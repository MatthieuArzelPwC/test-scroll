<template>
  <div ref="root" class="ts">
    <div class="ts__list" :style="{ '--row-height': `${rowHeight}px` }">
      <div v-for="row in rowCount" :key="row" class="ts__row">
        <span class="ts__index">{{ row }}</span>
        <span class="ts__bar" :style="{ width: `${20 + ((row * 37) % 70)}%` }"></span>
      </div>
      <p v-if="rowCount === 0" class="ts__empty">
        Aucune ligne : cas de la liste trop courte pour defiler.
      </p>
    </div>

    <div ref="sentinel" class="ts__sentinel" aria-hidden="true"></div>

    <div v-if="content.debug" class="ts__hud" aria-live="off">
      <div class="ts__hud-head">
        <strong>{{ strategyLabel }}</strong>
        <button type="button" class="ts__reset" @click="resetMeasures">reset</button>
      </div>

      <dl class="ts__grid">
        <div :class="{ '-bad': flags.neverFired }">
          <dt>fires</dt>
          <dd>{{ snapshot.fires }}</dd>
        </div>
        <div :class="{ '-bad': flags.latchLeaking }">
          <dt>blocked</dt>
          <dd>{{ snapshot.repeatFires }}</dd>
        </div>
        <div>
          <dt>rearms</dt>
          <dd>{{ snapshot.rearms }}</dd>
        </div>
        <div :class="{ '-warn': flags.highSampleRate }">
          <dt>samples/s</dt>
          <dd>{{ snapshot.samplesPerSecond }}</dd>
        </div>
        <div>
          <dt>samples</dt>
          <dd>{{ snapshot.samples }}</dd>
        </div>
        <div :class="{ '-warn': snapshot.unmeasurable > 0 }">
          <dt>unmeasured</dt>
          <dd>{{ snapshot.unmeasurable }}</dd>
        </div>
      </dl>

      <dl class="ts__rows">
        <div>
          <dt>scroll container</dt>
          <dd>{{ environment.scrollContainer || '-' }}</dd>
        </div>
        <div>
          <dt>distance / seuil</dt>
          <dd>{{ formatDistance(lastDistance) }} / {{ margin }}px</dd>
        </div>
        <div>
          <dt>scrollTop</dt>
          <dd>{{ environment.scrollTop }} / {{ environment.scrollHeight }}</dd>
        </div>
        <div>
          <dt>clientHeight</dt>
          <dd>{{ environment.clientHeight }}</dd>
        </div>
        <div>
          <dt>limite basse</dt>
          <dd>{{ environment.boundary }}px</dd>
        </div>
        <div>
          <dt>verrou</dt>
          <dd>{{ armed ? 'arme' : 'ferme' }}</dd>
        </div>
      </dl>

      <ul class="ts__verdicts">
        <li v-if="environment.unsupported" class="-bad">non supporte : {{ environment.reason }}</li>
        <li v-if="environment.scrollendSupported === false" class="-warn">scrollend absent : repli debounce</li>
        <li v-if="flags.stalledOnShortList" class="-bad">liste trop courte et aucun declenchement</li>
        <li v-if="flags.firedWithoutScroll" class="-ok">declenche sans defilement (attendu si liste courte)</li>
        <li v-if="flags.latchLeaking" class="-bad">verrou sollicite en rafale</li>
        <li v-if="flags.neverFired" class="-warn">aucun declenchement pour l instant</li>
      </ul>

      <ol v-if="snapshot.log.length" class="ts__log">
        <li v-for="(entry, index) in snapshot.log" :key="`${entry.at}-${index}`">
          <code>{{ formatTime(entry.at) }}</code>
          <span :class="entry.type === 'fire' ? '-ok' : '-dim'">{{ entry.type }}</span>
          <span class="-dim">{{ formatDistance(entry.detail) }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { GATE, createGate, createRecorder, verdicts } from './metrics.mjs';
import { STRATEGIES, STRATEGY_LABELS, startStrategy } from './strategies.mjs';

/** Cadence de rafraichissement du HUD, independante de celle des mesures. */
const HUD_INTERVAL_MS = 200;

export default {
  props: {
    content: { type: Object, required: true },
    uid: { type: String, required: true },
    /* wwEditor:start */
    wwEditorState: { type: Object, required: true },
    /* wwEditor:end */
  },
  emits: ['trigger-event'],
  setup(props, { emit }) {
    const root = ref(null);
    const sentinel = ref(null);

    const snapshot = ref({
      samples: 0,
      fires: 0,
      repeatFires: 0,
      rearms: 0,
      unmeasurable: 0,
      samplesPerSecond: 0,
      elapsedMs: 0,
      log: [],
    });
    const environment = ref({});
    const lastDistance = ref(null);
    const armed = ref(true);
    const hasScrolled = ref(false);

    let gate = null;
    let recorder = null;
    let stopStrategy = null;
    let hudTimer = null;

    const toNumber = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const strategy = computed(() => {
      const value = props.content.strategy;
      return Object.values(STRATEGIES).includes(value) ? value : STRATEGIES.INTERSECTION;
    });
    const strategyLabel = computed(() => STRATEGY_LABELS[strategy.value] || strategy.value);
    const margin = computed(() => Math.max(0, toNumber(props.content.margin, 300)));
    const hysteresis = computed(() => Math.max(0, toNumber(props.content.hysteresis, 80)));
    const rowCount = computed(() => Math.max(0, Math.round(toNumber(props.content.rows, 40))));
    const rowHeight = computed(() => Math.max(8, toNumber(props.content.rowHeight, 48)));

    /**
     * Une liste qui ne deborde pas de son conteneur ne produira jamais
     * d'evenement de scroll. C'est le cas qui bloquait le composant principal.
     */
    const fillsViewport = computed(() => {
      const { scrollHeight = 0, clientHeight = 0 } = environment.value || {};
      return scrollHeight > clientHeight + 1;
    });

    const flags = computed(() =>
      verdicts(snapshot.value, { scrolled: hasScrolled.value, fillsViewport: fillsViewport.value })
    );

    const now = () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

    const refreshHud = () => {
      if (!recorder) return;
      snapshot.value = recorder.snapshot(now());
      armed.value = gate ? gate.armed : true;
    };

    const onSample = distance => {
      if (!gate || !recorder) return;

      const at = now();
      recorder.sample(at);
      lastDistance.value = distance;

      const { action } = gate.evaluate(distance);
      recorder.record(at, action, distance);

      if (action !== GATE.FIRE) return;

      const payload = {
        count: recorder.snapshot(at).fires,
        distance: Math.round(Number(distance) || 0),
        strategy: strategy.value,
        scrollContainer: environment.value?.scrollContainer || 'viewport',
      };

      if (props.content.logToConsole) {
        console.info('[test-scroll] reachBottom', payload);
      }

      emit('trigger-event', { name: 'reachBottom', event: payload });
    };

    const onInfo = details => {
      environment.value = { ...environment.value, ...details };
      // Un scrollTop non nul est la seule preuve qu'un defilement a eu lieu ;
      // elle distingue "declenche en defilant" de "declenche a l arret".
      if ((details?.scrollTop ?? 0) > 0) hasScrolled.value = true;
    };

    const teardown = () => {
      if (typeof stopStrategy === 'function') stopStrategy();
      stopStrategy = null;
      if (hudTimer !== null) {
        clearInterval(hudTimer);
        hudTimer = null;
      }
    };

    const setup = () => {
      teardown();

      gate = createGate({ margin: margin.value, hysteresis: hysteresis.value });
      recorder = createRecorder({ logSize: 10, windowMs: 1000 });
      recorder.start(now());

      lastDistance.value = null;
      hasScrolled.value = false;
      environment.value = {};
      refreshHud();

      stopStrategy = startStrategy(strategy.value, {
        root: root.value,
        sentinel: sentinel.value,
        margin: margin.value,
        onSample,
        onInfo,
      });

      if (typeof window !== 'undefined') {
        hudTimer = setInterval(refreshHud, HUD_INTERVAL_MS);
      }
    };

    const resetMeasures = () => {
      // Remonte une strategie neuve : comparer deux strategies exige de repartir
      // d'un etat identique.
      nextTick(setup);
    };

    // Tout changement de reglage reconstruit le capteur : un verrou ou un
    // compteur herite d'un reglage precedent rendrait la mesure fausse.
    watch([strategy, margin, hysteresis, rowCount, rowHeight], () => nextTick(setup));
    onMounted(() => nextTick(setup));
    onBeforeUnmount(teardown);

    const formatDistance = value => {
      if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
      return `${Math.round(Number(value))}px`;
    };

    const formatTime = value => `${(Number(value) / 1000).toFixed(2)}s`;

    return {
      root,
      sentinel,
      snapshot,
      environment,
      lastDistance,
      armed,
      flags,
      strategyLabel,
      margin,
      rowCount,
      rowHeight,
      resetMeasures,
      formatDistance,
      formatTime,
    };
  },
};
</script>

<style scoped>
.ts {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.ts__row {
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  height: var(--row-height);
  padding: 0 12px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.18);
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.ts__index {
  flex: 0 0 48px;
  opacity: 0.55;
}

.ts__bar {
  height: 8px;
  border-radius: 4px;
  background: currentColor;
  opacity: 0.22;
}

.ts__empty {
  margin: 0;
  padding: 16px 12px;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  opacity: 0.7;
}

.ts__sentinel {
  width: 100%;
  height: 1px;
}

.ts__hud {
  position: sticky;
  bottom: 0;
  left: 0;
  z-index: 10;
  box-sizing: border-box;
  padding: 8px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(14, 16, 20, 0.93);
  color: #e6e8ec;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  backdrop-filter: blur(6px);
}

.ts__hud-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.ts__reset {
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.ts__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
  gap: 2px 8px;
  margin: 0 0 6px;
}

.ts__grid > div {
  display: flex;
  flex-direction: column;
  padding: 2px 4px;
  border-radius: 3px;
}

.ts__grid dt,
.ts__rows dt {
  opacity: 0.55;
}

.ts__grid dd,
.ts__rows dd {
  margin: 0;
  font-weight: 700;
}

.ts__rows {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0 10px;
  margin: 0;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.ts__rows > div {
  display: flex;
  gap: 6px;
  justify-content: space-between;
}

.ts__verdicts {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.ts__log {
  margin: 6px 0 0;
  padding: 5px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  list-style: none;
  max-height: 86px;
  overflow-y: auto;
}

.ts__log li {
  display: flex;
  gap: 8px;
}

.ts__log code {
  opacity: 0.5;
}

.-ok {
  color: #46d98a;
}

.-warn {
  color: #ffc94d;
}

.-bad {
  color: #ff6b6b;
}

.-dim {
  opacity: 0.55;
}

.ts__grid > div.-bad,
.ts__grid > div.-warn {
  background: rgba(255, 255, 255, 0.07);
}
</style>
