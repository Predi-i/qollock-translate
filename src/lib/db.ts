export interface LanguageRow {
  code: string;
  name: string;
  enabled: number;
  created_at: string;
}

export interface TranslationRow {
  language_code: string;
  translation_key: string;
  value: string;
  status: 'draft' | 'translated' | 'reviewed';
  needs_review: number;
  translator_email: string | null;
  reviewer_email: string | null;
  updated_at: string;
}

export interface ContributorRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: 'translator' | 'reviewer' | 'admin';
  trust_level: number;
  banned_at: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface ContributorDashboardRow extends ContributorRow {
  // Strings this contributor has translated / reviewed, counted from the
  // translations table by attribution (translator_email / reviewer_email now
  // hold the GitHub login). These replace the old social-suggestion tallies,
  // which are always 0 for workbench translators.
  translated_count: number;
  reviewed_count: number;
}

export interface TranslationSuggestionRow {
  id: string;
  language_code: string;
  translation_key: string;
  source_hash: string;
  value: string;
  status: 'pending' | 'accepted' | 'rejected';
  contributor_id: string;
  context_route: string | null;
  app_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface SuggestionWithContributor extends TranslationSuggestionRow {
  contributor_name: string;
  contributor_avatar: string | null;
}

export interface GlossaryTermRow {
  language_code: string;
  source_term: string;
  target_term: string;
  notes: string;
  updated_by: string | null;
  updated_at: string;
}

export async function listLanguages(db: D1Database): Promise<LanguageRow[]> {
  const result = await db
    .prepare<LanguageRow>(
      'SELECT code, name, enabled, created_at FROM languages WHERE enabled = 1 ORDER BY code'
    )
    .all();
  return result.results ?? [];
}

export async function addLanguage(db: D1Database, code: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO languages (code, name, enabled)
       VALUES (?, ?, 1)
       ON CONFLICT(code) DO UPDATE SET name = excluded.name, enabled = 1`
    )
    .bind(code, name)
    .run();
}

export async function languageExists(db: D1Database, code: string): Promise<boolean> {
  const row = await db
    .prepare<{ code: string }>('SELECT code FROM languages WHERE code = ? AND enabled = 1')
    .bind(code)
    .first();
  return !!row;
}

export async function getTranslations(db: D1Database, languageCode: string): Promise<TranslationRow[]> {
  const result = await db
    .prepare<TranslationRow>(
      `SELECT language_code, translation_key, value, status, needs_review, translator_email, reviewer_email, updated_at
       FROM translations
       WHERE language_code = ?
       ORDER BY translation_key`
    )
    .bind(languageCode)
    .all();
  return result.results ?? [];
}

export async function listGlossaryTerms(db: D1Database, languageCode: string): Promise<GlossaryTermRow[]> {
  const result = await db
    .prepare<GlossaryTermRow>(
      `SELECT language_code, source_term, target_term, notes, updated_by, updated_at
       FROM glossary_terms
       WHERE language_code = ?
       ORDER BY lower(source_term)`
    )
    .bind(languageCode)
    .all();
  return result.results ?? [];
}

export async function getGlossaryTerm(
  db: D1Database,
  languageCode: string,
  sourceTerm: string
): Promise<GlossaryTermRow | null> {
  return await db
    .prepare<GlossaryTermRow>(
      `SELECT language_code, source_term, target_term, notes, updated_by, updated_at
       FROM glossary_terms
       WHERE language_code = ? AND source_term = ?`
    )
    .bind(languageCode, sourceTerm)
    .first();
}

export async function upsertGlossaryTerm(
  db: D1Database,
  params: {
    languageCode: string;
    sourceTerm: string;
    targetTerm: string;
    notes: string;
    updatedBy: string;
  }
): Promise<GlossaryTermRow | null> {
  await db
    .prepare(
      `INSERT INTO glossary_terms (
         language_code, source_term, target_term, notes, updated_by, updated_at
       )
       VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(language_code, source_term) DO UPDATE SET
         target_term = excluded.target_term,
         notes = excluded.notes,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`
    )
    .bind(params.languageCode, params.sourceTerm, params.targetTerm, params.notes, params.updatedBy)
    .run();

  return await getGlossaryTerm(db, params.languageCode, params.sourceTerm);
}

export async function deleteGlossaryTerm(
  db: D1Database,
  languageCode: string,
  sourceTerm: string
): Promise<void> {
  await db
    .prepare('DELETE FROM glossary_terms WHERE language_code = ? AND source_term = ?')
    .bind(languageCode, sourceTerm)
    .run();
}

export async function getTranslation(
  db: D1Database,
  languageCode: string,
  key: string
): Promise<TranslationRow | null> {
  return await db
    .prepare<TranslationRow>(
      `SELECT language_code, translation_key, value, status, needs_review, translator_email, reviewer_email, updated_at
       FROM translations
       WHERE language_code = ? AND translation_key = ?`
    )
    .bind(languageCode, key)
    .first();
}

export async function upsertTranslation(
  db: D1Database,
  params: {
    languageCode: string;
    key: string;
    value: string;
    status: 'draft' | 'translated' | 'reviewed';
    needsReview: boolean;
    translatorEmail: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO translations (
         language_code, translation_key, value, status, needs_review, translator_email, reviewer_email, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(language_code, translation_key) DO UPDATE SET
         value = excluded.value,
         status = excluded.status,
         needs_review = excluded.needs_review,
         translator_email = excluded.translator_email,
         reviewer_email = excluded.reviewer_email,
         updated_at = excluded.updated_at`
    )
    .bind(
      params.languageCode,
      params.key,
      params.value,
      params.status,
      params.needsReview ? 1 : 0,
      params.translatorEmail,
      params.status === 'reviewed' ? params.translatorEmail : null
    )
    .run();
}

