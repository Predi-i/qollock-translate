import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isLanguageCode } from '../../lib/catalog';
import {
  deleteGlossaryTerm,
  languageExists,
  listGlossaryTerms,
  upsertGlossaryTerm,
  type GlossaryTermRow,
} from '../../lib/db';
import { isLockedGlossaryTerm } from '../../lib/glossary';
import { badRequest, json, readJson } from '../../lib/http';

interface SaveGlossaryTermBody {
  languageCode?: string;
  sourceTerm?: string;
  targetTerm?: string;
  notes?: string;
}

interface DeleteGlossaryTermBody {
  languageCode?: string;
  sourceTerm?: string;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim() ?? '';
  const error = await validateLanguage(languageCode);
  if (error) return error;

  const terms = await listGlossaryTerms(env.TRANSLATE_DB, languageCode);
  return json({ terms: terms.map(publicTerm) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  let body: SaveGlossaryTermBody;
  try {
    body = await readJson<SaveGlossaryTermBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  const error = await validateLanguage(languageCode);
  if (error) return error;

  const sourceTerm = normalizeTerm(body.sourceTerm ?? '');
  const targetTerm = normalizeTerm(body.targetTerm ?? '');
  const notes = (body.notes ?? '').trim();

  if (!sourceTerm) return badRequest('source term is required');
  if (!targetTerm) return badRequest('target term is required');
  if (isLockedGlossaryTerm(sourceTerm)) return badRequest('this term must stay unchanged');
  if (sourceTerm.length > 80) return badRequest('source term is too long');
  if (targetTerm.length > 120) return badRequest('target term is too long');
  if (notes.length > 500) return badRequest('notes are too long');

  const term = await upsertGlossaryTerm(env.TRANSLATE_DB, {
    languageCode,
    sourceTerm,
    targetTerm,
    notes,
    updatedBy: locals.translatorEmail,
  });

  return json({ term: term ? publicTerm(term) : null });
};

export const DELETE: APIRoute = async ({ request }) => {
  let body: DeleteGlossaryTermBody;
  try {
    body = await readJson<DeleteGlossaryTermBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  const error = await validateLanguage(languageCode);
  if (error) return error;

  const sourceTerm = normalizeTerm(body.sourceTerm ?? '');
  if (!sourceTerm) return badRequest('source term is required');

  await deleteGlossaryTerm(env.TRANSLATE_DB, languageCode, sourceTerm);
  return json({ deleted: true });
};

async function validateLanguage(languageCode: string): Promise<Response | null> {
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }
  return null;
}

function normalizeTerm(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function publicTerm(row: GlossaryTermRow) {
  return {
    sourceTerm: row.source_term,
    targetTerm: row.target_term,
    notes: row.notes,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}
