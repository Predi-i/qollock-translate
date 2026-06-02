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
  translator_email: string | null;
  reviewer_email: string | null;
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
      `SELECT language_code, translation_key, value, status, translator_email, reviewer_email, updated_at
       FROM translations
       WHERE language_code = ?
       ORDER BY translation_key`
    )
    .bind(languageCode)
    .all();
  return result.results ?? [];
}

export async function getTranslation(
  db: D1Database,
  languageCode: string,
  key: string
): Promise<TranslationRow | null> {
  return await db
    .prepare<TranslationRow>(
      `SELECT language_code, translation_key, value, status, translator_email, reviewer_email, updated_at
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
    translatorEmail: string;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO translations (
         language_code, translation_key, value, status, translator_email, reviewer_email, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(language_code, translation_key) DO UPDATE SET
         value = excluded.value,
         status = excluded.status,
         translator_email = excluded.translator_email,
         reviewer_email = excluded.reviewer_email,
         updated_at = excluded.updated_at`
    )
    .bind(
      params.languageCode,
      params.key,
      params.value,
      params.status,
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
