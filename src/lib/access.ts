// Verifies the Cloudflare Access JWT for translator-facing requests.

import { jwtVerify, createRemoteJWKSet } from 'jose';

interface JwksCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  team: string;
}

let jwksCache: JwksCacheEntry | null = null;

function getJwks(team: string) {
  if (jwksCache && jwksCache.team === team) return jwksCache.jwks;
  const url = new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  jwksCache = { team, jwks: createRemoteJWKSet(url) };
  return jwksCache.jwks;
}

export interface AccessIdentity {
  email: string;
  sub: string;
}

export async function verifyAccessJwt(
  request: Request,
  env: { CF_ACCESS_TEAM: string; CF_ACCESS_AUD: string }
): Promise<AccessIdentity | { error: string; status: number }> {
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    cookieValue(request.headers.get('Cookie'), 'CF_Authorization');

  if (!token) return { error: 'no access token', status: 401 };
  if (!env.CF_ACCESS_TEAM || !env.CF_ACCESS_AUD) {
    return { error: 'access not configured', status: 500 };
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(env.CF_ACCESS_TEAM), {
      issuer: `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com`,
      audience: env.CF_ACCESS_AUD,
    });
    const email = typeof payload.email === 'string' ? payload.email : '';
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!email) return { error: 'token missing email', status: 401 };
    return { email, sub };
  } catch (err) {
    return { error: `invalid token: ${(err as Error).message}`, status: 401 };
  }
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
