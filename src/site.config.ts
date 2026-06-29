// Per-fork branding. Everything project-specific that a new translation
// workbench must change lives here, so a fork is a one-file edit rather than a
// hunt through the React tree. Deployment/runtime config (which repo to read,
// the custom domain, secrets) stays in `wrangler.jsonc` and Worker secrets.

export const SITE = {
  // This workbench's own name. Shows in the browser title and the header.
  appName: 'QOLLOCK Translate',
  // Short badge shown in the header mark (2-3 letters).
  shortName: 'QT',
  // Public URL of this workbench. Referenced in the PR descriptions it opens.
  // TODO: set to the real custom domain (or the *.workers.dev URL) after deploy.
  url: 'https://translate.qollock.example',
  // The end-user application whose strings you are translating. Used in UI copy
  // like "...words that repeat across QOLLOCK".
  clientName: 'QOLLOCK',
  // Repo-relative directory holding the i18next catalogs the workbench reads
  // (`en/translation.json`) and writes PRs against (`<lang>/translation.json`).
  // Upstream hardcoded `src/locales`; in the QOLLOCK-translations repo the
  // catalogs live at `locales/<lang>/translation.json`. No leading/trailing slash.
  localesPath: 'locales',
  // Brand/product nouns that usually should NOT be translated. The glossary
  // helper surfaces these first so translators agree on (or skip) them up front.
  // QOLLOCK domain nouns — proper names, healthbar styles, minigames, and the
  // engine/UI acronyms that stay Latin. (Walker/Guardian/Base ARE translated, so
  // they are deliberately omitted.)
  priorityGlossaryTerms: [
    // Mod + community
    'QOLLOCK',
    'MOG',
    'MOGLOCK',
    'moglock.gg',
    'Deadlock',
    'Steam',
    'Discord',
    'GameBanana',
    'Statlocker',
    'mod',
    'mods',
    'VPK',
    // Feature / subsystem proper names
    'Deadlock For Dummies',
    'Rejuvenator',
    'Citadel',
    // Healthbar styles
    'Minecraft',
    'Budhud',
    "Klutz's Bar",
    // Minigames
    'Bebop Sweeper',
    // Engine / UI acronyms
    'HUD',
    'UI',
    'FPS',
    'MMR',
    'SPM',
    'HP',
    'crosshair',
  ],
} as const;
