import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  GitPullRequest,
  Languages,
  Plus,
  RefreshCw,
  Save,
  Search,
} from 'lucide-react';

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
  stats: {
    total: number;
    completed: number;
    reviewed: number;
    drafts: number;
  };
}

interface PullResponse {
  pullRequest: {
    url: string;
    number: number;
    branch: string;
    updatedExisting: boolean;
  };
}

const PLACEHOLDER_RE = /{{\s*([\w.-]+)\s*}}/g;

export default function TranslatorApp() {
  const [email, setEmail] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [draft, setDraft] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (selectedLanguage) void loadCatalog(selectedLanguage);
  }, [selectedLanguage]);

  useEffect(() => {
    const selected = catalog?.rows.find((row) => row.key === selectedKey);
    setDraft(selected?.value ?? '');
  }, [catalog, selectedKey]);

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
      setSelectedKey((current) => {
        if (current && next.rows.some((row) => row.key === current)) return current;
        return next.rows.find((row) => row.status === 'missing')?.key ?? next.rows[0]?.key ?? '';
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function addLanguage() {
    if (!newCode.trim()) return;
    setBusy('add-language');
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<{ languages: Language[] }>('/api/languages', {
        method: 'POST',
        body: JSON.stringify({ code: newCode.trim(), name: newName.trim() || undefined }),
      });
      setLanguages(result.languages);
      setSelectedLanguage(newCode.trim());
      setNewCode('');
      setNewName('');
      setMessage('Language added');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function saveTranslation(reviewed = false) {
    if (!selectedLanguage || !selectedRow) return;
    const check = checkPlaceholders(selectedRow.source, draft);
    if (check.missing.length || check.extra.length) {
      setError(
        `Placeholder mismatch: missing ${check.missing.join(', ') || 'none'}, extra ${check.extra.join(', ') || 'none'}`
      );
      return;
    }

    setBusy(reviewed ? 'review' : 'save');
    setError('');
    setMessage('');
    try {
      await fetchJson('/api/translations', {
        method: 'POST',
        body: JSON.stringify({
          languageCode: selectedLanguage,
          key: selectedRow.key,
          value: draft,
          status: reviewed ? 'reviewed' : 'translated',
        }),
      });
      await loadCatalog(selectedLanguage);
      setMessage(reviewed ? 'Reviewed' : 'Saved');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
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

  const selectedRow = useMemo(
    () => catalog?.rows.find((row) => row.key === selectedKey) ?? null,
    [catalog, selectedKey]
  );

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

  const selectedCheck = selectedRow ? checkPlaceholders(selectedRow.source, draft) : { missing: [], extra: [] };
  const completion = catalog?.stats.total
    ? Math.round((catalog.stats.completed / catalog.stats.total) * 100)
    : 0;
  const exportHref = selectedLanguage ? `/api/export?lang=${encodeURIComponent(selectedLanguage)}` : '#';

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
            title="Reload catalog"
            disabled={!!busy || !selectedLanguage}
            onClick={() => void loadCatalog()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <a className="btn btn-secondary" href={exportHref} title="Download JSON">
            <Download size={16} />
            Export
          </a>
          <button
            className="btn btn-primary"
            type="button"
            title="Open GitHub pull request"
            disabled={!!busy || !selectedLanguage || !catalog?.stats.completed}
            onClick={() => void createPullRequest()}
          >
            <GitPullRequest size={16} />
            PR
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="rail">
          <div className="section">
            <div className="section-title">Language</div>
            <div className="field">
              <label className="label" htmlFor="language-code">
                Code
              </label>
              <input
                id="language-code"
                className="input"
                value={newCode}
                placeholder="es"
                onChange={(event) => setNewCode(event.target.value)}
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="label" htmlFor="language-name">
                Name
              </label>
              <input
                id="language-name"
                className="input"
                value={newName}
                placeholder="Spanish"
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              type="button"
              style={{ marginTop: 10, width: '100%' }}
              disabled={busy === 'add-language' || !newCode.trim()}
              onClick={() => void addLanguage()}
            >
              <Plus size={16} />
              Add
            </button>
          </div>

          <div className="section">
            <div className="stats-grid">
              <div className="stat">
                <div className="stat-value">{completion}%</div>
                <div className="stat-label">Complete</div>
              </div>
              <div className="stat">
                <div className="stat-value">{catalog?.stats.reviewed ?? 0}</div>
                <div className="stat-label">Reviewed</div>
              </div>
              <div className="stat">
                <div className="stat-value">{catalog?.stats.completed ?? 0}</div>
                <div className="stat-label">Filled</div>
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
                No target languages
              </div>
            ) : (
              languages.map((language) => (
                <button
                  key={language.code}
                  type="button"
                  className={`language-button ${language.code === selectedLanguage ? 'active' : ''}`}
                  onClick={() => setSelectedLanguage(language.code)}
                >
                  <span>{language.name}</span>
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
                  Search
                </label>
                <input
                  id="search"
                  className="input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <button className="btn btn-icon" type="button" title="Search">
                <Search size={16} />
              </button>
            </div>
          </div>

          <div className="segmented" role="tablist" aria-label="String filters">
            {([
              ['open', 'Open'],
              ['flagged', 'Flags'],
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
              <div className="empty">No strings</div>
            ) : (
              filteredRows.map((row) => {
                const flagged = row.missingPlaceholders.length > 0 || row.extraPlaceholders.length > 0;
                return (
                  <button
                    key={row.key}
                    type="button"
                    className={`key-row ${row.key === selectedKey ? 'active' : ''}`}
                    onClick={() => setSelectedKey(row.key)}
                  >
                    <span className="key-row-header">
                      <span className="key">{row.key}</span>
                      <span className={`badge ${flagged ? 'flagged' : row.status}`}>{flagged ? 'flag' : row.status}</span>
                    </span>
                    <span className="source-preview">{row.source}</span>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="editor-pane">
          {selectedRow ? (
            <>
              <div className="editor-head">
                <div className="key">{selectedRow.key}</div>
                <div className="button-row">
                  <span className={`badge ${selectedRow.status}`}>{selectedRow.status}</span>
                  {selectedRow.updatedAt ? <span className="status-line">{selectedRow.updatedAt}</span> : null}
                </div>
              </div>

              <div className="editor-body">
                <div className="field">
                  <div className="label">English</div>
                  <div className="source-box">{selectedRow.source}</div>
                </div>

                {selectedRow.placeholders.length > 0 ? (
                  <div className="field">
                    <div className="label">Placeholders</div>
                    <div className="placeholder-row">
                      {selectedRow.placeholders.map((item) => (
                        <span className="placeholder" key={item}>
                          {`{{${item}}}`}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="field">
                  <label className="label" htmlFor="translation-value">
                    Translation
                  </label>
                  <textarea
                    id="translation-value"
                    className="textarea"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </div>

                {selectedCheck.missing.length || selectedCheck.extra.length ? (
                  <div className="alert">
                    <AlertTriangle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                    Missing {selectedCheck.missing.join(', ') || 'none'}; extra {selectedCheck.extra.join(', ') || 'none'}
                  </div>
                ) : null}
              </div>

              <div className="editor-footer">
                <div className="status-line">{error || message || `${filteredRows.length} visible`}</div>
                <div className="button-row">
                  {message.startsWith('PR #') ? (
                    <a className="btn" href={message.split(': ').slice(1).join(': ')} target="_blank" rel="noopener">
                      <ExternalLink size={16} />
                      Open
                    </a>
                  ) : null}
                  <button
                    className="btn"
                    type="button"
                    disabled={!!busy || draft === selectedRow.value}
                    onClick={() => void saveTranslation(false)}
                  >
                    <Save size={16} />
                    Save
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!!busy || !draft.trim()}
                    onClick={() => void saveTranslation(true)}
                  >
                    <Check size={16} />
                    Review
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">Select a string</div>
          )}
        </section>
      </main>
    </div>
  );
}

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
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
