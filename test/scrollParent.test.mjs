import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCROLLABLE_OVERFLOWS,
  isScrollable,
  findScrollParent,
  bottomBoundary,
  distanceToBottom,
  describeNode,
} from '../src/scrollParent.mjs';

/**
 * Fabrique de noeuds factices.
 *
 * Les tests portent sur le comportement observable du module, jamais sur le
 * texte de son code source.
 */
function node({ tag = 'div', overflowY = 'visible', scrollHeight = 100, clientHeight = 100, top = 0, bottom = 100, className = '', parent = null } = {}) {
  return {
    tagName: tag.toUpperCase(),
    className,
    scrollHeight,
    clientHeight,
    parentElement: parent,
    __overflowY: overflowY,
    getBoundingClientRect: () => ({ top, bottom }),
  };
}

const getStyle = element => ({ overflowY: element.__overflowY });

test('un overflow scrollable sans debordement ne defile pas', () => {
  const element = node({ overflowY: 'auto', scrollHeight: 100, clientHeight: 100 });
  assert.equal(isScrollable(element, getStyle), false);
});

test('un debordement sans overflow scrollable ne defile pas', () => {
  const element = node({ overflowY: 'visible', scrollHeight: 500, clientHeight: 100 });
  assert.equal(isScrollable(element, getStyle), false);
});

test('overflow scrollable et debordement reel defilent', () => {
  for (const overflowY of SCROLLABLE_OVERFLOWS) {
    const element = node({ overflowY, scrollHeight: 500, clientHeight: 100 });
    assert.equal(isScrollable(element, getStyle), true, overflowY);
  }
});

test('un debordement de un pixel est absorbe par la tolerance sub-pixel', () => {
  const element = node({ overflowY: 'auto', scrollHeight: 101, clientHeight: 100 });
  assert.equal(isScrollable(element, getStyle), false);

  const real = node({ overflowY: 'auto', scrollHeight: 102, clientHeight: 100 });
  assert.equal(isScrollable(real, getStyle), true);
});

test('findScrollParent retient le conteneur scrollable le plus proche', () => {
  const outer = node({ tag: 'section', overflowY: 'scroll', scrollHeight: 900, clientHeight: 300 });
  const middle = node({ overflowY: 'auto', scrollHeight: 600, clientHeight: 200, parent: outer });
  const inner = node({ overflowY: 'visible', parent: middle });

  assert.equal(findScrollParent(inner, { getStyle }), middle);
});

test('findScrollParent retourne le composant lui meme quand c est lui qui defile', () => {
  const root = node({ overflowY: 'auto', scrollHeight: 800, clientHeight: 400 });
  assert.equal(findScrollParent(root, { getStyle }), root);
});

test('findScrollParent retourne null quand le scroll appartient a la page', () => {
  const body = node({ tag: 'body' });
  const wrapper = node({ overflowY: 'visible', parent: body });
  const root = node({ overflowY: 'hidden', parent: wrapper });

  assert.equal(findScrollParent(root, { getStyle, stopAt: [body] }), null);
});

test('findScrollParent n explore pas au dela des noeuds d arret', () => {
  const scrollableBody = node({ tag: 'body', overflowY: 'auto', scrollHeight: 2000, clientHeight: 500 });
  const root = node({ overflowY: 'visible', parent: scrollableBody });

  assert.equal(findScrollParent(root, { getStyle, stopAt: [scrollableBody] }), null);
});

test('findScrollParent resiste a une chaine de parents circulaire', () => {
  const a = node({ overflowY: 'visible' });
  const b = node({ overflowY: 'visible', parent: a });
  a.parentElement = b;

  assert.equal(findScrollParent(b, { getStyle, maxDepth: 10 }), null);
});

test('bottomBoundary suit le conteneur quand il existe, le viewport sinon', () => {
  const container = node({ bottom: 640 });
  assert.equal(bottomBoundary(container, 900), 640);
  assert.equal(bottomBoundary(null, 900), 900);
});

test('distanceToBottom est positive avant le seuil et negative apres', () => {
  const container = node({ bottom: 600 });

  const far = node({ top: 1200 });
  assert.equal(distanceToBottom(far, container, 900), 600);

  const passed = node({ top: 450 });
  assert.equal(distanceToBottom(passed, container, 900), -150);
});

test('distanceToBottom signale une mesure impossible au lieu de retourner zero', () => {
  assert.equal(distanceToBottom(null, node({ bottom: 600 }), 900), null);
});

test('describeNode produit une etiquette lisible pour le HUD', () => {
  assert.equal(describeNode(node({ tag: 'section', className: 'ww-flexbox list' })), 'section.ww-flexbox.list');
  assert.equal(describeNode(node({ tag: 'div', className: '   ' })), 'div');
  assert.equal(describeNode(null), 'viewport');
  assert.equal(describeNode(node({ tag: 'div' }), { isViewport: true }), 'viewport');
});

test('describeNode borne le nombre de classes affichees', () => {
  const label = describeNode(node({ tag: 'div', className: 'a b c d e' }));
  assert.equal(label, 'div.a.b.c');
});
