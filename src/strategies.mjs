/**
 * Les trois strategies de detection du bas de liste, derriere une interface
 * unique afin d'etre comparables a chaud dans le Studio.
 *
 * Contrat commun :
 *
 *   start({ root, sentinel, margin, onSample, onInfo }) -> stop()
 *
 * `onSample(distance)` est appele a chaque evaluation de position. `distance`
 * est la distance entre le haut de la sentinelle et la limite basse de la zone
 * visible, ou `null` si la mesure est impossible. La decision de declencher
 * n'appartient pas aux strategies : elle est prise par `createGate` dans
 * metrics.mjs. Ainsi, comparer deux strategies compare bien la detection, et
 * non deux politiques de declenchement differentes.
 *
 * `onInfo(details)` remonte au HUD ce que la strategie a observe de son
 * environnement : conteneur retenu, dimensions, mode de repli.
 */

import { findScrollParent, distanceToBottom, describeNode } from './scrollParent.mjs';

export const STRATEGIES = {
  INTERSECTION: 'intersection',
  SCROLL_CAPTURE: 'scrollCapture',
  SCROLL_END: 'scrollend',
};

export const STRATEGY_LABELS = {
  [STRATEGIES.INTERSECTION]: 'IntersectionObserver',
  [STRATEGIES.SCROLL_CAPTURE]: 'scroll (capture) + rAF',
  [STRATEGIES.SCROLL_END]: 'scrollend',
};

const hasDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Resout le conteneur qui defile et decrit l'environnement pour le HUD. */
function resolveContext(root) {
  if (!hasDom() || !root) {
    return { scrollParent: null, viewportHeight: 0, label: 'viewport' };
  }

  const scrollParent = findScrollParent(root, {
    getStyle: element => window.getComputedStyle(element),
    stopAt: [document.body, document.documentElement],
  });

  return {
    scrollParent,
    viewportHeight: window.innerHeight,
    label: describeNode(scrollParent, { isViewport: !scrollParent }),
  };
}

function describeEnvironment(root, context) {
  const target = context.scrollParent || (hasDom() ? document.documentElement : null);
  return {
    scrollContainer: context.label,
    isViewportScroll: !context.scrollParent,
    scrollTop: Math.round(target?.scrollTop ?? 0),
    scrollHeight: Math.round(target?.scrollHeight ?? 0),
    clientHeight: Math.round(target?.clientHeight ?? context.viewportHeight ?? 0),
    boundary: Math.round(
      context.scrollParent ? context.scrollParent.getBoundingClientRect().bottom : context.viewportHeight
    ),
    sentinelTop: null,
    rootHeight: Math.round(root?.getBoundingClientRect?.().height ?? 0),
  };
}

/**
 * Strategie 1 : IntersectionObserver.
 *
 * Standard du marche, et volontairement remise a l'essai ici : elle avait ete
 * retiree du composant principal sans qu'une mesure en justifie l'abandon.
 *
 * Deux points la rendent delicate dans WeWeb :
 *
 * - `root` doit etre le conteneur qui defile reellement, sinon les ratios sont
 *   calcules contre le viewport et le seuil ne correspond a rien ;
 * - l'observateur ne reemet rien si la sentinelle reste visible sans bouger. Un
 *   `onSample` complementaire est donc necessaire pour que la porte voie la
 *   position courante, notamment quand la liste est trop courte pour defiler.
 */
function startIntersection({ root, sentinel, margin, onSample, onInfo }) {
  if (!hasDom() || !sentinel || typeof window.IntersectionObserver !== 'function') {
    onInfo?.({ unsupported: true, reason: 'IntersectionObserver indisponible' });
    return () => {};
  }

  const context = resolveContext(root);
  onInfo?.({ ...describeEnvironment(root, context), observerRoot: context.label });

  const measure = () => distanceToBottom(sentinel, context.scrollParent, window.innerHeight);

  const observer = new window.IntersectionObserver(
    entries => {
      for (const entry of entries) {
        // On ignore volontairement `isIntersecting` : la porte raisonne en
        // distance, ce qui rend les trois strategies comparables.
        void entry;
        onSample?.(measure());
      }
    },
    {
      root: context.scrollParent || null,
      rootMargin: `0px 0px ${Math.max(0, Math.round(Number(margin) || 0))}px 0px`,
      threshold: 0,
    }
  );

  observer.observe(sentinel);

  // Evaluation initiale : si la liste tient deja dans l'ecran, aucun evenement
  // ne viendra jamais et le capteur paraitrait inerte.
  const initial = window.requestAnimationFrame(() => onSample?.(measure()));

  const onResize = () => onSample?.(measure());
  window.addEventListener('resize', onResize, { passive: true });

  return () => {
    observer.disconnect();
    window.cancelAnimationFrame(initial);
    window.removeEventListener('resize', onResize);
  };
}

