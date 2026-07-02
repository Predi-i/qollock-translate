#!/usr/bin/env node
/**
 * build-context.mjs
 *
 * Extracts a "English label → breadcrumb context" map from QOLLOCK's
 * ql_settings.js and writes it to src/data/qollock-context.json.
 *
 * Sources (in priority order):
 *  1. SETTING_DESCRIPTION_OVERRIDE_BY_CATEGORY_ROW dict — exact Tab/Section/Label
 *  2. CreateRow / CreateSectionTitle static scan inside RenderCurrentTabContent
 *     — includes option-array labels that inherit their parent row's context
 *  3. SETTINGS_RU_TEXT keys — catch-all for any remaining ql_settings string
 *     that couldn't be placed in a specific section (generic "Settings" context)
 *
 * Usage:
 *   node scripts/build-context.mjs [path/to/ql_settings.js]
 *
 * Default path: ../QOLLOCK/panorama/scripts/ql_settings.js
 * Override with QL_SETTINGS_PATH env var or first CLI arg.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ── 1. Read source ────────────────────────────────────────────────────────────

const settingsPath = resolve(
  process.argv[2] ||
  process.env.QL_SETTINGS_PATH ||
  resolve(ROOT, '../QOLLOCK/panorama/scripts/ql_settings.js')
);

console.log(`[build-context] Reading: ${settingsPath}`);
const src = readFileSync(settingsPath, 'utf8');

// ── 2. String literal parser ──────────────────────────────────────────────────

function readStringAt(text, pos) {
  const ch = text[pos];
  if (ch !== '"' && ch !== "'") return null;
  let i = pos + 1;
  let out = '';
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i++;
      const e = text[i];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else out += e;
      i++;
      continue;
    }
    if (c === ch) return { value: out, end: i + 1 };
    out += c;
    i++;
  }
  return null;
}

/** Extract all "key": "value" entries from a JS object literal body. */
function parseStringDict(text, startPos, endPos) {
  const result = {};
  let i = startPos;
  while (i < endPos) {
    if (/[\s,]/.test(text[i])) { i++; continue; }
    if (text[i] !== '"' && text[i] !== "'") { i++; continue; }
    const keyResult = readStringAt(text, i);
    if (!keyResult) { i++; continue; }
    i = keyResult.end;
    while (i < endPos && /[\s:]/.test(text[i])) i++;
    if (i >= endPos || (text[i] !== '"' && text[i] !== "'")) { i++; continue; }
    const valResult = readStringAt(text, i);
    if (!valResult) { i++; continue; }
    i = valResult.end;
    result[keyResult.value] = valResult.value;
  }
  return result;
}

/** Find the body {start, end} of a const dict: `const NAME = { ... };` */
function findDictBody(src, varName) {
  const re = new RegExp(`const\\s+${varName}\\s*=\\s*\\{`);
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '"' || c === "'") {
      const s = readStringAt(src, i);
      if (s) { i = s.end; continue; }
    }
    i++;
  }
  return { start, end: i - 1 };
}

/**
 * Read the Nth argument (0-indexed) of a call whose opening paren is at openParen.
 * Returns the raw text of the argument (trimmed), or null if not reachable.
 */
function readNthArg(text, openParen, n) {
  let pos = openParen + 1;
  let depth = 0;
  let argNum = 0;
  while (pos < text.length) {
    const c = text[pos];
    if (c === '(' || c === '[' || c === '{') { depth++; pos++; continue; }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return null;
      depth--;
      pos++;
      continue;
    }
    if (c === ',' && depth === 0) {
      if (argNum === n) {
        // The arg text starts after this comma
        pos++;
        while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++;
        // Read until next top-level comma or closing paren
        const argStart = pos;
        let d2 = 0;
        while (pos < text.length) {
          const ch = text[pos];
          if (ch === '(' || ch === '[' || ch === '{') d2++;
          else if (ch === ')' || ch === ']' || ch === '}') {
            if (d2 === 0) break;
            d2--;
          } else if (ch === ',' && d2 === 0) break;
          else if ((ch === '"' || ch === "'") && d2 === 0) {
            const s = readStringAt(text, pos);
            if (s) { pos = s.end; continue; }
          }
          pos++;
        }
        return text.slice(argStart, pos).trim();
      }
      argNum++;
      pos++;
      continue;
    }
    if (c === '"' || c === "'") {
      const s = readStringAt(text, pos);
      if (s) { pos = s.end; continue; }
    }
    pos++;
  }
  return null;
}

// ── 3. Tab metadata ───────────────────────────────────────────────────────────

