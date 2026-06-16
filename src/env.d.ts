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

type Env = {
  TRANSLATE_DB: D1Database;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_TOKEN?: string;
  CF_ACCESS_TEAM: string;
  CF_ACCESS_AUD: string;
  TRANSLATOR_EMAIL?: string;
  GRIMOIRE_SOCIAL_BASE_URL?: string;
};

declare module 'cloudflare:workers' {
  export const env: Env;
}

declare namespace App {
  interface Locals {
    translatorEmail: string;
  }
}
