import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { clearSessionCookie, destroySession } from '../../lib/auth';

// Drop the KV session and clear the cookie, then return to the login page.
// Accept both GET (link) and POST (form/button) so either UI works.
const handler: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  await destroySession(env.SESSION, request);
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/login',
      'Set-Cookie': clearSessionCookie(secure),
    },
  });
};

export const GET = handler;
export const POST = handler;
