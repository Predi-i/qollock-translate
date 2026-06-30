import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders } from '../../../lib/catalog';
import {
  acceptSuggestion,
  getSuggestion,
  getTranslation,
  recordTranslationHistory,
  rejectSuggestion,
} from '../../../lib/db';
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

  // Capture the value this accept replaces (if any) for the history log.
  const prior = await getTranslation(env.TRANSLATE_DB, suggestion.language_code, suggestion.translation_key);

  // Attribution is shown as the GitHub nickname, so credit the login.
  const accepted = await acceptSuggestion(env.TRANSLATE_DB, id, locals.translatorLogin);
  if (!accepted) return json({ error: 'could not accept suggestion' }, { status: 500 });

  // Accepting a suggestion writes a normal 'translated' draft, so log it as an
  // edit. Best-effort: never fail the accept over the history write.
  try {
    await recordTranslationHistory(env.TRANSLATE_DB, {
      languageCode: suggestion.language_code,
      key: suggestion.translation_key,
      action: 'edit',
      oldValue: prior?.value ?? null,
      newValue: suggestion.value,
      status: 'translated',
      changedBy: locals.translatorLogin,
    });
  } catch {
    // History is a convenience log; ignore a write failure here.
  }

  return json({ suggestion: accepted });
};
