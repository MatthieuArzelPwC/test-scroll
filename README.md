# test-scroll — capteur de bas de liste (R&D)

Composant WeWeb de recherche. Il répond à **une seule question** : comment détecter de façon fiable qu'on approche du bas d'une liste, quand le conteneur qui défile peut être le composant, un wrapper WeWeb quelconque, ou la page.

Il n'affiche pas de collection, n'appelle pas `wwLib.wwCollection`, ne pagine rien. Le contenu est généré localement. Un échec ne peut donc être imputé qu'à la détection.

La stratégie gagnante sera recopiée dans le composant `infinite-collection`.

## Pourquoi ce repo existe

Le composant `infinite-collection` a consommé quatre commits correctifs successifs sur le déclenchement au scroll (`e0818c7`, `311baf6`, `82e17f4`, `5f6ef53`), dont un retrait d'`IntersectionObserver` sans mesure pour le justifier. Le diagnostic était impossible : impossible de distinguer « ça ne charge pas » (pagination) de « ça ne déclenche pas » (scroll).

Ici, le capteur est isolé et **instrumenté**. On décide par mesure.

## Architecture

| Fichier | Rôle | Dépendances |
|---|---|---|
| `src/scrollParent.mjs` | trouve le conteneur qui défile, calcule la distance au bas | pure, DOM injecté |
| `src/metrics.mjs` | décide s'il faut déclencher (`createGate`), compte (`createRecorder`) | pure, horloge injectée |
| `src/strategies.mjs` | les 3 mécanismes derrière une interface unique | DOM |
| `src/wwElement.vue` | assemblage + HUD | Vue |

Point de conception important : **les stratégies ne décident pas**. Elles se contentent d'appeler `onSample(distance)`. La décision appartient à `createGate`. Comparer deux stratégies compare donc bien la détection, et non deux politiques de déclenchement différentes.

## Les 3 stratégies

| Valeur | Mécanisme | Hypothèse testée |
|---|---|---|
| `intersection` | `IntersectionObserver` avec `root` = conteneur détecté, `rootMargin` bas | Standard du marché. Remise à l'essai après son retrait non justifié. |
| `scrollCapture` | `scroll` en capture sur `document` + throttle rAF | L'approche actuelle du composant principal. Sert de référence. |
| `scrollend` | n'évalue qu'à l'arrêt du défilement | Étalon de coût : l'écart de `samples/s` avec `scrollCapture` donne le nombre d'évaluations inutiles de cette dernière. |

## Protocole de mesure

### Installation

```bash
npm install
npm run build     # produit dist/manager.js
npm run serve     # dev dans le Studio
```

Poser le composant, laisser `debug` activé.

### Les 5 scénarios

Pour **chacune** des 3 stratégies, relever le HUD. Cliquer `reset` entre deux essais.

| # | Montage | `rows` | Ce qu'on vérifie | Attendu |
|---|---|---|---|---|
| 1 | Hauteur fixe sur le composant (ex. 400px) | 40 | le composant défile lui-même | `fires` ≥ 1, `scroll container` = le composant |
| 2 | Dans une Flexbox à hauteur fixe, composant en hauteur auto | 40 | le scroll appartient à un **wrapper** | `fires` ≥ 1, `scroll container` = la Flexbox |
| 3 | Page qui défile, composant en hauteur auto | 60 | le scroll appartient à la **page** | `fires` ≥ 1, `scroll container` = `viewport` |
| 4 | N'importe lequel | 0 à 3 | **liste trop courte pour défiler** | `fires` = 1 sans toucher la molette |
| 5 | Scénario 1, défiler vite de haut en bas plusieurs fois | 200 | rafale et coût | `blocked` faible, `samples/s` comparé |

Le scénario 2 est celui qui a cassé historiquement : un `scroll` d'élément ne remonte pas par bouillonnement.

Le scénario 4 est celui qui bloquait l'enchaînement des premières pages : sans défilement, aucun événement, donc aucun chargement, donc la liste reste trop courte. Blocage définitif.

### Lecture du HUD

| Champ | Signification | Seuil d'alerte |
|---|---|---|
| `fires` | déclenchements acceptés | `0` après défilement = échec |
| `blocked` | déclenchements refusés par le verrou | monte vite = la stratégie déclencherait en rafale sans verrou |
| `rearms` | réarmements après remontée | normal, informatif |
| `samples/s` | évaluations par seconde, fenêtre glissante 1s | > 30 = coût CPU notable |
| `unmeasured` | mesures impossibles | > 0 = sentinelle non mesurable, anormal |
| `scroll container` | conteneur retenu | **le premier champ à lire** quand rien ne se déclenche |
| `distance / seuil` | position courante vs `margin` | permet de vérifier le seuil à l'œil |
| `verrou` | `armé` / `fermé` | `fermé` durablement = pas de réarmement |

Lignes de verdict affichées automatiquement :

- `liste trop courte et aucun déclenchement` → échec du scénario 4
- `déclenché sans défilement` → **attendu** sur liste courte, c'est un succès
- `verrou sollicité en rafale` → à mettre en regard de `samples/s`
- `scrollend absent : repli debounce` → le navigateur ne supporte pas `scrollend`

### Isoler le verrou

Mettre `hysteresis` à `0` et osciller autour du seuil : `blocked` grimpe. C'est la démonstration du phénomène que l'hystérésis neutralise. Remettre à `80` pour les mesures de référence.

## Grille de décision

Une stratégie est retenue si elle satisfait **les quatre** critères :

1. **Déclenche dans les 3 montages** (scénarios 1, 2, 3) — critère éliminatoire
2. **Déclenche sur liste trop courte** (scénario 4) — critère éliminatoire
3. `blocked` reste bas en défilement rapide (scénario 5)
4. `samples/s` le plus faible parmi celles qui passent 1 à 3

Si `intersection` passe 1 et 2, elle gagne : elle est native, la moins coûteuse, et n'écoute rien globalement. Si elle échoue en 2 (root mal résolu dans WeWeb), `scrollCapture` reste la solution, et on aura la mesure qui justifie son coût.

Consigner le résultat dans ce README avant de porter le code.

## Résultats

| Stratégie | Sc. 1 | Sc. 2 | Sc. 3 | Sc. 4 | `blocked` | `samples/s` | Verdict |
|---|---|---|---|---|---|---|---|
| `intersection` | | | | | | | |
| `scrollCapture` | | | | | | | |
| `scrollend` | | | | | | | |

## Développement

```bash
npm test          # modules purs uniquement
npm run build
```

Aucune dépendance runtime.

**Règle de test explicite : aucune assertion par expression régulière sur le texte source.** C'est la dette principale du composant `infinite-collection`, où 38 assertions figent l'implémentation et protègent quatre bugs. Ici, les modules purs sont testés par leur comportement, et le reste se valide dans le Studio via le HUD.

## Hors périmètre

Pas de collection, pas de `setOffset`, pas d'accumulation, pas de virtualisation, pas de migration. Ce repo répond à une question et s'arrête là.
