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
  suggestion_count: number;
  pending_suggestion_count: number;
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
         COUNT(s.id) AS suggestion_count,
         COALESCE(SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_suggestion_count
       FROM contributors c
       LEFT JOIN translation_suggestions s ON s.contributor_id = c.id
       GROUP BY c.id
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
