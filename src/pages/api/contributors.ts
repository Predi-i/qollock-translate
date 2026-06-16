import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { listContributors } from '../../lib/db';
import { json } from '../../lib/http';

export const GET: APIRoute = async () => {
  return json({ contributors: await listContributors(env.TRANSLATE_DB) });
};
