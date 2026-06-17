import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { checkPlaceholders, flattenValues, isLanguageCode, type JsonObject } from '../../lib/catalog';
import {
  bulkUpsertTranslations,
  getLatestImportBatch,
  getTranslations,
  languageExists,
  recordImportBatch,
  type ImportBatchEntry,
} from '../../lib/db';
import { fetchCatalog, fetchSourceEntries } from '../../lib/github';
import { badRequest, json, readJson } from '../../lib/http';

interface ImportBody {
  languageCode?: string;
  catalog?: unknown;
  // When true, only write strings that are currently blank; never overwrite an
  // existing translation. Defaults to true so an upload cannot silently clobber
  // work already in the workbench.
  fillEmptyOnly?: boolean;
  // Set once the translator has acknowledged the "this looks like the English
  // source" warning. Without it, an upload that is mostly identical to English
  // is refused before anything is written.
  confirmSourceUpload?: boolean;
}

// A non-English upload whose values are mostly identical to the English source
// is almost always a mistake (the wrong file). Enough comparable strings to be
// sure, and a majority matching, trips the guard.
const SOURCE_MATCH_MIN_COMPARABLE = 25;
const SOURCE_MATCH_RATIO = 0.5;

function isEnglishTarget(languageCode: string): boolean {
  return languageCode === 'en' || languageCode.startsWith('en-');
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export const POST: APIRoute = async ({ request, locals }) => {
  let body: ImportBody;
  try {
    body = await readJson<ImportBody>(request);
  } catch (err) {
    return badRequest((err as Error).message);
  }

  const languageCode = (body.languageCode ?? '').trim();
  const fillEmptyOnly = body.fillEmptyOnly !== false; // default: do not overwrite
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');
  if (!isJsonObject(body.catalog)) return badRequest('catalog must be a JSON object of strings');
  if (!(await languageExists(env.TRANSLATE_DB, languageCode))) {
    return badRequest(`language is not enabled: ${languageCode}`);
  }

  const uploaded = flattenValues(body.catalog);
  if (uploaded.size === 0) return badRequest('no translatable strings found in the uploaded file');

  // Compare against what is already effective (existing draft, else the shipped
  // repo value) so re-importing an unchanged export does not turn every shipped
  // string into a fresh draft destined for a pull request.
  const sourceMap = await fetchSourceEntries(env);
  const repoTarget = await fetchCatalog(env, languageCode);
  const repoMap = flattenValues(repoTarget);
  // Keep the full prior rows (not just values): an undo needs to restore status,
  // review flag, and authorship, not only the text.
  const draftMap = new Map(
    (await getTranslations(env.TRANSLATE_DB, languageCode)).map((row) => [row.translation_key, row] as const)
  );

  const toWrite: Array<{
    languageCode: string;
    key: string;
    value: string;
    status: 'translated';
    needsReview: boolean;
    translatorEmail: string;
  }> = [];
  // Prior state for everything this import writes, so the whole upload can be
  // reverted in one click if it was a mistake (e.g. uploading the English file).
  const entries: ImportBatchEntry[] = [];
  const unknown: string[] = [];
  const rejected: Array<{ key: string; missing: string[]; extra: string[] }> = [];
  let unchanged = 0;
  let skippedExisting = 0;
  // How many uploaded strings are byte-for-byte the English source. Counted over
  // every non-blank string with a known source, independent of whether it would
  // be written, so a re-uploaded English file is caught even on the second try.
  let comparable = 0;
  let sourceMatches = 0;

  for (const [key, rawValue] of uploaded.entries()) {
    const value = rawValue ?? '';
    if (!value.trim()) continue; // blank entries are not an edit; skip silently

    const source = sourceMap.get(key);
    if (source === undefined) {
      unknown.push(key);
      continue;
    }

    comparable += 1;
    if (value === source) sourceMatches += 1;

    const priorRow = draftMap.get(key);
    const effective = priorRow?.value ?? repoMap.get(key) ?? '';
    if (value === effective) {
      unchanged += 1;
      continue;
    }
    if (fillEmptyOnly && effective.trim()) {
      skippedExisting += 1; // already translated; left untouched by request
      continue;
    }

    const check = checkPlaceholders(source, value);
    if (check.missing.length || check.extra.length) {
      rejected.push({ key, missing: check.missing, extra: check.extra });
      continue;
    }

    toWrite.push({
      languageCode,
      key,
      value,
      status: 'translated',
      needsReview: false,
      translatorEmail: locals.translatorEmail,
    });
    entries.push({
      key,
      priorExisted: priorRow !== undefined,
      priorValue: priorRow?.value ?? null,
      priorStatus: priorRow?.status ?? null,
      priorNeedsReview: priorRow?.needs_review ?? null,
      priorTranslatorEmail: priorRow?.translator_email ?? null,
      priorReviewerEmail: priorRow?.reviewer_email ?? null,
      priorUpdatedAt: priorRow?.updated_at ?? null,
      importedValue: value,
    });
  }

  // Stop before writing if the file looks like the English source, unless the
  // translator has confirmed. English targets are exempt (matching English is
  // the point there).
  const looksLikeSource =
    comparable >= SOURCE_MATCH_MIN_COMPARABLE && sourceMatches / comparable >= SOURCE_MATCH_RATIO;
  if (looksLikeSource && !isEnglishTarget(languageCode) && !body.confirmSourceUpload) {
    return json({
      imported: 0,
      unchanged,
      skippedExisting,
      unknownKeys: unknown.length,
      rejected,
      batchId: null,
      needsConfirm: true,
      sourceMatches,
      comparable,
    });
  }

  let batchId: string | null = null;
  if (toWrite.length) {
    await bulkUpsertTranslations(env.TRANSLATE_DB, toWrite);
    batchId = crypto.randomUUID();
    await recordImportBatch(env.TRANSLATE_DB, {
      id: batchId,
      languageCode,
      translatorEmail: locals.translatorEmail,
      entries,
    });
  }

  return json({
    imported: toWrite.length,
    unchanged,
    skippedExisting,
    unknownKeys: unknown.length,
    rejected,
    batchId,
  });
};

// The most recent import for a language that has not been undone yet, so the
// workbench can offer "Undo last import" even after the page is reloaded.
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const languageCode = url.searchParams.get('lang')?.trim() ?? '';
  if (!isLanguageCode(languageCode)) return badRequest('invalid language code');

  const batch = await getLatestImportBatch(env.TRANSLATE_DB, languageCode);
  return json({
    batch: batch ? { id: batch.id, rowCount: batch.row_count, createdAt: batch.created_at } : null,
  });
};
