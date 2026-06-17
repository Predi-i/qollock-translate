import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders } from '../../../lib/catalog';
import { acceptSuggestion, getSuggestion, rejectSuggestion } from '../../../lib/db';
import { fetchSourceEntries } from '../../../lib/github';
import { badRequest, json, readJson } from '../../../lib/http';

interface SuggestionActionBody {
  action?: 'accept' | 'reject';
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id?.trim();
  if (!id) return badRequest('missing suggestion id');

  let body: SuggestionActionBody;
  try {
    body = await readJson<SuggestionActionBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  if (body.action !== 'accept' && body.action !== 'reject') {
    return badRequest('action must be accept or reject');
  }

  const suggestion = await getSuggestion(env.TRANSLATE_DB, id);
  if (!suggestion) return json({ error: 'suggestion not found' }, { status: 404 });
  if (suggestion.status !== 'pending') {
    return badRequest(`suggestion has already been ${suggestion.status}`);
  }

  if (body.action === 'reject') {
    const rejected = await rejectSuggestion(env.TRANSLATE_DB, id);
    return json({ suggestion: rejected });
  }

  // Accept: re-validate placeholders against the CURRENT source, not the source
  // at suggestion time. The English may have changed; a stale suggestion that no
  // longer balances its placeholders must not be pulled in.
  const sourceMap = await fetchSourceEntries(env);
  const source = sourceMap.get(suggestion.translation_key);
  if (!source) {
    return badRequest(`source key no longer exists: ${suggestion.translation_key}`);
  }
  const check = checkPlaceholders(source, suggestion.value);
  if (check.missing.length || check.extra.length) {
    return badRequest(
      `cannot accept: the English changed and placeholders no longer match (missing [${check.missing.join(', ')}], extra [${check.extra.join(', ')}]). Edit the string directly instead.`
    );
  }

  const accepted = await acceptSuggestion(env.TRANSLATE_DB, id, locals.translatorEmail);
  if (!accepted) return json({ error: 'could not accept suggestion' }, { status: 500 });
  return json({ suggestion: accepted });
};
