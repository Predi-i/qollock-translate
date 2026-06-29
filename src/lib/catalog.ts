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

// QOLLOCK fork: keys are opaque English source sentences, and some are a dot-prefix of another
// (e.g. "Ready" vs "Ready.", "Reset to default value" vs "Reset to default value."). Splitting on
// "." would nest those and silently drop the shorter key, so we assign every key verbatim. The
// locale files are therefore flat; flattenCatalog never recurses (no nested objects exist) and so
// preserves the same keys on read. Upstream's path-nesting behaviour is intentionally dropped.
export function unflattenValues(entries: Array<{ key: string; value: string }>): JsonObject {
  const root: JsonObject = {};
  for (const entry of entries) root[entry.key] = entry.value;
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
