# grimoire-translate

Translation workbench for `../grimoire`. Keep it Cloudflare-native: Astro on
Workers with Assets, D1 for data, Cloudflare Access for auth, and GitHub API for
repo integration.

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm db:migrate:local
pnpm db:migrate:remote
pnpm deploy
```

## Boundaries

- English source strings live in `../grimoire/src/locales/en/translation.json`
  and are read from GitHub in production.
- Target-language drafts live in D1.
- Do not push directly to `main`; PR export writes `translations/<lang>`.
- Keep language codes BCP 47 style, matching Grimoire's i18next folder layout.
- Preserve placeholders like `{{count}}`; the API rejects mismatches.
