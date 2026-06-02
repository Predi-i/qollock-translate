import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { languageExists } from '../../lib/db';
import { badRequest } from '../../lib/http';
import { materializeLanguage } from '../../lib/translationData';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim();
  if (!languageCode) return badRequest('missing lang query parameter');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const materialized = await materializeLanguage(env, env.TRANSLATE_DB, languageCode);
  return new Response(JSON.stringify(materialized.catalog, null, 2) + '\n', {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${languageCode}-translation.json"`,
    },
  });
};
