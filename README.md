# grimoire-translate

A Cloudflare-native translation workbench for i18next projects. Translators add
languages, fill in strings against the live English source, build a shared
glossary, and open a GitHub PR that writes `src/locales/<lang>/translation.json`
back to the source repo — no Git or developer knowledge required on their end.

Built for [Grimoire](https://github.com/Slush97/grimoire) and running at
`translate.grimoiremods.com`, but it's a **template**: the engine is project
agnostic, so any i18next repo (e.g. another Deadlock mod) can stand up its own
instance by editing one config file and pointing it at a different repo. See
[Use this for your own project](#use-this-for-your-own-project).

## How it works

1. The app reads English source strings from a GitHub repo
   (`GITHUB_REPO`): `src/locales/en/translation.json`. The source is cached
   per-isolate for 5 minutes and falls back to the last good copy if GitHub is
   briefly unavailable.
2. Translators add target languages and save string values into Cloudflare D1.
   Placeholders like `{{count}}` are validated — mismatches are rejected.
3. A glossary helper surfaces frequently-repeated terms so contributors agree on
   (or skip) them once and stay consistent.
4. **Download** exports a language as `src/locales/<lang>/translation.json`;
   **Upload** reads an edited file of that shape back into D1 (unknown keys and
   placeholder mismatches are skipped; by default it only fills blanks).
5. **PR** creates or updates a `translations/<lang>` branch and opens a GitHub
   pull request against the source repo's default branch.

Optionally, an in-client **suggestion loop** lets end users propose
translations from inside the app itself; this requires a separate social
backend (see [Optional: the suggestion loop](#optional-the-suggestion-loop)).

## Stack

- Astro 6 + React 19
- Cloudflare Workers with Assets
- Cloudflare D1 — target-language drafts, contributors, glossary, suggestions
- Cloudflare KV — sessions
- Cloudflare Access — translator login (production)
- GitHub REST API — reading `en` source strings and opening PRs

## Use this for your own project

This repo is a GitHub template. Click **Use this template** (or fork it), then:

### 1. Branding — `src/site.config.ts`

Everything project-specific lives in one file: the app name, the short header
badge, the public URL (used in PR descriptions), the name of the end-user app
you're translating, and the priority glossary terms (brand/product nouns that
usually shouldn't be translated). Edit those values; nothing else in `src/`
needs changing for branding.

### 2. Deployment config — `wrangler.jsonc`

- `name` — the Worker name (e.g. `qol-lock-translate`).
- `routes[].pattern` — your custom domain, or remove `routes` to use the
  `*.workers.dev` URL.
- `vars.GITHUB_REPO` / `vars.GITHUB_BRANCH` — the repo holding
  `src/locales/en/translation.json` and the branch PRs target.
- `vars.SOCIAL_BASE_URL` — optional; remove it unless you run a social backend.
- `d1_databases[].database_id` and `kv_namespaces[].id` — replace with your own
  (created in step 3).

### 3. Create Cloudflare resources

```sh
pnpm exec wrangler d1 create <your-db-name>      # -> copy database_id into wrangler.jsonc
pnpm exec wrangler kv namespace create SESSION   # -> copy id into wrangler.jsonc
pnpm db:migrate:remote                           # apply migrations to D1
```

(`database_name` in `wrangler.jsonc` and the `--remote`/`--local` migration
scripts in `package.json` reference the db name — keep them in sync.)

### 4. Auth + secrets

Create a Cloudflare Access application for your workbench URL, then set the
Worker secrets (see [Cloudflare setup](#cloudflare-setup) for detail):

```sh
pnpm exec wrangler secret put CF_ACCESS_TEAM
pnpm exec wrangler secret put CF_ACCESS_AUD
pnpm exec wrangler secret put GITHUB_TOKEN
```

The GitHub token is a fine-grained PAT scoped to **your** `GITHUB_REPO` with
Contents: Read and write, and Pull requests: Read and write.

### 5. Deploy

```sh
pnpm run deploy
```

That's the whole hand-off — no code changes beyond `site.config.ts` and config.

## Local dev

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm dev
```

In dev the middleware authenticates with `TRANSLATOR_EMAIL` from `.dev.vars`.
Production verifies the Cloudflare Access JWT instead.

## Cloudflare setup

The Grimoire D1 database has already been created and migrated; its id is
committed in `wrangler.jsonc`. If you ever recreate it:

```sh
pnpm exec wrangler d1 create grimoire-translate
```

Copy the generated `database_id` into `wrangler.jsonc`, then apply migrations:

```sh
pnpm db:migrate:remote
```

> Grimoire-specific: on the maintainer's machine the current Wrangler token
> cannot auto-list account ids. Prefix remote Wrangler commands with the account
> id from `grimoire-admin/.dev.vars`:
>
> ```sh
> ACCOUNT_ID=$(awk -F= '/^CF_ACCOUNT_ID=/{print $2}' ../grimoire-admin/.dev.vars)
> CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" pnpm db:migrate:remote
> ```

Create a Cloudflare Access application for your workbench URL (Grimoire's is
`https://translate.grimoiremods.com`). Grimoire's translator allowlist process
is documented in [`docs/translator-access.md`](docs/translator-access.md).

Set these Worker secrets:

```sh
pnpm exec wrangler secret put CF_ACCESS_TEAM
pnpm exec wrangler secret put CF_ACCESS_AUD
pnpm exec wrangler secret put GITHUB_TOKEN
```

Use the same `CLOUDFLARE_ACCOUNT_ID=...` prefix if Wrangler prints an account id
lookup error. If `secret put` returns an authentication error, run
`pnpm exec wrangler login` with an account user that has Workers edit
permission, or switch to an API token that can edit Worker scripts and secrets.

`CF_ACCESS_TEAM` is the Zero Trust team subdomain without
`.cloudflareaccess.com`. `CF_ACCESS_AUD` is the Access app AUD tag.

## Deploy

```sh
pnpm run deploy
```

`wrangler.jsonc` binds the Worker to its custom domain.

### GitHub Actions

`.github/workflows/deploy.yml` is a manual `workflow_dispatch` deploy. It
expects these repository secrets:

- `CLOUDFLARE_API_TOKEN` — token that can edit Workers, D1, and Worker secrets
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account id
- `CF_ACCESS_TEAM` — Zero Trust team subdomain without `.cloudflareaccess.com`
- `CF_ACCESS_AUD` — AUD tag from the workbench's Access app
- `GRIMOIRE_TRANSLATE_GITHUB_TOKEN` — fine-grained GitHub PAT for the source repo

The workflow applies D1 migrations, deploys the Worker, then uploads runtime
secrets. That ordering supports the first deploy, when the Worker script does
not exist yet.

## Optional: the suggestion loop

The `/api/live/*` endpoints power an in-client suggestion loop where end users
propose translations from inside the app. They authenticate against a separate
social backend via `SOCIAL_BASE_URL` (Grimoire uses its own Discord-login
Worker). If `SOCIAL_BASE_URL` is unset, those endpoints return `501` and the
rest of the workbench works normally — so a new project can ignore this feature
entirely until it has a backend to wire up.

## Limits

This is a focused MVP, not a Weblate replacement. It intentionally does not
include translation memory, comments, conflict resolution, or hosting multiple
projects from one deployment — each project runs its own instance.
