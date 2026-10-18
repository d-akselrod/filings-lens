/**
 * Gemini API terms allow only Paid Services in apps offered to users in the EEA, Switzerland and the UK.
 * The built-in (free-tier) key is never used for these visitors. Extras are territories that may geolocate as their own code.
 */
export const RESTRICTED_COUNTRIES: ReadonlySet<string> = new Set([
  // EU-27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // rest of the EEA, Switzerland, United Kingdom
  'IS', 'LI', 'NO', 'CH', 'GB',
  // conservative extras
  'AX', 'GF', 'GP', 'MQ', 'RE', 'YT', 'MF', 'GI', 'JE', 'GG', 'IM',
]);

/** Fails closed: a missing, malformed or unknown ('XX') country counts as restricted. */
export function isRestrictedCountry(code: string | null | undefined): boolean {
  const c = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === 'XX') return true;
  return RESTRICTED_COUNTRIES.has(c);
}
