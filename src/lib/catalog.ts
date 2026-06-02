export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface CatalogEntry {
  key: string;
  source: string;
}

export interface PlaceholderCheck {
  missing: string[];
  extra: string[];
}

const PLACEHOLDER_RE = /{{\s*([\w.-]+)\s*}}/g;

export function flattenCatalog(catalog: JsonObject): CatalogEntry[] {
  const out: CatalogEntry[] = [];

  function visit(value: JsonValue, prefix: string) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        visit(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    if (typeof value === 'string') out.push({ key: prefix, source: value });
  }

  visit(catalog, '');
  return out;
}

export function flattenValues(catalog: JsonObject | null): Map<string, string> {
  if (!catalog) return new Map();
  return new Map(flattenCatalog(catalog).map((entry) => [entry.key, entry.source]));
}

export function unflattenValues(entries: Array<{ key: string; value: string }>): JsonObject {
  const root: JsonObject = {};

  for (const entry of entries) {
    const parts = entry.key.split('.');
    let cursor = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cursor[part] = entry.value;
      } else {
        const next = cursor[part];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
          cursor[part] = {};
        }
        cursor = cursor[part] as JsonObject;
      }
    }
  }

  return root;
}

export function placeholders(value: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value))) found.add(match[1]);
  return [...found].sort();
}

export function checkPlaceholders(source: string, target: string): PlaceholderCheck {
  const sourceVars = new Set(placeholders(source));
  const targetVars = new Set(placeholders(target));
  const missing = [...sourceVars].filter((name) => !targetVars.has(name)).sort();
  const extra = [...targetVars].filter((name) => !sourceVars.has(name)).sort();
  return { missing, extra };
}

export function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value);
}

export function displayNameForLanguage(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
