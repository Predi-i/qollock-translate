import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { undoImportBatch } from '../../lib/db';
import { badRequest, json, readJson } from '../../lib/http';

interface UndoBody {
  batchId?: string;
}

// Revert a single import in one click. Each string the import touched is rolled
// back to its prior state, unless the translator has edited it by hand since the
// import (in which case that string is left alone). Idempotent: undoing an
// already-undone batch is a no-op.
export const POST: APIRoute = async ({ request }) => {
  let body: UndoBody;
  try {
    body = await readJson<UndoBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const batchId = (body.batchId ?? '').trim();
  if (!batchId) return badRequest('batchId is required');

  const reverted = await undoImportBatch(env.TRANSLATE_DB, batchId);
  if (reverted === null) {
    return badRequest('that import was already undone or no longer exists');
  }

  return json({ reverted });
};
