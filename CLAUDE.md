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

## Architecture map

Almost the entire app UI lives in one big client component:
`src/components/TranslatorApp.tsx` (~3400 lines), rendered by
`src/pages/index.astro`. It's a single-page workbench with three views
(`translations` / `history` / `contributors`, see the `View` type). Roughly,
top to bottom:
- Types + constants (RowStatus, Filter, stopword lists, glossary term list).
- `statusMeta` / `computeStats` — pure helpers for row labels/dot colors.
- The main `TranslatorApp` component: session/catalog/glossary/contributors
  state, then the load/save functions (`loadCatalog`, `commitRow`,
  `flushDirtyRows`, `runSubmit`), then the JSX for all three views.
- `TableRow` and `StringHelper` — the two per-string editor components
  (memoized so typing in one row doesn't re-render the ~800-row list).
- `GlossaryPanel` + glossary helper functions at the bottom
  (`buildGlossaryCandidates`, `buildGlossaryItems`, `buildGlossaryMatches`).

**Save/submit model** (see commit `738a6d0`, `4ca8362`): edits are **local-only
React state** (`drafts`) until the translator presses **Submit**. Submit calls
`flushDirtyRows()`, which POSTs every dirty row to `/api/translations`
(`commitRow`) and only then opens/updates the PR via `/api/pull-request`. A
`beforeunload` guard warns before closing the tab with unsaved edits.
`commitRow` returns `{ ok, error }`; `flushDirtyRows` collects failures (most
commonly a `{{placeholder}}` mismatch) and `runSubmit` **must** refuse to open
the PR if any row failed — this used to fail silently, which is exactly how a
translator lost every hand-written (placeholder-bearing) string from a
session while single-word glossary substitutions went through fine (real
incident, see git history around 2026-07-02/03).

There is **no in-app translation-review stage** (no "needs review"/"approved"
status, no Approve button) — every saved string is just "translated" once
non-empty. The actual review is the maintainer looking at the GitHub PR that
Submit opens. The `reviewer`/`admin` contributor roles still exist, but only
gate: promoting other contributors' roles (`/api/contributors/[id]`),
reverting history entries (`/api/history/revert`), and (unenforced today)
moderating in-app player suggestions. `RowStatus` can still read a legacy
`'reviewed'` value from old D1 rows — the UI treats it identically to
`'translated'`.

Backend, by file:
- `src/lib/db.ts` — all D1 queries (languages, translations, glossary_terms,
  contributors, translation_suggestions, translation_history, import_batches).
- `src/lib/translationData.ts` — `materializeLanguage()` merges the GitHub
  source catalog + repo target catalog + D1 drafts into the rows the UI reads,
  and builds the flat catalog object that gets PR'd.
- `src/lib/catalog.ts` — flatten/unflatten the flat-dict JSON, placeholder
  extraction/checking (`{{name}}` tokens).
- `src/lib/github.ts` — GitHub REST calls: fetch source/target catalogs
  (cached), open/update the translation PR.
- `src/lib/auth.ts` — GitHub OAuth + KV sessions; `isReviewer()`/
  `isLoginAllowed()` read `REVIEWER_GITHUB_USERS`/`ALLOWED_GITHUB_USERS` from
  env (comma/space-separated GitHub logins).
- `src/lib/glossary.ts` — the fixed list of locked terms (VPK, GLB, HUD, file
  extensions, etc.) that are always "keep as-is" and can't be edited.
- `src/middleware.ts` — auth gate; in dev, runs as a fixed reviewer identity.
- `src/pages/api/*` — one route per resource; `contributors/[id].ts` and
  `history/revert.ts` are reviewer-gated, everything else just needs a session.

**Glossary, what it actually is**: a per-language dictionary of
source-term → target-term (+ optional note), built from auto-detected
recurring words/phrases across the English source (`buildGlossaryCandidates`
scores by repetition + a fixed priority list). It's an *autocomplete aid*, not
a translation engine — in the row editor, matching English words get
underlined with a hover tooltip, and pressing Tab inserts the saved target
term as literal text at the cursor. It does not compose full sentences or
handle grammar/inflection; relying on it for anything longer than a
short/fixed phrase will read as word-for-word substitution.
