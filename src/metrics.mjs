/**
 * Mesure et arbitrage des declenchements.
 *
 * Module pur : aucun acces au DOM, aucune horloge interne. Le temps est toujours
 * injecte, donc les tests sont deterministes.
 *
 * Deux responsabilites distinctes :
 *
 * - `createGate` decide s'il faut declencher. C'est la logique que le composant
 *   principal reprendra ; elle doit donc etre correcte independamment de la
 *   strategie DOM qui l'alimente.
 * - `createRecorder` compte, sans jamais decider. Il rend visible ce qui etait
 *   invisible lors des iterations precedentes.
 */

/** Etats exposes par la porte, volontairement limites a l'essentiel. */
export const GATE = {
  FIRE: 'fire',
  REARM: 'rearm',
  IDLE: 'idle',
  BLOCKED: 'blocked',
  UNMEASURABLE: 'unmeasurable',
};

/**
 * Porte a verrou avec hysteresis.
 *
 * Le probleme central d'un capteur de bas de liste n'est pas de detecter, c'est
 * de ne detecter qu'une fois. Sans verrou, rester en bas de la liste declenche a
 * chaque evenement de scroll. Sans hysteresis, osciller d'un pixel autour du
 * seuil declenche en rafale.
 *
 * Le verrou se ferme au declenchement et ne se rouvre que lorsque la sentinelle
 * est repartie franchement au-dessus du seuil, soit `margin + hysteresis`.
 */
export function createGate({ margin = 300, hysteresis = 80 } = {}) {
  const threshold = Number(margin) || 0;
  const slack = Math.max(0, Number(hysteresis) || 0);
  let armed = true;

  return {
    get armed() {
      return armed;
    },

    /**
     * `distance` est la distance sentinelle -> limite basse.
     * `null` signifie mesure impossible : on ne declenche pas, mais on ne
     * modifie pas non plus l'etat du verrou.
     */
    evaluate(distance) {
      if (distance === null || distance === undefined || Number.isNaN(Number(distance))) {
        return { action: GATE.UNMEASURABLE, armed };
      }

      const value = Number(distance);

      if (value <= threshold) {
        if (!armed) return { action: GATE.BLOCKED, armed };
        armed = false;
        return { action: GATE.FIRE, armed };
      }

      if (!armed && value > threshold + slack) {
        armed = true;
        return { action: GATE.REARM, armed };
      }

      return { action: GATE.IDLE, armed };
    },

    reset() {
      armed = true;
    },
  };
}

/**
 * Compteurs, debit d'echantillonnage et journal.
 *
 * `windowMs` borne la fenetre glissante du debit. `logSize` borne le journal :
 * un capteur en rafale ne doit pas pouvoir faire grossir la memoire.
 */
export function createRecorder({ logSize = 10, windowMs = 1000 } = {}) {
  const limit = Math.max(1, Number(logSize) || 1);
  const window = Math.max(1, Number(windowMs) || 1);

  let samples = 0;
  let fires = 0;
  let repeatFires = 0;
  let rearms = 0;
  let unmeasurable = 0;
  let firstFireAt = null;
  let lastFireAt = null;
  let startedAt = null;
  let sampleTimes = [];
  let log = [];

  const push = (now, type, detail) => {
    log = [{ at: Number(now) || 0, type, detail: detail ?? null }, ...log].slice(0, limit);
  };

  const prune = now => {
    const floor = Number(now) - window;
    sampleTimes = sampleTimes.filter(time => time >= floor);
  };

  return {
    start(now) {
      startedAt = Number(now) || 0;
    },

    /** Un echantillon est une evaluation de position, declenchement ou non. */
    sample(now) {
      samples += 1;
      sampleTimes.push(Number(now) || 0);
      prune(now);
    },

    record(now, action, detail) {
      switch (action) {
        case GATE.FIRE:
          fires += 1;
          if (firstFireAt === null) firstFireAt = Number(now) || 0;
          lastFireAt = Number(now) || 0;
          push(now, GATE.FIRE, detail);
          break;
        case GATE.BLOCKED:
          // Un declenchement refuse par le verrou. C'est exactement ce que
          // mesure ce repo : un compteur qui grimpe signale une strategie qui
          // declencherait en rafale sans verrou.
          repeatFires += 1;
          break;
        case GATE.REARM:
          rearms += 1;
          push(now, GATE.REARM, detail);
          break;
        case GATE.UNMEASURABLE:
          unmeasurable += 1;
          break;
        default:
          break;
      }
    },

    note(now, type, detail) {
      push(now, type, detail);
    },

    snapshot(now) {
      prune(now);
      const elapsed = startedAt === null ? 0 : Math.max(0, (Number(now) || 0) - startedAt);
      return {
        samples,
        fires,
        repeatFires,
        rearms,
        unmeasurable,
        firstFireAt,
        lastFireAt,
        startedAt,
        elapsedMs: elapsed,
        // Debit instantane sur la fenetre glissante, pas une moyenne depuis le
        // demarrage : c'est le cout CPU percu pendant un defilement actif.
        samplesPerSecond: Math.round((sampleTimes.length * 1000) / window),
        log: [...log],
      };
    },

    reset() {
      samples = 0;
      fires = 0;
      repeatFires = 0;
      rearms = 0;
      unmeasurable = 0;
      firstFireAt = null;
      lastFireAt = null;
      startedAt = null;
      sampleTimes = [];
      log = [];
    },
  };
}

/**
 * Traduit un releve en verdicts lisibles.
 *
 * `firedWithoutScroll` repond a la question qui a bloque le composant principal :
 * quand la liste est trop courte pour defiler, le capteur doit declencher seul.
 * S'il attend un evenement de scroll qui ne viendra jamais, rien ne se charge.
 */
export function verdicts(snapshot, { scrolled = false, fillsViewport = true } = {}) {
  const fires = snapshot?.fires ?? 0;
  const repeats = snapshot?.repeatFires ?? 0;
  const rate = snapshot?.samplesPerSecond ?? 0;

  return {
    neverFired: fires === 0,
    firedWithoutScroll: fires > 0 && !scrolled,
    // Liste trop courte pour defiler et pourtant aucun declenchement : le
    // capteur est inutilisable pour enchainer les premieres pages.
    stalledOnShortList: !fillsViewport && !scrolled && fires === 0,
    latchLeaking: repeats > 0,
    highSampleRate: rate > 30,
  };
}
