import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Flag,
  GitPullRequest,
  HelpCircle,
  Languages,
  Lightbulb,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { isLockedGlossaryTerm, lockedGlossaryNote, SHORT_GLOSSARY_TERMS } from '../lib/glossary';
import { COMMON_LANGUAGES, flagForCode, sectionForKey, type SectionMeta } from '../lib/languages';
import { SITE } from '../site.config';

type RowStatus = 'missing' | 'shipped' | 'draft' | 'translated' | 'reviewed';
type Filter = 'open' | 'flagged' | 'done' | 'checked' | 'review' | 'suggested' | 'all';
type View = 'translations' | 'contributors';
type ContributorRole = 'translator' | 'reviewer' | 'admin';
type GlossaryFilter = 'missing' | 'saved' | 'all';

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
  needsReview: boolean;
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

// A pending translation suggested from inside the client app. `stale` means
// the English source changed since it was suggested, so it may no longer fit.
interface Suggestion {
  id: string;
  key: string;
  value: string;
  source: string | null;
  currentValue: string;
  stale: boolean;
  contributorName: string;
  contributorAvatar: string | null;
  contextRoute: string | null;
  appVersion: string | null;
  createdAt: string;
}

interface GlossaryTerm {
  sourceTerm: string;
  targetTerm: string;
  notes: string;
  updatedBy: string | null;
  updatedAt: string;
}

interface GlossaryDraft {
  targetTerm: string;
  notes: string;
}

interface GlossaryCandidate {
  sourceTerm: string;
  count: number;
  examples: string[];
}

interface GlossaryListItem extends GlossaryCandidate {
  targetTerm: string;
  notes: string;
  updatedBy: string | null;
  updatedAt: string | null;
  saved: boolean;
  locked: boolean;
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
const GLOSSARY_OPEN_KEY = 'gt.glossaryOpen.v1';
const EMPTY_GLOSSARY_MATCHES: GlossaryTerm[] = [];
const EMPTY_SUGGESTIONS: Suggestion[] = [];
const PRIORITY_GLOSSARY_TERMS = SITE.priorityGlossaryTerms;
const GLOSSARY_STOPWORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'back',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'cannot',
  'cant',
  'could',
  'couldn',
  'current',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'down',
  'during',
  'each',
  'either',
  'else',
  'for',
  'from',
  'had',
  'has',
  'have',
  'having',
  'here',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'later',
  'left',
  'like',
  'may',
  'more',
  'most',
  'new',
  'next',
  'no',
  'none',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'one',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'own',
  's',
  'same',
  'so',
  'some',
  'still',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'this',
  'those',
  'through',
  'to',
  'under',
  'until',
  'up',
  'use',
  'used',
  'via',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'will',
  'with',
  'without',
  'won',
  'you',
  'your',
]);

