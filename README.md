# grimoire-translate

Cloudflare-native translation workbench for Grimoire. It runs at
`translate.grimoiremods.com` as an Astro app on Cloudflare Workers with Assets.

## Stack

- Astro 6 + React
- Cloudflare Workers with Assets
- Cloudflare D1 for target-language drafts
- Cloudflare Access for translator login
- GitHub REST API for reading `src/locales/en/translation.json` and opening PRs

## Local Dev

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

For local development, the middleware uses `TRANSLATOR_EMAIL` from `.dev.vars`.
Production verifies the Cloudflare Access JWT.

## Cloudflare Setup

The D1 database has already been created and migrated once. Its id is committed
in `wrangler.jsonc`.

If you ever recreate it, run:

```sh
pnpm exec wrangler d1 create grimoire-translate
```

Copy the generated `database_id` into `wrangler.jsonc`, then apply migrations:

```sh
pnpm db:migrate:remote
```

On this machine, the current Wrangler token cannot auto-list account ids. Prefix
remote Wrangler commands with the account id from `grimoire-admin/.dev.vars`:

```sh
ACCOUNT_ID=$(awk -F= '/^CF_ACCOUNT_ID=/{print $2}' ../grimoire-admin/.dev.vars)
CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" pnpm db:migrate:remote
```

Create a Cloudflare Access application for:

```text
https://translate.grimoiremods.com
```

Translator allowlist updates are documented in
[`docs/translator-access.md`](docs/translator-access.md).

Set these Worker secrets:

```sh
pnpm exec wrangler secret put CF_ACCESS_TEAM
pnpm exec wrangler secret put CF_ACCESS_AUD
pnpm exec wrangler secret put GITHUB_TOKEN
```

Use the same `CLOUDFLARE_ACCOUNT_ID=...` prefix if Wrangler prints an account id
lookup error. If `secret put` returns an authentication error, run
`pnpm exec wrangler login` with an account user that has Workers edit permission,
or switch to an API token that can edit Worker scripts and secrets.

`CF_ACCESS_TEAM` is the Zero Trust team subdomain without
`.cloudflareaccess.com`. `CF_ACCESS_AUD` is the Access app AUD tag.

The GitHub token should be a fine-grained PAT scoped to `Slush97/grimoire` with:

- Contents: Read and write
- Pull requests: Read and write

## Deploy

```sh
pnpm run deploy
```

`wrangler.jsonc` binds the Worker to `translate.grimoiremods.com`.

## GitHub Actions Deploy

The repo includes `.github/workflows/deploy.yml` as a manual
`workflow_dispatch` deploy. It expects these repository secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token that can edit Workers, D1, and Worker secrets
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account id
- `CF_ACCESS_TEAM` — Zero Trust team subdomain without `.cloudflareaccess.com`
- `CF_ACCESS_AUD` — AUD tag from the `translate.grimoiremods.com` Access app
- `GRIMOIRE_TRANSLATE_GITHUB_TOKEN` — fine-grained GitHub PAT for `Slush97/grimoire`

The workflow applies D1 migrations, deploys the Worker, then uploads runtime
secrets. That ordering supports the first deploy when the Worker script does not
exist yet.

## Data Flow

1. The app reads English source strings from `Slush97/grimoire`:
   `src/locales/en/translation.json`.
2. Translators add languages and save string values in D1.
3. Download exports the language in `src/locales/<lang>/translation.json` shape;
   Upload reads an edited file of that shape back into D1 (unknown keys and
   placeholder mismatches are skipped). By default Upload only fills blank
   strings; untick "Only fill blanks" to let the file overwrite existing
   translations.
4. PR creates or updates a `translations/<lang>` branch and opens a GitHub PR.

## Limits

This is a Grimoire-specific MVP, not a Weblate replacement. It intentionally
does not include translation memory, glossary management, comments, conflict
resolution, or multi-project support yet.
