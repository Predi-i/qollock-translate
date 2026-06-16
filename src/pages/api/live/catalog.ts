import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
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

  const materialized = await materializeLanguage(env, env.TRANSLATE_DB, languageCode);
  return json({
    languageCode: materialized.languageCode,
    rows: materialized.rows,
    stats: materialized.stats,
  });
};
