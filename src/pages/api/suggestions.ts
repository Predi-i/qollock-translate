import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isLanguageCode } from '../../lib/catalog';
import { getTranslation, languageExists, listSuggestions } from '../../lib/db';
import { fetchSourceEntries } from '../../lib/github';
import { badRequest, json } from '../../lib/http';
import { sha256Hex } from '../../lib/live';

// Pending in-app suggestions for a language, enriched with the current source
// string, the current saved translation, and a `stale` flag (the English source
// changed since the player suggested this, so it may no longer fit).
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim() ?? '';
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const [suggestions, sourceMap] = await Promise.all([
    listSuggestions(env.TRANSLATE_DB, languageCode, 'pending'),
    fetchSourceEntries(env),
  ]);

  const enriched = await Promise.all(
    suggestions.map(async (s) => {
      const source = sourceMap.get(s.translation_key) ?? null;
      const current = await getTranslation(env.TRANSLATE_DB, languageCode, s.translation_key);
      const stale = source ? (await sha256Hex(source)) !== s.source_hash : true;
      return {
        id: s.id,
        key: s.translation_key,
        value: s.value,
        source,
        currentValue: current?.value ?? '',
        stale,
        contributorName: s.contributor_name,
        contributorAvatar: s.contributor_avatar,
        contextRoute: s.context_route,
        appVersion: s.app_version,
        createdAt: s.created_at,
      };
    })
  );

  return json({ suggestions: enriched });
};
