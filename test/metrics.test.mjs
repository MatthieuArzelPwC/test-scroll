import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GATE, createGate, createRecorder, verdicts } from '../src/metrics.mjs';

test('la porte declenche au franchissement du seuil', () => {
  const gate = createGate({ margin: 300, hysteresis: 80 });
  assert.equal(gate.evaluate(1000).action, GATE.IDLE);
  assert.equal(gate.evaluate(300).action, GATE.FIRE);
});

test('rester sous le seuil ne declenche qu une fois', () => {
  const gate = createGate({ margin: 300, hysteresis: 80 });
  assert.equal(gate.evaluate(120).action, GATE.FIRE);

  for (const distance of [100, 50, 0, -40, -300]) {
    assert.equal(gate.evaluate(distance).action, GATE.BLOCKED, `distance=${distance}`);
  }
});

test('l hysteresis empeche la rafale autour du seuil', () => {
  const gate = createGate({ margin: 300, hysteresis: 80 });
  assert.equal(gate.evaluate(290).action, GATE.FIRE);

  // Juste au-dessus du seuil mais dans la zone morte : pas de rearmement, donc
  // osciller d un pixel ne peut pas produire un second declenchement.
  assert.equal(gate.evaluate(310).action, GATE.IDLE);
  assert.equal(gate.evaluate(295).action, GATE.BLOCKED);
  assert.equal(gate.evaluate(380).action, GATE.IDLE);
  assert.equal(gate.evaluate(381).action, GATE.REARM);
  assert.equal(gate.evaluate(200).action, GATE.FIRE);
});

test('une hysteresis nulle rearme des que le seuil est repasse', () => {
  const gate = createGate({ margin: 100, hysteresis: 0 });
  assert.equal(gate.evaluate(50).action, GATE.FIRE);
  assert.equal(gate.evaluate(101).action, GATE.REARM);
});

test('une mesure impossible ne declenche pas et preserve le verrou', () => {
  const gate = createGate({ margin: 300 });
  assert.equal(gate.evaluate(null).action, GATE.UNMEASURABLE);
  assert.equal(gate.armed, true);

  gate.evaluate(10);
  assert.equal(gate.armed, false);
  assert.equal(gate.evaluate(undefined).action, GATE.UNMEASURABLE);
  assert.equal(gate.armed, false);
});

test('reset rouvre le verrou', () => {
  const gate = createGate({ margin: 300 });
  gate.evaluate(0);
  assert.equal(gate.armed, false);
  gate.reset();
  assert.equal(gate.armed, true);
  assert.equal(gate.evaluate(0).action, GATE.FIRE);
});

test('une sequence de defilement complete ne declenche qu une fois par approche', () => {
  const gate = createGate({ margin: 300, hysteresis: 80 });
  // Approche, sejour en bas, remontee franche, nouvelle approche.
  const distances = [900, 700, 500, 310, 280, 120, 0, -100, 200, 500, 900, 400, 250];
  const fires = distances.filter(distance => gate.evaluate(distance).action === GATE.FIRE);
  assert.equal(fires.length, 2);
});

test('le recorder distingue declenchements acceptes et refuses', () => {
  const gate = createGate({ margin: 300, hysteresis: 80 });
  const recorder = createRecorder({ logSize: 5, windowMs: 1000 });
  recorder.start(0);

  let now = 0;
  for (const distance of [900, 250, 100, 50, 900, 1000, 200]) {
    now += 100;
    recorder.sample(now);
    const { action } = gate.evaluate(distance);
    recorder.record(now, action, distance);
  }

  const snapshot = recorder.snapshot(now);
  assert.equal(snapshot.fires, 2);
  assert.equal(snapshot.repeatFires, 2);
  assert.equal(snapshot.rearms, 1);
  assert.equal(snapshot.samples, 7);
});

test('le journal est borne et le plus recent vient en tete', () => {
  const recorder = createRecorder({ logSize: 3 });
  recorder.start(0);
  for (let i = 1; i <= 6; i += 1) recorder.record(i * 10, GATE.FIRE, i);

  const { log } = recorder.snapshot(100);
  assert.equal(log.length, 3);
  assert.deepEqual(log.map(entry => entry.detail), [6, 5, 4]);
});

test('le debit est calcule sur une fenetre glissante et non depuis le demarrage', () => {
  const recorder = createRecorder({ windowMs: 1000 });
  recorder.start(0);

  // Dix echantillons dans la premiere seconde.
  for (let i = 1; i <= 10; i += 1) recorder.sample(i * 100);
  assert.equal(recorder.snapshot(1000).samplesPerSecond, 10);

  // Dix secondes plus tard, sans nouvel echantillon, le debit retombe a zero.
  assert.equal(recorder.snapshot(11000).samplesPerSecond, 0);
});

test('le premier et le dernier declenchement sont horodates', () => {
  const recorder = createRecorder();
  recorder.start(0);
  recorder.record(250, GATE.FIRE, null);
  recorder.record(900, GATE.FIRE, null);

  const snapshot = recorder.snapshot(1000);
  assert.equal(snapshot.firstFireAt, 250);
  assert.equal(snapshot.lastFireAt, 900);
  assert.equal(snapshot.elapsedMs, 1000);
});

test('les mesures impossibles sont comptees a part', () => {
  const recorder = createRecorder();
  recorder.start(0);
  recorder.record(10, GATE.UNMEASURABLE, null);
  recorder.record(20, GATE.UNMEASURABLE, null);

  const snapshot = recorder.snapshot(30);
  assert.equal(snapshot.unmeasurable, 2);
  assert.equal(snapshot.fires, 0);
});

test('reset remet tous les compteurs a zero', () => {
  const recorder = createRecorder();
  recorder.start(0);
  recorder.sample(10);
  recorder.record(10, GATE.FIRE, null);
  recorder.reset();

  const snapshot = recorder.snapshot(100);
  assert.equal(snapshot.samples, 0);
  assert.equal(snapshot.fires, 0);
  assert.equal(snapshot.log.length, 0);
  assert.equal(snapshot.startedAt, null);
});

test('aucun declenchement est signale comme tel', () => {
  const result = verdicts({ fires: 0, repeatFires: 0, samplesPerSecond: 4 }, { scrolled: true });
  assert.equal(result.neverFired, true);
  assert.equal(result.latchLeaking, false);
});

test('une liste trop courte sans declenchement est un blocage', () => {
  const result = verdicts(
    { fires: 0, repeatFires: 0, samplesPerSecond: 0 },
    { scrolled: false, fillsViewport: false }
  );
  assert.equal(result.stalledOnShortList, true);
});

test('declencher sans defilement est attendu sur une liste trop courte', () => {
  const result = verdicts(
    { fires: 1, repeatFires: 0, samplesPerSecond: 0 },
    { scrolled: false, fillsViewport: false }
  );
  assert.equal(result.firedWithoutScroll, true);
  assert.equal(result.stalledOnShortList, false);
});

test('un verrou qui fuit et un debit excessif sont signales', () => {
  const result = verdicts({ fires: 3, repeatFires: 12, samplesPerSecond: 58 }, { scrolled: true });
  assert.equal(result.latchLeaking, true);
  assert.equal(result.highSampleRate, true);
});

test('verdicts tolere un releve absent', () => {
  const result = verdicts(null, {});
  assert.equal(result.neverFired, true);
  assert.equal(result.latchLeaking, false);
});