const tabGroupMap = {};
{
  const m = src.match(/function GetSettingsTabGroups\(\)\s*\{([\s\S]*?)\n\}/);
  if (m) {
    const body = m[1];
    const groupRe = /title:\s*["']([^"']+)["'][\s\S]*?tabs:\s*\[([^\]]+)\]/g;
    let gm;
    while ((gm = groupRe.exec(body)) !== null) {
      const groupName = gm[1];
      const tabList = gm[2].match(/["']([^"']+)["']/g) || [];
      for (const t of tabList) tabGroupMap[t.replace(/['"]/g, '')] = groupName;
    }
  }
}

const tabDisplayNames = {};
{
  const fnStart = src.indexOf('function GetSettingsTabDisplayName(');
  if (fnStart >= 0) {
    const bracePos = src.indexOf('{', fnStart);
    if (bracePos >= 0) {
      let depth = 1, i = bracePos + 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        else if (src[i] === '"' || src[i] === "'") {
          const s = readStringAt(src, i);
          if (s) { i = s.end; continue; }
        }
        i++;
      }
      const fnBody = src.slice(bracePos + 1, i - 1);
      const re = /===\s*["']([^"']+)["']\s*\)\s*return\s*["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(fnBody)) !== null) tabDisplayNames[m[1]] = m[2];
    }
  }
}

function displayName(tab) {
  return tabDisplayNames[tab] || tab;
}

// ── 4. Primary: SETTING_DESCRIPTION_OVERRIDE_BY_CATEGORY_ROW ─────────────────

const contextMap = {};

const primaryDictBody = findDictBody(src, 'SETTING_DESCRIPTION_OVERRIDE_BY_CATEGORY_ROW');
if (primaryDictBody) {
  const dict = parseStringDict(src, primaryDictBody.start, primaryDictBody.end);
  for (const [key, description] of Object.entries(dict)) {
    const pipeIdx = key.lastIndexOf('|');
    if (pipeIdx < 0) continue;

    const label = key.slice(pipeIdx + 1).trim();
    const location = key.slice(0, pipeIdx).trim();
    if (!label) continue;

    let tab, section;
    const slashIdx = location.indexOf(' / ');
    if (slashIdx >= 0) {
      tab = location.slice(0, slashIdx).trim();
      section = location.slice(slashIdx + 3).trim();
    } else {
      tab = location;
      section = '';
    }

    const dTab = displayName(tab);
    const group = tabGroupMap[tab] || '';
    const parts = [group, dTab, section].filter(Boolean);
    const breadcrumb = parts.join(' › ');
    const entry = { breadcrumb, tab: dTab, section, group };

    if (!contextMap[label]) contextMap[label] = entry;
    if (description && !contextMap[description]) contextMap[description] = entry;
  }
}

console.log(`[build-context] Primary dict: ${Object.keys(contextMap).length} entries`);

// ── 5. Option arrays: const FOO = [{ label: "..." }, ...] ────────────────────
//
// Build a map of variable name → Set<string label> so that when we see
// CreateRow(..., FOO) in step 6 we can inherit the row's context to each label.

const optionArrayLabels = new Map(); // varName → Set<string>
{
  // Match "const VARNAME = [" — we'll brace-match the array body
  const arrayDefRe = /\bconst\s+(\w+)\s*=\s*\[/g;
  let adm;
  while ((adm = arrayDefRe.exec(src)) !== null) {
    const varName = adm[1];
    const arrayStart = adm.index + adm[0].length - 1; // points at '['
    let depth = 1, i = arrayStart + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '[') depth++;
      else if (c === ']') depth--;
      else if (c === '"' || c === "'") {
        const s = readStringAt(src, i);
        if (s) { i = s.end; continue; }
      }
      i++;
    }
    const arrayBody = src.slice(arrayStart + 1, i - 1);

    // Extract { label: "..." } or { label: '...' }
    const labels = new Set();
    const labelRe = /\blabel\s*:\s*["']([^"'\\]*)["']/g;
    let lm;
    while ((lm = labelRe.exec(arrayBody)) !== null) {
      if (lm[1].trim()) labels.add(lm[1]);
    }
    if (labels.size > 0) optionArrayLabels.set(varName, labels);
  }
}

console.log(`[build-context] Option arrays found: ${optionArrayLabels.size}`);

// ── 6. CreateRow / CreateSectionTitle static scan ────────────────────────────
//
// Walk RenderCurrentTabContent tab-by-tab. For each CreateRow call:
//  - arg 1 (label)   → gets the current tab+section context
//  - arg 7 (options) → if it's a known option-array variable, all its labels
//                       also inherit this row's context

function readSecondStringArg(text, openParen) {
  let pos = openParen + 1;
  let depth = 0;
  while (pos < text.length) {
    const c = text[pos];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return null; depth--; }
    else if (c === ',' && depth === 0) { pos++; break; }
    else if (c === '"' || c === "'") {
      const s = readStringAt(text, pos);
      if (s) { pos = s.end; continue; }
    }
    pos++;
  }
  while (pos < text.length && /[ \t\r\n]/.test(text[pos])) pos++;
  const s = readStringAt(text, pos);
  return s ? s.value : null;
}

