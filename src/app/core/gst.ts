/**
 * GST helpers — spec §9.4.
 *
 * The rule that matters most here is the *absence* rule: with no GSTIN on the business
 * profile, tax mode is forced to `none` and every piece of GST UI disappears. An
 * unregistered freelancer must never be nagged about GST, so `isGstEnabled` is the gate
 * that the settings screens, the editor, and the renderer all consult.
 */

import type { TaxMode } from './types';

/**
 * GSTIN layout: 2-digit state code, 10-character PAN, 1 entity digit, 1 fixed 'Z',
 * 1 check character.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const CHECKSUM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Indian GST state codes, used to compare states when a client has no GSTIN. */
export const GST_STATE_CODES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export function normaliseGstin(value: string | null | undefined): string {
  return (value ?? '').replace(/\s/g, '').toUpperCase();
}

/** True when the business is GST-registered at all (§9.4's master switch). */
export function isGstEnabled(businessGstin: string | null | undefined): boolean {
  return normaliseGstin(businessGstin).length > 0;
}

/** Structural check only — does it look like a GSTIN? */
export function isGstinFormatValid(value: string | null | undefined): boolean {
  return GSTIN_PATTERN.test(normaliseGstin(value));
}

/**
 * Verify the GSTIN check character.
 *
 * The algorithm is the standard one: weight each of the first 14 characters
 * alternately by 1 and 2, take each product's quotient plus remainder against 36, sum,
 * and the check character is whatever brings the total to a multiple of 36.
 *
 * This is offered as a *warning* rather than a gate. A typo'd GSTIN on an invoice is
 * worth flagging, but blocking the user from saving would be worse — the spec's whole
 * posture on validation (§8.4) is warn, never hard-block.
 */
export function isGstinChecksumValid(value: string | null | undefined): boolean {
  const gstin = normaliseGstin(value);
  if (gstin.length !== 15) return false;

  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const index = CHECKSUM_ALPHABET.indexOf(gstin[i] ?? '');
    if (index < 0) return false;
    const weight = i % 2 === 0 ? 1 : 2;
    const product = index * weight;
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = (36 - (sum % 36)) % 36;
  return CHECKSUM_ALPHABET[expected] === gstin[14];
}

export type GstinProblem = 'empty' | 'format' | 'checksum' | 'unknown_state' | null;

/** One-stop validation used by the forms: `null` means no complaint. */
export function validateGstin(value: string | null | undefined): GstinProblem {
  const gstin = normaliseGstin(value);
  if (gstin.length === 0) return 'empty';
  if (!isGstinFormatValid(gstin)) return 'format';
  if (!(stateCodeFromGstin(gstin) in GST_STATE_CODES)) return 'unknown_state';
  if (!isGstinChecksumValid(gstin)) return 'checksum';
  return null;
}

/** The leading two digits, which encode the state. */
export function stateCodeFromGstin(value: string | null | undefined): string {
  return normaliseGstin(value).slice(0, 2);
}

export function stateNameFromGstin(value: string | null | undefined): string | null {
  return GST_STATE_CODES[stateCodeFromGstin(value)] ?? null;
}

/**
 * Compare two free-text state names tolerantly.
 *
 * Users type "Kerala", "kerala", "KL" and "Kerala " for the same place, and this
 * comparison decides between CGST+SGST and IGST — a wrong answer here puts the wrong
 * tax on a real invoice. Punctuation and case are stripped, and the common
 * abbreviations are mapped onto full names.
 */
const STATE_ALIASES: Readonly<Record<string, string>> = {
  kl: 'kerala',
  tn: 'tamilnadu',
  ka: 'karnataka',
  mh: 'maharashtra',
  dl: 'delhi',
  up: 'uttarpradesh',
  ap: 'andhrapradesh',
  ts: 'telangana',
  tg: 'telangana',
  gj: 'gujarat',
  rj: 'rajasthan',
  wb: 'westbengal',
  mp: 'madhyapradesh',
  hr: 'haryana',
  pb: 'punjab',
  br: 'bihar',
  or: 'odisha',
  od: 'odisha',
  as: 'assam',
  jh: 'jharkhand',
  ct: 'chhattisgarh',
  cg: 'chhattisgarh',
  uk: 'uttarakhand',
  ut: 'uttarakhand',
  hp: 'himachalpradesh',
  jk: 'jammuandkashmir',
  ga: 'goa',
  py: 'puducherry',
};

export function normaliseStateName(value: string | null | undefined): string {
  const cleaned = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .trim();
  return STATE_ALIASES[cleaned] ?? cleaned;
}

export function statesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseStateName(a);
  const right = normaliseStateName(b);
  return left.length > 0 && left === right;
}

export interface TaxModeInferenceInput {
  businessGstin: string | null | undefined;
  clientGstin: string | null | undefined;
  businessState: string | null | undefined;
  clientState: string | null | undefined;
}

export interface TaxModeInference {
  mode: TaxMode;
  /** Why this mode was chosen, so the editor can explain itself to the user. */
  reason:
    | 'business_not_registered'
    | 'gstin_state_codes_match'
    | 'gstin_state_codes_differ'
    | 'state_names_match'
    | 'state_names_differ'
    | 'client_location_unknown';
}

/**
 * Default the tax mode for a document (§9.4).
 *
 * Order of evidence: no business GSTIN wins outright; then both GSTINs' state codes;
 * then the free-text state fields; and if the client's location is simply unknown, fall
 * back to intra-state, which is the overwhelmingly common case for a local design
 * studio. Always overridable in the editor.
 */
export function inferTaxMode(input: TaxModeInferenceInput): TaxModeInference {
  if (!isGstEnabled(input.businessGstin)) {
    return { mode: 'none', reason: 'business_not_registered' };
  }

  const businessCode = stateCodeFromGstin(input.businessGstin);
  const clientCode = stateCodeFromGstin(input.clientGstin);

  if (clientCode.length === 2 && businessCode.length === 2 && /^\d{2}$/.test(clientCode)) {
    return businessCode === clientCode
      ? { mode: 'gst_intra', reason: 'gstin_state_codes_match' }
      : { mode: 'gst_inter', reason: 'gstin_state_codes_differ' };
  }

  // No client GSTIN: fall back to the state fields (§9.4). A *blank* business state
  // must fall back to the state encoded in the GSTIN — `??` would not, because an empty
  // string is not nullish, and the consequence would be IGST on local invoices.
  const businessState =
    normaliseStateName(input.businessState).length > 0
      ? input.businessState
      : stateNameFromGstin(input.businessGstin);
  const clientState = input.clientState;

  if (normaliseStateName(clientState).length === 0) {
    return { mode: 'gst_intra', reason: 'client_location_unknown' };
  }
  return statesMatch(businessState, clientState)
    ? { mode: 'gst_intra', reason: 'state_names_match' }
    : { mode: 'gst_inter', reason: 'state_names_differ' };
}

/**
 * Force an unregistered business's tax mode to `none`, whatever is stored.
 *
 * Called on the way out of the database as well as on the way in: an owner who had a
 * GSTIN, issued documents, then removed it must not see stale GST rows on new drafts.
 * Already-issued documents keep their stored totals untouched (§5.4).
 */
export function enforceGstGate(mode: TaxMode, businessGstin: string | null | undefined): TaxMode {
  return isGstEnabled(businessGstin) ? mode : 'none';
}
