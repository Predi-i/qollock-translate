# QOLLOCK Translate

The community translation website for **[QOLLOCK](https://github.com/civo7/QOLLOCK)**,
a Deadlock HUD customization mod. Translators add a language, fill in the UI
strings against the live English source, and the site opens a GitHub pull
request with their work — **no Git or coding knowledge needed**.

🌐 **Live site:** <https://qollock-translate.predi.workers.dev>

It is a fork of [grimoire-translate](https://github.com/Slush97/grimoire-translate)
adapted for QOLLOCK (GitHub sign-in instead of Cloudflare Access, and pointed at
the [QOLLOCK-translations](https://github.com/Predi-i/QOLLOCK-translations) repo).

## For translators

1. Open the site and **Sign in with GitHub**.
2. Pick your language from the list, or add a new one.
3. Type each translation under its English string. `Enter` saves and jumps to the
   next box. Anything inside `{{double braces}}` is a placeholder — leave it
   exactly as-is.
4. When you're happy, click **PR**. The site opens a pull request on
   [QOLLOCK-translations](https://github.com/Predi-i/QOLLOCK-translations) with
   your changes. A maintainer reviews and merges it.

That's it — you never touch Git directly. The glossary panel helps everyone
translate repeated terms (hero names, UI nouns) the same way.

## How it works

1. The site reads the English source from
   [`Predi-i/QOLLOCK-translations`](https://github.com/Predi-i/QOLLOCK-translations)
   at `locales/en/translation.json` (cached ~5 minutes).
2. Drafts are saved in Cloudflare D1 as you type. Placeholder mismatches
   (`{{count}}` etc.) are rejected so translations can't break the mod.
3. **PR** opens/updates a `translations/<lang>` branch on QOLLOCK-translations.
4. After merge, the maintainer folds the translations into the mod's canonical
   `ql_settings.js` maps and repacks the VPK — see that repo's README for the
   full data flow.

## Stack

- Astro + React on **Cloudflare Workers** (with Assets)
- **Cloudflare D1** — language drafts, contributors, glossary
- **Cloudflare KV** — sign-in sessions
- **GitHub OAuth** — translator login
- **GitHub REST API** — reads the English source and opens PRs

## Maintainers

Setup and deployment (one-time) are documented in **[DEPLOY.md](DEPLOY.md)**.
Deploys run from GitHub Actions (**Actions → Deploy → Run workflow**), so no local
Cloudflare access is required.

## Credit

Built on [grimoire-translate](https://github.com/Slush97/grimoire-translate) by
Slush. This fork keeps the engine and swaps the auth and target repo for QOLLOCK.
