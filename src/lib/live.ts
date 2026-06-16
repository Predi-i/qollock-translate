import { displayNameForLanguage, isLanguageCode } from './catalog';
import { addLanguage, upsertContributor, type ContributorRow } from './db';
import { badRequest, json } from './http';
import { requireSocialUser, type SocialUser } from './social';

export async function requireLiveContributor(
  request: Request,
  env: Env
): Promise<{ user: SocialUser; contributor: ContributorRow } | Response> {
  const user = await requireSocialUser(request, env);
  if (user instanceof Response) return user;

  const contributor = await upsertContributor(env.TRANSLATE_DB, {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  });
  if (!contributor) return json({ error: 'could not load contributor' }, { status: 500 });
  if (contributor.banned_at) return json({ error: 'translation access disabled' }, { status: 403 });

  return { user, contributor };
}

export async function ensureLiveLanguage(db: D1Database, languageCode: string): Promise<Response | null> {
  if (!isLanguageCode(languageCode)) {
    return badRequest('language code must be BCP 47 style, like es or pt-BR');
  }
  if (languageCode.toLowerCase() === 'en') {
    return badRequest('English is the source catalog, not a target language');
  }
  await addLanguage(db, languageCode, displayNameForLanguage(languageCode));
  return null;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
