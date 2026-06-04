import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  GitPullRequest,
  Languages,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { COMMON_LANGUAGES, flagForCode, sectionForKey, type SectionMeta } from '../lib/languages';

type RowStatus = 'missing' | 'shipped' | 'draft' | 'translated' | 'reviewed';
type Filter = 'open' | 'flagged' | 'done' | 'all';

interface Language {
  code: string;
  name: string;
  enabled: number;
  created_at: string;
}

interface CatalogRow {
  key: string;
  source: string;
  value: string;
  status: RowStatus;
  translatorEmail: string | null;
  reviewerEmail: string | null;
  updatedAt: string | null;
  placeholders: string[];
  missingPlaceholders: string[];
  extraPlaceholders: string[];
}

interface CatalogResponse {
  languageCode: string;
  languages: Language[];
  rows: CatalogRow[];
  stats: { total: number; completed: number; reviewed: number; drafts: number };
}

interface PullResponse {
  pullRequest: { url: string; number: number; branch: string; updatedExisting: boolean };
}

interface RowGroup {
  section: SectionMeta;
  rows: CatalogRow[];
}

const PLACEHOLDER_RE = /{{\s*([\w.-]+)\s*}}/g;
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

// Plain-language labels. Wire-format status values stay the same.
function statusMeta(status: RowStatus, flagged: boolean): { label: string; cls: string } {
  if (flagged) return { label: 'Needs fix', cls: 'flagged' };
  switch (status) {
    case 'missing':
      return { label: 'To do', cls: 'missing' };
    case 'shipped':
      return { label: 'Already live', cls: 'shipped' };
    case 'reviewed':
      return { label: 'Checked', cls: 'reviewed' };
    default:
      return { label: 'Done', cls: 'translated' };
  }
}

function computeStats(rows: CatalogRow[]): CatalogResponse['stats'] {
  return {
    total: rows.length,
    completed: rows.filter((r) => r.value.trim()).length,
    reviewed: rows.filter((r) => r.status === 'reviewed').length,
    drafts: rows.filter((r) => r.status === 'draft' || r.status === 'translated').length,
  };
}