/**
 * Strategie 2 : ecoute du scroll en capture sur document, throttlee par rAF.
 *
 * C'est l'approche du composant principal, conservee comme reference de
 * comparaison. Un scroll d'element ne remonte pas par bouillonnement : la
 * capture sur document est le seul moyen de recevoir celui d'un wrapper WeWeb
 * quelconque sans savoir lequel defile.
 *
 * Cout : une mesure de position a chaque frame de defilement, donc un recalcul
 * de style force. C'est precisement ce que `samplesPerSecond` mesure.
 */
function startScrollCapture({ root, sentinel, onSample, onInfo }) {
  if (!hasDom() || !sentinel) {
    onInfo?.({ unsupported: true, reason: 'DOM indisponible' });
    return () => {};
  }

  let context = resolveContext(root);
  onInfo?.(describeEnvironment(root, context));

  let frame = null;

  const evaluate = () => {
    frame = null;
    // Le conteneur scrollable peut changer : contenu qui grandit, wrapper
    // redimensionne, passage responsive. On le resout a chaque mesure.
    context = resolveContext(root);
    onInfo?.(describeEnvironment(root, context));
    onSample?.(distanceToBottom(sentinel, context.scrollParent, window.innerHeight));
  };

  const schedule = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(evaluate);
  };

  document.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  schedule();

  return () => {
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
  };
}

/**
 * Strategie 3 : scrollend.
 *
 * N'evalue qu'a l'arret du defilement. Sert d'etalon de cout : l'ecart de
 * `samplesPerSecond` avec la strategie 2 donne le nombre d'evaluations que
 * celle-ci effectue sans necessite.
 *
 * Contrepartie attendue : un chargement qui ne demarre qu'apres l'arret du
 * doigt ou de la molette, donc une latence percue. Support partiel selon les
 * navigateurs, d'ou le repli explicite signale au HUD.
 */
function startScrollEnd({ root, sentinel, onSample, onInfo }) {
  if (!hasDom() || !sentinel) {
    onInfo?.({ unsupported: true, reason: 'DOM indisponible' });
    return () => {};
  }

  const supported = 'onscrollend' in window;
  let context = resolveContext(root);
  onInfo?.({ ...describeEnvironment(root, context), scrollendSupported: supported });

  const evaluate = () => {
    context = resolveContext(root);
    onInfo?.({ ...describeEnvironment(root, context), scrollendSupported: supported });
    onSample?.(distanceToBottom(sentinel, context.scrollParent, window.innerHeight));
  };

  let idleTimer = null;
  // Repli pour les navigateurs sans scrollend : un debounce reproduit la meme
  // semantique, afin que la comparaison reste possible partout.
  const onFallbackScroll = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      evaluate();
    }, 120);
  };

  if (supported) {
    document.addEventListener('scrollend', evaluate, { capture: true, passive: true });
  } else {
    document.addEventListener('scroll', onFallbackScroll, { capture: true, passive: true });
  }
  window.addEventListener('resize', evaluate, { passive: true });
  evaluate();

  return () => {
    if (supported) {
      document.removeEventListener('scrollend', evaluate, true);
    } else {
      document.removeEventListener('scroll', onFallbackScroll, true);
    }
    window.removeEventListener('resize', evaluate);
    if (idleTimer !== null) clearTimeout(idleTimer);
  };
}

const IMPLEMENTATIONS = {
  [STRATEGIES.INTERSECTION]: startIntersection,
  [STRATEGIES.SCROLL_CAPTURE]: startScrollCapture,
  [STRATEGIES.SCROLL_END]: startScrollEnd,
};

/** Demarre la strategie demandee et retourne sa fonction d'arret. */
export function startStrategy(name, options) {
  const implementation = IMPLEMENTATIONS[name] || IMPLEMENTATIONS[STRATEGIES.INTERSECTION];
  return implementation(options);
}
