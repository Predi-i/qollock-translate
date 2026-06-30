import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { upsertContributor } from '../../lib/db';
import { json } from '../../lib/http';

export const GET: APIRoute = async ({ locals }) => {
  // Boot is the one moment we know a GitHub user is here, so record them as a
  // contributor (keyed by their login) and bump last_seen. This is what makes
  // every signed-in translator show up on the Contributors page — not just the
  // ones who came through the in-app suggestion loop.
  if (locals.translatorLogin) {
    await upsertContributor(env.TRANSLATE_DB, {
      id: locals.translatorLogin,
      displayName: locals.translatorLogin,
      avatarUrl: locals.translatorAvatar,
    });
  }

  return json({
    email: locals.translatorEmail,
    login: locals.translatorLogin,
    isReviewer: locals.isReviewer,
  });
};
