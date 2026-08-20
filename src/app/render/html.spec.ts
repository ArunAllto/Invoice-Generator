import { calculateDocument } from '../core/calc';
import { amountInWords } from '../core/number-to-words-indian';
import { buildUpiUri, encodeQr, qrToSvg } from '../core/qr';
import { resolvePageGeometry } from '../core/page-size';
import {
  DEFAULT_BLOCKS,
  PAGE_PRESETS,
  type DocumentBlocks,
  type TemplateId,
} from '../core/types';
import {
  countPages,
  escapeHtml,
  renderDocumentHtml,
  type RenderInput,
  type RenderLine,
  type RenderParty,
} from './html';

const RUPEE = 100;

const BUSINESS: RenderParty = {
  name: 'The Crafty Pixels',
  tagline: 'Graphic Design & Brand Identity',
  addressLine1: 'Kangarapady',
  city: 'Ernakulam',
  state: 'Kerala',
  pincode: '682021',
  phone: '+91 98470 00000',
  email: 'hello@thecraftypixels.in',
  gstin: '32AAACC1234A1ZR',
  pan: 'AAACC1234A',
  bankName: 'HDFC Bank',
  bankAccountNo: '50100123456789',
  bankIfsc: 'HDFC0001234',
  upiId: 'craftypixels@okhdfcbank',
  signatureLabel: 'Authorised Signatory',
};

const CLIENT: RenderParty = {
  name: 'Ravi Menon',
  company: 'Acme Traders',
  addressLine1: 'MG Road',
  city: 'Chennai',
  state: 'Tamil Nadu',
  pincode: '600001',
  phone: '+91 90000 11111',
  gstin: '33BBBCC5678B1ZV',
};

function line(overrides: Partial<RenderLine> = {}): RenderLine {
  return {
    name: 'Logo Design',
    description: '',
    hsnSac: '998391',
    qtyMilli: 1000,
    unit: 'nos',
    rate: 7500 * RUPEE,
    taxRateBp: 1800,
    discountBp: 0,
    isFree: false,
    ...overrides,
  };
}

function build(
  overrides: {
    lines?: RenderLine[];
    blocks?: Partial<DocumentBlocks>;
    template?: TemplateId;
    document?: Partial<RenderInput['document']>;
    client?: RenderParty | null;
    business?: Partial<RenderParty>;
    options?: Partial<RenderInput['options']>;
  } = {},
): RenderInput {
  const lines = overrides.lines ?? [line()];
  const taxMode = overrides.document?.taxMode ?? 'gst_inter';
  const calc = calculateDocument({
    lines: lines.map((l) => ({
      qtyMilli: l.qtyMilli,
      rate: l.rate,
      taxRateBp: l.taxRateBp,
      discountBp: l.discountBp,
      isFree: l.isFree,
      hsnSac: l.hsnSac,
    })),
    discountMode: overrides.document?.taxMode === undefined ? 'none' : 'none',
    discountValue: 0,
    taxMode,
    shippingAmount: 0,
    roundOffEnabled: true,
  });

  return {
    document: {
      type: 'invoice',
      number: 'CP/INV/2026-27/001',
      status: 'sent',
      issueDate: '2026-08-18',
      dueDate: '2026-09-02',
      currency: 'INR',
      taxMode,
      notes: '',
      terms: '',
      templateId: overrides.template ?? 'classic',
      accentColor: '#0F4C81',
      amountInWords: amountInWords(calc.grandTotal),
      customFields: [],
      ...overrides.document,
    },
    lines,
    business: { ...BUSINESS, ...overrides.business },
    client: overrides.client === undefined ? CLIENT : overrides.client,
    calc,
    blocks: { ...DEFAULT_BLOCKS, ...overrides.blocks },
    options: {
      fontCss: "@font-face{font-family:'CraftyDocsSans';src:url(data:font/ttf;base64,AAAA);}",
      fontFamily: "'CraftyDocsSans', sans-serif",
      ...overrides.options,
    },
  };
}

