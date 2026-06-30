import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isLanguageCode } from '../../lib/catalog';
import { listTranslationHistory } from '../../lib/db';
import { badRequest, json } from '../../lib/http';

// Recent change history (commit-style log) for one language, newest first.
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim() ?? '';
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');

  const entries = await listTranslationHistory(env.TRANSLATE_DB, languageCode);
  return json({
    entries: entries.map((e) => ({
      id: e.id,
      key: e.translation_key,
      action: e.action,
      oldValue: e.old_value,
      newValue: e.new_value,
      status: e.status,
      changedBy: e.changed_by,
      createdAt: e.created_at,
    })),
  });
};
