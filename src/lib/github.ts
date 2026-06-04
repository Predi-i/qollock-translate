import { flattenValues, type JsonObject } from './catalog';

interface GitHubEnv {
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN?: string;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  sha?: string;
}

interface GitRefResponse {
  object: {
    sha: string;
  };
}

interface PullResponse {
  number: number;
  html_url: string;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`invalid GITHUB_REPO: ${repo}`);
  return { owner, name };
}

function headers(env: GitHubEnv): HeadersInit {
  const out: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Grimoire-Translate/0.1',
  };
  if (env.GITHUB_TOKEN) out.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return out;
}

async function githubFetch<T>(
  env: GitHubEnv,
  path: string,
  init: RequestInit = {}
): Promise<{ value: T | null; status: number }> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...headers(env),
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 404) return { value: null, status: 404 };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status}: ${text}`);
  }
  return { value: (await res.json()) as T, status: res.status };
}

export async function fetchCatalog(
  env: GitHubEnv,
  languageCode: string,
  ref = env.GITHUB_BRANCH
): Promise<JsonObject | null> {
  const { owner, name } = splitRepo(env.GITHUB_REPO);
  const path = urlPath(`src/locales/${languageCode}/translation.json`);
  const response = await githubFetch<GitHubContentResponse>(
    env,
    `/repos/${owner}/${name}/contents/${path}?ref=${encodeURIComponent(ref)}`
  );
  if (!response.value) return null;

  if (response.value.encoding !== 'base64' || !response.value.content) {
    throw new Error(`unsupported GitHub content encoding for ${languageCode}`);
  }

  return JSON.parse(decodeBase64(response.value.content)) as JsonObject;
}

// The English source changes rarely, but it was being re-fetched from GitHub on
// every catalog load and every single save. That hammered the API (and blows the
// 60/hr unauthenticated limit in local dev). Cache it per isolate with a short
// TTL, and fall back to the last good copy if GitHub is briefly unavailable or
// rate-limited.
interface SourceCache {
  entries: Map<string, string>;
  at: number;
}

let sourceCache: SourceCache | null = null;
const SOURCE_TTL_MS = 5 * 60 * 1000;

export async function fetchSourceEntries(env: GitHubEnv) {
  const now = Date.now();
  if (sourceCache && now - sourceCache.at < SOURCE_TTL_MS) return sourceCache.entries;

  let source: JsonObject | null;
  try {
    source = await fetchCatalog(env, 'en');
  } catch (err) {
    if (sourceCache) return sourceCache.entries; // serve stale rather than fail
    throw err;
  }
  if (!source) {
    if (sourceCache) return sourceCache.entries;
    throw new Error('English source catalog was not found');
  }

  const entries = flattenValues(source);
  sourceCache = { entries, at: now };
  return entries;
}

export async function createTranslationPullRequest(
  env: GitHubEnv,
  languageCode: string,
  catalog: JsonObject
): Promise<{ url: string; number: number; branch: string; updatedExisting: boolean }> {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to create pull requests');

  const { owner, name } = splitRepo(env.GITHUB_REPO);
  const base = env.GITHUB_BRANCH || 'main';
  const branch = `translations/${languageCode.replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const path = `src/locales/${languageCode}/translation.json`;

  const baseRef = await githubFetch<GitRefResponse>(
    env,
    `/repos/${owner}/${name}/git/ref/heads/${urlPath(base)}`
  );
  if (!baseRef.value) throw new Error(`base branch ${base} was not found`);

  const branchRef = await githubFetch<GitRefResponse>(
    env,
    `/repos/${owner}/${name}/git/ref/heads/${urlPath(branch)}`
  );
  if (!branchRef.value) {
    await githubFetch(env, `/repos/${owner}/${name}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseRef.value.object.sha,
      }),
    });
  }

  const encodedPath = urlPath(path);
  const existing = await githubFetch<GitHubContentResponse>(
    env,
    `/repos/${owner}/${name}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
  );

  const body: Record<string, unknown> = {
    message: `i18n: update ${languageCode} translations`,
    content: encodeBase64(JSON.stringify(catalog, null, 2) + '\n'),
    branch,
  };
  if (existing.value?.sha) body.sha = existing.value.sha;

  await githubFetch(env, `/repos/${owner}/${name}/contents/${encodedPath}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  const open = await githubFetch<PullResponse[]>(
    env,
    `/repos/${owner}/${name}/pulls?state=open&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${branch}`)}`
  );
  if (open.value && open.value.length > 0) {
    return {
      url: open.value[0].html_url,
      number: open.value[0].number,
      branch,
      updatedExisting: true,
    };
  }

  const pr = await githubFetch<PullResponse>(env, `/repos/${owner}/${name}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `i18n: update ${languageCode} translations`,
      head: branch,
      base,
      body: [
        `Updates ${languageCode} translations from translate.grimoiremods.com.`,
        '',
        'Generated by Grimoire Translate.',
      ].join('\n'),
    }),
  });

  if (!pr.value) throw new Error('GitHub did not return a pull request');
  return { url: pr.value.html_url, number: pr.value.number, branch, updatedExisting: false };
}

function decodeBase64(value: string): string {
  const normalized = value.replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function urlPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
