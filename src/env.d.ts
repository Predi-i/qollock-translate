/// <reference path="../.astro/types.d.ts" />

interface D1PreparedStatement<T = unknown> {
  bind(...values: unknown[]): D1PreparedStatement<T>;
  all(): Promise<D1Result<T>>;
  first(): Promise<T | null>;
  run(): Promise<D1Result>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
}

interface D1Database {
  prepare<T = unknown>(query: string): D1PreparedStatement<T>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
}

// Minimal KV surface used by the session store (auth.ts). Declared by hand to
// match how D1Database is declared above, so we don't depend on a generated
// worker-configuration.d.ts being present.
interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

type Env = {
  TRANSLATE_DB: D1Database;
  // KV namespace backing browser sessions (see wrangler.jsonc kv_namespaces).
  SESSION: KVNamespace;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN?: string;
  // GitHub OAuth app credentials — replaces Cloudflare Access for translator
  // sign-in (Access requires a card on file; OAuth is free). Client id is a
  // plain var; the secret is set with `wrangler secret put`.
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  // Optional comma/space-separated GitHub login allowlist. Empty/unset = any
  // GitHub account may sign in (PRs are reviewed before merge anyway).
  ALLOWED_GITHUB_USERS?: string;
  TRANSLATOR_EMAIL?: string;
  SOCIAL_BASE_URL?: string;
};

declare module 'cloudflare:workers' {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    translatorEmail: string;
  }
}
