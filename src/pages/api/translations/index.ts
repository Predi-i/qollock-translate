import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders, isLanguageCode } from '../../../lib/catalog';
import { deleteTranslation, getTranslation, languageExists, upsertTranslation } from '../../../lib/db';
import { fetchSourceEntries } from '../../../lib/github';
import { badRequest, json, readJson } from '../../../lib/http';

interface SaveTranslationBody {
  languageCode?: string;
  key?: string;
  value?: string;
  status?: 'translated' | 'reviewed';
  needsReview?: boolean;
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
  const status = body.status === 'reviewed' ? 'reviewed' : 'translated';
  // Approving (reviewed) clears the flag; otherwise trust the client's flag state.
  const needsReview = status === 'reviewed' ? false : !!body.needsReview;

  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');
  if (!key) return badRequest('missing translation key');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const sourceMap = await fetchSourceEntries(env);
  const source = sourceMap.get(key);
  if (!source) return badRequest(`unknown source key: ${key}`);

  if (!value.trim()) {
    await deleteTranslation(env.TRANSLATE_DB, languageCode, key);
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
    translatorEmail: locals.translatorEmail,
  });

  return json({ translation: await getTranslation(env.TRANSLATE_DB, languageCode, key) });
};