// Write many translations at once for bulk import. Same upsert semantics as
// upsertTranslation, batched so a full-catalog import is a handful of round
// trips instead of one per string. D1 caps statements per batch, so chunk.
export async function bulkUpsertTranslations(
  db: D1Database,
  rows: Array<{
    languageCode: string;
    key: string;
    value: string;
    status: 'draft' | 'translated' | 'reviewed';
    needsReview: boolean;
    translatorEmail: string;
  }>
): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO translations (
       language_code, translation_key, value, status, needs_review, translator_email, reviewer_email, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(language_code, translation_key) DO UPDATE SET
       value = excluded.value,
       status = excluded.status,
       needs_review = excluded.needs_review,
       translator_email = excluded.translator_email,
       reviewer_email = excluded.reviewer_email,
       updated_at = excluded.updated_at`
  );

  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK).map((row) =>
      stmt.bind(
        row.languageCode,
        row.key,
        row.value,
        row.status,
        row.needsReview ? 1 : 0,
        row.translatorEmail,
        row.status === 'reviewed' ? row.translatorEmail : null
      )
    );
    if (batch.length) await db.batch(batch);
  }
}

export interface ImportBatchRow {
  id: string;
  language_code: string;
  translator_email: string;
  row_count: number;
  undone_at: string | null;
  created_at: string;
}

// The prior state of one string, captured before an import overwrote it (or
// prior_existed = false if the import was what created the row). imported_value
// is what the import wrote, so an undo can tell an untouched row apart from one
// the translator has since edited by hand.
export interface ImportBatchEntry {
  key: string;
  priorExisted: boolean;
  priorValue: string | null;
  priorStatus: string | null;
  priorNeedsReview: number | null;
  priorTranslatorEmail: string | null;
  priorReviewerEmail: string | null;
  priorUpdatedAt: string | null;
  importedValue: string;
}

// Persist an import as a revertible batch: the batch header plus one entry per
// affected string. Chunked like bulkUpsertTranslations because D1 caps the
// statements per batch.
export async function recordImportBatch(
  db: D1Database,
  params: {
    id: string;
    languageCode: string;
    translatorEmail: string;
    entries: ImportBatchEntry[];
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO import_batches (id, language_code, translator_email, row_count)
       VALUES (?, ?, ?, ?)`
    )
    .bind(params.id, params.languageCode, params.translatorEmail, params.entries.length)
    .run();

  const stmt = db.prepare(
    `INSERT INTO import_batch_entries (
       batch_id, translation_key, prior_existed, prior_value, prior_status,
       prior_needs_review, prior_translator_email, prior_reviewer_email,
       prior_updated_at, imported_value
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const CHUNK = 50;
  for (let i = 0; i < params.entries.length; i += CHUNK) {
    const batch = params.entries.slice(i, i + CHUNK).map((e) =>
      stmt.bind(
        params.id,
        e.key,
        e.priorExisted ? 1 : 0,
        e.priorValue,
        e.priorStatus,
        e.priorNeedsReview,
        e.priorTranslatorEmail,
        e.priorReviewerEmail,
        e.priorUpdatedAt,
        e.importedValue
      )
    );
    if (batch.length) await db.batch(batch);
  }
}

// The most recent import for a language that has not been undone, or null. Used
// to offer "Undo last import" even after the page reloads.
export async function getLatestImportBatch(
  db: D1Database,
  languageCode: string
): Promise<ImportBatchRow | null> {
  return await db
    .prepare<ImportBatchRow>(
      `SELECT id, language_code, translator_email, row_count, undone_at, created_at
       FROM import_batches
       WHERE language_code = ? AND undone_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .bind(languageCode)
    .first();
}

