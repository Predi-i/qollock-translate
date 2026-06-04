// Friendly metadata for the translator UI: a curated language picker (flag +
// names) and human context for each string group. None of this affects the wire
// format; it only makes the workbench approachable for non-developers.

export interface LanguageOption {
  code: string;
  name: string; // English name
  native: string; // endonym
  flag: string; // emoji
}

// Curated set of common target languages. Anything not listed can still be added
// by typing a BCP 47 code (the picker offers a custom option, and the flag is
// derived from the region subtag when present).
export const COMMON_LANGUAGES: LanguageOption[] = [
  { code: 'es', name: 'Spanish', native: 'Espanol', flag: '🇪🇸' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', native: 'Portugues (Brasil)', flag: '🇧🇷' },
  { code: 'pt', name: 'Portuguese', native: 'Portugues', flag: '🇵🇹' },
  { code: 'fr', name: 'French', native: 'Francais', flag: '🇫🇷' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '🇮🇹' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', native: 'Polski', flag: '🇵🇱' },
  { code: 'ru', name: 'Russian', native: 'Russkij', flag: '🇷🇺' },
  { code: 'uk', name: 'Ukrainian', native: 'Ukrainska', flag: '🇺🇦' },
  { code: 'tr', name: 'Turkish', native: 'Turkce', flag: '🇹🇷' },
  { code: 'cs', name: 'Czech', native: 'Cestina', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', native: 'Slovencina', flag: '🇸🇰' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', flag: '🇭🇺' },
  { code: 'ro', name: 'Romanian', native: 'Romana', flag: '🇷🇴' },
  { code: 'el', name: 'Greek', native: 'Ellinika', flag: '🇬🇷' },
  { code: 'bg', name: 'Bulgarian', native: 'Balgarski', flag: '🇧🇬' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', flag: '🇭🇷' },
  { code: 'sr', name: 'Serbian', native: 'Srpski', flag: '🇷🇸' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', native: 'Dansk', flag: '🇩🇰' },
  { code: 'fi', name: 'Finnish', native: 'Suomi', flag: '🇫🇮' },
  { code: 'no', name: 'Norwegian', native: 'Norsk', flag: '🇳🇴' },
  { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷' },
  { code: 'zh-CN', name: 'Chinese (Simplified)', native: '简体中文', flag: '🇨🇳' },
  { code: 'zh-TW', name: 'Chinese (Traditional)', native: '繁體中文', flag: '🇹🇼' },
  { code: 'th', name: 'Thai', native: 'ไทย', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', native: 'Tieng Viet', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fil', name: 'Filipino', native: 'Filipino', flag: '🇵🇭' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', flag: '🇧🇩' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
  { code: 'he', name: 'Hebrew', native: 'עברית', flag: '🇮🇱' },
  { code: 'fa', name: 'Persian', native: 'فارسی', flag: '🇮🇷' },
];

const BY_CODE = new Map(COMMON_LANGUAGES.map((lang) => [lang.code.toLowerCase(), lang]));

// Turn a 2-letter region (BR, TW, ...) into its flag emoji via regional
// indicator symbols.
function regionToFlag(region: string): string {
  const cc = region.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export function flagForCode(code: string): string {
  const exact = BY_CODE.get(code.toLowerCase());
  if (exact) return exact.flag;

  const parts = code.split('-');
  const region = parts.find((part) => /^[A-Za-z]{2}$/.test(part) && part === part.toUpperCase());
  if (region) {
    const flag = regionToFlag(region);
    if (flag) return flag;
  }

  const base = BY_CODE.get(parts[0]?.toLowerCase() ?? '');
  if (base) return base.flag;

  return '🌐';
}

// --- Per-string context ----------------------------------------------------
// Keyed by the first segment of an i18next key (nav.discover -> "nav").

export interface SectionMeta {
  label: string;
  hint: string;
}

const SECTION_META: Record<string, SectionMeta> = {
  common: { label: 'Common', hint: 'Shared buttons and labels used all over the app' },
  nav: { label: 'Navigation', hint: 'The main sidebar menu down the left of the app' },
  sidebar: { label: 'Sidebar', hint: 'The collapsible sidebar' },
  settings: { label: 'Settings', hint: 'The Settings screen' },
  profiles: { label: 'Profiles', hint: 'Sharing and importing profiles' },
  conflicts: { label: 'Conflicts', hint: 'Where the app resolves mod conflicts' },
  stats: { label: 'Stats', hint: 'The statistics screen' },
  locker: { label: 'Locker', hint: 'The mod locker' },
  browse: { label: 'Browse', hint: 'Browsing and discovering mods' },
  discover: { label: 'Discover', hint: 'The Discover screen' },
  installed: { label: 'Installed', hint: 'Installed mods' },
};

function titleCase(value: string): string {
  if (!value) return 'Other';
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function sectionForKey(key: string): SectionMeta {
  const top = key.split('.')[0] ?? '';
  return SECTION_META[top] ?? { label: titleCase(top), hint: `Appears in the ${titleCase(top)} area` };
}