describe('escapeHtml', () => {
  it('escapes every character that could break the document or inject script', () => {
    expect(escapeHtml('Smith & Sons')).toBe('Smith &amp; Sons');
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml('a "b" \'c\'')).toBe('a &quot;b&quot; &#39;c&#39;');
  });

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('renderDocumentHtml — self-containment (§10.1, §11 privacy)', () => {
  const html = renderDocumentHtml(build());

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('makes no network request of any kind', () => {
    // §11: "no network calls of any kind in v1". An export that quietly fetched a
    // stylesheet or a font would break that promise the moment the phone was online.
    expect(html).not.toMatch(/src=["']https?:/i);
    expect(html).not.toMatch(/href=["']https?:/i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(["']?https?:/i);
    expect(html).not.toContain('<script');
  });

  it('inlines the fonts it was given', () => {
    expect(html).toContain('@font-face');
    expect(html).toContain('data:font/ttf;base64,');
  });

  it('sets the A4 page size and the margins from §10.1', () => {
    expect(html).toContain('@page { size: A4; margin: 16mm 20mm; }');
  });

  it('keeps background fills when printing', () => {
    expect(html).toContain('-webkit-print-color-adjust: exact');
    expect(html).toContain('print-color-adjust: exact');
  });

  it('repeats the table header and forbids splitting a row', () => {
    expect(html).toContain('.items thead { display: table-header-group; }');
    expect(html).toContain('.items tr { page-break-inside: avoid');
  });

  it('keeps the closing group together', () => {
    expect(html).toContain('.closing { margin-top');
    expect(html).toMatch(/\.closing \{[^}]*page-break-inside: avoid/);
    expect(html).toMatch(/\.signature \{[^}]*page-break-inside: avoid/);
  });
});

describe('renderDocumentHtml — content', () => {
  it('prints the business, client, number, dates and total', () => {
    const html = renderDocumentHtml(build());
    expect(html).toContain('The Crafty Pixels');
    expect(html).toContain('Acme Traders');
    expect(html).toContain('CP/INV/2026-27/001');
    expect(html).toContain('18 Aug 2026');
    expect(html).toContain('02 Sep 2026');
    expect(html).toContain('INVOICE');
  });

  it('prints the rupee sign against amounts', () => {
    const html = renderDocumentHtml(build());
    // §11 currency correctness: the glyph must actually be in the output.
    expect(html).toContain('₹7,500.00');
    expect(html).toContain('₹8,850.00'); // 7500 + 18%
  });

  it('escapes user text rather than trusting it', () => {
    const html = renderDocumentHtml(
      build({
        lines: [line({ name: '<b>Logo</b> & "Brand"' })],
        document: { notes: '<script>alert(1)</script>' },
        blocks: { notes: true },
      }),
    );
    expect(html).toContain('&lt;b&gt;Logo&lt;/b&gt; &amp; &quot;Brand&quot;');
    expect(html).not.toContain('<script>alert(1)');
  });

  it('renders multi-line notes and terms as line breaks', () => {
    const html = renderDocumentHtml(
      build({ document: { terms: 'One\nTwo\nThree' }, blocks: { terms: true } }),
    );
    expect(html).toContain('One<br>Two<br>Three');
  });

  it('numbers the item rows from 1', () => {
    const html = renderDocumentHtml(build({ lines: [line(), line({ name: 'Flyer' })] }));
    expect(html).toContain('<td class="col-sn">1</td>');
    expect(html).toContain('<td class="col-sn">2</td>');
  });

  it('prints the amount in words', () => {
    const html = renderDocumentHtml(build());
    expect(html).toContain('Rupees Eight Thousand Eight Hundred Fifty Only');
  });
});

describe('renderDocumentHtml — complimentary lines (§7.3, acceptance §14.4)', () => {
  const html = renderDocumentHtml(
    build({
      lines: [
        line({ name: 'Logo Design', rate: 7500 * RUPEE }),
        line({
          name: 'Brand Guidelines',
          description: 'Included at no charge as agreed.',
          rate: 5000 * RUPEE,
          isFree: true,
        }),
      ],
      blocks: { descriptions: true },
    }),
  );

  it('prints FREE in the amount column', () => {
    expect(html).toContain('<span class="free-badge">FREE</span>');
  });

  it('keeps the full description of the complimentary line', () => {
    expect(html).toContain('Included at no charge as agreed.');
  });

  it('does not add the complimentary value to the total', () => {
    expect(html).toContain('₹8,850.00');
    expect(html).not.toContain('₹14,750.00');
  });

  it('dashes the rate rather than printing ₹0.00', () => {
    expect(html).toMatch(/<td class="col-rate">—<\/td>/);
  });
});

describe('renderDocumentHtml — GST (§9.2, §9.4, acceptance §14.5)', () => {
  it('prints IGST as a single row for an inter-state document', () => {
    const html = renderDocumentHtml(build({ document: { taxMode: 'gst_inter' } }));
    expect(html).toContain('IGST');
    expect(html).not.toContain('>CGST<');
  });

  it('prints CGST and SGST for an intra-state document', () => {
    const html = renderDocumentHtml(build({ document: { taxMode: 'gst_intra' } }));
    expect(html).toContain('CGST');
    expect(html).toContain('SGST');
    expect(html).not.toContain('>IGST<');
  });

  it('acceptance §14.5: no GSTIN and no tax row anywhere when tax mode is none', () => {
    const html = renderDocumentHtml(
      build({ document: { taxMode: 'none' }, business: { gstin: '32AAACC1234A1ZR' } }),
    );
    expect(html).not.toContain('GSTIN');
    expect(html).not.toContain('32AAACC1234A1ZR');
    expect(html).not.toContain('33BBBCC5678B1ZV');
    expect(html).not.toContain('CGST');
    expect(html).not.toContain('IGST');
    expect(html).not.toContain('<th class="col-tax">');
  });

  it('prints the tax summary table only when rates differ (§9.3)', () => {
    const single = renderDocumentHtml(build({ lines: [line(), line({ name: 'Flyer' })] }));
    expect(single).not.toContain('Tax summary');

    const mixed = renderDocumentHtml(
      build({
        lines: [line(), line({ name: 'Printing', taxRateBp: 500, hsnSac: '4911' })],
      }),
    );
    expect(mixed).toContain('Tax summary');
    expect(mixed).toContain('4911');
  });
});

describe('renderDocumentHtml — optional blocks (§7.4)', () => {
  it('omits the client block entirely and marks the layout as client-less', () => {
    const html = renderDocumentHtml(build({ client: null, blocks: { clientBlock: false } }));
    expect(html).not.toContain('Acme Traders');
    expect(html).not.toContain('Billed to');
    // §7.4: it must still look deliberate, not like a form with a hole in it.
    expect(html).toContain('meta-row no-client');
  });

  it('drops each block when its toggle is off', () => {
    const allOff: DocumentBlocks = {
      ...DEFAULT_BLOCKS,
      clientBlock: false,
      hsnColumn: false,
      unitColumn: false,
      taxColumns: false,
      bankDetails: false,
      upiQr: false,
      signature: false,
      terms: false,
      notes: false,
      amountInWords: false,
      discountRow: false,
      shippingRow: false,
      roundOffRow: false,
      footerLine: false,
      descriptions: false,
      taxSummary: false,
    };
    const html = renderDocumentHtml(
      build({
        blocks: allOff,
        document: { notes: 'A note', terms: 'Some terms' },
        client: null,
      }),
    );
    expect(html).not.toContain('A note');
    expect(html).not.toContain('Some terms');
    expect(html).not.toContain('HDFC Bank');
    expect(html).not.toContain('<p class="signature-label">');
    expect(html).not.toContain('Amount in words');
    expect(html).not.toContain('<th class="col-unit">');
    // The items table and the total survive — they are not optional.
    expect(html).toContain('class="items"');
    expect(html).toContain('Total');
  });

  it('shows the unit and HSN columns only when enabled and populated', () => {
    const withHsn = renderDocumentHtml(build({ blocks: { hsnColumn: true } }));
    expect(withHsn).toContain('HSN/SAC');

    const noHsnData = renderDocumentHtml(
      build({ blocks: { hsnColumn: true }, lines: [line({ hsnSac: '' })] }),
    );
    expect(noHsnData).not.toContain('>HSN/SAC<');
  });

  it('prints a blank ruled line when there is no signature image (§7.2)', () => {
    const html = renderDocumentHtml(build({ blocks: { signature: true } }));
    expect(html).toContain('<div class="signature-line">');
    expect(html).toContain('Authorised Signatory');

    const withImage = renderDocumentHtml(
      build({ blocks: { signature: true }, options: { signatureDataUri: 'data:image/png;base64,AAA' } }),
    );
    expect(withImage).toContain('class="signature-image"');
    expect(withImage).not.toContain('<div class="signature-line">');
  });

  it('constrains the logo and signature to the sizes §7.1 and §7.2 specify', () => {
    const html = renderDocumentHtml(
      build({ options: { logoDataUri: 'data:image/png;base64,AAA' } }),
    );
    expect(html).toContain('<img class="logo"');
    expect(html).toContain('.logo { max-height: 22mm');
    expect(html).toContain('.signature-image { max-height: 18mm');
  });

  it('includes the UPI QR only when the toggle is on and markup is supplied (§7.6)', () => {
    const qr = qrToSvg(
      encodeQr(buildUpiUri({ vpa: 'a@b', payeeName: 'X', amountPaise: 100 })),
      { size: 26, unit: 'mm' },
    );
    const on = renderDocumentHtml(build({ blocks: { upiQr: true }, options: { upiQrSvg: qr } }));
    expect(on).toContain('Scan to pay');
    expect(on).toContain('<svg');

    const off = renderDocumentHtml(build({ blocks: { upiQr: false }, options: { upiQrSvg: qr } }));
    expect(off).not.toContain('Scan to pay');
  });
});

describe('renderDocumentHtml — pagination and page numbers (§10.1, acceptance §14.9)', () => {
  it('a short document is a single page', () => {
    const input = build();
    expect(countPages(input)).toBe(1);
    const html = renderDocumentHtml(input);
    expect(html).toContain('Page 1 of 1');
    expect((html.match(/class="page[ "]/g) ?? []).length).toBe(1);
  });

  it('acceptance §14.9: a 25-line invoice paginates and prints "Page 1 of 2"', () => {
    const lines = Array.from({ length: 25 }, (_unused, i) =>
      line({ name: `Design deliverable ${i + 1}`, rate: (1000 + i) * RUPEE }),
    );
    const input = build({ lines });
    const pageCount = countPages(input);
    expect(pageCount).toBeGreaterThanOrEqual(2);

    const html = renderDocumentHtml(input);
    expect(html).toContain(`Page 1 of ${pageCount}`);
    expect(html).toContain(`Page ${pageCount} of ${pageCount}`);
    // Every page carries its own table header, which is what makes it repeat.
    const headerCount = (html.match(/<thead>/g) ?? []).length;
    expect(headerCount).toBeGreaterThanOrEqual(2);
  });

  it('every line item appears exactly once across the pages', () => {
    const lines = Array.from({ length: 40 }, (_unused, i) => line({ name: `Item ${i + 1}` }));
    const html = renderDocumentHtml(build({ lines }));
    for (let i = 1; i <= 40; i += 1) {
      const matches = html.match(new RegExp(`Item ${i}<`, 'g')) ?? [];
      expect(matches).toHaveLength(1);
    }
  });

  it('the closing block appears exactly once, on the final page', () => {
    const lines = Array.from({ length: 30 }, (_unused, i) => line({ name: `Item ${i + 1}` }));
    const html = renderDocumentHtml(build({ lines }));
    expect((html.match(/class="closing"/g) ?? []).length).toBe(1);
    const closingIndex = html.indexOf('class="closing"');
    const lastPageIndex = html.lastIndexOf('class="page last"');
    expect(closingIndex).toBeGreaterThan(lastPageIndex);
  });

  it('only the final page ends without a forced break', () => {
    const lines = Array.from({ length: 30 }, (_unused, i) => line({ name: `Item ${i + 1}` }));
    const html = renderDocumentHtml(build({ lines }));
    expect((html.match(/class="page last"/g) ?? []).length).toBe(1);
  });

  it('long descriptions push the break earlier rather than overflowing the page', () => {
    const shortLines = Array.from({ length: 12 }, () => line({ description: '' }));
    const longLines = Array.from({ length: 12 }, () =>
      line({ description: 'A very detailed scope note. '.repeat(20) }),
    );
    expect(countPages(build({ lines: longLines, blocks: { descriptions: true } }))).toBeGreaterThan(
      countPages(build({ lines: shortLines, blocks: { descriptions: true } })),
    );
  });

  it('gives the closing group its own page when it cannot fit under the rows', () => {
    // Fill the page almost exactly, then demand a large terms block too.
    const lines = Array.from({ length: 26 }, (_unused, i) => line({ name: `Item ${i + 1}` }));
    const input = build({
      lines,
      document: { terms: 'Clause line.\n'.repeat(30), notes: 'Note line.\n'.repeat(10) },
      blocks: { terms: true, notes: true },
    });
    const html = renderDocumentHtml(input);
    expect((html.match(/class="closing"/g) ?? []).length).toBe(1);
    expect(html).toContain(`Page ${countPages(input)} of ${countPages(input)}`);
  });

  it('the compact template fits more rows per page than the others (§10.6)', () => {
    const lines = Array.from({ length: 20 }, (_unused, i) => line({ name: `Item ${i + 1}` }));
    const compact = countPages(build({ lines, template: 'compact' }));
    const bold = countPages(build({ lines, template: 'bold' }));
    expect(compact).toBeLessThanOrEqual(bold);
    expect(compact).toBe(1); // §10.6: ~20 items on one page
  });

  it('a document with no items still renders one page with the totals', () => {
    const html = renderDocumentHtml(build({ lines: [] }));
    expect(html).toContain('Page 1 of 1');
    expect(html).toContain('Total');
  });
});

describe('renderDocumentHtml — templates (§10.6, acceptance §14.10)', () => {
  const templates: TemplateId[] = ['classic', 'minimal', 'bold', 'compact'];

  it('every template renders and tags the body', () => {
    for (const template of templates) {
      const html = renderDocumentHtml(build({ template }));
      expect(html).toContain(`class="tpl-${template}`);
      expect(html).toContain('CP/INV/2026-27/001');
    }
  });

  it('acceptance §14.8/§14.10: switching template changes no number', () => {
    const lines = [
      line({ rate: 7500 * RUPEE }),
      line({ name: 'Poster', rate: 1250 * RUPEE, taxRateBp: 1800 }),
      line({ name: 'Gift', rate: 900 * RUPEE, isFree: true }),
    ];
    const amounts = templates.map((template) => {
      const html = renderDocumentHtml(build({ lines, template }));
      return (html.match(/₹[\d,]+\.\d{2}/g) ?? []).join('|');
    });
    for (const rendered of amounts) {
      expect(rendered).toBe(amounts[0]);
    }
  });

  it('the accent colour reaches the stylesheet, and only as a colour', () => {
    const html = renderDocumentHtml(build({ document: { accentColor: '#1B7F79' } }));
    expect(html).toContain('#1B7F79');
  });

  it('refuses to inject a non-colour accent value', () => {
    // Guards against a crafted colour string escaping the stylesheet.
    const html = renderDocumentHtml(
      build({ document: { accentColor: 'red; } body { display:none } .x {' } }),
    );
    expect(html).not.toContain('display:none');
    expect(html).toContain('#0F4C81'); // fell back to the default
  });
});

describe('renderDocumentHtml — modes', () => {
  it('screen mode adds the paper styling that print does not need', () => {
    const screen = renderDocumentHtml(build({ options: { forScreen: true } }));
    expect(screen).toContain('class="tpl-classic screen"');
    expect(screen).toContain('body.screen');
  });

  it('pixel mode lays the page out in pixels for image capture (§10.4)', () => {
    const html = renderDocumentHtml(build({ options: { pixelWidth: 1240 } }));
    // 170mm of content at 1240px/210mm ≈ 1003.81px
    expect(html).toContain('width: 1003.81px');
    expect(html).not.toContain('width: 170mm');
  });

  it('millimetre mode is the default', () => {
    const html = renderDocumentHtml(build());
    expect(html).toContain('width: 170mm');
  });
});

describe('renderDocumentHtml — invoice payment state', () => {
  it('prints received and balance rows once a payment exists (§14.14)', () => {
    const html = renderDocumentHtml(
      build({ document: { paidTotal: 5000 * RUPEE, balanceDue: 3850 * RUPEE } }),
    );
    expect(html).toContain('Received');
    expect(html).toContain('Balance due');
    expect(html).toContain('₹5,000.00');
    expect(html).toContain('₹3,850.00');
  });

  it('omits them when nothing has been paid', () => {
    const html = renderDocumentHtml(build({ document: { paidTotal: 0 } }));
    expect(html).not.toContain('Balance due');
  });

  it('watermarks a draft and a cancelled document', () => {
    expect(renderDocumentHtml(build({ document: { watermark: 'DRAFT' } }))).toContain(
      '<div class="watermark">DRAFT</div>',
    );
    expect(renderDocumentHtml(build({ document: { watermark: null } }))).not.toContain(
      'class="watermark"',
    );
  });
});

describe('renderDocumentHtml — determinism', () => {
  it('the same input renders byte-identical output', () => {
    // §10.5 caches generated files against a hash of the document state, which only works
    // if rendering is deterministic.
    const input = build({ lines: [line(), line({ name: 'Poster' })] });
    expect(renderDocumentHtml(input)).toBe(renderDocumentHtml(input));
  });

  it('receipts render with their payment metadata', () => {
    const html = renderDocumentHtml(
      build({
        document: {
          type: 'receipt',
          taxMode: 'none',
          paymentMethodLabel: 'UPI',
          paymentReference: 'UTR123456',
        },
        lines: [line({ name: 'Payment received against Invoice CP/INV/2026-27/001', taxRateBp: 0 })],
      }),
    );
    expect(html).toContain('RECEIPT');
    expect(html).toContain('Received from');
    expect(html).toContain('UPI');
    expect(html).toContain('UTR123456');
  });
});

/**
 * Configurable paper (§10.1).
 *
 * The point of these is that the row count per page is *derived* from the sheet. A change that
 * altered the CSS but left pagination on A4's 265mm of usable height would look right in the preview
 * and then overflow when printed, which is exactly the failure explicit pagination exists to avoid.
 */
describe('renderDocumentHtml — page size', () => {
  const twentyLines = Array.from({ length: 20 }, (_, i) => line({ name: `Item ${i + 1}` }));

  it('defaults to A4 when no page is given', () => {
    const html = renderDocumentHtml(build());
    expect(html).toContain('@page { size: A4;');
    expect(html).toContain('margin: 16mm 20mm;');
  });

  it('emits each preset as a named CSS size', () => {
    expect(renderDocumentHtml(build({ options: { page: PAGE_PRESETS.letter } }))).toContain(
      '@page { size: letter;',
    );
    expect(renderDocumentHtml(build({ options: { page: PAGE_PRESETS.a5 } }))).toContain(
      '@page { size: A5;',
    );
    expect(renderDocumentHtml(build({ options: { page: PAGE_PRESETS.legal } }))).toContain(
      '@page { size: legal;',
    );
  });

  /**
   * How many item rows the renderer actually placed on a given page.
   *
   * Needs a document long enough to overflow every sheet under test — with only twenty rows both
   * Letter and Legal hold the lot on page one, and the comparison proves nothing.
   */
  const longDocument = Array.from({ length: 60 }, (_, i) => line({ name: `Row ${i + 1}` }));

  const rowsOnPage = (page: number, geometry?: RenderInput['options']['page']): number => {
    const html = renderDocumentHtml(
      build({
        lines: longDocument,
        options: { onlyPage: page, ...(geometry ? { page: geometry } : {}) },
      }),
    );
    return longDocument.filter((l) => html.includes(`>${l.name}<`)).length;
  };

  it('fits fewer rows per page on a smaller sheet', () => {
    // The precise claim, rather than a page total: a page count can coincide across two sheets while
    // the rows are distributed quite differently, so counting pages proves nothing on its own.
    expect(rowsOnPage(1, PAGE_PRESETS.a5)).toBeLessThan(rowsOnPage(1));
  });

  it('fits more rows per page on a taller sheet', () => {
    expect(rowsOnPage(1, PAGE_PRESETS.legal)).toBeGreaterThan(rowsOnPage(1, PAGE_PRESETS.letter));
  });

  it('needs more pages for the same document on a smaller sheet', () => {
    const onA4 = countPages(build({ lines: longDocument }));
    const onA5 = countPages(build({ lines: longDocument, options: { page: PAGE_PRESETS.a5 } }));
    expect(onA5).toBeGreaterThan(onA4);
  });

  it('numbers every page against the whole document, whatever the sheet', () => {
    const html = renderDocumentHtml(build({ lines: twentyLines, options: { page: PAGE_PRESETS.a5 } }));
    const total = countPages(build({ lines: twentyLines, options: { page: PAGE_PRESETS.a5 } }));
    expect(html).toContain(`Page 1 of ${total}`);
    expect(html).toContain(`Page ${total} of ${total}`);
  });

  it('lays a custom sheet out at its own width and margins', () => {
    const page = resolvePageGeometry({
      sizeId: 'custom',
      widthMm: 120,
      heightMm: 200,
      marginXMm: 6,
      marginYMm: 5,
    });
    const html = renderDocumentHtml(build({ options: { page } }));
    expect(html).toContain('@page { size: 120mm 200mm;');
    expect(html).toContain('margin: 5mm 6mm;');
    // The content box is the sheet less both margins.
    expect(html).toContain('width: 108mm');
    expect(html).toContain('min-height: 190mm');
  });

  it('re-clamps a stored geometry that would give pagination a negative height', () => {
    // Not a hypothetical: the settings row and a hand-edited backup both reach here, and the row
    // count is divided out of the content height.
    const html = renderDocumentHtml(
      build({
        lines: twentyLines,
        options: {
          page: resolvePageGeometry({
            sizeId: 'custom',
            widthMm: 70,
            heightMm: 100,
            marginXMm: 40,
            marginYMm: 40,
          }),
        },
      }),
    );
    expect(html).toContain('Page 1 of');
    expect(html).not.toContain('min-height: -');
    expect(html).not.toContain('NaN');
  });

  it('scales the image export against the chosen width, not a fixed 210mm', () => {
    const html = renderDocumentHtml(
      build({ options: { page: PAGE_PRESETS.a5, pixelWidth: 1480 } }),
    );
    // A5 is 148mm wide, so 1480px is exactly 10px per millimetre — the page box lands on 1480px.
    expect(html).toContain('width: 1480.00px');
  });
});