const renderFnMatch = /function RenderCurrentTabContent\([^)]*\)\s*\{/.exec(src);
if (renderFnMatch) {
  const bodyStart = renderFnMatch.index + renderFnMatch[0].length;
  let depth = 1, pos = bodyStart;
  while (pos < src.length && depth > 0) {
    const c = src[pos];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '"' || c === "'") {
      const s = readStringAt(src, pos);
      if (s) { pos = s.end - 1; }
    }
    pos++;
  }
  const renderFnBody = src.slice(bodyStart, pos - 1);

  const tabBlockRe = /(?:^|\})\s*(?:else\s+)?if\s*\(\s*currentTab\s*===\s*["']([^"']+)["']\s*\)/g;
  const boundaries = [{ tab: null, start: 0 }];
  let m;
  while ((m = tabBlockRe.exec(renderFnBody)) !== null) {
    boundaries.push({ tab: m[1], start: m.index });
  }
  boundaries.push({ tab: null, start: renderFnBody.length });

  const tabBlocks = {};
  for (let i = 0; i < boundaries.length - 1; i++) {
    const { tab, start } = boundaries[i];
    const end = boundaries[i + 1].start;
    if (tab) tabBlocks[tab] = renderFnBody.slice(start, end);
  }

  for (const [tab, block] of Object.entries(tabBlocks)) {
    const dTab = displayName(tab);
    const group = tabGroupMap[tab] || '';
    let currentSection = '';

    const callRe = /(?<![\w$])(CreateSectionTitle|CreateRow|CreateSliderRow|CreateSectionTitleCheckboxToggle|CreateAnimatedInlineToggleSection|CreateInlineSecondaryCheckboxToggleRow)\s*\(/g;
    let cm;
    while ((cm = callRe.exec(block)) !== null) {
      const fnName = cm[1];
      const openParen = cm.index + cm[0].length - 1;
      const label = readSecondStringArg(block, openParen);
      if (!label || !label.trim()) continue;
      const l = label.trim();

      if (fnName === 'CreateSectionTitle' || fnName === 'CreateSectionTitleCheckboxToggle' || fnName === 'CreateAnimatedInlineToggleSection') {
        currentSection = l;
        if (!contextMap[l]) {
          const parts = [group, dTab].filter(Boolean);
          contextMap[l] = { breadcrumb: parts.join(' › '), tab: dTab, section: '', group };
        }
      } else {
        // Row label
        const parts = [group, dTab, currentSection].filter(Boolean);
        const entry = { breadcrumb: parts.join(' › '), tab: dTab, section: currentSection, group };
        if (!contextMap[l]) contextMap[l] = entry;

        // Also assign this row's context to all labels in its options array (arg 7)
        const optionsArg = readNthArg(block, openParen, 7);
        if (optionsArg) {
          const optLabels = optionArrayLabels.get(optionsArg);
          if (optLabels) {
            for (const ol of optLabels) {
              if (!contextMap[ol]) contextMap[ol] = entry;
            }
          }
        }
      }
    }
  }
}

console.log(`[build-context] After CreateRow scan: ${Object.keys(contextMap).length} entries`);

// ── 7. SETTINGS_RU_TEXT catch-all ────────────────────────────────────────────
//
// Every key in SETTINGS_RU_TEXT is a translatable string from ql_settings.js.
// For strings not yet placed in a specific section, assign a generic "Settings"
// context so they group together rather than land in "# Other".

const ruTextBody = findDictBody(src, 'SETTINGS_RU_TEXT');
if (ruTextBody) {
  const ruDict = parseStringDict(src, ruTextBody.start, ruTextBody.end);
  const genericEntry = { breadcrumb: 'Settings', tab: 'Settings', section: '', group: '' };
  let fallbackCount = 0;
  for (const key of Object.keys(ruDict)) {
    if (key && !contextMap[key]) {
      contextMap[key] = genericEntry;
      fallbackCount++;
    }
  }
  console.log(`[build-context] SETTINGS_RU_TEXT fallback: +${fallbackCount} entries`);
}

// ── 8. Write output ───────────────────────────────────────────────────────────

const total = Object.keys(contextMap).length;
const outPath = resolve(ROOT, 'src/data/qollock-context.json');
writeFileSync(outPath, JSON.stringify(contextMap, null, 2) + '\n', 'utf8');

console.log(`[build-context] Done. ${total} entries → ${outPath}`);
const sample = Object.entries(contextMap).slice(0, 5);
for (const [k, v] of sample) {
  console.log(`  "${k}" → "${v.breadcrumb}"`);
}
