import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateContributorRole, type ContributorRow } from '../../../lib/db';
import { badRequest, json, readJson } from '../../../lib/http';

interface UpdateContributorBody {
  role?: ContributorRow['role'];
}

const ROLES = new Set<ContributorRow['role']>(['translator', 'reviewer', 'admin']);

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id?.trim();
  if (!id) return badRequest('missing contributor id');

  let body: UpdateContributorBody;
  try {
    body = await readJson<UpdateContributorBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const role = body.role;
  if (!role || !ROLES.has(role)) return badRequest('role must be translator, reviewer, or admin');

  const contributor = await updateContributorRole(env.TRANSLATE_DB, id, role);
  if (!contributor) return json({ error: 'contributor not found' }, { status: 404 });
  return json({ contributor });
};
