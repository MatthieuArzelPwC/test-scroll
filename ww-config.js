// Composant de R&D : il ne detecte que l'approche du bas d'une liste.
//
// Perimetre volontairement etroit : aucune collection, aucun appel a
// wwLib.wwCollection, aucune pagination. Le contenu est genere localement afin
// qu'un echec ne puisse etre impute qu'a la detection elle-meme.

const strategyHelp =
  "Mecanisme de detection. Commutable a chaud pour comparer les trois approches dans les memes conditions d'integration.";

const marginHelp =
  "Distance au bas du conteneur, en pixels, a partir de laquelle le capteur declenche. Equivalent du rootMargin.";

export default {
  options: {
    displayAllowedValues: ['block', 'flex'],
  },
  editor: {
    label: {
      en: 'Scroll sensor (R&D)',
      fr: 'Capteur de scroll (R&D)',
    },
    icon: 'cursor',
    bubble: {
      icon: 'cursor',
    },
  },
  triggerEvents: [
    {
      name: 'reachBottom',
      label: { en: 'On reach bottom', fr: 'A l approche du bas' },
      event: { count: 0, distance: 0, strategy: '', scrollContainer: '' },
    },
  ],
  properties: {
    strategy: {
      label: {
        en: 'Strategy',
        fr: 'Strategie',
      },
      section: 'settings',
      type: 'TextSelect',
      options: {
        options: [
          { value: 'intersection', label: { en: 'IntersectionObserver', fr: 'IntersectionObserver' } },
          { value: 'scrollCapture', label: { en: 'scroll (capture) + rAF', fr: 'scroll (capture) + rAF' } },
          { value: 'scrollend', label: { en: 'scrollend', fr: 'scrollend' } },
        ],
      },
      defaultValue: 'intersection',
      bindable: true,
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: strategyHelp,
      },
      propertyHelp: {
        tooltip: strategyHelp,
      },
      /* wwEditor:end */
    },
    margin: {
      label: {
        en: 'Margin (px)',
        fr: 'Marge (px)',
      },
      section: 'settings',
      type: 'Number',
      options: { min: 0, max: 2000, step: 10 },
      defaultValue: 300,
      bindable: true,
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: marginHelp,
      },
      propertyHelp: {
        tooltip: marginHelp,
      },
      /* wwEditor:end */
    },
    hysteresis: {
      label: {
        en: 'Hysteresis (px)',
        fr: 'Hysteresis (px)',
      },
      section: 'settings',
      type: 'Number',
      options: { min: 0, max: 1000, step: 10 },
      defaultValue: 80,
      /* wwEditor:start */
      propertyHelp: {
        tooltip:
          "Distance a remonter au-dela de la marge avant de pouvoir redeclencher. Empeche la rafale quand on oscille autour du seuil. Mettre a 0 pour observer le phenomene.",
      },
      /* wwEditor:end */
    },
    rows: {
      label: {
        en: 'Filler rows',
        fr: 'Lignes de remplissage',
      },
      section: 'settings',
      type: 'Number',
      options: { min: 0, max: 2000, step: 10 },
      defaultValue: 40,
      bindable: true,
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: 'Nombre de lignes generees localement pour creer de la hauteur.',
      },
      propertyHelp: {
        tooltip:
          "Contenu de test, fixe. Mettre une valeur basse (0 a 3) pour reproduire le cas d'une liste trop courte pour defiler.",
      },
      /* wwEditor:end */
    },
    rowHeight: {
      label: {
        en: 'Row height (px)',
        fr: 'Hauteur de ligne (px)',
      },
      section: 'settings',
      type: 'Number',
      options: { min: 8, max: 400, step: 4 },
      defaultValue: 48,
    },
    debug: {
      label: {
        en: 'Show HUD',
        fr: 'Afficher le HUD',
      },
      section: 'settings',
      type: 'OnOff',
      defaultValue: true,
      /* wwEditor:start */
      propertyHelp: {
        tooltip: 'Superpose les metriques live et le journal des derniers evenements.',
      },
      /* wwEditor:end */
    },
    logToConsole: {
      label: {
        en: 'Log to console',
        fr: 'Journaliser en console',
      },
      section: 'settings',
      type: 'OnOff',
      defaultValue: false,
      /* wwEditor:start */
      propertyHelp: {
        tooltip: 'Desactive par defaut : un capteur de scroll peut inonder la console.',
      },
      /* wwEditor:end */
    },
  },
};
