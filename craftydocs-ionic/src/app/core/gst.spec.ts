import {
  enforceGstGate,
  inferTaxMode,
  isGstEnabled,
  isGstinChecksumValid,
  isGstinFormatValid,
  normaliseStateName,
  stateCodeFromGstin,
  stateNameFromGstin,
  statesMatch,
  validateGstin,
} from './gst';

// Real-shaped GSTINs with genuinely correct check characters.
const KERALA = '32AAACC1234A1ZR'; // state 32 — Kerala
const TAMIL_NADU = '33BBBCC5678B1ZV'; // state 33 — Tamil Nadu
const KERALA_OTHER = '32ABCDE1234F1Z9';

describe('isGstEnabled — the master switch (§9.4)', () => {
  it('is off for a business with no GSTIN', () => {
    expect(isGstEnabled(null)).toBe(false);
    expect(isGstEnabled(undefined)).toBe(false);
    expect(isGstEnabled('')).toBe(false);
    expect(isGstEnabled('   ')).toBe(false);
  });

  it('is on once a GSTIN is present', () => {
    expect(isGstEnabled(KERALA)).toBe(true);
  });
});

describe('GSTIN validation', () => {
  it('accepts well-formed GSTINs, case-insensitively and ignoring spaces', () => {
    expect(isGstinFormatValid(KERALA)).toBe(true);
    expect(isGstinFormatValid(KERALA.toLowerCase())).toBe(true);
    expect(isGstinFormatValid(' 32AAACC1234A1ZR ')).toBe(true);
  });

  it('rejects wrong lengths and wrong shapes', () => {
    expect(isGstinFormatValid('32AAACC1234A1Z')).toBe(false); // 14 chars
    expect(isGstinFormatValid('32AAACC1234A1ZRR')).toBe(false); // 16 chars
    expect(isGstinFormatValid('AAAAACC1234A1ZR')).toBe(false); // no state digits
    expect(isGstinFormatValid('32AAACC1234A1YR')).toBe(false); // missing the fixed Z
    expect(isGstinFormatValid('')).toBe(false);
  });

  it('verifies the check character', () => {
    expect(isGstinChecksumValid(KERALA)).toBe(true);
    expect(isGstinChecksumValid(TAMIL_NADU)).toBe(true);
    expect(isGstinChecksumValid(KERALA_OTHER)).toBe(true);
    // Same GSTIN with the wrong final character.
    expect(isGstinChecksumValid('32AAACC1234A1ZX')).toBe(false);
  });

  it('reports a specific problem, so the form can explain itself', () => {
    expect(validateGstin(KERALA)).toBeNull();
    expect(validateGstin('')).toBe('empty');
    expect(validateGstin('nonsense')).toBe('format');
    expect(validateGstin('32AAACC1234A1ZX')).toBe('checksum');
    expect(validateGstin('99AAACC1234A1ZR')).toBe('unknown_state');
  });
});

describe('state codes', () => {
  it('reads the state out of a GSTIN', () => {
    expect(stateCodeFromGstin(KERALA)).toBe('32');
    expect(stateNameFromGstin(KERALA)).toBe('Kerala');
    expect(stateNameFromGstin(TAMIL_NADU)).toBe('Tamil Nadu');
    expect(stateNameFromGstin('99AAACC1234A1ZR')).toBeNull();
  });
});

describe('normaliseStateName / statesMatch', () => {
  it('matches the same state typed differently', () => {
    expect(statesMatch('Kerala', 'kerala')).toBe(true);
    expect(statesMatch('Kerala ', ' KERALA')).toBe(true);
    expect(statesMatch('Kerala', 'KL')).toBe(true);
    expect(statesMatch('Tamil Nadu', 'tamilnadu')).toBe(true);
    expect(statesMatch('Tamil Nadu', 'TN')).toBe(true);
  });

  it('does not match different states', () => {
    expect(statesMatch('Kerala', 'Tamil Nadu')).toBe(false);
    expect(statesMatch('Kerala', 'Karnataka')).toBe(false);
  });

  it('treats an empty state as no information rather than a match', () => {
    expect(statesMatch('', '')).toBe(false);
    expect(statesMatch('Kerala', '')).toBe(false);
    expect(statesMatch(null, undefined)).toBe(false);
  });

  it('normalises to a comparable token', () => {
    expect(normaliseStateName('Tamil Nadu')).toBe('tamilnadu');
    expect(normaliseStateName('TN')).toBe('tamilnadu');
    expect(normaliseStateName(null)).toBe('');
  });
});

describe('inferTaxMode (§9.4)', () => {
  it('acceptance test §14.5: an unregistered business gets no GST at all', () => {
    const result = inferTaxMode({
      businessGstin: '',
      clientGstin: TAMIL_NADU,
      businessState: 'Kerala',
      clientState: 'Tamil Nadu',
    });
    expect(result.mode).toBe('none');
    expect(result.reason).toBe('business_not_registered');
  });

  it('acceptance test §14.6: Kerala business, Tamil Nadu client → IGST', () => {
    const result = inferTaxMode({
      businessGstin: KERALA,
      clientGstin: TAMIL_NADU,
      businessState: 'Kerala',
      clientState: 'Tamil Nadu',
    });
    expect(result.mode).toBe('gst_inter');
    expect(result.reason).toBe('gstin_state_codes_differ');
  });

  it('two GSTINs in the same state → CGST + SGST', () => {
    const result = inferTaxMode({
      businessGstin: KERALA,
      clientGstin: KERALA_OTHER,
      businessState: 'Kerala',
      clientState: 'Kerala',
    });
    expect(result.mode).toBe('gst_intra');
    expect(result.reason).toBe('gstin_state_codes_match');
  });

  it('falls back to the state fields when the client has no GSTIN', () => {
    expect(
      inferTaxMode({
        businessGstin: KERALA,
        clientGstin: null,
        businessState: 'Kerala',
        clientState: 'Kerala',
      }),
    ).toEqual({ mode: 'gst_intra', reason: 'state_names_match' });

    expect(
      inferTaxMode({
        businessGstin: KERALA,
        clientGstin: '',
        businessState: 'Kerala',
        clientState: 'Karnataka',
      }),
    ).toEqual({ mode: 'gst_inter', reason: 'state_names_differ' });
  });

  it('derives the business state from its GSTIN when the field is blank', () => {
    const result = inferTaxMode({
      businessGstin: KERALA,
      clientGstin: null,
      businessState: '',
      clientState: 'Kerala',
    });
    expect(result.mode).toBe('gst_intra');
  });

  it('assumes intra-state for a walk-in client with no location at all', () => {
    const result = inferTaxMode({
      businessGstin: KERALA,
      clientGstin: null,
      businessState: 'Kerala',
      clientState: null,
    });
    expect(result.mode).toBe('gst_intra');
    expect(result.reason).toBe('client_location_unknown');
  });
});

describe('enforceGstGate', () => {
  it('forces stored GST modes to none when the GSTIN is gone', () => {
    expect(enforceGstGate('gst_intra', '')).toBe('none');
    expect(enforceGstGate('gst_inter', null)).toBe('none');
    expect(enforceGstGate('flat', undefined)).toBe('none');
  });

  it('leaves the mode alone for a registered business', () => {
    expect(enforceGstGate('gst_intra', KERALA)).toBe('gst_intra');
    expect(enforceGstGate('flat', KERALA)).toBe('flat');
    expect(enforceGstGate('none', KERALA)).toBe('none');
  });
});
