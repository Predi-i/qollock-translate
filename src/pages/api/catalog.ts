import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listLanguages } from '../../lib/db';
import { badRequest, json } from '../../lib/http';
import { materializeLanguage } from '../../lib/translationData';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim();
  if (!languageCode) return badRequest('missing lang query parameter');

  const languages = await listLanguages(env.TRANSLATE_DB);
  if (!languages.some((language) => language.code === languageCode)) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const materialized = await materializeLanguage(env, env.TRANSLATE_DB, languageCode);
  return json({ ...materialized, languages });
};
