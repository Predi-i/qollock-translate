import {
  checkPlaceholders,
  flattenValues,
  placeholders,
  unflattenValues,
  type JsonObject,
} from './catalog';
import { getTranslations } from './db';
import { fetchCatalog, fetchSourceEntries } from './github';

export type CatalogRowStatus = 'missing' | 'shipped' | 'draft' | 'translated' | 'reviewed';

export interface CatalogRow {
  key: string;
  source: string;
  value: string;
  status: CatalogRowStatus;
  needsReview: boolean;
  translatorEmail: string | null;
  reviewerEmail: string | null;
  updatedAt: string | null;
  placeholders: string[];
  missingPlaceholders: string[];
  extraPlaceholders: string[];
}

export interface MaterializedLanguage {
  languageCode: string;
  rows: CatalogRow[];
  catalog: JsonObject;
  stats: {
    total: number;
    completed: number;
    reviewed: number;
    drafts: number;
  };
}

export async function materializeLanguage(
  env: Env,
  db: D1Database,
  languageCode: string
): Promise<MaterializedLanguage> {
  const sourceMap = await fetchSourceEntries(env);
  const repoTarget = await fetchCatalog(env, languageCode);
  const targetMap = flattenValues(repoTarget);
  const draftRows = await getTranslations(db, languageCode);
  const draftMap = new Map(draftRows.map((row) => [row.translation_key, row]));

  const rows: CatalogRow[] = [];
  const catalogEntries: Array<{ key: string; value: string }> = [];

  for (const [key, source] of sourceMap.entries()) {
    const draft = draftMap.get(key);
    const repoValue = targetMap.get(key);
    const value = draft?.value ?? repoValue ?? '';
    // A value that exists only in the live repo (no local draft) still wants a
    // review pass here, so surface it as 'translated' (Needs review) rather than
    // a separate "Live" bucket that sits outside the workflow.
    const status: CatalogRowStatus = draft?.status ?? (repoValue ? 'translated' : 'missing');
    const check = checkPlaceholders(source, value);

    rows.push({
      key,
      source,
      value,
      status,
      needsReview: draft?.needs_review === 1,
      translatorEmail: draft?.translator_email ?? null,
      reviewerEmail: draft?.reviewer_email ?? null,
      updatedAt: draft?.updated_at ?? null,
      placeholders: placeholders(source),
      missingPlaceholders: check.missing,
      extraPlaceholders: check.extra,
    });

    if (value.trim()) catalogEntries.push({ key, value });
  }

  const stats = {
    total: rows.length,
    completed: rows.filter((row) => row.value.trim()).length,
    reviewed: rows.filter((row) => row.status === 'reviewed').length,
    drafts: rows.filter((row) => row.status === 'draft' || row.status === 'translated').length,
  };

  return {
    languageCode,
    rows,
    catalog: unflattenValues(catalogEntries),
    stats,
  };
}