// Revert an import: for each string it touched, restore the prior value (or
// delete the row the import created), then mark the batch undone. The
// imported_value guard means a string the translator has edited by hand since
// the import is left alone, so undo only rolls back what is still untouched.
// Returns the number of strings reverted, or null if the batch is unknown or
// already undone.
export async function undoImportBatch(db: D1Database, batchId: string): Promise<number | null> {
  const batch = await db
    .prepare<ImportBatchRow>(
      `SELECT id, language_code, translator_email, row_count, undone_at, created_at
       FROM import_batches WHERE id = ?`
    )
    .bind(batchId)
    .first();
  if (!batch || batch.undone_at) return null;

  const entries = await db
    .prepare<{
      translation_key: string;
      prior_existed: number;
      prior_value: string | null;
      prior_status: string | null;
      prior_needs_review: number | null;
      prior_translator_email: string | null;
      prior_reviewer_email: string | null;
      prior_updated_at: string | null;
      imported_value: string;
    }>(
      `SELECT translation_key, prior_existed, prior_value, prior_status,
              prior_needs_review, prior_translator_email, prior_reviewer_email,
              prior_updated_at, imported_value
       FROM import_batch_entries WHERE batch_id = ?`
    )
    .bind(batchId)
    .all();

  // An untouched row still carries exactly what the import wrote: imported_value
  // as a 'translated' string with no review flag. If any of that changed, the
  // translator has since worked on it, so we skip it rather than discard work.
  const statements = (entries.results ?? []).map((row) => {
    if (row.prior_existed) {
      return db
        .prepare(
          `UPDATE translations
           SET value = ?, status = ?, needs_review = ?, translator_email = ?,
               reviewer_email = ?, updated_at = ?
           WHERE language_code = ? AND translation_key = ?
             AND value = ? AND status = 'translated' AND needs_review = 0`
        )
        .bind(
          row.prior_value,
          row.prior_status,
          row.prior_needs_review,
          row.prior_translator_email,
          row.prior_reviewer_email,
          row.prior_updated_at,
          batch.language_code,
          row.translation_key,
          row.imported_value
        );
    }
    return db
      .prepare(
        `DELETE FROM translations
         WHERE language_code = ? AND translation_key = ?
           AND value = ? AND status = 'translated' AND needs_review = 0`
      )
      .bind(batch.language_code, row.translation_key, row.imported_value);
  });

  statements.push(
    db
      .prepare(
        `UPDATE import_batches SET undone_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND undone_at IS NULL`
      )
      .bind(batchId)
  );

  let reverted = 0;
  const CHUNK = 50;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const results = await db.batch(statements.slice(i, i + CHUNK));
    for (const r of results) reverted += (r as { meta?: { changes?: number } }).meta?.changes ?? 0;
  }
  // The final UPDATE on import_batches also reports a change; do not count it.
  return Math.max(0, reverted - 1);
}

export async function deleteTranslation(
  db: D1Database,
  languageCode: string,
  key: string
): Promise<void> {
  await db
    .prepare('DELETE FROM translations WHERE language_code = ? AND translation_key = ?')
    .bind(languageCode, key)
    .run();
}

// ── Change history (commit-style log) ───────────────────────────────────────

export type HistoryAction = 'edit' | 'approve' | 'import' | 'delete';

