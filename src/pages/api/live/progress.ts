import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { countPendingSuggestions } from '../../../lib/db';
import { badRequest, json } from '../../../lib/http';
import { ensureLiveLanguage, requireLiveContributor } from '../../../lib/live';
import { materializeLanguage } from '../../../lib/translationData';

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireLiveContributor(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim();
  if (!languageCode) return badRequest('missing lang query parameter');

  const languageError = await ensureLiveLanguage(env.TRANSLATE_DB, languageCode);
  if (languageError) return languageError;

  const [materialized, pendingSuggestions] = await Promise.all([
    materializeLanguage(env, env.TRANSLATE_DB, languageCode),
    countPendingSuggestions(env.TRANSLATE_DB, languageCode),
  ]);

  return json({
    languageCode,
    total: materialized.stats.total,
    completed: materialized.stats.completed,
    reviewed: materialized.stats.reviewed,
    pendingSuggestions,
  });
};
