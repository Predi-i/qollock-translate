import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { displayNameForLanguage, isLanguageCode } from '../../lib/catalog';
import { addLanguage, listLanguages } from '../../lib/db';
import { badRequest, json, readJson } from '../../lib/http';

interface AddLanguageBody {
  code?: string;
  name?: string;
}

export const GET: APIRoute = async () => {
  return json({ languages: await listLanguages(env.TRANSLATE_DB) });
};

export const POST: APIRoute = async ({ request }) => {
  let body: AddLanguageBody;
  try {
    body = await readJson<AddLanguageBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const code = (body.code ?? '').trim();
  if (!isLanguageCode(code)) return badRequest('language code must be BCP 47 style, like es or pt-BR');
  if (code.toLowerCase() === 'en') return badRequest('English is the source catalog, not a target language');

  const name = (body.name ?? '').trim() || displayNameForLanguage(code);
  await addLanguage(env.TRANSLATE_DB, code, name);
  return json({ languages: await listLanguages(env.TRANSLATE_DB) });
};