export interface TranslationHistoryRow {
  id: number;
  language_code: string;
  translation_key: string;
  action: HistoryAction;
  old_value: string | null;
  new_value: string | null;
  status: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface TranslationHistoryEntry {
  languageCode: string;
  key: string;
  action: HistoryAction;
  oldValue: string | null;
  newValue: string | null;
  status: string | null;
  changedBy: string;
}

const HISTORY_INSERT = `INSERT INTO translation_history (
   language_code, translation_key, action, old_value, new_value, status, changed_by
 )
 VALUES (?, ?, ?, ?, ?, ?, ?)`;

// Append one change to the history log. Best-effort: callers should not let a
// logging failure undo a successful edit, so they wrap this in its own try.
export async function recordTranslationHistory(
  db: D1Database,
  entry: TranslationHistoryEntry
): Promise<void> {
  await db
    .prepare(HISTORY_INSERT)
    .bind(
      entry.languageCode,
      entry.key,
      entry.action,
      entry.oldValue,
      entry.newValue,
      entry.status,
      entry.changedBy
    )
    .run();
}

// Append many changes at once (e.g. one per string in a bulk import). Chunked
// like the other bulk writers because D1 caps statements per batch.
export async function bulkRecordTranslationHistory(
  db: D1Database,
  entries: TranslationHistoryEntry[]
): Promise<void> {
  const stmt = db.prepare(HISTORY_INSERT);
  const CHUNK = 50;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK).map((e) =>
      stmt.bind(e.languageCode, e.key, e.action, e.oldValue, e.newValue, e.status, e.changedBy)
    );
    if (batch.length) await db.batch(batch);
  }
}