export default function TranslatorApp() {
  const [email, setEmail] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const savedValues = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (selectedLanguage) void loadCatalog(selectedLanguage);
  }, [selectedLanguage]);

  async function bootstrap() {
    setError('');
    try {
      const [sessionRes, languagesRes] = await Promise.all([
        fetchJson<{ email: string }>('/api/session'),
        fetchJson<{ languages: Language[] }>('/api/languages'),
      ]);
      setEmail(sessionRes.email);
      setLanguages(languagesRes.languages);
      const first = languagesRes.languages[0]?.code ?? '';
      if (first) setSelectedLanguage(first);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadCatalog(languageCode = selectedLanguage) {
    if (!languageCode) return;
    setBusy('loading');
    setError('');
    try {
      const next = await fetchJson<CatalogResponse>(`/api/catalog?lang=${encodeURIComponent(languageCode)}`);
      setCatalog(next);
      setLanguages(next.languages);
      setDrafts(Object.fromEntries(next.rows.map((row) => [row.key, row.value])));
      savedValues.current = new Map(next.rows.map((row) => [row.key, row.value]));
      setRowErrors({});
      setSavedKeys({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function addLanguageByCode(code: string, name: string) {
    setBusy('add-language');
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<{ languages: Language[] }>('/api/languages', {
        method: 'POST',
        body: JSON.stringify({ code, name }),
      });
      setLanguages(result.languages);
      setSelectedLanguage(code);
      setPickerOpen(false);
      setPickerQuery('');
      setMessage(`Added ${name}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  function patchRow(key: string, value: string, status: RowStatus) {
    setCatalog((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((row) => {
        if (row.key !== key) return row;
        const check = checkPlaceholders(row.source, value);
        return {
          ...row,
          value,
          status,
          missingPlaceholders: value.trim() ? check.missing : [],
          extraPlaceholders: value.trim() ? check.extra : [],
        };
      });
      return { ...prev, rows, stats: computeStats(rows) };
    });
  }

  // Save a single row. Returns true if it saved (or was a no-op), false if blocked.
  async function commitRow(row: CatalogRow, rawValue: string, opts: { review?: boolean; force?: boolean } = {}) {
    const key = row.key;
    const value = rawValue;
    const wasReviewed = row.status === 'reviewed';
    const review = opts.review ?? wasReviewed;
    const statusChanged = review !== wasReviewed;

    if (!opts.force && value === savedValues.current.get(key) && !statusChanged) return true;

    if (value.trim()) {
      const check = checkPlaceholders(row.source, value);
      if (check.missing.length || check.extra.length) {
        setRowErrors((e) => ({
          ...e,
          [key]: `Keep the {{tags}}: missing ${check.missing.join(', ') || 'none'}, extra ${check.extra.join(', ') || 'none'}`,
        }));
        return false;
      }
    }

    setRowErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
    setSavingKeys((s) => ({ ...s, [key]: true }));
    try {
      await fetchJson('/api/translations', {
        method: 'POST',
        body: JSON.stringify({
          languageCode: selectedLanguage,
          key,
          value,
          status: review ? 'reviewed' : 'translated',
        }),
      });
      savedValues.current.set(key, value);
      patchRow(key, value, value.trim() ? (review ? 'reviewed' : 'translated') : 'missing');
      setSavedKeys((s) => ({ ...s, [key]: true }));
      window.setTimeout(() => setSavedKeys((s) => ({ ...s, [key]: false })), 1400);
      return true;
    } catch (err) {
      setRowErrors((e) => ({ ...e, [key]: (err as Error).message }));
      return false;
    } finally {
      setSavingKeys((s) => ({ ...s, [key]: false }));
    }
  }

  async function createPullRequest() {
    if (!selectedLanguage) return;
    setBusy('pr');
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<PullResponse>('/api/pull-request', {
        method: 'POST',
        body: JSON.stringify({ languageCode: selectedLanguage }),
      });
      setMessage(`PR #${result.pullRequest.number}: ${result.pullRequest.url}`);
      window.open(result.pullRequest.url, '_blank', 'noopener');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  // Filter on the SAVED value, not the live draft, so a row never disappears
  // out from under the cursor as soon as the translator starts typing. It moves
  // between tabs only after a save (Enter / blur).
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.rows ?? []).filter((row) => {
      const flagged = row.missingPlaceholders.length > 0 || row.extraPlaceholders.length > 0;
      const done = !!row.value.trim();
      const matchesFilter =
        filter === 'all' ||
        (filter === 'open' && !done) ||
        (filter === 'flagged' && flagged) ||
        (filter === 'done' && done);
      const matchesQuery =
        !needle ||
        row.key.toLowerCase().includes(needle) ||
        row.source.toLowerCase().includes(needle) ||
        row.value.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query]);

  const orderedKeys = useMemo(() => filteredRows.map((row) => row.key), [filteredRows]);

  const groups = useMemo<RowGroup[]>(() => {
    const out: RowGroup[] = [];
    let current: RowGroup | null = null;
    for (const row of filteredRows) {
      const section = sectionForKey(row.key);
      if (!current || current.section.label !== section.label) {
        current = { section, rows: [] };
        out.push(current);
      }
      current.rows.push(row);
    }
    return out;
  }, [filteredRows]);

  const pickerOptions = useMemo(() => {
    const taken = new Set(languages.map((l) => l.code.toLowerCase()));
    const needle = pickerQuery.trim().toLowerCase();
    return COMMON_LANGUAGES.filter((lang) => !taken.has(lang.code.toLowerCase())).filter(
      (lang) =>
        !needle ||
        lang.name.toLowerCase().includes(needle) ||
        lang.native.toLowerCase().includes(needle) ||
        lang.code.toLowerCase().includes(needle)
    );
  }, [languages, pickerQuery]);

  const customOption = useMemo(() => {
    const raw = pickerQuery.trim();
    if (!raw || !CODE_RE.test(raw) || raw.toLowerCase() === 'en') return null;
    const taken = new Set(languages.map((l) => l.code.toLowerCase()));
    if (taken.has(raw.toLowerCase())) return null;
    if (COMMON_LANGUAGES.some((l) => l.code.toLowerCase() === raw.toLowerCase())) return null;
    return { code: raw, name: displayName(raw), flag: flagForCode(raw) };
  }, [pickerQuery, languages]);

  function focusKey(key: string | undefined) {
    if (!key) return;
    const el = document.getElementById(`tx-${key}`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveFocus(currentKey: string, dir: 1 | -1) {
    const idx = orderedKeys.indexOf(currentKey);
    if (idx === -1) return;
    focusKey(orderedKeys[idx + dir]);
  }

  function onRowKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, row: CatalogRow) {
    if (event.nativeEvent.isComposing) return; // let IME (Bengali, CJK, etc.) handle Enter
    const el = event.currentTarget;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void commitRow(row, el.value).then((ok) => {
        if (ok) moveFocus(row.key, 1);
      });
    } else if (event.key === 'ArrowDown' && el.selectionStart === el.value.length && el.selectionStart === el.selectionEnd) {
      event.preventDefault();
      moveFocus(row.key, 1);
    } else if (event.key === 'ArrowUp' && el.selectionStart === 0 && el.selectionStart === el.selectionEnd) {
      event.preventDefault();
      moveFocus(row.key, -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const reset = savedValues.current.get(row.key) ?? '';
      setDrafts((d) => ({ ...d, [row.key]: reset }));
      el.blur();
    }
  }

  const completion = catalog?.stats.total
    ? Math.round((catalog.stats.completed / catalog.stats.total) * 100)
    : 0;
  const exportHref = selectedLanguage ? `/api/export?lang=${encodeURIComponent(selectedLanguage)}` : '#';
  const activeLanguage = languages.find((l) => l.code === selectedLanguage);
  const activeLanguageName = activeLanguage?.name ?? selectedLanguage;
  const prUrl = message.startsWith('PR #') ? message.split(': ').slice(1).join(': ') : '';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">GT</div>
          <div>
            <div className="brand-title">Grimoire Translate</div>
            <div className="brand-subtitle">{email || 'Loading account'}</div>
          </div>
        </div>
        <div className="button-row">
          <button
            className="btn"
            type="button"
            title="Reload the latest strings"
            disabled={!!busy || !selectedLanguage}
            onClick={() => void loadCatalog()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <a className="btn btn-secondary" href={exportHref} title="Download this language as a file">
            <Download size={16} />
            Download
          </a>
          <button
            className="btn btn-primary"
            type="button"
            title="Send your translations to the developer for review"
            disabled={!!busy || !selectedLanguage || !catalog?.stats.completed}
            onClick={() => void createPullRequest()}
          >
            <GitPullRequest size={16} />
            Submit translations
          </button>
        </div>
      </header>

      <main className="workspace workspace--inline">
        <aside className="rail">
          <div className="section">
            <div className="section-title">Languages</div>
            {!pickerOpen ? (
              <button className="btn btn-primary add-lang-btn" type="button" onClick={() => setPickerOpen(true)}>
                <Plus size={16} />
                Add a language
              </button>
            ) : (
              <div className="picker">
                <div className="picker-search">
                  <Search size={15} />
                  <input
                    className="picker-input"
                    autoFocus
                    placeholder="Search, e.g. Spanish or es"
                    value={pickerQuery}
                    onChange={(event) => setPickerQuery(event.target.value)}
                  />
                  <button
                    className="picker-x"
                    type="button"
                    title="Close"
                    onClick={() => {
                      setPickerOpen(false);
                      setPickerQuery('');
                    }}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="picker-list">
                  {pickerOptions.map((lang) => (
                    <button
                      key={lang.code}
                      className="picker-option"
                      type="button"
                      disabled={busy === 'add-language'}
                      onClick={() => void addLanguageByCode(lang.code, lang.name)}
                    >
                      <span className="lang-flag">{lang.flag}</span>
                      <span className="picker-name">{lang.name}</span>
                      <span className="picker-native">{lang.native}</span>
                      <span className="picker-code">{lang.code}</span>
                    </button>
                  ))}
                  {customOption ? (
                    <button
                      className="picker-option"
                      type="button"
                      disabled={busy === 'add-language'}
                      onClick={() => void addLanguageByCode(customOption.code, customOption.name)}
                    >
                      <span className="lang-flag">{customOption.flag}</span>
                      <span className="picker-name">Add {customOption.name}</span>
                      <span className="picker-native">custom code</span>
                      <span className="picker-code">{customOption.code}</span>
                    </button>
                  ) : null}
                  {pickerOptions.length === 0 && !customOption ? (
                    <div className="empty">No match. Type a language code like pt-BR.</div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="section">
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">{completion}%</div>
                <div className="stat-label">Complete</div>
              </div>
              <div className="stat">
                <div className="stat-value">{catalog?.stats.reviewed ?? 0}</div>
                <div className="stat-label">Checked</div>
              </div>
              <div className="stat">
                <div className="stat-value">{catalog?.stats.completed ?? 0}</div>
                <div className="stat-label">Done</div>
              </div>
              <div className="stat">
                <div className="stat-value">{catalog?.stats.total ?? 0}</div>
                <div className="stat-label">Total</div>
              </div>
            </div>
          </div>

          <div className="language-list">
            {languages.length === 0 ? (
              <div className="empty">
                <Languages size={26} style={{ margin: '0 auto 10px' }} />
                No languages yet. Add one above to start.
              </div>
            ) : (
              languages.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className={`language-button ${language.code === selectedLanguage ? 'active' : ''}`}
                  onClick={() => setSelectedLanguage(language.code)}
                >
                  <span className="lang-left">
                    <span className="lang-flag">{flagForCode(language.code)}</span>
                    <span>{language.name}</span>
                  </span>
                  <span className="language-code">{language.code}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="list-pane">
          <div className="section">
            <div className="search-row">
              <div className="field">
                <label className="label" htmlFor="search">
                  Search strings
                </label>
                <input
                  id="search"
                  className="input"
                  placeholder="Find a word or phrase"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <button className="btn btn-icon" type="button" title="Search">
                <Search size={16} />
              </button>
            </div>
            <p className="help-text">
              Type each translation{activeLanguage ? ` in ${activeLanguageName}` : ''} in the box under the English.
              Press <kbd>Enter</kbd> to save and jump to the next, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line, and{' '}
              <kbd>↑</kbd>/<kbd>↓</kbd> to move between boxes. Leave anything inside {'{{double braces}}'} unchanged.
            </p>
            {error || prUrl ? (
              <div className={`banner ${error ? 'banner-error' : ''}`}>
                <span>{error || message}</span>
                {prUrl ? (
                  <a className="banner-link" href={prUrl} target="_blank" rel="noopener">
                    <ExternalLink size={14} /> Open PR
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="segmented" role="tablist" aria-label="String filters">
            {([
              ['open', 'To do'],
              ['flagged', 'Needs fix'],
              ['done', 'Done'],
              ['all', 'All'],
            ] as Array<[Filter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segment ${filter === value ? 'active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="key-list">
            {filteredRows.length === 0 ? (
              <div className="empty">No strings here. Try another filter.</div>
            ) : (
              groups.map((group) => (
                <div className="list-group" key={group.section.label}>
                  <div className="list-group-header" title={group.section.hint}>
                    <span className="list-group-label">{group.section.label}</span>
                    <span className="list-group-count">{group.rows.length}</span>
                  </div>
                  {group.rows.map((row) => {
                    const value = drafts[row.key] ?? '';
                    const live = checkPlaceholders(row.source, value);
                    const flagged = value.trim() ? live.missing.length > 0 || live.extra.length > 0 : false;
                    const reviewed = row.status === 'reviewed';
                    const meta = statusMeta(row.status, flagged);
                    const saving = !!savingKeys[row.key];
                    const saved = !!savedKeys[row.key];
                    return (
                      <div className={`trow ${flagged ? 'trow-flagged' : ''}`} key={row.key}>
                        <div className="trow-en">
                          <span className="trow-en-text">{row.source}</span>
                          <span className={`badge ${meta.cls}`}>{meta.label}</span>
                        </div>
                        {row.placeholders.length > 0 ? (
                          <div className="trow-ph">
                            <span className="trow-ph-label">Keep exactly:</span>
                            {row.placeholders.map((item) => (
                              <span className="placeholder" key={item}>{`{{${item}}}`}</span>
                            ))}
                          </div>
                        ) : null}
                        <textarea
                          id={`tx-${row.key}`}
                          className="trow-input"
                          dir="auto"
                          rows={1}
                          placeholder={`Type the ${activeLanguageName || 'translation'} here`}
                          value={value}
                          onChange={(event) => setDrafts((d) => ({ ...d, [row.key]: event.target.value }))}
                          onKeyDown={(event) => onRowKeyDown(event, row)}
                          onBlur={(event) => void commitRow(row, event.target.value)}
                        />
                        <div className="trow-foot">
                          <div className="trow-foot-left">
                            {rowErrors[row.key] ? (
                              <span className="trow-err">
                                <AlertTriangle size={13} /> {rowErrors[row.key]}
                              </span>
                            ) : (
                              <span className="trow-key">{row.key}</span>
                            )}
                          </div>
                          <div className="trow-foot-right">
                            <span className="trow-status">{saving ? 'Saving...' : saved ? 'Saved' : ''}</span>
                            <button
                              type="button"
                              className={`chk ${reviewed ? 'on' : ''}`}
                              title={reviewed ? 'Checked. Click to unmark.' : 'Mark this translation as checked'}
                              disabled={!value.trim() || saving}
                              onClick={() => void commitRow(row, value, { review: !reviewed, force: true })}
                            >
                              <Check size={14} />
                              {reviewed ? 'Checked' : 'Check'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the HTTP status fallback.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function displayName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function placeholders(value: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value))) found.add(match[1]);
  return [...found].sort();
}

function checkPlaceholders(source: string, target: string) {
  const sourceVars = new Set(placeholders(source));
  const targetVars = new Set(placeholders(target));
  return {
    missing: [...sourceVars].filter((item) => !targetVars.has(item)).sort(),
    extra: [...targetVars].filter((item) => !sourceVars.has(item)).sort(),
  };
}
