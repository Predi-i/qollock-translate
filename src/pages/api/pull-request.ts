import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { languageExists } from '../../lib/db';
import { createTranslationPullRequest } from '../../lib/github';
import { badRequest, json, readJson } from '../../lib/http';
import { materializeLanguage } from '../../lib/translationData';

interface PullRequestBody {
  languageCode?: string;
}

export const POST: APIRoute = async ({ request }) => {
  let body: PullRequestBody;
  try {
    body = await readJson<PullRequestBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  if (!languageCode) return badRequest('missing language code');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const materialized = await materializeLanguage(env, env.TRANSLATE_DB, languageCode);
  if (materialized.stats.completed === 0) {
    return badRequest('there are no translated strings to submit');
  }

  const pullRequest = await createTranslationPullRequest(env, languageCode, materialized.catalog);
  return json({ pullRequest });
};