// Most recent changes for a language, newest first. Capped so the history view
// stays a recent-activity log rather than an unbounded dump.
export async function listTranslationHistory(
  db: D1Database,
  languageCode: string,
  limit = 200
): Promise<TranslationHistoryRow[]> {
  const result = await db
    .prepare<TranslationHistoryRow>(
      `SELECT id, language_code, translation_key, action, old_value, new_value, status, changed_by, created_at
       FROM translation_history
       WHERE language_code = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(languageCode, limit)
    .all();
  return result.results ?? [];
}

export async function upsertContributor(
  db: D1Database,
  params: { id: string; displayName: string; avatarUrl: string | null }
): Promise<ContributorRow | null> {
  await db
    .prepare(
      `INSERT INTO contributors (id, display_name, avatar_url, last_seen_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         last_seen_at = excluded.last_seen_at`
    )
    .bind(params.id, params.displayName, params.avatarUrl)
    .run();

  return await db
    .prepare<ContributorRow>(
      `SELECT id, display_name, avatar_url, role, trust_level, banned_at, created_at, last_seen_at
       FROM contributors
       WHERE id = ?`
    )
    .bind(params.id)
    .first();
}

export async function insertTranslationSuggestion(
  db: D1Database,
  params: {
    id: string;
    languageCode: string;
    key: string;
    sourceHash: string;
    value: string;
    contributorId: string;
    contextRoute: string | null;
    appVersion: string | null;
  }
): Promise<TranslationSuggestionRow | null> {
  await db
    .prepare(
      `INSERT INTO translation_suggestions (
         id, language_code, translation_key, source_hash, value, contributor_id,
         context_route, app_version
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      params.id,
      params.languageCode,
      params.key,
      params.sourceHash,
      params.value,
      params.contributorId,
      params.contextRoute,
      params.appVersion
    )
    .run();

  return await db
    .prepare<TranslationSuggestionRow>(
      `SELECT id, language_code, translation_key, source_hash, value, status,
              contributor_id, context_route, app_version, created_at, updated_at
       FROM translation_suggestions
       WHERE id = ?`
    )
    .bind(params.id)
    .first();
}

export async function listSuggestions(
  db: D1Database,
  languageCode: string,
  status: TranslationSuggestionRow['status'] = 'pending'
): Promise<SuggestionWithContributor[]> {
  const result = await db
    .prepare<SuggestionWithContributor>(
      `SELECT s.id, s.language_code, s.translation_key, s.source_hash, s.value, s.status,
              s.contributor_id, s.context_route, s.app_version, s.created_at, s.updated_at,
              c.display_name AS contributor_name, c.avatar_url AS contributor_avatar
       FROM translation_suggestions s
       LEFT JOIN contributors c ON c.id = s.contributor_id
       WHERE s.language_code = ? AND s.status = ?
       ORDER BY s.translation_key, s.created_at DESC`
    )
    .bind(languageCode, status)
    .all();
  return result.results ?? [];
}

export async function getSuggestion(
  db: D1Database,
  id: string
): Promise<TranslationSuggestionRow | null> {
  return await db
    .prepare<TranslationSuggestionRow>(
      `SELECT id, language_code, translation_key, source_hash, value, status,
              contributor_id, context_route, app_version, created_at, updated_at
       FROM translation_suggestions
       WHERE id = ?`
    )
    .bind(id)
    .first();
}

// Pull a pending suggestion into the translations table as a normal draft, mark
// it accepted, and reject any competing pending suggestions for the same string
// (one winner per key). Returns the accepted suggestion, or null if it was not
// pending. The caller is responsible for re-validating placeholders first.
export async function acceptSuggestion(
  db: D1Database,
  id: string,
  reviewerEmail: string
): Promise<TranslationSuggestionRow | null> {
  const suggestion = await getSuggestion(db, id);
  if (!suggestion || suggestion.status !== 'pending') return null;

  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  await db.batch([
    db
      .prepare(
        `INSERT INTO translations (
           language_code, translation_key, value, status, needs_review, translator_email, reviewer_email, updated_at
         )
         VALUES (?, ?, ?, 'translated', 0, ?, NULL, ${now})
         ON CONFLICT(language_code, translation_key) DO UPDATE SET
           value = excluded.value,
           status = 'translated',
           needs_review = 0,
           translator_email = excluded.translator_email,
           reviewer_email = NULL,
           updated_at = excluded.updated_at`
      )
      .bind(suggestion.language_code, suggestion.translation_key, suggestion.value, reviewerEmail),
    db
      .prepare(`UPDATE translation_suggestions SET status = 'accepted', updated_at = ${now} WHERE id = ?`)
      .bind(id),
    db
      .prepare(
        `UPDATE translation_suggestions SET status = 'rejected', updated_at = ${now}
         WHERE language_code = ? AND translation_key = ? AND status = 'pending' AND id != ?`
      )
      .bind(suggestion.language_code, suggestion.translation_key, id),
  ]);

  return await getSuggestion(db, id);
}

export async function rejectSuggestion(
  db: D1Database,
  id: string
): Promise<TranslationSuggestionRow | null> {
  await db
    .prepare(
      `UPDATE translation_suggestions
       SET status = 'rejected', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND status = 'pending'`
    )
    .bind(id)
    .run();
  return await getSuggestion(db, id);
}

export async function countPendingSuggestions(db: D1Database, languageCode: string): Promise<number> {
  const row = await db
    .prepare<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM translation_suggestions
       WHERE language_code = ? AND status = 'pending'`
    )
    .bind(languageCode)
    .first();
  return row?.count ?? 0;
}

export async function listContributors(db: D1Database): Promise<ContributorDashboardRow[]> {
  // Scalar subqueries (not joins) for the counts so the two tallies stay
  // independent — a join to translations would multiply rows and inflate them.
  const result = await db
    .prepare<ContributorDashboardRow>(
      `SELECT
         c.id,
         c.display_name,
         c.avatar_url,
         c.role,
         c.trust_level,
         c.banned_at,
         c.created_at,
         c.last_seen_at,
         (SELECT COUNT(*) FROM translations t WHERE t.translator_email = c.id) AS translated_count,
         (SELECT COUNT(*) FROM translations t WHERE t.reviewer_email = c.id) AS reviewed_count
       FROM contributors c
       ORDER BY c.last_seen_at DESC`
    )
    .all();
  return result.results ?? [];
}

export async function updateContributorRole(
  db: D1Database,
  contributorId: string,
  role: ContributorRow['role']
): Promise<ContributorRow | null> {
  await db
    .prepare('UPDATE contributors SET role = ? WHERE id = ?')
    .bind(role, contributorId)
    .run();

  return await db
    .prepare<ContributorRow>(
      `SELECT id, display_name, avatar_url, role, trust_level, banned_at, created_at, last_seen_at
       FROM contributors
       WHERE id = ?`
    )
    .bind(contributorId)
    .first();
}
