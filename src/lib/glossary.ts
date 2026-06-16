export const SHORT_GLOSSARY_TERMS = new Set(['3D', 'AI', 'EU', 'GLB', 'HUD', 'MMR', 'NA', 'UI', 'VFX', 'VPK']);

export const LOCKED_GLOSSARY_TERMS = new Set([
  'autoexec.cfg',
  'gameinfo.gi',
  '.vpk',
  '.glb',
  '.modprofile.json',
  'mp1:',
  'VPK',
  'GLB',
  'VFX',
  'HUD',
  'UI',
  'FPS',
  'ADS',
  'MMR',
]);

export function isLockedGlossaryTerm(sourceTerm: string): boolean {
  return LOCKED_GLOSSARY_TERMS.has(sourceTerm) || LOCKED_GLOSSARY_TERMS.has(sourceTerm.toUpperCase());
}

export function lockedGlossaryNote(sourceTerm: string): string {
  return isLockedGlossaryTerm(sourceTerm) ? 'Keep unchanged: file name, extension, acronym, or code token.' : '';
}
