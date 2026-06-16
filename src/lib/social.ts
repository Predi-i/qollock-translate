import { json } from './http';

const DEFAULT_SOCIAL_BASE_URL = 'https://grimoire-social.slusheliott.workers.dev';

export interface SocialUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function requireSocialUser(
  request: Request,
  env: { GRIMOIRE_SOCIAL_BASE_URL?: string }
): Promise<SocialUser | Response> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return json({ error: 'authentication required' }, { status: 401 });
  }

  const baseUrl = (env.GRIMOIRE_SOCIAL_BASE_URL || DEFAULT_SOCIAL_BASE_URL).replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
      },
    });
  } catch (err) {
    return json(
      { error: `could not reach Grimoire Social: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  if (response.status === 401) {
    return json({ error: 'authentication required' }, { status: 401 });
  }
  if (!response.ok) {
    return json({ error: `Grimoire Social returned ${response.status}` }, { status: 502 });
  }

  const body = await safeJson(response);
  const user = readSocialUser(body);
  if (!user) return json({ error: 'Grimoire Social returned an invalid user' }, { status: 502 });
  return user;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readSocialUser(body: unknown): SocialUser | null {
  if (!body || typeof body !== 'object' || !('user' in body)) return null;
  const user = body.user;
  if (!user || typeof user !== 'object') return null;
  const id = 'id' in user && typeof user.id === 'string' ? user.id : '';
  const displayName =
    'display_name' in user && typeof user.display_name === 'string' ? user.display_name : '';
  const avatarUrl =
    'avatar_url' in user && (typeof user.avatar_url === 'string' || user.avatar_url === null)
      ? user.avatar_url
      : null;
  if (!id || !displayName) return null;
  return { id, displayName, avatarUrl };
}
