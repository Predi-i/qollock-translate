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
  status?: 'translated' | 'reviewed';
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
  // Role decides the stage. A reviewer's save lands approved (they may explicitly
  // send it back with status:'translated'); everyone else's edit goes to "needs
  // review", so we ignore a non-reviewer asking for 'reviewed'. needs_review is
  // kept only for import-undo's untouched-row guard, not for display.
  const status = locals.isReviewer && body.status !== 'translated' ? 'reviewed' : 'translated';
  const needsReview = status === 'translated';

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

  // A reviewer's save that lands 'reviewed' is an approval; anything else is a
  // plain edit (covers both first-time translations and later tweaks).
  await logHistory({
    languageCode,
    key,
    action: status === 'reviewed' ? 'approve' : 'edit',
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
