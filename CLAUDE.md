# grimoire-translate

Translation workbench for QOLLOCK (`../QOLLOCK`). Keep it Cloudflare-native: Astro on
Workers with Assets, D1 for draft data, KV for sessions, and the GitHub API for
repo integration. Auth is **GitHub OAuth** (`src/lib/auth.ts`) — it replaced the
upstream Cloudflare Access integration, which required a payment card even on the
free plan. The GitHub login/email also doubles as the translator identity stored
in D1. An optional `ALLOWED_GITHUB_USERS` allowlist can restrict sign-in.

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

- English source strings live in `../QOLLOCK/translations/locales/en/translation.json`
  (flat dict, key = English string = value) and are read from GitHub in production
  via the `QOLLOCK-translations` repo (`GITHUB_REPO` in `wrangler.jsonc`).
- Target-language drafts live in D1; sessions live in KV.
- Do not push directly to `main`. PR export opens a PR against the public repo
  `Predi-i/QOLLOCK-translations` (`GITHUB_REPO` in `wrangler.jsonc`), writing
  `translations/<lang>`.
- Keep language codes BCP 47 style, matching Grimoire's i18next folder layout.
- Preserve placeholders like `{{count}}`; the API rejects mismatches.
