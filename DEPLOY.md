# Deploying QOLLOCK Translate

This is a one-time setup guide for maintainers. The workbench is a Cloudflare
Worker (Workers + D1 + KV). Translators sign in with **GitHub OAuth**, and the
site opens pull requests against the public
[QOLLOCK-translations](https://github.com/Predi-i/QOLLOCK-translations) repo.

Because some networks can't reach Cloudflare's upload API directly, **deploys run
from GitHub Actions** — you push, and GitHub deploys to Cloudflare for you.

---

## How the pieces fit together

```
civo7/QOLLOCK (private mod)          Predi-i/QOLLOCK-translations         qollock-translate (this site)
  panorama/scripts/ql_settings.js       (public mirror)                    Cloudflare Worker
    canonical JS string maps              locales/en/translation.json  ◄── reads English source
        │  export_locales_json.js  ──┐    locales/<lang>/translation.json ◄─ writes PRs here
        ▼                            │         ▲                              │
  translations/locales/  ──sync────► │         └──────── PR ─────────── translators edit in browser
        ▲                            │                                       (sign in with GitHub)
        └── import_locales_json.js ◄─┘ (maintainer merges PR, imports, repacks VPK)
```

The **JS maps in `ql_settings.js` are the source of truth** (they compile into the
VPK; Panorama can't read JSON at runtime). The JSON files are just the exchange
format the website reads and writes. The private→public mirror is automatic
(`sync-translations.yml`); public→mod is a manual import + repack.

---

## Prerequisites

- A Cloudflare account (free tier is fine).
- Node 22+ and `pnpm` (`npm i -g pnpm`).
- This repo cloned locally, and the [`gh`](https://cli.github.com/) CLI signed in
  (`gh auth login`).

---

## Step 1 — Create the Cloudflare resources

```sh
pnpm install
pnpm exec wrangler login            # opens a browser to link your account

pnpm exec wrangler d1 create qollock-translate     # prints a database_id
pnpm exec wrangler kv namespace create SESSION      # prints a KV id
```

Paste the two ids into `wrangler.jsonc`:

- D1 id → `d1_databases[0].database_id`
- KV id → `kv_namespaces[0].id`

> The account-level `*.workers.dev` subdomain is set once per Cloudflare account
> (Workers & Pages → your subdomain). The site is served at
> `qollock-translate.<your-subdomain>.workers.dev` because `workers_dev: true` is
> set in `wrangler.jsonc`.

---

## Step 2 — Create the GitHub OAuth App (translator login)

At <https://github.com/settings/developers> → **New OAuth App**:

- **Homepage URL:** `https://qollock-translate.<your-subdomain>.workers.dev`
- **Authorization callback URL:**
  `https://qollock-translate.<your-subdomain>.workers.dev/auth/callback`

Register it, then copy:

- **Client ID** (`Ov23…`) → paste into `wrangler.jsonc` as `GITHUB_OAUTH_CLIENT_ID`
  (it's public, safe to commit).
- **Client secret** (long hex) → keep it for Step 4 (it's a secret, never commit).

> Optional: set `ALLOWED_GITHUB_USERS` in `wrangler.jsonc` to a space/comma list of
> GitHub logins to restrict who can sign in. Leave it out to let any GitHub
> account translate — PRs are reviewed before merge anyway.

---

## Step 3 — Create the GitHub PAT (for opening PRs)

Create a **fine-grained personal access token** at
<https://github.com/settings/tokens?type=beta>:

- **Resource owner:** `Predi-i`
- **Repository access:** Only select repositories → `Predi-i/QOLLOCK-translations`
- **Permissions:** Contents → Read and write, Pull requests → Read and write

Copy the token (`github_pat_…`) for Step 4.

---

## Step 4 — Add the GitHub Actions secrets

The deploy runs on GitHub's servers, so the credentials live as **repository
secrets** (not in the code). At
`https://github.com/Predi-i/qollock-translate` → **Settings → Secrets and
variables → Actions → New repository secret**, add four:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Workers Scripts: Edit**, **D1: Edit**, **Workers KV Storage: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id (dashboard home, right sidebar) |
| `OAUTH_CLIENT_SECRET` | The OAuth App client secret from Step 2 |
| `PR_GITHUB_TOKEN` | The `github_pat_…` from Step 3 |

> GitHub forbids the `GITHUB_` prefix for secret names, so the OAuth secret is
> `OAUTH_CLIENT_SECRET` and the PR token is `PR_GITHUB_TOKEN`. The workflow maps
> them to the Worker's `GITHUB_OAUTH_CLIENT_SECRET` / `GITHUB_TOKEN` bindings.

Create the Cloudflare token from the **"Edit Cloudflare Workers"** template, then
**add D1: Edit** to it (the template doesn't include D1).

---

## Step 5 — Deploy

Commit your `wrangler.jsonc` changes, push, and trigger the workflow:

```sh
git push origin main
gh workflow run deploy.yml --ref main -R Predi-i/qollock-translate
```

(Or from the web: **Actions → Deploy → Run workflow**.) The workflow applies D1
migrations, builds, deploys the Worker, then uploads the runtime secrets to it.

Watch it finish:

```sh
gh run watch "$(gh run list --workflow=deploy.yml -L1 -R Predi-i/qollock-translate --json databaseId --jq '.[0].databaseId')" -R Predi-i/qollock-translate
```

When it's green, open `https://qollock-translate.<your-subdomain>.workers.dev` and
sign in.

### Optional: custom domain

If you own a domain on Cloudflare, set `workers_dev: false`, uncomment the
`routes` block in `wrangler.jsonc` with your hostname, update the OAuth App
Homepage/callback URLs to match, and redeploy.

---

## The day-to-day loop

1. A translator opens the site, signs in, picks a language, fills in strings.
2. They click **PR** → a pull request appears on
   [QOLLOCK-translations](https://github.com/Predi-i/QOLLOCK-translations) at
   `locales/<lang>/translation.json`.
3. A maintainer reviews and **merges** the PR.
4. To ship it in the game, bring the merged translations into the **private**
   QOLLOCK repo and repack the VPK:

   ```sh
   # in the private civo7/QOLLOCK repo:
   # 1. copy the merged locales/<lang>/translation.json into translations/locales/<lang>/
   node scripts/import_locales_json.js     # folds JSON into ql_settings.js
   node --check panorama/scripts/ql_settings.js
   # 2. run the build pipeline to repack the VPK (scripts/qollock_pipeline.ps1)
   ```

   `import_locales_json.js` only fills/overwrites translations; it never wipes
   existing ones.

**New English strings** flow the other way automatically: when the mod's locales
are exported (`export_locales_json.js`) and pushed to the private repo's `main`,
`sync-translations.yml` mirrors them to QOLLOCK-translations, and the site picks
up the new source within ~5 minutes. No manual step on the website.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site loads but shows no strings | `GITHUB_REPO`/`GITHUB_BRANCH` wrong, or `locales/en/translation.json` missing on that branch. |
| Sign-in fails / `redirect_uri mismatch` | OAuth App callback URL must exactly equal `https://<site>/auth/callback`. |
| `?error=not_allowed` after login | The GitHub account isn't in `ALLOWED_GITHUB_USERS`. |
| Deploy: `7403 not authorized` on D1 | The Cloudflare API token is missing **D1: Edit**. |
| Deploy: "register a workers.dev subdomain" | No `*.workers.dev` subdomain on the account, or `workers_dev` not set. |
| PR button errors | `PR_GITHUB_TOKEN` missing/expired or lacks Contents+PR write on QOLLOCK-translations. |

The in-client "suggestion loop" (`SOCIAL_BASE_URL`) from upstream is intentionally
disabled — QOLLOCK has no social backend, and those endpoints return 501 without
affecting the rest of the site.
