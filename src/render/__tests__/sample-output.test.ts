import * as fs from 'fs';
import * as path from 'path';
import { calculateDocument } from '../../core/calc';
import { amountInWords } from '../../core/numberToWordsIndian';
import { buildUpiUri, encodeQr, qrToSvg } from '../../core/qr';
import { DEFAULT_BLOCKS, type TemplateId } from '../../core/types';
import { renderDocumentHtml, type RenderInput } from '../html';

/**
 * A developer tool rather than an assertion suite.
 *
 * Run with SAMPLE_OUT set to a directory and it writes one realistic invoice per template
 * so the layouts can be opened in a browser and compared against the owner's existing
 * PDF — which is Phase 5's definition of done and the one thing only the owner can judge.
 * Skipped in a normal run.
 *
 *   SAMPLE_OUT=./docs/samples npx jest --selectProjects pure -t 'writes sample HTML'
 */

const OUT = process.env.SAMPLE_OUT ?? '';
const R = 100;

const LINES = [
  { name: 'Logo Design', description: 'Three initial concepts, two revision rounds, final files in AI, EPS, PNG and SVG.', hsnSac: '998391', qtyMilli: 1000, unit: 'nos', rate: 18000 * R, taxRateBp: 1800, discountBp: 0, isFree: false },
  { name: 'Brand Guideline Sheet', description: 'Logo variants, clear space, colour values, typography.', hsnSac: '998391', qtyMilli: 1000, unit: 'nos', rate: 6500 * R, taxRateBp: 1800, discountBp: 1000, isFree: false },
  { name: 'Social Media Posters', description: 'Festival and product creatives, sized per platform.', hsnSac: '998391', qtyMilli: 12000, unit: 'nos', rate: 850 * R, taxRateBp: 1800, discountBp: 0, isFree: false },
  { name: 'Business Card Design', description: '', hsnSac: '998391', qtyMilli: 1000, unit: 'nos', rate: 3500 * R, taxRateBp: 1800, discountBp: 0, isFree: false },
  { name: 'Banner Printing', description: 'Vinyl flex, 8 x 4 ft.', hsnSac: '4911', qtyMilli: 32000, unit: 'sq.ft', rate: 45 * R, taxRateBp: 500, discountBp: 0, isFree: false },
  { name: 'Bilingual Layout (Malayalam)', description: 'Complimentary — Malayalam typesetting of the approved brochure.', hsnSac: '998391', qtyMilli: 1000, unit: 'nos', rate: 4500 * R, taxRateBp: 1800, discountBp: 0, isFree: true },
];

function make(template: TemplateId): RenderInput {
  const calc = calculateDocument({
    lines: LINES.map((l) => ({ qtyMilli: l.qtyMilli, rate: l.rate, taxRateBp: l.taxRateBp, discountBp: l.discountBp, isFree: l.isFree, hsnSac: l.hsnSac })),
    discountMode: 'percent', discountValue: 500, taxMode: 'gst_intra', shippingAmount: 250 * R, roundOffEnabled: true,
  });
  const qr = qrToSvg(encodeQr(buildUpiUri({ vpa: 'craftypixels@okhdfcbank', payeeName: 'The Crafty Pixels', amountPaise: calc.grandTotal, note: 'CP/INV/2026-27/014' })), { size: 26, unit: 'mm', margin: 2 });
  return {
    document: {
      type: 'invoice', number: 'CP/INV/2026-27/014', status: 'sent', issueDate: '2026-08-18', dueDate: '2026-09-02',
      currency: 'INR', taxMode: 'gst_intra',
      notes: 'Thank you for the repeat business. Source files will be shared over Drive on payment.',
      terms: '1. Payment: 50% advance to confirm the project, balance on delivery of final files.\n2. Timeline: Work begins on receipt of the advance and all required inputs.\n3. Revisions: Two rounds of revisions are included at each stage.\n4. Ownership: Full ownership transfers on receipt of complete payment.\n5. Validity: Prices hold for 15 days from the date of issue.',
      templateId: template, accentColor: '#0F4C81', amountInWords: amountInWords(calc.grandTotal),
      customFields: [{ label: 'PO Number', value: 'ACME/PO/2026/88' }, { label: 'Project Code', value: 'CP-ACME-BRAND' }],
      paidTotal: 10000 * R, balanceDue: calc.grandTotal - 10000 * R,
    },
    lines: LINES,
    business: {
      name: 'The Crafty Pixels', tagline: 'Graphic Design & Brand Identity', addressLine1: '2nd Floor, Pixel House, Kangarapady',
      city: 'Ernakulam', state: 'Kerala', pincode: '682021', phone: '+91 98470 12345', email: 'hello@thecraftypixels.in',
      website: 'thecraftypixels.in', gstin: '32AAACC1234A1ZR', pan: 'AAACC1234A', bankName: 'HDFC Bank',
      bankAccountName: 'The Crafty Pixels', bankAccountNo: '50100123456789', bankIfsc: 'HDFC0001234',
      upiId: 'craftypixels@okhdfcbank', signatureLabel: 'Authorised Signatory',
    },
    client: { name: 'Ravi Menon', company: 'Acme Traders Pvt Ltd', addressLine1: '14/B, Marine Drive', city: 'Kochi', state: 'Kerala', pincode: '682031', phone: '+91 90000 11111', email: 'ravi@acmetraders.in', gstin: '32ABCDE1234F1Z9' },
    calc,
    blocks: { ...DEFAULT_BLOCKS, hsnColumn: true, upiQr: true, shippingRow: true },
    options: { fontCss: '', fontFamily: "'Noto Sans','Segoe UI',sans-serif", upiQrSvg: qr, dateStyle: 'dd MMM yyyy', forScreen: true },
  };
}

(OUT ? it : it.skip)('writes sample HTML for visual inspection', () => {
  for (const template of ['classic', 'minimal', 'bold', 'compact'] as TemplateId[]) {
    fs.writeFileSync(path.join(OUT, `sample-${template}.html`), renderDocumentHtml(make(template)));
  }
  expect(fs.existsSync(path.join(OUT, 'sample-classic.html'))).toBe(true);
});
