# Deploying qollock-translate

This fork of [grimoire-translate](https://github.com/Slush97/grimoire-translate)
is the QOLLOCK translation workbench: a website where community members translate
QOLLOCK's UI strings in the browser and the site opens a GitHub pull request with
their work — no JavaScript or Git knowledge needed on their end.

It runs on **Cloudflare** (Workers + D1 + KV + Access). You only do this setup
**once**. Everything below is copy-paste; where a value is yours to fill in it
says so in CAPS.

---

## How the pieces fit together

```
QOLLOCK repo (civo7/QOLLOCK)                 This fork (Predi-i/qollock-translate)
  panorama/scripts/ql_settings.js   <─────┐    Cloudflare Worker (the website)
    SETTINGS_RU_TEXT = {...}  ← canon      │      reads en source from GitHub
        │  scripts/export_locales_json.js  │      stores drafts in D1
        ▼                                  │      translators log in via Access
  translations/locales/<lang>/             │
    translation.json  ──────────────────►─┘──►  opens a PR back to civo7/QOLLOCK
        ▲                                              │
        └──── scripts/import_locales_json.js ◄─────────┘  (you merge the PR,
              merges the PR back into the maps              then run import)
```

The **JS maps in `ql_settings.js` stay the source of truth** (they compile into
the VPK; Panorama can't read JSON at runtime). The JSON files under
`translations/locales/` are only the exchange format the website reads and writes.

---

## Prerequisites

- A Cloudflare account (free tier is fine to start).
- Node 22+ and `pnpm` installed. (`npm i -g pnpm` if you don't have it.)
- This fork cloned locally — you already have it at `D:\GitHub2\grimoire-translate`.

---

## Step 0 — Publish the English source so the website can read it

The website reads the English strings from **`civo7/QOLLOCK`**, path
`translations/locales/en/translation.json`, on the branch named by
`GITHUB_BRANCH` (set to `main` in `wrangler.jsonc`). So those files must exist on
that branch first.

From the **QOLLOCK** repo:

```sh
cd /d/GitHub2/QOLLOCK
node scripts/export_locales_json.js     # regenerate translations/locales/
git add translations/locales scripts/export_locales_json.js scripts/import_locales_json.js
git commit -m "Add i18next locale catalogs for the translation workbench"
git push
```

For first testing you can point the site at the working branch instead of `main`
by setting `"GITHUB_BRANCH": "feat/translation-workbench"` in `wrangler.jsonc`.
Switch it back to `main` once the locale files are merged to main.

> The PR token (Step 4) needs write access to `civo7/QOLLOCK`. You have admin on
> that repo, so you can mint a fine-grained PAT for it.

---

## Step 1 — Branding (already done)

`src/site.config.ts` is already set for QOLLOCK (name, glossary nouns,
`localesPath`). Nothing to do unless you want to tweak the app name or the
glossary list. The public URL there (`SITE.url`) is a placeholder — update it
after Step 6 once you know your real URL.

---

## Step 2 — Log Wrangler into Cloudflare

```sh
cd /d/GitHub2/grimoire-translate
pnpm install
pnpm exec wrangler login
```

A browser opens; approve the access. This links the CLI to your Cloudflare
account.

---

## Step 3 — Create the D1 database and KV namespace

```sh
pnpm exec wrangler d1 create qollock-translate
pnpm exec wrangler kv namespace create SESSION
```

Each command prints an id. Open `wrangler.jsonc` and paste them in, replacing the
placeholders:

- D1 → `d1_databases[0].database_id` = `REPLACE_WITH_YOUR_D1_DATABASE_ID`
- KV → `kv_namespaces[0].id` = `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`

Then create the tables:

```sh
pnpm db:migrate:remote
```

> If Wrangler complains it can't determine your account id, prefix the command:
> `CLOUDFLARE_ACCOUNT_ID=YOUR_ACCOUNT_ID pnpm db:migrate:remote`
> (Your account id is on the Cloudflare dashboard home page, right sidebar.)

---

## Step 4 — Make the GitHub token (for opening PRs)

Create a **fine-grained personal access token** at
<https://github.com/settings/tokens?type=beta>:

- **Resource owner:** `civo7`
- **Repository access:** Only select repositories → `civo7/QOLLOCK`
- **Permissions:** Contents → Read and write, Pull requests → Read and write
- Copy the token (starts with `github_pat_…`).

---

## Step 5 — Set up translator login (Cloudflare Access) + secrets

Translators sign in through **Cloudflare Access** (Zero Trust). In the Cloudflare
dashboard:

1. Go to **Zero Trust → Access → Applications → Add an application** →
   *Self-hosted*.
2. Name it `QOLLOCK Translate`. For the domain, use the URL you'll get in Step 6
   (you can come back and fix this after the first deploy if needed).
3. Add a policy named `QOLLOCK translators`, decision **Allow**, with an
   **Include → Emails** rule listing the translators you trust (add more later as
   community translators ask). Save.
4. From the application's overview, copy two values:
   - **AUD tag** → this is `CF_ACCESS_AUD`.
   - Your **team subdomain** (the `xxxx` in `xxxx.cloudflareaccess.com`) → this
     is `CF_ACCESS_TEAM` (without `.cloudflareaccess.com`).

Now push the three secrets to the Worker:

```sh
pnpm exec wrangler secret put CF_ACCESS_TEAM     # paste the team subdomain
pnpm exec wrangler secret put CF_ACCESS_AUD      # paste the AUD tag
pnpm exec wrangler secret put GITHUB_TOKEN       # paste the github_pat_… from Step 4
```

(Adding/removing translators later = edit the `QOLLOCK translators` policy's
email list. See `docs/translator-access.md` for the dashboard + API methods —
substitute the QOLLOCK app/policy names.)

---

## Step 6 — Deploy

```sh
pnpm run deploy
```

This applies migrations, builds the site, and publishes the Worker. When it
finishes it prints the live URL, e.g.
`https://qollock-translate.YOUR-SUBDOMAIN.workers.dev`.

Put that URL into `src/site.config.ts` (`SITE.url`) and redeploy so PR
descriptions link to the right place:

```sh
# edit SITE.url, then:
pnpm run deploy
```

### Optional: custom domain

If you own a domain on Cloudflare, uncomment the `routes` block in
`wrangler.jsonc`, set `pattern` to your hostname (e.g.
`translate.qollock.gg`), set `SITE.url` to match, and redeploy.

---

## You're live — the day-to-day loop

1. A translator opens the site, logs in, picks a language, fills in strings.
2. They click **PR**; the site opens a pull request on `civo7/QOLLOCK` that
   writes `translations/locales/<lang>/translation.json`.
3. You review and **merge** the PR.
4. Back in the QOLLOCK repo, fold the merged JSON into the canonical maps and
   repack:

   ```sh
   cd /d/GitHub2/QOLLOCK
   git pull
   node scripts/import_locales_json.js
   node --check panorama/scripts/ql_settings.js
   # then repack the VPK as usual
   ```

`import_locales_json.js` only fills/overwrites translations; it never wipes
existing ones. Re-running `export_locales_json.js` after that keeps the JSON in
sync for the next round.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Site loads but shows no strings | `GITHUB_REPO`/`GITHUB_BRANCH` wrong, or `translations/locales/en/translation.json` not on that branch yet (Step 0). |
| `wrangler` "could not determine account id" | Prefix commands with `CLOUDFLARE_ACCOUNT_ID=…` (Step 3 note). |
| PR button errors | `GITHUB_TOKEN` missing/expired or lacks Contents+PR write on `civo7/QOLLOCK` (Step 4). |
| Can't log in / 403 | Email not in the `QOLLOCK translators` Access policy, or `CF_ACCESS_TEAM`/`CF_ACCESS_AUD` secrets wrong (Step 5). |
| `secret put` auth error | Re-run `pnpm exec wrangler login` with a user that has Workers edit permission. |

The in-client "suggestion loop" (`SOCIAL_BASE_URL`) from upstream is intentionally
disabled here — QOLLOCK has no social backend, and those endpoints simply return
501 without affecting the rest of the site.
