import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { json } from '../../../../lib/http';
import { requireLiveContributor } from '../../../../lib/live';

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireLiveContributor(request, env);
  if (auth instanceof Response) return auth;

  return json({
    contributor: {
      id: auth.contributor.id,
      displayName: auth.contributor.display_name,
      avatarUrl: auth.contributor.avatar_url,
      role: auth.contributor.role,
      trustLevel: auth.contributor.trust_level,
      lastSeenAt: auth.contributor.last_seen_at,
    },
  });
};
