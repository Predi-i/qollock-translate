import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders, isLanguageCode } from '../../../lib/catalog';
import {
  deleteTranslation,
  getTranslation,
  languageExists,
  recordTranslationHistory,
  upsertTranslation,
} from '../../../lib/db';
import { fetchSourceEntries } from '../../../lib/github';
import { badRequest, json, readJson } from '../../../lib/http';

interface SaveTranslationBody {
  languageCode?: string;
  key?: string;
  value?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: SaveTranslationBody;
  try {
    body = await readJson<SaveTranslationBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  const key = (body.key ?? '').trim();
  const value = body.value ?? '';
  // There is no in-app review stage: any saved string is simply 'translated'.
  // The real review happens when the maintainer looks at the submitted PR.
  // needs_review is kept false; it only ever mattered for import-undo's
  // untouched-row guard, not for display.
  const status = 'translated';
  const needsReview = false;

  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');
  if (!key) return badRequest('missing translation key');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const sourceMap = await fetchSourceEntries(env);
  const source = sourceMap.get(key);
  if (!source) return badRequest(`unknown source key: ${key}`);

  // The string's value before this change, captured for the history log.
  const prior = await getTranslation(env.TRANSLATE_DB, languageCode, key);

  if (!value.trim()) {
    await deleteTranslation(env.TRANSLATE_DB, languageCode, key);
    // Only log a delete if there was something to remove.
    if (prior) {
      await logHistory({
        languageCode,
        key,
        action: 'delete',
        oldValue: prior.value,
        newValue: null,
        status: null,
        changedBy: locals.translatorLogin,
      });
    }
    return json({ deleted: true });
  }

  const placeholderCheck = checkPlaceholders(source, value);
  if (placeholderCheck.missing.length || placeholderCheck.extra.length) {
    return badRequest(
      `placeholder mismatch: missing [${placeholderCheck.missing.join(', ')}], extra [${placeholderCheck.extra.join(', ')}]`
    );
  }

  await upsertTranslation(env.TRANSLATE_DB, {
    languageCode,
    key,
    value,
    status,
    needsReview,
    // Attribution is shown as the GitHub nickname, so store the login.
    translatorEmail: locals.translatorLogin,
  });

  await logHistory({
    languageCode,
    key,
    action: 'edit',
    oldValue: prior?.value ?? null,
    newValue: value,
    status,
    changedBy: locals.translatorLogin,
  });

  return json({ translation: await getTranslation(env.TRANSLATE_DB, languageCode, key) });
};

// Logging must never sink an otherwise-good save, so swallow its errors.
async function logHistory(entry: Parameters<typeof recordTranslationHistory>[1]): Promise<void> {
  try {
    await recordTranslationHistory(env.TRANSLATE_DB, entry);
  } catch {
    // History is a convenience log; a write failure here is not worth failing
    // the user's edit over.
  }
}
