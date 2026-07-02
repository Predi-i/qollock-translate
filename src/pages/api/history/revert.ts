import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isLanguageCode } from '../../../lib/catalog';
import {
  getHistoryEntry,
  getTranslation,
  recordTranslationHistory,
  upsertTranslation,
  deleteTranslation,
} from '../../../lib/db';
import { badRequest, forbidden, json, readJson } from '../../../lib/http';

interface RevertBody {
  id?: number;
  languageCode?: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.isReviewer) return forbidden('only reviewers can revert history entries');

  let body: RevertBody;
  try {
    body = await readJson<RevertBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const id = typeof body.id === 'number' ? body.id : parseInt(String(body.id ?? ''), 10);
  const languageCode = (body.languageCode ?? '').trim();

  if (!id || isNaN(id)) return badRequest('invalid id');
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');

  const entry = await getHistoryEntry(env.TRANSLATE_DB, id, languageCode);
  if (!entry) return badRequest('history entry not found');

  const current = await getTranslation(env.TRANSLATE_DB, languageCode, entry.translation_key);
  const currentValue = current?.value ?? null;

  if (entry.old_value === null || entry.old_value === '') {
    // The original state was "no translation" — delete it
    await deleteTranslation(env.TRANSLATE_DB, languageCode, entry.translation_key);
  } else {
    await upsertTranslation(env.TRANSLATE_DB, {
      languageCode,
      key: entry.translation_key,
      value: entry.old_value,
      status: 'reviewed',
      needsReview: false,
      translatorEmail: locals.translatorLogin,
    });
  }

  try {
    await recordTranslationHistory(env.TRANSLATE_DB, {
      languageCode,
      key: entry.translation_key,
      action: 'edit',
      oldValue: currentValue,
      newValue: entry.old_value ?? null,
      status: entry.old_value ? 'reviewed' : null,
      changedBy: locals.translatorLogin,
    });
  } catch {
    // best-effort history logging
  }

  return json({ ok: true, key: entry.translation_key, restoredValue: entry.old_value });
};
