import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders } from '../../../lib/catalog';
import { insertTranslationSuggestion } from '../../../lib/db';
import { badRequest, json, readJson } from '../../../lib/http';
import { ensureLiveLanguage, requireLiveContributor, sha256Hex } from '../../../lib/live';
import { fetchSourceEntries } from '../../../lib/github';

interface SuggestionBody {
  languageCode?: string;
  key?: string;
  value?: string;
  source?: string;
  contextRoute?: string;
  appVersion?: string;
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireLiveContributor(request, env);
  if (auth instanceof Response) return auth;

  let body: SuggestionBody;
  try {
    body = await readJson<SuggestionBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  const key = (body.key ?? '').trim();
  const value = body.value ?? '';
  const contextRoute = (body.contextRoute ?? '').trim() || null;
  const appVersion = (body.appVersion ?? '').trim() || null;

  if (!key) return badRequest('missing translation key');
  if (!value.trim()) return badRequest('translation value is required');
  if (value.length > 4000) return badRequest('translation value is too long');
  if (contextRoute && contextRoute.length > 256) return badRequest('context route is too long');
  if (appVersion && appVersion.length > 64) return badRequest('app version is too long');

  const languageError = await ensureLiveLanguage(env.TRANSLATE_DB, languageCode);
  if (languageError) return languageError;

  const sourceMap = await fetchSourceEntries(env);
  const source = sourceMap.get(key);
  if (!source) return badRequest(`unknown source key: ${key}`);

  const placeholderCheck = checkPlaceholders(source, value);
  if (placeholderCheck.missing.length || placeholderCheck.extra.length) {
    return badRequest(
      `placeholder mismatch: missing [${placeholderCheck.missing.join(', ')}], extra [${placeholderCheck.extra.join(', ')}]`
    );
  }

  const suggestion = await insertTranslationSuggestion(env.TRANSLATE_DB, {
    id: crypto.randomUUID(),
    languageCode,
    key,
    sourceHash: await sha256Hex(source),
    value,
    contributorId: auth.contributor.id,
    contextRoute,
    appVersion,
  });

  if (!suggestion) return json({ error: 'could not save suggestion' }, { status: 500 });

  return json({
    suggestion: {
      id: suggestion.id,
      languageCode: suggestion.language_code,
      key: suggestion.translation_key,
      value: suggestion.value,
      status: suggestion.status,
      createdAt: suggestion.created_at,
    },
  });
};
