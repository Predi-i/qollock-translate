import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  GitPullRequest,
  HelpCircle,
  Languages,
  Lightbulb,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { COMMON_LANGUAGES, flagForCode, sectionForKey, type SectionMeta } from '../lib/languages';

type RowStatus = 'missing' | 'shipped' | 'draft' | 'translated' | 'reviewed';
type Filter = 'open' | 'flagged' | 'done' | 'all';
type View = 'translations' | 'contributors';
type ContributorRole = 'translator' | 'reviewer' | 'admin';

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

interface Contributor {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: ContributorRole;
  trust_level: number;
  banned_at: string | null;
  created_at: string;
  last_seen_at: string;
  suggestion_count: number;
  pending_suggestion_count: number;
}

interface RowGroup {
  section: SectionMeta;
  rows: CatalogRow[];
}

// One step on the undo stack: the value/state a key held *before* the last save,
// so Ctrl+Z (or the Undo button) can put it back.
interface UndoEntry {
  key: string;
  value: string;
  reviewed: boolean;
  label: string;
}

const PLACEHOLDER_RE = /{{\s*([\w.-]+)\s*}}/g;
const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const TUTORIAL_SEEN_KEY = 'gt.tutorialSeen.v1';

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
  const [view, setView] = useState<View>('translations');
  const [email, setEmail] = useState('');
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
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
  const [showHelp, setShowHelp] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);

  const savedValues = useRef<Map<string, string>>(new Map());
  // Undo history of saved values. We keep refs in sync so the global key
  // handler (bound once) always sees the latest catalog and save function.
  const undoStack = useRef<UndoEntry[]>([]);
  const catalogRef = useRef<CatalogResponse | null>(null);
  const performUndoRef = useRef<() => void>(() => {});
  // Refs let the memoized row callbacks stay referentially stable (so typing in
  // one box never re-renders the other ~60 rows) while still reading fresh state.
  const selectedLanguageRef = useRef(selectedLanguage);
  const orderedKeysRef = useRef<string[]>([]);
  catalogRef.current = catalog;
  selectedLanguageRef.current = selectedLanguage;

  useEffect(() => {
    void bootstrap();
    try {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) setShowHelp(true);
    } catch {
      // localStorage may be unavailable; skip the first-run tutorial.
    }
  }, []);

  // Global Ctrl/Cmd+Z. While you are actively editing a row (its box differs
  // from the last save), the browser's native text-undo wins. Otherwise we undo
  // the most recent *saved* change so a translator can recover an overwrite.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const isUndo = (event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey) && !event.shiftKey;
      if (!isUndo) return;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active.id.startsWith('tx-')) {
        const key = active.id.slice(3);
        if (active.value !== (savedValues.current.get(key) ?? '')) return; // let native undo run
      }
      if (undoStack.current.length === 0) return;
      event.preventDefault();
      performUndoRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function dismissTutorial() {
    setShowHelp(false);
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
    } catch {
      // Ignore storage failures; the tutorial just reopens next visit.
    }
  }

  useEffect(() => {
    if (selectedLanguage) void loadCatalog(selectedLanguage);
  }, [selectedLanguage]);

  useEffect(() => {
    if (view === 'contributors') void loadContributors();
  }, [view]);

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
      undoStack.current = [];
      setUndoDepth(0);
      setRowErrors({});
      setSavedKeys({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function loadContributors() {
    setBusy('contributors');
    setError('');
    try {
      const result = await fetchJson<{ contributors: Contributor[] }>('/api/contributors');
      setContributors(result.contributors);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function updateContributorRole(id: string, role: ContributorRole) {
    setBusy(`contributor:${id}`);
    setError('');
    try {
      const result = await fetchJson<{ contributor: Contributor }>(`/api/contributors/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setContributors((prev) =>
        prev.map((contributor) =>
          contributor.id === id ? { ...contributor, role: result.contributor.role } : contributor
        )
      );
      setMessage(`Updated ${result.contributor.display_name}`);
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

  const patchRow = useCallback((key: string, value: string, status: RowStatus) => {
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
  }, []);

  // Save a single row. Returns true if it saved (or was a no-op), false if blocked.
  const commitRow = useCallback(async (
    row: CatalogRow,
    rawValue: string,
    opts: { review?: boolean; force?: boolean; fromUndo?: boolean } = {}
  ): Promise<boolean> => {
    const key = row.key;
    const value = rawValue;
    const wasReviewed = row.status === 'reviewed';
    const review = opts.review ?? wasReviewed;
    const statusChanged = review !== wasReviewed;
    const prior = savedValues.current.get(key) ?? '';

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
          languageCode: selectedLanguageRef.current,
          key,
          value,
          status: review ? 'reviewed' : 'translated',
        }),
      });
      // Record the pre-save value so this change can be undone, unless this save
      // *is* an undo (otherwise Ctrl+Z would just bounce between two values).
      if (!opts.fromUndo && prior !== value) {
        undoStack.current.push({ key, value: prior, reviewed: wasReviewed, label: row.source });
        if (undoStack.current.length > 100) undoStack.current.shift();
        setUndoDepth(undoStack.current.length);
      }
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
  }, [patchRow]);

  // Pop the last saved change and restore the previous value, re-saving it so
  // the server and the UI agree. Bound to Ctrl/Cmd+Z and the Undo button.
  const performUndo = useCallback(() => {
    const entry = undoStack.current.pop();
    setUndoDepth(undoStack.current.length);
    if (!entry) return;
    const row = catalogRef.current?.rows.find((r) => r.key === entry.key);
    if (!row) return;
    setDrafts((d) => ({ ...d, [entry.key]: entry.value }));
    void commitRow(row, entry.value, { review: entry.reviewed, force: true, fromUndo: true }).then((ok) => {
      if (ok) {
        focusKey(entry.key);
        setError('');
        const short = entry.label.length > 42 ? `${entry.label.slice(0, 42)}…` : entry.label;
        setMessage(`Reverted "${short}"`);
      }
    });
    // commitRow / focusKey are stable enough for this handler; refs cover the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  performUndoRef.current = performUndo;

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
  orderedKeysRef.current = orderedKeys;

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

  // Click a {{placeholder}} chip to drop it into that row's box at the cursor
  // (or append it), so translators never have to retype the braces by hand.
  const insertPlaceholder = useCallback((key: string, name: string) => {
    const token = `{{${name}}}`;
    const el = document.getElementById(`tx-${key}`) as HTMLTextAreaElement | null;
    if (!el) {
      setDrafts((d) => {
        const cur = d[key] ?? '';
        return { ...d, [key]: cur && !cur.endsWith(' ') ? `${cur} ${token}` : `${cur}${token}` };
      });
      return;
    }
    const cur = el.value;
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + token + cur.slice(end);
    const caret = start + token.length;
    setDrafts((d) => ({ ...d, [key]: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, []);

  function focusKey(key: string | undefined) {
    if (!key) return;
    const el = document.getElementById(`tx-${key}`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  const moveFocus = useCallback((currentKey: string, dir: 1 | -1) => {
    const keys = orderedKeysRef.current;
    const idx = keys.indexOf(currentKey);
    if (idx === -1) return;
    focusKey(keys[idx + dir]);
  }, []);

  const handleChange = useCallback((key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
  }, []);

  const toggleCheck = useCallback(
    (row: CatalogRow, value: string, reviewed: boolean) => {
      void commitRow(row, value, { review: !reviewed, force: true });
    },
    [commitRow]
  );

  const onRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>, row: CatalogRow) => {
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
    },
    [commitRow, moveFocus]
  );

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
            title="How this works (open the guide)"
            onClick={() => setShowHelp(true)}
          >
            <HelpCircle size={16} />
            Help
          </button>
          {view === 'translations' ? (
            <button
              className="btn"
              type="button"
              title="Undo the last saved change (Ctrl+Z)"
              disabled={undoDepth === 0}
              onClick={() => performUndo()}
            >
              <Undo2 size={16} />
              Undo
            </button>
          ) : null}
          <button
            className="btn"
            type="button"
            title="Reload the latest strings"
            disabled={!!busy || (view === 'translations' && !selectedLanguage)}
            onClick={() => (view === 'contributors' ? void loadContributors() : void loadCatalog())}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          <button
            className={`btn ${view === 'contributors' ? 'btn-secondary' : ''}`}
            type="button"
            title="Manage Steam-authenticated translation contributors"
            onClick={() => setView(view === 'contributors' ? 'translations' : 'contributors')}
          >
            <Users size={16} />
            {view === 'contributors' ? 'Translations' : 'Contributors'}
          </button>
          {view === 'translations' ? (
            <>
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
            </>
          ) : null}
        </div>
      </header>

      {view === 'contributors' ? (
        <main className="admin-workspace">
          <section className="admin-pane">
            <div className="section">
              <div className="admin-head">
                <div>
                  <div className="section-title">Contributors</div>
                  <div className="admin-subtitle">
                    Steam users appear here after they enter Translation Mode in Grimoire.
                  </div>
                </div>
                <button className="btn" type="button" disabled={!!busy} onClick={() => void loadContributors()}>
                  <RefreshCw size={16} />
                  Refresh
                </button>
              </div>
              {error ? (
                <div className="banner banner-error">
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <div className="contributor-list">
              {contributors.length === 0 ? (
                <div className="empty">No Steam contributors yet.</div>
              ) : (
                contributors.map((contributor) => (
                  <div className="contributor-row" key={contributor.id}>
                    <div className="contributor-main">
                      {contributor.avatar_url ? (
                        <img className="contributor-avatar" src={contributor.avatar_url} alt="" />
                      ) : (
                        <div className="contributor-avatar contributor-avatar--empty">
                          <Users size={18} />
                        </div>
                      )}
                      <div className="contributor-ident">
                        <div className="contributor-name">
                          {contributor.display_name}
                          {contributor.role === 'admin' || contributor.role === 'reviewer' ? (
                            <span className={`role-pill ${contributor.role}`}>
                              <ShieldCheck size={12} />
                              {contributor.role}
                            </span>
                          ) : null}
                        </div>
                        <div className="contributor-meta">
                          <span>{contributor.id}</span>
                          <span>Last seen {formatDate(contributor.last_seen_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="contributor-stats">
                      <div>
                        <span className="contributor-stat-value">{contributor.suggestion_count}</span>
                        <span className="contributor-stat-label">suggestions</span>
                      </div>
                      <div>
                        <span className="contributor-stat-value">{contributor.pending_suggestion_count}</span>
                        <span className="contributor-stat-label">pending</span>
                      </div>
                    </div>
                    <select
                      className="select contributor-role"
                      value={contributor.role}
                      disabled={busy === `contributor:${contributor.id}`}
                      onChange={(event) =>
                        void updateContributorRole(contributor.id, event.target.value as ContributorRole)
                      }
                    >
                      <option value="translator">Translator</option>
                      <option value="reviewer">Reviewer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                ))
              )}
            </div>
          </section>
        </main>
      ) : (
        <main className="workspace workspace--inline">
        <aside className="rail">
          <div className="section">
            <div className="section-title">Languages</div>
            <button
              className="btn btn-primary add-lang-btn"
              type="button"
              onClick={() => {
                setPickerQuery('');
                setPickerOpen(true);
              }}
            >
              <Plus size={16} />
              Add a language
            </button>
          </div>

          <div className="section">
            {catalog ? (
              <div className="progress" aria-label={`${completion}% complete`}>
                <div className="progress-head">
                  <span className="progress-label">{activeLanguageName} progress</span>
                  <span className="progress-pct">{completion}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${completion}%` }} />
                </div>
              </div>
            ) : null}
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
              Type each translation{activeLanguage ? ` in ${activeLanguageName}` : ''} in the box under the English.{' '}
              <kbd>Enter</kbd> saves and jumps to the next, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line,{' '}
              <kbd>↑</kbd>/<kbd>↓</kbd> move between boxes, and <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last save. Leave
              anything inside {'{{double braces}}'} unchanged.{' '}
              <button type="button" className="link-btn" onClick={() => setShowHelp(true)}>
                Open the full guide
              </button>
              .
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
                  {group.rows.map((row) => (
                    <TranslationRow
                      key={row.key}
                      row={row}
                      value={drafts[row.key] ?? ''}
                      saving={!!savingKeys[row.key]}
                      saved={!!savedKeys[row.key]}
                      error={rowErrors[row.key]}
                      activeLanguageName={activeLanguageName}
                      onChange={handleChange}
                      onKeyDown={onRowKeyDown}
                      onBlur={commitRow}
                      onToggleCheck={toggleCheck}
                      onInsertPlaceholder={insertPlaceholder}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      )}

      {pickerOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            setPickerOpen(false);
            setPickerQuery('');
          }}
        >
          <div
            className="modal modal--picker"
            role="dialog"
            aria-modal="true"
            aria-label="Add a language"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">Add a language</div>
              <button
                className="picker-x"
                type="button"
                title="Close"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerQuery('');
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="picker-search">
              <Search size={15} />
              <input
                className="picker-input"
                autoFocus
                placeholder="Search, e.g. Spanish or es"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setPickerOpen(false);
                    setPickerQuery('');
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    const first = pickerOptions[0] ?? customOption;
                    if (first) void addLanguageByCode(first.code, first.name);
                  }
                }}
              />
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
        </div>
      ) : null}

      {showHelp ? (
        <div className="modal-backdrop" role="presentation" onClick={dismissTutorial}>
          <div
            className="modal modal--guide"
            role="dialog"
            aria-modal="true"
            aria-label="How to translate Grimoire"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">
                <Lightbulb size={18} /> How to translate Grimoire
              </div>
              <button className="picker-x" type="button" title="Close" onClick={dismissTutorial}>
                <X size={18} />
              </button>
            </div>
            <div className="guide-body">
              <p className="guide-lead">
                Thanks for helping translate Grimoire. You do not need to be a developer. Here is the whole job in
                four steps.
              </p>
              <ol className="guide-steps">
                <li>
                  <span className="guide-step-num">1</span>
                  <div>
                    <strong>Pick a language.</strong> Choose one on the left, or press{' '}
                    <strong>Add a language</strong> to start a new one.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">2</span>
                  <div>
                    <strong>Type the translation</strong> in the box under each English phrase. Press <kbd>Enter</kbd>{' '}
                    to save and jump to the next, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line, and{' '}
                    <kbd>↑</kbd>/<kbd>↓</kbd> to move between boxes. It saves on its own when you click away too.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">3</span>
                  <div>
                    <strong>Keep the {'{{tags}}'}.</strong> Anything inside double braces, like{' '}
                    <span className="placeholder">{'{{count}}'}</span>, is a slot the app fills in. Click the chip
                    under the English to drop it into your text. We warn you (
                    <span className="badge flagged">Needs fix</span>) if one goes missing.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">4</span>
                  <div>
                    <strong>Submit when ready.</strong> Press <strong>Submit translations</strong> to send your work
                    to the developer. Nothing goes live until they review it.
                  </div>
                </li>
              </ol>
              <div className="guide-tips">
                <div className="guide-tip">
                  <Undo2 size={15} /> Made a mistake? Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> (or the <strong>Undo</strong>{' '}
                  button) to bring back what you just changed. <kbd>Esc</kbd> clears the box you are in.
                </div>
                <div className="guide-tip">
                  <Check size={15} /> Use the <strong>Check</strong> button to mark a translation you are confident
                  in. The tabs up top let you focus on what is <strong>To do</strong>.
                </div>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-primary" type="button" onClick={dismissTutorial}>
                Got it, let's go
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface TranslationRowProps {
  row: CatalogRow;
  value: string;
  saving: boolean;
  saved: boolean;
  error?: string;
  activeLanguageName: string;
  onChange: (key: string, value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>, row: CatalogRow) => void;
  onBlur: (row: CatalogRow, value: string) => void;
  onToggleCheck: (row: CatalogRow, value: string, reviewed: boolean) => void;
  onInsertPlaceholder: (key: string, name: string) => void;
}

// One translation row, memoized so a keystroke only re-renders the row being
// edited instead of the whole catalog. All handler props are stable
// (useCallback in the parent), so memo can skip every untouched row.
const TranslationRow = memo(function TranslationRow({
  row,
  value,
  saving,
  saved,
  error,
  activeLanguageName,
  onChange,
  onKeyDown,
  onBlur,
  onToggleCheck,
  onInsertPlaceholder,
}: TranslationRowProps) {
  const live = checkPlaceholders(row.source, value);
  const flagged = value.trim() ? live.missing.length > 0 || live.extra.length > 0 : false;
  const reviewed = row.status === 'reviewed';
  const meta = statusMeta(row.status, flagged);
  return (
    <div className={`trow ${flagged ? 'trow-flagged' : ''}`}>
      <div className="trow-en">
        <span className="trow-en-text">{row.source}</span>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
      </div>
      {row.placeholders.length > 0 ? (
        <div className="trow-ph">
          <span className="trow-ph-label">Keep these (click to insert):</span>
          {row.placeholders.map((item) => (
            <button
              type="button"
              className="placeholder placeholder-btn"
              key={item}
              title={`Insert {{${item}}} at the cursor`}
              onClick={() => onInsertPlaceholder(row.key, item)}
            >
              {`{{${item}}}`}
            </button>
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
        onChange={(event) => onChange(row.key, event.target.value)}
        onKeyDown={(event) => onKeyDown(event, row)}
        onBlur={(event) => onBlur(row, event.target.value)}
      />
      <div className="trow-foot">
        <div className="trow-foot-left">
          {error ? (
            <span className="trow-err">
              <AlertTriangle size={13} /> {error}
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
            onClick={() => onToggleCheck(row, value, reviewed)}
          >
            <Check size={14} />
            {reviewed ? 'Checked' : 'Check'}
          </button>
        </div>
      </div>
    </div>
  );
});

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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