// Plain-language labels. Wire-format status values stay the same.
function statusMeta(status: RowStatus, flagged: boolean, needsReview: boolean): { label: string; cls: string } {
  if (flagged) return { label: 'Issue', cls: 'flagged' };
  if (needsReview) return { label: 'Needs review', cls: 'review' };
  switch (status) {
    case 'missing':
      return { label: 'Untranslated', cls: 'missing' };
    case 'shipped':
      return { label: 'Live', cls: 'shipped' };
    case 'reviewed':
      return { label: 'Approved', cls: 'reviewed' };
    default:
      return { label: 'Translated', cls: 'translated' };
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  // The string currently open in the focus editor (Crowdin-style: pick on the
  // left, edit on the right). null = nothing selected yet / empty list.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Submit flow. 'pending' is the brief cancel window before the PR is actually
  // created; 'submitting' is the live API call. The PR opens in a popup-blocked
  // world, so instead of auto-opening a tab we surface a success banner with a
  // link the translator clicks themselves.
  const [submitPhase, setSubmitPhase] = useState<'idle' | 'pending' | 'submitting'>('idle');
  const [submitCountdown, setSubmitCountdown] = useState(0);
  const [prResult, setPrResult] = useState<{ url: string; number: number; updatedExisting: boolean } | null>(null);
  const submitTimers = useRef<{ interval?: number; timeout?: number }>({});
  // Upload merge mode: when true, an uploaded file only fills blank strings and
  // never overwrites an existing translation. On by default (the safe choice).
  const [importFillEmptyOnly, setImportFillEmptyOnly] = useState(true);
  // The most recent un-reverted import for this language. Drives the "Undo last
  // import" affordance so a wrong upload (e.g. the English source) is one click
  // to roll back. Survives reload via GET /api/import.
  const [lastImportBatch, setLastImportBatch] = useState<{ id: string; rowCount: number } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [undoDepth, setUndoDepth] = useState(0);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossary, setGlossary] = useState<Record<string, GlossaryTerm>>({});
  const [glossaryDrafts, setGlossaryDrafts] = useState<Record<string, GlossaryDraft>>({});
  const [glossaryQuery, setGlossaryQuery] = useState('');
  const [glossaryFilter, setGlossaryFilter] = useState<GlossaryFilter>('missing');
  const [savingGlossary, setSavingGlossary] = useState<Record<string, boolean>>({});
  const [savedGlossary, setSavedGlossary] = useState<Record<string, boolean>>({});
  // Terms saved during this session stay visible in the current view (even under
  // the "To fill" filter) so a card never vanishes out from under the cursor
  // before the translator is done. Cleared on filter switch or language reload.
  const [pinnedGlossary, setPinnedGlossary] = useState<Record<string, boolean>>({});
  // Source terms the translator added by hand (not auto-detected). They surface
  // as count-0 "custom" cards so any word can be put in the glossary, even one
  // that appears only inside longer phrases like "ability duration".
  const [customGlossaryTerms, setCustomGlossaryTerms] = useState<string[]>([]);
  const [glossaryError, setGlossaryError] = useState('');

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
  // Set true right before we change selectedKey via keyboard/click so the editor
  // textarea grabs focus once it has rendered for the newly selected string.
  const focusEditorRef = useRef(false);
  // Keys we have already auto-filled from the glossary this language load, so the
  // prefill effect never re-seeds a box the translator cleared or edited.
  const prefilledRef = useRef<Set<string>>(new Set());
  const importInputRef = useRef<HTMLInputElement>(null);
  catalogRef.current = catalog;
  selectedLanguageRef.current = selectedLanguage;

  useEffect(() => {
    void bootstrap();
    try {
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) setShowHelp(true);
    } catch {
      // localStorage may be unavailable; skip the first-run tutorial.
    }
    try {
      // Remember the translator's last choice so the panel does not silently
      // re-collapse on every visit. First-timers default to open on wide
      // screens; on narrower ones it stays behind the button + nudge.
      const stored = localStorage.getItem(GLOSSARY_OPEN_KEY);
      if (stored === '1' || stored === '0') {
        setGlossaryOpen(stored === '1');
      } else {
        setGlossaryOpen(window.matchMedia('(min-width: 1121px)').matches);
      }
    } catch {
      // matchMedia/localStorage may be unavailable in tests; keep it behind the button.
    }
  }, []);

  // Single entry point for showing/hiding the glossary so every toggle (toolbar
  // button, panel close, empty-state nudge) persists the same preference.
  const setGlossaryVisible = useCallback((next: boolean) => {
    setGlossaryOpen(next);
    try {
      localStorage.setItem(GLOSSARY_OPEN_KEY, next ? '1' : '0');
    } catch {
      // localStorage may be unavailable; the in-memory state still updates.
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

  // Drop any armed submit when the unmount happens or the language changes, so a
  // pending countdown never fires against the wrong (or a gone) language.
  useEffect(() => () => clearSubmitTimers(), []);

  useEffect(() => {
    clearSubmitTimers();
    setSubmitPhase('idle');
    setSubmitCountdown(0);
    setPrResult(null);
    setCustomGlossaryTerms([]);
    if (selectedLanguage) {
      void loadCatalog(selectedLanguage);
      void loadGlossary(selectedLanguage);
    } else {
      setGlossary({});
      setGlossaryDrafts({});
      setGlossaryError('');
    }
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
      prefilledRef.current = new Set();
      undoStack.current = [];
      setUndoDepth(0);
      setRowErrors({});
      setSavedKeys({});
      void loadSuggestions(languageCode);
      void loadLastImportBatch(languageCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function loadSuggestions(languageCode = selectedLanguage) {
    if (!languageCode) {
      setSuggestions([]);
      return;
    }
    try {
      const result = await fetchJson<{ suggestions: Suggestion[] }>(
        `/api/suggestions?lang=${encodeURIComponent(languageCode)}`
      );
      if (selectedLanguageRef.current !== languageCode) return;
      setSuggestions(result.suggestions);
    } catch {
      // Suggestions are a side panel, not the main flow; a failure here should
      // not block translating. Leave whatever we had and stay quiet.
    }
  }

  async function loadGlossary(languageCode = selectedLanguage) {
    if (!languageCode) return;
    setGlossaryError('');
    try {
      const result = await fetchJson<{ terms: GlossaryTerm[] }>(
        `/api/glossary?lang=${encodeURIComponent(languageCode)}`
      );
      if (selectedLanguageRef.current !== languageCode) return;
      const terms = Object.fromEntries(result.terms.map((term) => [term.sourceTerm, term]));
      setGlossary(terms);
      setGlossaryDrafts(
        Object.fromEntries(
          result.terms.map((term) => [
            term.sourceTerm,
            { targetTerm: term.targetTerm, notes: term.notes },
          ])
        )
      );
      setSavedGlossary({});
      setPinnedGlossary({});
    } catch (err) {
      setGlossaryError((err as Error).message);
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

  const patchRow = useCallback((key: string, value: string, status: RowStatus, needsReview: boolean) => {
    setCatalog((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((row) => {
        if (row.key !== key) return row;
        const check = checkPlaceholders(row.source, value);
        return {
          ...row,
          value,
          status,
          needsReview,
          missingPlaceholders: value.trim() ? check.missing : [],
          extraPlaceholders: value.trim() ? check.extra : [],
        };
      });
      return { ...prev, rows, stats: computeStats(rows) };
    });
  }, []);

  // Accept a player's suggestion: it becomes the saved translation, and the row
  // updates in place. Returns an error string if the server rejected it (e.g. the
  // English changed and placeholders no longer match). Resolves to null on success.
  const acceptSuggestion = useCallback(async (suggestion: Suggestion): Promise<string | null> => {
    try {
      await fetchJson(`/api/suggestions/${encodeURIComponent(suggestion.id)}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'accept' }),
      });
    } catch (err) {
      return (err as Error).message;
    }
    const key = suggestion.key;
    const value = suggestion.value;
    setDrafts((d) => ({ ...d, [key]: value }));
    savedValues.current.set(key, value);
    patchRow(key, value, 'translated', false);
    // The server accepts one suggestion per string and rejects the rest, so drop
    // every pending suggestion for this key from the list.
    setSuggestions((prev) => prev.filter((s) => s.key !== key));
    setSavedKeys((s) => ({ ...s, [key]: true }));
    window.setTimeout(() => setSavedKeys((s) => ({ ...s, [key]: false })), 1400);
    return null;
  }, [patchRow]);

  const rejectSuggestion = useCallback(async (suggestion: Suggestion): Promise<string | null> => {
    try {
      await fetchJson(`/api/suggestions/${encodeURIComponent(suggestion.id)}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'reject' }),
      });
    } catch (err) {
      return (err as Error).message;
    }
    setSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
    return null;
  }, []);

  // Save a single row. Returns true if it saved (or was a no-op), false if blocked.
  const commitRow = useCallback(async (
    row: CatalogRow,
    rawValue: string,
    opts: { review?: boolean; force?: boolean; fromUndo?: boolean; needsReview?: boolean } = {}
  ): Promise<boolean> => {
    const key = row.key;
    const value = rawValue;
    const wasReviewed = row.status === 'reviewed';
    const review = opts.review ?? wasReviewed;
    const statusChanged = review !== wasReviewed;
    const prior = savedValues.current.get(key) ?? '';
    // Approving clears the flag; otherwise keep the row's flag unless toggled.
    const needsReview = value.trim() ? (review ? false : opts.needsReview ?? row.needsReview) : false;
    const reviewChanged = needsReview !== row.needsReview;

    if (!opts.force && value === savedValues.current.get(key) && !statusChanged && !reviewChanged) return true;

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
          needsReview,
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
      patchRow(key, value, value.trim() ? (review ? 'reviewed' : 'translated') : 'missing', needsReview);
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

  function clearSubmitTimers() {
    if (submitTimers.current.interval) window.clearInterval(submitTimers.current.interval);
    if (submitTimers.current.timeout) window.clearTimeout(submitTimers.current.timeout);
    submitTimers.current = {};
  }

  // Step 1: arm the submit. Nothing is sent yet — the translator gets a few
  // seconds to back out before the PR is opened.
  function startSubmit() {
    if (!selectedLanguage || submitPhase !== 'idle') return;
    setError('');
    setMessage('');
    setPrResult(null);
    setSubmitPhase('pending');
    setSubmitCountdown(5);
    clearSubmitTimers();
    submitTimers.current.interval = window.setInterval(() => {
      setSubmitCountdown((n) => (n > 1 ? n - 1 : 0));
    }, 1000);
    submitTimers.current.timeout = window.setTimeout(() => void runSubmit(), 5000);
  }

  function cancelSubmit() {
    clearSubmitTimers();
    setSubmitPhase('idle');
    setSubmitCountdown(0);
    setMessage('Submit cancelled — nothing was sent.');
  }

  // Step 2: actually open the PR. Reached either when the countdown elapses or
  // when the translator clicks "Send now".
  async function runSubmit() {
    clearSubmitTimers();
    if (!selectedLanguage) {
      setSubmitPhase('idle');
      return;
    }
    setSubmitPhase('submitting');
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<PullResponse>('/api/pull-request', {
        method: 'POST',
        body: JSON.stringify({ languageCode: selectedLanguage }),
      });
      setPrResult({
        url: result.pullRequest.url,
        number: result.pullRequest.number,
        updatedExisting: result.pullRequest.updatedExisting,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitPhase('idle');
    }
  }

  async function importCatalogFile(file: File) {
    if (!selectedLanguage) return;
    setBusy('import');
    setError('');
    setMessage('');
    try {
      let catalogJson: unknown;
      try {
        catalogJson = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} is not valid JSON`);
      }

      const postImport = (confirmSourceUpload: boolean) =>
        fetchJson<{
          imported: number;
          unchanged: number;
          skippedExisting: number;
          unknownKeys: number;
          rejected: Array<{ key: string; missing: string[]; extra: string[] }>;
          batchId: string | null;
          needsConfirm?: boolean;
          sourceMatches?: number;
          comparable?: number;
        }>('/api/import', {
          method: 'POST',
          body: JSON.stringify({
            languageCode: selectedLanguage,
            catalog: catalogJson,
            fillEmptyOnly: importFillEmptyOnly,
            confirmSourceUpload,
          }),
        });

      let result = await postImport(false);

      // The file looks like the English source, not a translation. Make the
      // translator confirm before anything is written (this is the common
      // "oops, wrong file" case).
      if (result.needsConfirm) {
        const ok = window.confirm(
          `This file looks like the English source, not a translation: ` +
            `${result.sourceMatches} of ${result.comparable} strings are identical to the English text.\n\n` +
            `If you picked the wrong file, click Cancel and choose your translated file.\n\n` +
            `Upload it anyway?`
        );
        if (!ok) {
          setMessage('Upload cancelled. No changes were made.');
          return;
        }
        result = await postImport(true);
      }

      // Reload so the grid reflects what landed before we report the tally.
      await loadCatalog(selectedLanguage);
      // loadCatalog refreshes the undo target from the server; trust the import
      // response too in case its write and the GET race.
      if (result.batchId && result.imported) {
        setLastImportBatch({ id: result.batchId, rowCount: result.imported });
      }

      const parts = [`Imported ${result.imported} string${result.imported === 1 ? '' : 's'}`];
      if (result.unchanged) parts.push(`${result.unchanged} unchanged`);
      if (result.skippedExisting) parts.push(`${result.skippedExisting} kept (already translated)`);
      if (result.unknownKeys) parts.push(`${result.unknownKeys} unknown skipped`);
      if (result.rejected.length) parts.push(`${result.rejected.length} rejected (placeholder mismatch)`);
      setMessage(parts.join(', '));
      if (result.rejected.length) {
        const sample = result.rejected.slice(0, 3).map((r) => r.key).join(', ');
        setError(
          `${result.rejected.length} string${result.rejected.length === 1 ? '' : 's'} skipped for placeholder mismatch: ${sample}${result.rejected.length > 3 ? ', ...' : ''}`
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function loadLastImportBatch(languageCode = selectedLanguage) {
    if (!languageCode) {
      setLastImportBatch(null);
      return;
    }
    try {
      const result = await fetchJson<{ batch: { id: string; rowCount: number } | null }>(
        `/api/import?lang=${encodeURIComponent(languageCode)}`
      );
      if (selectedLanguageRef.current !== languageCode) return;
      setLastImportBatch(result.batch);
    } catch {
      // A missing undo target is not worth surfacing; just hide the affordance.
      setLastImportBatch(null);
    }
  }

  async function undoLastImport() {
    if (!lastImportBatch) return;
    setBusy('import');
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<{ reverted: number }>('/api/import-undo', {
        method: 'POST',
        body: JSON.stringify({ batchId: lastImportBatch.id }),
      });
      setLastImportBatch(null);
      await loadCatalog(selectedLanguage);
      setMessage(
        `Undid the import: ${result.reverted} string${result.reverted === 1 ? '' : 's'} rolled back` +
          (result.reverted < lastImportBatch.rowCount
            ? ` (${lastImportBatch.rowCount - result.reverted} left as-is because you had edited them since)`
            : '')
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  // Filter on the SAVED value, not the live draft, so a row never disappears
  // out from under the cursor as soon as the translator starts typing. It moves
  // between tabs only after a save (Enter / blur).
  const suggestionsByKey = useMemo(() => {
    const map = new Map<string, Suggestion[]>();
    for (const s of suggestions) {
      const list = map.get(s.key);
      if (list) list.push(s);
      else map.set(s.key, [s]);
    }
    return map;
  }, [suggestions]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (catalog?.rows ?? []).filter((row) => {
      const flagged = row.missingPlaceholders.length > 0 || row.extraPlaceholders.length > 0;
      const done = !!row.value.trim();
      const matchesFilter =
        filter === 'all' ||
        (filter === 'open' && !done) ||
        (filter === 'flagged' && flagged) ||
        (filter === 'review' && row.needsReview) ||
        (filter === 'checked' && row.status === 'reviewed') ||
        (filter === 'suggested' && suggestionsByKey.has(row.key)) ||
        // Done = translated but not yet checked; checked strings live in their
        // own tab so the two lists do not overlap.
        (filter === 'done' && done && row.status !== 'reviewed');
      const matchesQuery =
        !needle ||
        row.key.toLowerCase().includes(needle) ||
        row.source.toLowerCase().includes(needle) ||
        row.value.toLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query, suggestionsByKey]);

  const orderedKeys = useMemo(() => filteredRows.map((row) => row.key), [filteredRows]);
  orderedKeysRef.current = orderedKeys;

  // Keep a valid string open in the editor: if the current pick falls out of the
  // visible list (filter/search/language change), fall back to the first row.
  useEffect(() => {
    if (orderedKeys.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
    } else if (!selectedKey || !orderedKeys.includes(selectedKey)) {
      setSelectedKey(orderedKeys[0]);
    }
  }, [orderedKeys, selectedKey]);

  // After a keyboard/click selection, move focus into the editor textarea once it
  // has rendered for the new string.
  useEffect(() => {
    if (!focusEditorRef.current || !selectedKey) return;
    focusEditorRef.current = false;
    const el = document.getElementById(`tx-${selectedKey}`) as HTMLTextAreaElement | null;
    if (el) {
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [selectedKey]);

  const selectRow = useCallback((key: string, focusEditor = true) => {
    focusEditorRef.current = focusEditor;
    setSelectedKey(key);
  }, []);

  const groups = useMemo<RowGroup[]>(() => {
    // Bucket by the A–Z section so case-only ordering quirks (lowercase keys sort
    // after uppercase) don't split one letter into two headers. Letters first, "#"
    // (digits/symbols) last.
    const byLabel = new Map<string, RowGroup>();
    for (const row of filteredRows) {
      const section = sectionForKey(row.key);
      let group = byLabel.get(section.label);
      if (!group) {
        group = { section, rows: [] };
        byLabel.set(section.label, group);
      }
      group.rows.push(row);
    }
    return [...byLabel.values()].sort((a, b) => {
      const aHash = a.section.label === '#';
      const bHash = b.section.label === '#';
      if (aHash !== bHash) return aHash ? 1 : -1;
      return a.section.label.localeCompare(b.section.label);
    });
  }, [filteredRows]);

  const glossaryCandidates = useMemo(() => buildGlossaryCandidates(catalog?.rows ?? []), [catalog]);
  // Hand-added terms ride alongside the auto-detected ones as count-0 entries so
  // they render and can be filled/saved like any other card.
  const glossaryCandidatesWithCustom = useMemo(() => {
    if (customGlossaryTerms.length === 0) return glossaryCandidates;
    const known = new Set(glossaryCandidates.map((c) => c.sourceTerm.toLowerCase()));
    const extra = customGlossaryTerms
      .filter((term) => !known.has(term.toLowerCase()))
      .map((sourceTerm) => ({ sourceTerm, count: 0, examples: [] as string[] }));
    return [...extra, ...glossaryCandidates];
  }, [glossaryCandidates, customGlossaryTerms]);
  const glossaryItems = useMemo(
    () => buildGlossaryItems(glossaryCandidatesWithCustom, glossary, glossaryQuery, glossaryFilter, pinnedGlossary),
    [glossaryCandidatesWithCustom, glossary, glossaryQuery, glossaryFilter, pinnedGlossary]
  );
  const glossaryMatchesByKey = useMemo(
    () => buildGlossaryMatches(catalog?.rows ?? [], Object.values(glossary), glossaryCandidates),
    [catalog, glossary, glossaryCandidates]
  );
  const savedGlossaryCount = useMemo(
    () => Object.values(glossary).filter((term) => term.targetTerm.trim()).length,
    [glossary]
  );

  // When an untranslated string IS a glossary term on its own (e.g. the whole
  // English is "Profile" and the glossary agrees Profile -> Profil), we can fill
  // the box with the agreed translation up front. The translator just presses
  // Enter to accept (or types over it). Only exact, whole-string matches qualify,
  // so we never guess at word order for longer phrases.
  const glossaryPrefills = useMemo(() => {
    const out = new Map<string, string>();
    if (!catalog) return out;
    for (const row of catalog.rows) {
      if (row.value.trim()) continue; // already has a saved translation
      const matches = glossaryMatchesByKey.get(row.key);
      if (!matches) continue;
      const src = row.source.trim().toLowerCase();
      const exact = matches.find((term) => term.sourceTerm.trim().toLowerCase() === src);
      if (exact && exact.targetTerm.trim()) out.set(row.key, exact.targetTerm);
    }
    return out;
  }, [catalog, glossaryMatchesByKey]);

  // Seed the prefill into each empty box once. We never clobber text the
  // translator has typed or saved, and prefilledRef keeps us from re-seeding a
  // box they deliberately cleared. These stay client-side drafts until committed,
  // so untouched prefills are never written to the server or counted as done.
  useEffect(() => {
    if (glossaryPrefills.size === 0) return;
    setDrafts((d) => {
      let changed = false;
      const next = { ...d };
      for (const [key, value] of glossaryPrefills) {
        if (prefilledRef.current.has(key)) continue;
        if ((d[key] ?? '') !== '') continue;
        if ((savedValues.current.get(key) ?? '').trim() !== '') continue;
        next[key] = value;
        prefilledRef.current.add(key);
        changed = true;
      }
      return changed ? next : d;
    });
  }, [glossaryPrefills]);

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
    if (!raw || !CODE_RE.test(raw)) return null;
    const taken = new Set(languages.map((l) => l.code.toLowerCase()));
    if (taken.has(raw.toLowerCase())) return null;
    if (COMMON_LANGUAGES.some((l) => l.code.toLowerCase() === raw.toLowerCase())) return null;
    return { code: raw, name: displayName(raw), flag: flagForCode(raw) };
  }, [pickerQuery, languages]);

  const insertIntoDraft = useCallback((key: string, token: string, padded = false) => {
    const el = document.getElementById(`tx-${key}`) as HTMLTextAreaElement | null;
    // A whole-word insert (glossary term) into a box that already holds exactly
    // that word — typically a not-yet-accepted glossary prefill — would otherwise
    // double it ("Discord Discord"). Treat the click as "already there": leave the
    // value alone and just put the cursor back in the box.
    const skipDuplicate = padded && !!token.trim();
    if (!el) {
      setDrafts((d) => {
        const cur = d[key] ?? '';
        if (skipDuplicate && cur.trim() === token.trim()) return d;
        const next = padded && cur && !cur.endsWith(' ') ? `${cur} ${token}` : `${cur}${token}`;
        return { ...d, [key]: next };
      });
      return;
    }
    if (skipDuplicate && el.value.trim() === token.trim()) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      return;
    }
    const cur = el.value;
    const start = el.selectionStart ?? cur.length;
    const end = el.selectionEnd ?? cur.length;
    const before = cur.slice(0, start);
    const after = cur.slice(end);
    const prefix = padded && before && !/\s$/.test(before) ? ' ' : '';
    const suffix = padded && after && !/^[\s.,!?:;)\]}]/.test(after) ? ' ' : '';
    const insertion = `${prefix}${token}${suffix}`;
    const next = before + insertion + after;
    const caret = before.length + prefix.length + token.length;
    setDrafts((d) => ({ ...d, [key]: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }, []);

  // Click a {{placeholder}} chip to drop it into that row's box at the cursor
  // (or append it), so translators never have to retype the braces by hand.
  const insertPlaceholder = useCallback(
    (key: string, name: string) => {
      insertIntoDraft(key, `{{${name}}}`);
    },
    [insertIntoDraft]
  );

  const insertGlossaryTerm = useCallback(
    (key: string, targetTerm: string) => {
      insertIntoDraft(key, targetTerm, true);
    },
    [insertIntoDraft]
  );

  // Open a string in the editor and focus its textarea (used after undo).
  function focusKey(key: string | undefined) {
    if (!key) return;
    focusEditorRef.current = true;
    setSelectedKey(key);
  }

  // Step the editor to the previous/next visible string.
  const moveFocus = useCallback((currentKey: string, dir: 1 | -1) => {
    const keys = orderedKeysRef.current;
    const idx = keys.indexOf(currentKey);
    if (idx === -1) return;
    const next = keys[idx + dir];
    if (!next) return;
    focusEditorRef.current = true;
    setSelectedKey(next);
  }, []);

  const handleChange = useCallback((key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
  }, []);

  const handleGlossaryDraftChange = useCallback(
    (sourceTerm: string, patch: Partial<GlossaryDraft>) => {
      setGlossaryDrafts((drafts) => {
        const current = drafts[sourceTerm] ?? {
          targetTerm: glossary[sourceTerm]?.targetTerm ?? '',
          notes: glossary[sourceTerm]?.notes ?? '',
        };
        return { ...drafts, [sourceTerm]: { ...current, ...patch } };
      });
    },
    [glossary]
  );

  const addCustomGlossaryTerm = useCallback((rawTerm: string): boolean => {
    const sourceTerm = rawTerm.replace(/\s+/g, ' ').trim();
    if (!sourceTerm) return false;
    if (sourceTerm.length > 80) {
      setGlossaryError('Term is too long (max 80 characters).');
      return false;
    }
    if (isLockedGlossaryTerm(sourceTerm)) {
      setGlossaryError(`"${sourceTerm}" is a locked term and is kept as-is.`);
      return false;
    }
    setGlossaryError('');
    setCustomGlossaryTerms((terms) =>
      terms.some((term) => term.toLowerCase() === sourceTerm.toLowerCase()) ? terms : [sourceTerm, ...terms]
    );
    setGlossaryDrafts((drafts) =>
      drafts[sourceTerm] ? drafts : { ...drafts, [sourceTerm]: { targetTerm: '', notes: '' } }
    );
    setPinnedGlossary((pins) => ({ ...pins, [sourceTerm.toLowerCase()]: true }));
    setGlossaryFilter('missing');
    return true;
  }, []);

  const saveGlossaryTerm = useCallback(
    async (sourceTerm: string) => {
      const languageCode = selectedLanguageRef.current;
      if (!languageCode) return;

      const current = glossary[sourceTerm];
      const draft = glossaryDrafts[sourceTerm] ?? {
        targetTerm: current?.targetTerm ?? '',
        notes: current?.notes ?? '',
      };
      const targetTerm = draft.targetTerm.trim();
      const notes = draft.notes.trim();
      if (!targetTerm) return;

      setSavingGlossary((state) => ({ ...state, [sourceTerm]: true }));
      setGlossaryError('');
      try {
      const result = await fetchJson<{ term: GlossaryTerm | null }>('/api/glossary', {
        method: 'POST',
        body: JSON.stringify({ languageCode, sourceTerm, targetTerm, notes }),
      });
      if (selectedLanguageRef.current !== languageCode) return;
      if (result.term) {
          setGlossary((terms) => ({ ...terms, [result.term!.sourceTerm]: result.term! }));
          setGlossaryDrafts((drafts) => ({
            ...drafts,
            [result.term!.sourceTerm]: { targetTerm: result.term!.targetTerm, notes: result.term!.notes },
          }));
          setSavedGlossary((state) => ({ ...state, [result.term!.sourceTerm]: true }));
          setPinnedGlossary((pins) => ({ ...pins, [result.term!.sourceTerm.toLowerCase()]: true }));
          window.setTimeout(
            () => setSavedGlossary((state) => ({ ...state, [result.term!.sourceTerm]: false })),
            1400
          );
        }
      } catch (err) {
        setGlossaryError((err as Error).message);
      } finally {
        setSavingGlossary((state) => ({ ...state, [sourceTerm]: false }));
      }
    },
    [glossary, glossaryDrafts]
  );

  const deleteGlossaryTerm = useCallback(
    async (sourceTerm: string) => {
      const languageCode = selectedLanguageRef.current;
      if (!languageCode) return;

      setSavingGlossary((state) => ({ ...state, [sourceTerm]: true }));
      setGlossaryError('');
      try {
        await fetchJson('/api/glossary', {
          method: 'DELETE',
          body: JSON.stringify({ languageCode, sourceTerm }),
        });
        if (selectedLanguageRef.current !== languageCode) return;
        setGlossary((terms) => {
          const next = { ...terms };
          delete next[sourceTerm];
          return next;
        });
        setGlossaryDrafts((drafts) => ({ ...drafts, [sourceTerm]: { targetTerm: '', notes: '' } }));
      } catch (err) {
        setGlossaryError((err as Error).message);
      } finally {
        setSavingGlossary((state) => ({ ...state, [sourceTerm]: false }));
      }
    },
    []
  );

  const toggleCheck = useCallback(
    (row: CatalogRow, value: string, reviewed: boolean) => {
      void commitRow(row, value, { review: !reviewed, force: true });
    },
    [commitRow]
  );

  const toggleReview = useCallback(
    (row: CatalogRow, value: string, needsReview: boolean) => {
      void commitRow(row, value, { needsReview, force: true });
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
  const reviewCount = catalog?.rows.filter((row) => row.needsReview).length ?? 0;
  const checkedCount = catalog?.rows.filter((row) => row.status === 'reviewed').length ?? 0;
  const suggestionCount = suggestionsByKey.size;

  // If the review queue empties (last flag cleared), the hidden tab would leave
  // you staring at an empty list, so fall back to To do.
  useEffect(() => {
    if (filter === 'review' && reviewCount === 0) setFilter('open');
  }, [filter, reviewCount]);

  // Same guard for the Checked tab: if the last checked string is un-checked or
  // edited back to a draft, the tab disappears, so step back to To do.
  useEffect(() => {
    if (filter === 'checked' && checkedCount === 0) setFilter('open');
  }, [filter, checkedCount]);

  // Same guard for the suggestions tab: once you have triaged the last one, the
  // tab disappears, so step back to To do rather than an empty list.
  useEffect(() => {
    if (filter === 'suggested' && suggestionCount === 0) setFilter('open');
  }, [filter, suggestionCount]);
  const exportHref = selectedLanguage ? `/api/export?lang=${encodeURIComponent(selectedLanguage)}` : '#';
  const activeLanguage = languages.find((l) => l.code === selectedLanguage);
  const activeLanguageName = activeLanguage?.name ?? selectedLanguage;
  const selectedRow = selectedKey ? catalog?.rows.find((row) => row.key === selectedKey) ?? null : null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">{SITE.shortName}</div>
          <div>
            <div className="brand-title">{SITE.appName}</div>
            <div className="brand-subtitle">
              {email || 'Loading account'}
              {email ? (
                <>
                  {' · '}
                  <a href="/auth/logout" className="signout-link">
                    Sign out
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>
        {view === 'translations' ? (
          <div className="lang-cluster">
            <div className="lang-select-wrap">
              <Languages size={15} />
              <select
                className="lang-select"
                value={selectedLanguage}
                disabled={languages.length === 0}
                aria-label="Translation language"
                onChange={(event) => setSelectedLanguage(event.target.value)}
              >
                {languages.length === 0 ? (
                  <option value="">No languages yet</option>
                ) : (
                  languages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {flagForCode(language.code)} {language.name} ({language.code})
                    </option>
                  ))
                )}
              </select>
            </div>
            <button
              className="btn btn-icon"
              type="button"
              title="Add a language"
              onClick={() => {
                setPickerQuery('');
                setPickerOpen(true);
              }}
            >
              <Plus size={16} />
            </button>
            {catalog ? (
              <div className="topbar-progress" title={`${completion}% complete`}>
                <div className="topbar-progress-track">
                  <div className="topbar-progress-fill" style={{ width: `${completion}%` }} />
                </div>
                <span className="topbar-progress-pct">{completion}%</span>
              </div>
            ) : null}
          </div>
        ) : null}
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
              className={`btn ${glossaryOpen ? 'btn-secondary' : ''}`}
              type="button"
              title="Open or close the glossary helper"
              onClick={() => setGlossaryVisible(!glossaryOpen)}
            >
              <BookOpen size={16} />
              Glossary
              {savedGlossaryCount > 0 ? <span className="btn-badge">{savedGlossaryCount}</span> : null}
            </button>
          ) : null}
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
          <span className="toolbar-divider" aria-hidden="true" />
          <button
            className={`btn ${view === 'contributors' ? 'btn-secondary' : ''}`}
            type="button"
            title="Manage GitHub-authenticated translation contributors"
            onClick={() => setView(view === 'contributors' ? 'translations' : 'contributors')}
          >
            <Users size={16} />
            {view === 'contributors' ? 'Translations' : 'Contributors'}
          </button>
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
                    GitHub users appear here after they sign in and start translating {SITE.clientName}.
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
                <div className="empty">No GitHub contributors yet.</div>
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
        <main className={`workspace ${glossaryOpen ? 'workspace--glossary' : ''}`}>
        <section className="list-pane">
          <div className="list-head">
            <div className="list-toolbar">
              <div className="search-field">
                <Search size={15} />
                <input
                  id="search"
                  className="search-input"
                  placeholder="Search strings…"
                  aria-label="Search strings"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button className="search-clear" type="button" title="Clear search" onClick={() => setQuery('')}>
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <div className="submit-cluster">
                {submitPhase === 'pending' ? (
                  <>
                    <span className="submit-countdown" aria-live="polite">
                      <RefreshCw size={14} className="spin" />
                      Sending in {submitCountdown}s…
                    </span>
                    <button className="btn" type="button" title="Open the pull request now" onClick={() => void runSubmit()}>
                      Send now
                    </button>
                    <button className="btn btn-cancel" type="button" title="Don't send" onClick={cancelSubmit}>
                      <X size={16} />
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    title="Send your translations to the developer for review"
                    disabled={!!busy || submitPhase === 'submitting' || !selectedLanguage || !catalog?.stats.completed}
                    onClick={startSubmit}
                  >
                    <GitPullRequest size={16} />
                    {submitPhase === 'submitting' ? 'Submitting…' : 'Submit translations'}
                  </button>
                )}
              </div>
            </div>

            <div className="list-actions">
              <span className="list-actions-label">File</span>
              <a className="btn btn-ghost" href={exportHref} title="Download this language as a file">
                <Download size={16} />
                Download
              </a>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so picking the same file again still fires onChange.
                  e.target.value = '';
                  if (file) void importCatalogFile(file);
                }}
              />
              <button
                className="btn btn-ghost"
                type="button"
                title="Upload an edited language file to load your translations"
                disabled={!!busy || !selectedLanguage}
                onClick={() => importInputRef.current?.click()}
              >
                <Upload size={16} />
                Upload
              </button>
              <label
                className="import-toggle"
                title="When on, an upload only fills blank strings and never overwrites an existing translation"
              >
                <input
                  type="checkbox"
                  checked={importFillEmptyOnly}
                  onChange={(e) => setImportFillEmptyOnly(e.target.checked)}
                />
                Only fill blanks
              </label>
              {lastImportBatch && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  title="Roll back the most recent upload. Strings you have edited by hand since then are kept."
                  disabled={!!busy}
                  onClick={() => void undoLastImport()}
                >
                  <Undo2 size={16} />
                  Undo import ({lastImportBatch.rowCount})
                </button>
              )}
            </div>

            <p className="help-text">
              <kbd>Enter</kbd> saves · <kbd>Tab</kbd> inserts tags &amp; glossary · <kbd>↑</kbd>/<kbd>↓</kbd> move ·{' '}
              <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes. Keep anything inside {'{{double braces}}'}.{' '}
              <button type="button" className="link-btn" onClick={() => setShowHelp(true)}>
                Full guide
              </button>
            </p>

            {error ? (
              <div className="banner banner-error">
                <AlertTriangle size={14} />
                <span>{error}</span>
              </div>
            ) : null}
            {prResult ? (
              <div className="banner banner-success">
                <Check size={15} />
                <span>
                  {prResult.updatedExisting
                    ? `Updated your open pull request (PR #${prResult.number}).`
                    : `Submitted! Pull request #${prResult.number} is open for review.`}
                </span>
                <a className="banner-link" href={prResult.url} target="_blank" rel="noopener">
                  <ExternalLink size={14} /> Open PR
                </a>
                <button className="banner-x" type="button" title="Dismiss" onClick={() => setPrResult(null)}>
                  <X size={14} />
                </button>
              </div>
            ) : null}
            {message && !error ? (
              <div className="banner">
                <span>{message}</span>
              </div>
            ) : null}
          </div>

          {catalog && savedGlossaryCount === 0 && !glossaryOpen ? (
            <button type="button" className="glossary-nudge" onClick={() => setGlossaryVisible(true)}>
              <BookOpen size={16} />
              <span>
                <strong>Set up your glossary first.</strong>{' '}
                {glossaryCandidates.length > 0
                  ? `We found ${glossaryCandidates.length} words that repeat across ${SITE.clientName}. Agree on how each one is translated once, and the app suggests it everywhere, so you stay consistent and type less.`
                  : 'Agree on how key words are translated once, and the app suggests them everywhere, so you stay consistent and type less.'}{' '}
                Open it to get started.
              </span>
            </button>
          ) : null}

          <div className="segmented" role="tablist" aria-label="String filters">
            {([
              ['open', 'Untranslated'],
              ['flagged', 'Issues'],
              ['done', 'Translated'],
              ...(checkedCount > 0 ? ([['checked', `Approved (${checkedCount})`]] as Array<[Filter, string]>) : []),
              ...(reviewCount > 0 ? ([['review', `Needs review (${reviewCount})`]] as Array<[Filter, string]>) : []),
              ...(suggestionCount > 0 ? ([['suggested', `Suggestions (${suggestionCount})`]] as Array<[Filter, string]>) : []),
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
                    <StringListItem
                      key={row.key}
                      row={row}
                      value={drafts[row.key] ?? ''}
                      active={row.key === selectedKey}
                      hasSuggestion={suggestionsByKey.has(row.key)}
                      onSelect={selectRow}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="editor-pane">
          {selectedRow ? (
            <TranslationRow
              key={selectedRow.key}
              row={selectedRow}
              value={drafts[selectedRow.key] ?? ''}
              saving={!!savingKeys[selectedRow.key]}
              saved={!!savedKeys[selectedRow.key]}
              error={rowErrors[selectedRow.key]}
              activeLanguageName={activeLanguageName}
              glossaryPrefill={glossaryPrefills.get(selectedRow.key)}
              glossaryMatches={glossaryMatchesByKey.get(selectedRow.key) ?? EMPTY_GLOSSARY_MATCHES}
              suggestions={suggestionsByKey.get(selectedRow.key) ?? EMPTY_SUGGESTIONS}
              onAcceptSuggestion={acceptSuggestion}
              onRejectSuggestion={rejectSuggestion}
              onChange={handleChange}
              onKeyDown={onRowKeyDown}
              onBlur={commitRow}
              onToggleCheck={toggleCheck}
              onToggleReview={toggleReview}
              onInsertPlaceholder={insertPlaceholder}
              onInsertGlossaryTerm={insertGlossaryTerm}
            />
          ) : (
            <div className="editor-empty">
              <BookOpen size={30} />
              <p>
                {!catalog
                  ? 'Pick or add a language to start translating.'
                  : filteredRows.length === 0
                    ? 'Nothing to edit in this filter.'
                    : 'Select a string on the left to start translating.'}
              </p>
            </div>
          )}
        </section>

        {glossaryOpen ? (
          <GlossaryPanel
            activeLanguageName={activeLanguageName}
            items={glossaryItems}
            drafts={glossaryDrafts}
            filter={glossaryFilter}
            query={glossaryQuery}
            error={glossaryError}
            candidateCount={glossaryCandidates.length}
            savedCount={savedGlossaryCount}
            saving={savingGlossary}
            saved={savedGlossary}
            onClose={() => setGlossaryVisible(false)}
            onFilterChange={(next) => {
              setGlossaryFilter(next);
              setPinnedGlossary({});
            }}
            onQueryChange={setGlossaryQuery}
            onDraftChange={handleGlossaryDraftChange}
            onSave={saveGlossaryTerm}
            onDelete={deleteGlossaryTerm}
            onAddTerm={addCustomGlossaryTerm}
          />
        ) : null}
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
            aria-label={`How to translate ${SITE.clientName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div className="modal-title">
                <Lightbulb size={18} /> How to translate {SITE.clientName}
              </div>
              <button className="picker-x" type="button" title="Close" onClick={dismissTutorial}>
                <X size={18} />
              </button>
            </div>
            <div className="guide-body">
              <p className="guide-lead">
                Thanks for helping translate {SITE.clientName}. You do not need to be a developer. Here is the whole job in
                five steps.
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
                    <strong>Set up your glossary first.</strong> Open the <strong>Glossary</strong> and you will see the
                    words that come up again and again across {SITE.clientName}, already gathered for you. Agree on how each one
                    is translated once, and the app suggests it everywhere, so your work stays consistent and you type
                    less. This is the step that saves the most time, so it is worth doing before you dive in.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">3</span>
                  <div>
                    <strong>Type the translation</strong> in the box under each English phrase. Press <kbd>Enter</kbd>{' '}
                    to save and jump to the next, <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line, and{' '}
                    <kbd>↑</kbd>/<kbd>↓</kbd> to move between boxes. It saves on its own when you click away too.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">4</span>
                  <div>
                    <strong>Keep the {'{{tags}}'}.</strong> Anything inside double braces, like{' '}
                    <span className="placeholder">{'{{count}}'}</span>, is a slot the app fills in. Click the chip
                    under the English, or press <kbd>Tab</kbd> in the box, to drop it into your text. We warn you (
                    <span className="badge flagged">Issue</span>) if one goes missing.
                  </div>
                </li>
                <li>
                  <span className="guide-step-num">5</span>
                  <div>
                    <strong>Submit when ready.</strong> Press <strong>Submit translations</strong> to send your work
                    to the developer. Nothing goes live until they review it.
                  </div>
                </li>
              </ol>
              <div className="guide-tips">
                <div className="guide-tip">
                  <Undo2 size={15} />
                  <span>
                    Made a mistake? Press <kbd>Ctrl</kbd>+<kbd>Z</kbd> (or the <strong>Undo</strong> button) to bring
                    back what you just changed. <kbd>Esc</kbd> clears the box you are in.
                  </span>
                </div>
                <div className="guide-tip">
                  <Check size={15} />
                  <span>
                    Use the <strong>Approve</strong> button to mark a translation you are confident in. The tabs up top
                    let you focus on what is <strong>Untranslated</strong>.
                  </span>
                </div>
                <div className="guide-tip">
                  <Flag size={15} />
                  <span>
                    Not sure about one? Hit <strong>Flag</strong> to mark it. Flagged strings gather under a{' '}
                    <strong>Needs review</strong> tab so someone can take a second look.
                  </span>
                </div>
                <div className="guide-tip">
                  <BookOpen size={15} />
                  <span>
                    Once your glossary has words in it, press <kbd>Tab</kbd> in any box to drop them in. The list shows
                    that box's tags and your saved glossary words. Use <kbd>↑</kbd>/<kbd>↓</kbd> to pick, type to
                    filter, <kbd>Enter</kbd> to insert, <kbd>Esc</kbd> to close.
                  </span>
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

// A single in-app suggestion, shown above the translation box. "Use this" pulls
// it into the saved value; "Dismiss" discards it. Holds its own busy/error state
// so accepting one card never re-renders the rest of the catalog.
function SuggestionCard({
  suggestion,
  onAccept,
  onReject,
}: {
  suggestion: Suggestion;
  onAccept: (suggestion: Suggestion) => Promise<string | null>;
  onReject: (suggestion: Suggestion) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const act = async (fn: (s: Suggestion) => Promise<string | null>) => {
    setBusy(true);
    setError('');
    const message = await fn(suggestion);
    // On success the card unmounts (the parent drops it), so only a failure path
    // needs to restore the buttons.
    if (message) {
      setError(message);
      setBusy(false);
    }
  };

  const where = [suggestion.contextRoute, suggestion.appVersion ? `v${suggestion.appVersion}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="suggestion-card">
      <div className="suggestion-head">
        <Lightbulb size={13} />
        <span className="suggestion-from">
          Suggested by {suggestion.contributorName || 'a player'}
        </span>
        {where ? <span className="suggestion-where">{where}</span> : null}
        {suggestion.stale ? (
          <span className="suggestion-stale" title="The English text changed since this was suggested.">
            <AlertTriangle size={12} /> source changed
          </span>
        ) : null}
      </div>
      <div className="suggestion-value" dir="auto">
        {suggestion.value}
      </div>
      {error ? (
        <div className="suggestion-error">
          <AlertTriangle size={12} /> {error}
        </div>
      ) : null}
      <div className="suggestion-actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={busy}
          onClick={() => void act(onAccept)}
        >
          <Check size={13} /> Use this
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={busy}
          onClick={() => void act(onReject)}
        >
          <X size={13} /> Dismiss
        </button>
      </div>
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
  glossaryPrefill?: string;
  glossaryMatches: GlossaryTerm[];
  suggestions: Suggestion[];
  onAcceptSuggestion: (suggestion: Suggestion) => Promise<string | null>;
  onRejectSuggestion: (suggestion: Suggestion) => Promise<string | null>;
  onChange: (key: string, value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>, row: CatalogRow) => void;
  onBlur: (row: CatalogRow, value: string) => void;
  onToggleCheck: (row: CatalogRow, value: string, reviewed: boolean) => void;
  onToggleReview: (row: CatalogRow, value: string, needsReview: boolean) => void;
  onInsertPlaceholder: (key: string, name: string) => void;
  onInsertGlossaryTerm: (key: string, targetTerm: string) => void;
}

interface StringListItemProps {
  row: CatalogRow;
  value: string;
  active: boolean;
  hasSuggestion: boolean;
  onSelect: (key: string) => void;
}

// Compact left-hand list row, two columns like Crowdin: the English source (with
// its key/ID dim underneath when it differs) on the left, the current translation
// on the right, and a status dot up front. Clicking opens it in the editor.
const StringListItem = memo(function StringListItem({
  row,
  value,
  active,
  hasSuggestion,
  onSelect,
}: StringListItemProps) {
  const live = checkPlaceholders(row.source, value);
  const flagged = value.trim() ? live.missing.length > 0 || live.extra.length > 0 : false;
  const meta = statusMeta(row.status, flagged, row.needsReview);
  const preview = value.trim();
  return (
    <button
      type="button"
      className={`slist-item ${active ? 'active' : ''}`}
      aria-current={active}
      onClick={() => onSelect(row.key)}
    >
      <span className={`slist-dot ${meta.cls}`} title={meta.label} aria-hidden="true" />
      <span className="slist-src">
        <span className="slist-src-text">{row.source}</span>
        {/* In this fork the key usually IS the English source, so only show it
            when it actually adds an ID worth seeing. */}
        {row.key !== row.source ? <span className="slist-key">{row.key}</span> : null}
      </span>
      <span className={`slist-tgt ${preview ? '' : 'empty'}`}>
        <span className="slist-tgt-text">{preview || 'Untranslated'}</span>
        {hasSuggestion ? <Lightbulb className="slist-sugg" size={12} aria-label="Has a suggestion" /> : null}
      </span>
    </button>
  );
});

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
  glossaryPrefill,
  glossaryMatches,
  suggestions,
  onAcceptSuggestion,
  onRejectSuggestion,
  onChange,
  onKeyDown,
  onBlur,
  onToggleCheck,
  onToggleReview,
  onInsertPlaceholder,
  onInsertGlossaryTerm,
}: TranslationRowProps) {
  const live = checkPlaceholders(row.source, value);
  const flagged = value.trim() ? live.missing.length > 0 || live.extra.length > 0 : false;
  // The box holds a glossary suggestion the translator has not accepted or
  // changed yet (no saved value, text still equals the prefill).
  const isPrefill = !!glossaryPrefill && value === glossaryPrefill && !row.value.trim();
  const reviewed = row.status === 'reviewed';
  const needsReview = row.needsReview;
  const meta = statusMeta(row.status, flagged, needsReview);

  // Keyboard-driven insert menu. Tab opens it; arrows move; typing filters;
  // Enter inserts at the cursor; Esc closes. Focus never leaves the textarea,
  // so the row is not blurred/committed while the translator picks a fill-in.
  const [menu, setMenu] = useState<{ query: string; index: number } | null>(null);
  const menuItems = useMemo(() => {
    const items = [
      ...row.placeholders.map((name) => ({
        key: `ph-${name}`,
        primary: `{{${name}}}`,
        tag: 'placeholder',
        filter: name,
        insert: () => onInsertPlaceholder(row.key, name),
      })),
      ...glossaryMatches.map((term) => ({
        key: `gl-${term.sourceTerm}`,
        primary: `${term.sourceTerm} -> ${term.targetTerm}`,
        tag: term.sourceTerm.toLowerCase() === term.targetTerm.toLowerCase() ? 'keep' : 'glossary',
        filter: `${term.sourceTerm} ${term.targetTerm}`,
        insert: () => onInsertGlossaryTerm(row.key, term.targetTerm),
      })),
    ];
    const q = menu?.query.trim().toLowerCase() ?? '';
    return q ? items.filter((it) => it.filter.toLowerCase().includes(q)) : items;
  }, [row.placeholders, row.key, glossaryMatches, menu?.query, onInsertPlaceholder, onInsertGlossaryTerm]);
  const hasFillIns = row.placeholders.length > 0 || glossaryMatches.length > 0;

  const onTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menu) {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.min(m.index + 1, Math.max(menuItems.length - 1, 0)) } : m));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.max(m.index - 1, 0) } : m));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        menuItems[menu.index]?.insert();
        setMenu(null);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, query: m.query.slice(0, -1), index: 0 } : m));
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, query: m.query + event.key, index: 0 } : m));
        return;
      }
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey && hasFillIns) {
      event.preventDefault();
      setMenu({ query: '', index: 0 });
      return;
    }
    onKeyDown(event, row);
  };

  return (
    <div className={`trow ${flagged ? 'trow-flagged' : ''}`}>
      <div className="trow-en">
        <SourceWithGlossary source={row.source} matches={glossaryMatches} />
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
      </div>
      {suggestions.length > 0 ? (
        <div className="trow-suggestions">
          {suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onAccept={onAcceptSuggestion}
              onReject={onRejectSuggestion}
            />
          ))}
        </div>
      ) : null}
      {row.placeholders.length > 0 ? (
        <div className="trow-ph">
          <span className="trow-ph-label">Keep these (click, or press Tab):</span>
          {row.placeholders.map((item) => (
            <button
              type="button"
              className="placeholder placeholder-btn"
              key={item}
              title={`Insert {{${item}}} at the cursor`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsertPlaceholder(row.key, item)}
            >
              {`{{${item}}}`}
            </button>
          ))}
        </div>
      ) : null}
      {glossaryMatches.length > 0 ? (
        <div className="trow-glossary">
          <span className="trow-glossary-label">Glossary:</span>
          {glossaryMatches.map((term) => {
            // "Keep" terms translate to themselves (brand nouns like Discord). The
            // source -> target chip would just print the same word twice, so show a
            // single "keep" chip instead.
            const keep = term.sourceTerm.toLowerCase() === term.targetTerm.toLowerCase();
            return (
              <button
                type="button"
                className={`glossary-chip ${keep ? 'glossary-chip--keep' : ''}`}
                key={term.sourceTerm}
                title={term.notes || (keep ? `Keep "${term.sourceTerm}" as-is` : `Insert "${term.targetTerm}"`)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onInsertGlossaryTerm(row.key, term.targetTerm)}
              >
                {keep ? (
                  <span className="glossary-chip-target">{term.targetTerm}</span>
                ) : (
                  <>
                    <span className="glossary-chip-source">{term.sourceTerm}</span>
                    <span className="glossary-chip-target">{term.targetTerm}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      {isPrefill ? (
        <div className="trow-prefill-hint">
          <BookOpen size={13} />
          <span>
            Filled in from your glossary. Press <kbd>Enter</kbd> to accept, or type over it.
          </span>
        </div>
      ) : null}
      <div className="trow-input-wrap">
        <textarea
          id={`tx-${row.key}`}
          className={`trow-input ${isPrefill ? 'trow-input--prefill' : ''}`}
          dir="auto"
          rows={1}
          placeholder={`Type the ${activeLanguageName || 'translation'} here`}
          value={value}
          aria-expanded={!!menu}
          aria-controls={menu ? `insert-menu-${row.key}` : undefined}
          aria-activedescendant={menu && menuItems.length > 0 ? `insert-opt-${row.key}-${menu.index}` : undefined}
          onChange={(event) => onChange(row.key, event.target.value)}
          onKeyDown={onTextareaKeyDown}
          onBlur={(event) => {
            setMenu(null);
            onBlur(row, event.target.value);
          }}
        />
        {menu ? (
          <div
            className="insert-menu"
            id={`insert-menu-${row.key}`}
            role="listbox"
            aria-label="Insert tag or glossary word"
          >
            <div className="insert-menu-search">
              <Search size={13} />
              <span className="insert-menu-query">{menu.query || 'Type to filter'}</span>
              <span className="insert-menu-hint">Enter inserts · Esc closes</span>
            </div>
            <div className="insert-menu-list">
              {menuItems.length === 0 ? (
                <div className="insert-menu-empty">No matches</div>
              ) : (
                menuItems.map((it, i) => (
                  <button
                    type="button"
                    role="option"
                    id={`insert-opt-${row.key}-${i}`}
                    aria-selected={i === menu.index}
                    key={it.key}
                    className={`insert-menu-item ${i === menu.index ? 'active' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      it.insert();
                      setMenu(null);
                    }}
                    onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                  >
                    <span className="insert-menu-label">{it.primary}</span>
                    <span className="insert-menu-tag">{it.tag}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
      <div className="trow-foot">
        <div className="trow-foot-left">
          {error ? (
            <span className="trow-err">
              <AlertTriangle size={13} /> {error}
            </span>
          ) : row.key !== row.source ? (
            // In the QOLLOCK fork the key IS the English source, so showing it here
            // just repeats the line above. Only show it when it actually differs.
            <span className="trow-key">{row.key}</span>
          ) : null}
        </div>
        <div className="trow-foot-right">
          <span className="trow-status">{saving ? 'Saving...' : saved ? 'Saved' : ''}</span>
          <button
            type="button"
            className={`chk chk-flag ${needsReview ? 'on' : ''}`}
            title={
              needsReview
                ? 'Flagged for review. Click to remove the flag.'
                : 'Flag for someone to review (use when you are not sure)'
            }
            disabled={!value.trim() || saving}
            onClick={() => onToggleReview(row, value, !needsReview)}
          >
            <Flag size={14} />
            {needsReview ? 'Needs review' : 'Flag'}
          </button>
          <button
            type="button"
            className={`chk ${reviewed ? 'on' : ''}`}
            title={reviewed ? 'Approved. Click to unmark.' : 'Approve this translation'}
            disabled={!value.trim() || saving}
            onClick={() => onToggleCheck(row, value, reviewed)}
          >
            <Check size={14} />
            {reviewed ? 'Approved' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
});

interface GlossaryPanelProps {
  activeLanguageName: string;
  items: GlossaryListItem[];
  drafts: Record<string, GlossaryDraft>;
  filter: GlossaryFilter;
  query: string;
  error: string;
  candidateCount: number;
  savedCount: number;
  saving: Record<string, boolean>;
  saved: Record<string, boolean>;
  onClose: () => void;
  onFilterChange: (filter: GlossaryFilter) => void;
  onQueryChange: (query: string) => void;
  onDraftChange: (sourceTerm: string, patch: Partial<GlossaryDraft>) => void;
  onSave: (sourceTerm: string) => void;
  onDelete: (sourceTerm: string) => void;
  onAddTerm: (sourceTerm: string) => boolean;
}

function GlossaryPanel({
  activeLanguageName,
  items,
  drafts,
  filter,
  query,
  error,
  candidateCount,
  savedCount,
  saving,
  saved,
  onClose,
  onFilterChange,
  onQueryChange,
  onDraftChange,
  onSave,
  onDelete,
  onAddTerm,
}: GlossaryPanelProps) {
  const [newTerm, setNewTerm] = useState('');
  const submitNewTerm = () => {
    if (onAddTerm(newTerm)) setNewTerm('');
  };
  return (
    <aside className="glossary-pane" aria-label="Glossary">
      <div className="glossary-head">
        <div>
          <div className="section-title">Glossary</div>
          <div className="glossary-summary">
            {savedCount} saved · {candidateCount} repeated terms
          </div>
        </div>
        <button className="picker-x" type="button" title="Close glossary" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="glossary-controls">
        <div className="picker-search">
          <Search size={15} />
          <input
            className="picker-input"
            placeholder="Search glossary"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <div className="segmented segmented-compact" role="tablist" aria-label="Glossary filters">
          {[
            ['missing', 'To fill'],
            ['saved', 'Saved'],
            ['all', 'All'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`segment ${filter === value ? 'active' : ''}`}
              onClick={() => onFilterChange(value as GlossaryFilter)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="glossary-add">
          <input
            className="input glossary-add-input"
            placeholder="Add any word to the glossary"
            value={newTerm}
            onChange={(event) => setNewTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitNewTerm();
              }
            }}
          />
          <button
            className="btn btn-primary glossary-add-btn"
            type="button"
            disabled={!newTerm.trim()}
            onClick={submitNewTerm}
          >
            <Plus size={15} />
            Add
          </button>
        </div>
        {error ? (
          <div className="banner banner-error glossary-error">
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <div className="glossary-list">
        {items.length === 0 ? (
          <div className="empty">No glossary terms match.</div>
        ) : (
          items.map((item) => {
            const draft = drafts[item.sourceTerm] ?? { targetTerm: item.targetTerm, notes: item.notes };
            const dirty = draft.targetTerm !== item.targetTerm || draft.notes !== item.notes;
            const isSaving = !!saving[item.sourceTerm];
            const isSaved = !!saved[item.sourceTerm];
            return (
              <div className={`glossary-card ${item.saved ? 'saved' : ''} ${item.locked ? 'locked' : ''}`} key={item.sourceTerm}>
                <div className="glossary-card-head">
                  <div className="glossary-source">
                    <span>{item.sourceTerm}</span>
                    <span className="glossary-count">{item.count ? `${item.count} uses` : 'custom'}</span>
                  </div>
                  {item.locked ? (
                    <span className="badge shipped">Keep</span>
                  ) : item.saved ? (
                    <span className="badge reviewed">Saved</span>
                  ) : null}
                </div>
                {item.examples.length > 0 ? (
                  <div className="glossary-examples">{item.examples.slice(0, 2).join(' · ')}</div>
                ) : null}
                {item.locked ? (
                  <div className="glossary-locked-note">{item.notes}</div>
                ) : (
                  <>
                    <input
                      className="input glossary-term-input"
                      value={draft.targetTerm}
                      placeholder={`${activeLanguageName || 'Target'} term`}
                      onChange={(event) => onDraftChange(item.sourceTerm, { targetTerm: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onSave(item.sourceTerm);
                        }
                      }}
                    />
                    <textarea
                      className="textarea glossary-notes"
                      rows={2}
                      value={draft.notes}
                      placeholder="Context note"
                      onChange={(event) => onDraftChange(item.sourceTerm, { notes: event.target.value })}
                    />
                    <div className="glossary-actions">
                      <button
                        className="btn btn-primary glossary-save"
                        type="button"
                        disabled={isSaving || !draft.targetTerm.trim() || (!dirty && item.saved)}
                        onClick={() => onSave(item.sourceTerm)}
                      >
                        <Save size={14} />
                        {isSaving ? 'Saving' : isSaved ? 'Saved' : 'Save'}
                      </button>
                      {item.saved ? (
                        <button
                          className="btn btn-icon"
                          type="button"
                          title="Delete glossary term"
                          disabled={isSaving}
                          onClick={() => onDelete(item.sourceTerm)}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildGlossaryCandidates(rows: CatalogRow[]): GlossaryCandidate[] {
  const candidates = new Map<string, { sourceTerm: string; count: number; examples: string[]; priority: number }>();

  const addHit = (rawTerm: string, source: string, priority = 0) => {
    const sourceTerm = normalizeGlossaryTerm(rawTerm);
    if (!sourceTerm || sourceTerm.length > 80) return;
    const key = sourceTerm.toLowerCase();
    const item = candidates.get(key) ?? { sourceTerm, count: 0, examples: [], priority };
    item.count += 1;
    item.priority = Math.max(item.priority, priority);
    const example = compactExample(source);
    if (example && item.examples.length < 3 && !item.examples.includes(example)) item.examples.push(example);
    candidates.set(key, item);
  };

  for (const row of rows) {
    const source = stripPlaceholders(row.source);
    const sourceKey = row.key.toLowerCase();

    for (const term of PRIORITY_GLOSSARY_TERMS) {
      const keyTerm = term.toLowerCase().replace(/\s+/g, '');
      if (matchesGlossaryTerm(source, term) || (keyTerm.length >= 5 && sourceKey.includes(keyTerm))) {
        addHit(term, row.source, 100);
      }
    }

    const seenWords = new Set<string>();
    for (const word of glossaryWords(source)) {
      const normalized = word.toLowerCase();
      if (GLOSSARY_STOPWORDS.has(normalized) || seenWords.has(normalized)) continue;
      seenWords.add(normalized);
      addHit(displayGlossaryWord(word), row.source);
    }
  }

  return [...candidates.values()]
    .filter((item) => item.priority > 0 || item.count >= 2)
    .sort((a, b) => b.priority - a.priority || b.count - a.count || a.sourceTerm.localeCompare(b.sourceTerm))
    .slice(0, 400)
    .map(({ sourceTerm, count, examples }) => ({ sourceTerm, count, examples }));
}

function buildGlossaryItems(
  candidates: GlossaryCandidate[],
  glossary: Record<string, GlossaryTerm>,
  query: string,
  filter: GlossaryFilter,
  pinned: Record<string, boolean> = {}
): GlossaryListItem[] {
  const byTerm = new Map<string, GlossaryListItem>();
  const savedByLower = new Map(Object.values(glossary).map((term) => [term.sourceTerm.toLowerCase(), term]));

  for (const candidate of candidates) {
    const saved = savedByLower.get(candidate.sourceTerm.toLowerCase());
    const locked = isLockedGlossaryTerm(candidate.sourceTerm);
    byTerm.set(candidate.sourceTerm.toLowerCase(), {
      ...candidate,
      sourceTerm: locked ? candidate.sourceTerm : saved?.sourceTerm ?? candidate.sourceTerm,
      targetTerm: locked ? candidate.sourceTerm : saved?.targetTerm ?? '',
      notes: locked ? lockedGlossaryNote(candidate.sourceTerm) : saved?.notes ?? '',
      updatedBy: locked ? null : saved?.updatedBy ?? null,
      updatedAt: locked ? null : saved?.updatedAt ?? null,
      saved: locked || !!saved?.targetTerm.trim(),
      locked,
    });
  }

  for (const saved of Object.values(glossary)) {
    if (isLockedGlossaryTerm(saved.sourceTerm)) continue;
    const key = saved.sourceTerm.toLowerCase();
    if (byTerm.has(key)) continue;
    byTerm.set(key, {
      sourceTerm: saved.sourceTerm,
      count: 0,
      examples: [],
      targetTerm: saved.targetTerm,
      notes: saved.notes,
      updatedBy: saved.updatedBy,
      updatedAt: saved.updatedAt,
      saved: !!saved.targetTerm.trim(),
      locked: false,
    });
  }

  const needle = query.trim().toLowerCase();
  return [...byTerm.values()].filter((item) => {
    if (filter === 'missing' && item.saved && !pinned[item.sourceTerm.toLowerCase()]) return false;
    if (filter === 'saved' && !item.saved) return false;
    if (!needle) return true;
    return (
      item.sourceTerm.toLowerCase().includes(needle) ||
      item.targetTerm.toLowerCase().includes(needle) ||
      item.notes.toLowerCase().includes(needle)
    );
  });
}

// A run of source text, either plain or a glossary hit carrying its term so the
// editor can underline it and show a hover tooltip.
type SourceSegment = string | { text: string; term: GlossaryTerm };

// Split the English source into plain runs and glossary hits. Longer terms are
// claimed first so "ability duration" wins over a bare "ability", and we mirror
// matchesGlossaryTerm's word-boundary rule so we only mark whole words.
function splitSourceByGlossary(source: string, matches: GlossaryTerm[]): SourceSegment[] {
  if (matches.length === 0) return [source];
  const terms = [...matches].sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  const ranges: Array<{ start: number; end: number; term: GlossaryTerm }> = [];
  for (const term of terms) {
    const normalized = term.sourceTerm.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`(^|[^A-Za-z0-9])(${escaped})($|[^A-Za-z0-9])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const start = m.index + m[1].length;
      const end = start + m[2].length;
      // Keep the trailing boundary char available for the next iteration so two
      // adjacent terms separated by a single space both still match.
      re.lastIndex = end;
      if (ranges.some((r) => start < r.end && end > r.start)) continue;
      ranges.push({ start, end, term });
    }
  }
  if (ranges.length === 0) return [source];
  ranges.sort((a, b) => a.start - b.start);
  const out: SourceSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) out.push(source.slice(cursor, r.start));
    out.push({ text: source.slice(r.start, r.end), term: r.term });
    cursor = r.end;
  }
  if (cursor < source.length) out.push(source.slice(cursor));
  return out;
}

// English source line in the editor, with any glossary words underlined and
// hover-explained. Falls back to a plain span when nothing matches.
function SourceWithGlossary({ source, matches }: { source: string; matches: GlossaryTerm[] }) {
  const segments = useMemo(() => splitSourceByGlossary(source, matches), [source, matches]);
  if (segments.length === 1 && typeof segments[0] === 'string') {
    return <span className="trow-en-text">{source}</span>;
  }
  return (
    <span className="trow-en-text">
      {segments.map((seg, i) =>
        typeof seg === 'string' ? (
          <span key={i}>{seg}</span>
        ) : (
          <GlossaryMark key={i} text={seg.text} term={seg.term} />
        )
      )}
    </span>
  );
}

// One underlined glossary word plus its hover/focus tooltip: target term, the
// author's note, and who set it.
function GlossaryMark({ text, term }: { text: string; term: GlossaryTerm }) {
  const keep = term.sourceTerm.toLowerCase() === term.targetTerm.toLowerCase();
  return (
    <span className="gloss-mark" tabIndex={0}>
      {text}
      <span className="gloss-tip" role="tooltip">
        <span className="gloss-tip-head">
          <span className="gloss-tip-src">{term.sourceTerm}</span>
          {keep ? (
            <span className="gloss-tip-keep">keep as-is</span>
          ) : (
            <span className="gloss-tip-tgt">{term.targetTerm}</span>
          )}
        </span>
        {term.notes ? <span className="gloss-tip-note">{term.notes}</span> : null}
        {term.updatedBy ? <span className="gloss-tip-by">— {term.updatedBy}</span> : null}
      </span>
    </span>
  );
}

function buildGlossaryMatches(
  rows: CatalogRow[],
  terms: GlossaryTerm[],
  candidates: GlossaryCandidate[]
): Map<string, GlossaryTerm[]> {
  const lockedTerms = candidates
    .filter((candidate) => isLockedGlossaryTerm(candidate.sourceTerm))
    .map((candidate) => ({
      sourceTerm: candidate.sourceTerm,
      targetTerm: candidate.sourceTerm,
      notes: lockedGlossaryNote(candidate.sourceTerm),
      updatedBy: null,
      updatedAt: '',
    }));
  const usable = [...lockedTerms, ...terms.filter((term) => !isLockedGlossaryTerm(term.sourceTerm))]
    .filter((term) => term.sourceTerm.trim() && term.targetTerm.trim())
    .sort((a, b) => b.sourceTerm.length - a.sourceTerm.length);
  const out = new Map<string, GlossaryTerm[]>();

  for (const row of rows) {
    const seen = new Set<string>();
    const matches = usable
      .filter((term) => {
        const key = term.sourceTerm.toLowerCase();
        if (seen.has(key) || !matchesGlossaryTerm(row.source, term.sourceTerm)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
    if (matches.length > 0) out.set(row.key, matches);
  }

  return out;
}

function glossaryWords(source: string): string[] {
  return (stripPlaceholders(source).match(/[A-Za-z0-9][A-Za-z0-9+.-]*(?:['’][A-Za-z]+)?/g) ?? [])
    .map((word) => word.replace(/^[-.+]+|[-.+]+$/g, ''))
    .filter((word) => {
      if (!word) return false;
      if (/['’]/.test(word)) return false;
      if (/^\d+$/.test(word)) return false;
      if (word.length >= 3) return true;
      return SHORT_GLOSSARY_TERMS.has(word.toUpperCase());
    });
}

function displayGlossaryWord(word: string): string {
  if (/^[A-Z0-9+.-]{2,}$/.test(word)) return word;
  return word.toLowerCase();
}

function stripPlaceholders(source: string): string {
  return source
    .replace(PLACEHOLDER_RE, ' ')
    .replace(/&(apos|#39|#x27);/gi, "'")
    .replace(/&(quot|#34|#x22);/gi, '"')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[{}()[\]"“”‘’]/g, ' ');
}

function normalizeGlossaryTerm(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function compactExample(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 92 ? `${compact.slice(0, 89)}...` : compact;
}

function matchesGlossaryTerm(source: string, term: string): boolean {
  const normalized = normalizeGlossaryTerm(term);
  if (!normalized) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');

  if (normalized.startsWith('.')) {
    return new RegExp(`${escaped}($|[^A-Za-z0-9])`, 'i').test(source);
  }
  if (normalized.endsWith(':')) {
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}`, 'i').test(source);
  }
  if (isLockedGlossaryTerm(normalized) && /^[A-Z0-9]{2,5}$/.test(normalized)) {
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}s?($|[^A-Za-z0-9])`, 'i').test(source);
  }

  return new RegExp(`(^|[^A-Za-z0-9])${escaped}($|[^A-Za-z0-9])`, 'i').test(source);
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
