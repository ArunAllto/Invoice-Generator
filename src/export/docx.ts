/**
 * DOCX export — spec §10.3.
 *
 * A real Word document with a real table, built with the `docx` package, because the owner
 * may want to edit it afterwards. §10.3 is explicit that renaming an HTML file to `.doc`
 * is not acceptable, and it is not done here.
 *
 * Structural parity with the PDF is the requirement (§10.3): the same header block, items
 * table, totals, terms and signature, in the same order, showing the same numbers.
 * Pixel-identical styling is explicitly not required, which is why this builds Word
 * primitives rather than trying to translate CSS.
 *
 * ## The two things that break this silently, per §10.3
 *
 * 1. **The `buffer` polyfill.** `docx` reaches for Node's `Buffer`. React Native has no
 *    `Buffer`, and the failure is an obscure `ReferenceError` deep inside the packer. The
 *    polyfill is installed in `app/_layout.tsx` (the app entry point) and the README says
 *    so. This module double-checks and fails with a readable message instead.
 * 2. **The rupee glyph.** A DOCX carries no embedded font, so the glyph depends on what is
 *    installed on the machine that opens it. `DOCX_USE_RUPEE_GLYPH` controls the fallback.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import * as FileSystem from 'expo-file-system/legacy';

import { formatBasisPoints, formatMilli, formatPaise } from '../core/money';
import type { Paise } from '../core/types';
import type { RenderInput } from '../render/html';
import { buildExportFilename, MIME_TYPES, type FilenameParts } from './filename';
import type { GeneratedFile } from './pdf';

/**
 * Whether to write "₹" or "Rs." in DOCX output.
 *
 * `true` uses the real glyph, which is correct on any machine with a font covering
 * U+20B9 — every current Windows, macOS and Android release. `false` writes "Rs." instead,
 * which is universally safe but less polished.
 *
 * Default `true`: Word substitutes a font per-glyph rather than dropping the character, so
 * the realistic worst case on a very old machine is a rupee sign in a slightly different
 * face — not the blank box that the PDF path genuinely risks. Flip this if a client ever
 * reports a missing symbol.
 */
export const DOCX_USE_RUPEE_GLYPH = true;

/** Word measures in half-points; these mirror the on-screen hierarchy loosely. */
const SIZE = {
  businessName: 28,
  docTitle: 26,
  heading: 18,
  body: 19,
  small: 17,
  tiny: 15,
} as const;

const INK = '14181F';
const MUTED = '5A6472';

function accentHex(input: RenderInput): string {
  return (input.document.accentColor || '#0F4C81').replace('#', '').toUpperCase();
}

function money(amount: Paise, currency: string): string {
  if (currency !== 'INR') return formatPaise(amount);
  return DOCX_USE_RUPEE_GLYPH ? `₹${formatPaise(amount)}` : `Rs. ${formatPaise(amount)}`;
}

function text(
  value: string,
  options: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {},
): TextRun {
  return new TextRun({
    text: value,
    bold: options.bold ?? false,
    italics: options.italics ?? false,
    size: options.size ?? SIZE.body,
    color: options.color ?? INK,
  });
}

function para(
  runs: TextRun[],
  options: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacingAfter?: number } = {},
): Paragraph {
  return new Paragraph({
    children: runs,
    alignment: options.align,
    spacing: { after: options.spacingAfter ?? 40 },
  });
}

/** Strip the `data:` prefix from a data URI, ready for `ImageRun`. */
function base64FromDataUri(dataUri: string | null | undefined): string | null {
  if (!dataUri) return null;
  const comma = dataUri.indexOf(',');
  return comma >= 0 ? dataUri.slice(comma + 1) : null;
}

function imageType(dataUri: string): 'png' | 'jpg' {
  return dataUri.includes('image/jpeg') || dataUri.includes('image/jpg') ? 'jpg' : 'png';
}

/**
 * Confirm the `buffer` polyfill is in place before `docx` trips over its absence.
 *
 * §10.3 asks for this to be documented because it fails obscurely; a clear error at the
 * top of the export is far better than a stack trace from inside the packer.
 */
function assertBufferPolyfill(): void {
  const globalBuffer = (globalThis as { Buffer?: unknown }).Buffer;
  if (typeof globalBuffer === 'undefined') {
    throw new Error(
      'DOCX export needs the `buffer` polyfill. Add `import { Buffer } from "buffer"; ' +
        'global.Buffer = global.Buffer ?? Buffer;` to app/_layout.tsx. See the README.',
    );
  }
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

function buildHeaderBlock(input: RenderInput): Paragraph[] {
  const { business, document } = input;
  const out: Paragraph[] = [];

  out.push(
    new Paragraph({
      children: [text(business.name, { bold: true, size: SIZE.businessName })],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 40 },
    }),
  );
  if (business.tagline) {
    out.push(para([text(business.tagline, { size: SIZE.small, color: MUTED })]));
  }

  const addressLine = [
    business.addressLine1,
    business.addressLine2,
    business.city,
    business.state,
    business.pincode,
  ]
    .filter((part) => part && part.trim().length > 0)
    .join(', ');
  if (addressLine) out.push(para([text(addressLine, { size: SIZE.small, color: MUTED })]));

  const contact = [
    business.phone ? `Phone: ${business.phone}` : '',
    business.email ? `Email: ${business.email}` : '',
    business.website ?? '',
  ]
    .filter((part) => part.length > 0)
    .join('   ·   ');
  if (contact) out.push(para([text(contact, { size: SIZE.small, color: MUTED })]));

  // §9.2: nothing GST-related is printed when the document carries no tax.
  const ids = [
    document.taxMode !== 'none' && business.gstin ? `GSTIN: ${business.gstin}` : '',
    business.pan ? `PAN: ${business.pan}` : '',
  ]
    .filter((part) => part.length > 0)
    .join('   ·   ');
  if (ids) out.push(para([text(ids, { size: SIZE.small, bold: true })]));

  return out;
}

function buildTitleAndMeta(input: RenderInput): Paragraph[] {
  const { document, client, blocks } = input;
  const out: Paragraph[] = [];

  const titles = { quotation: 'QUOTATION', invoice: 'INVOICE', receipt: 'RECEIPT' } as const;
  out.push(
    new Paragraph({
      children: [text(titles[document.type], { bold: true, size: SIZE.docTitle, color: accentHex(input) })],
      spacing: { before: 240, after: 120 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 12, color: accentHex(input), space: 6 },
      },
    }),
  );

  if (blocks.clientBlock && client) {
    out.push(
      para([
        text(document.type === 'receipt' ? 'Received from: ' : 'Billed to: ', { color: MUTED, size: SIZE.small }),
        text(client.company || client.name, { bold: true }),
      ]),
    );
    const clientAddress = [client.addressLine1, client.addressLine2, client.city, client.state, client.pincode]
      .filter((part) => part && part.trim().length > 0)
      .join(', ');
    if (client.company && client.name) out.push(para([text(client.name, { size: SIZE.small })]));
    if (clientAddress) out.push(para([text(clientAddress, { size: SIZE.small, color: MUTED })]));
    if (client.phone) out.push(para([text(client.phone, { size: SIZE.small, color: MUTED })]));
    if (document.taxMode !== 'none' && client.gstin) {
      out.push(para([text(`GSTIN: ${client.gstin}`, { size: SIZE.small, bold: true })]));
    }
  }

  const metaBits: string[] = [];
  if (document.number) metaBits.push(`No.: ${document.number}`);
  metaBits.push(`Date: ${document.issueDate}`);
  if (document.type === 'quotation' && document.validUntil) {
    metaBits.push(`Valid until: ${document.validUntil}`);
  }
  if (document.type === 'invoice' && document.dueDate) metaBits.push(`Due: ${document.dueDate}`);
  if (document.paymentMethodLabel) metaBits.push(`Paid by: ${document.paymentMethodLabel}`);
  if (document.paymentReference) metaBits.push(`Ref: ${document.paymentReference}`);
  for (const field of document.customFields) {
    if (field.label.trim() && field.value.trim()) metaBits.push(`${field.label}: ${field.value}`);
  }
  out.push(new Paragraph({ children: [text(metaBits.join('   ·   '), { size: SIZE.small })], spacing: { before: 120, after: 160 } }));

  return out;
}

function headerCell(label: string, accent: string, align?: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return new TableCell({
    shading: { fill: accent },
    children: [
      new Paragraph({
        children: [text(label, { bold: true, size: SIZE.tiny, color: 'FFFFFF' })],
        alignment: align,
      }),
    ],
  });
}

function bodyCell(
  runs: TextRun[],
  align?: (typeof AlignmentType)[keyof typeof AlignmentType],
): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: runs, alignment: align, spacing: { after: 20 } })],
  });
}

function buildItemsTable(input: RenderInput): Table {
  const { lines, calc, blocks, document } = input;
  const accent = accentHex(input);
  const currency = document.currency;

  const showHsn = blocks.hsnColumn && lines.some((line) => line.hsnSac.trim().length > 0);
  const showUnit = blocks.unitColumn;
  const showTax = blocks.taxColumns && document.taxMode !== 'none';

  const header = new TableRow({
    tableHeader: true, // repeats on every page, matching the PDF (§10.1)
    children: [
      headerCell('#', accent),
      headerCell('Description', accent),
      ...(showHsn ? [headerCell('HSN/SAC', accent)] : []),
      headerCell('Qty', accent, AlignmentType.RIGHT),
      ...(showUnit ? [headerCell('Unit', accent)] : []),
      headerCell('Rate', accent, AlignmentType.RIGHT),
      ...(showTax ? [headerCell('Tax', accent, AlignmentType.RIGHT)] : []),
      headerCell('Amount', accent, AlignmentType.RIGHT),
    ],
  });

  const rows = lines.map((line, index) => {
    const lineCalc = calc.lines[index];
    const description: TextRun[] = [text(line.name)];
    if (blocks.descriptions && line.description.trim().length > 0) {
      // Word has no <br>; a break run is the equivalent.
      description.push(new TextRun({ text: line.description, size: SIZE.small, color: MUTED, break: 1 }));
    }

    return new TableRow({
      cantSplit: true, // §10.1: a line item must not split across pages
      children: [
        bodyCell([text(String(index + 1), { color: MUTED })], AlignmentType.RIGHT),
        bodyCell(description),
        ...(showHsn ? [bodyCell([text(line.hsnSac, { size: SIZE.small })])] : []),
        bodyCell([text(formatMilli(line.qtyMilli))], AlignmentType.RIGHT),
        ...(showUnit ? [bodyCell([text(line.unit, { size: SIZE.small })])] : []),
        bodyCell([text(line.isFree ? '—' : money(line.rate, currency))], AlignmentType.RIGHT),
        ...(showTax
          ? [
              bodyCell(
                [
                  text(
                    (lineCalc?.effectiveTaxRateBp ?? 0) > 0
                      ? `${formatBasisPoints(lineCalc?.effectiveTaxRateBp ?? 0)}%`
                      : '—',
                  ),
                ],
                AlignmentType.RIGHT,
              ),
            ]
          : []),
        // §7.3: FREE, not a zero-rupee hack.
        bodyCell(
          [
            line.isFree
              ? text('FREE', { bold: true, color: accent })
              : text(money(lineCalc?.lineTotal ?? 0, currency), { bold: true }),
          ],
          AlignmentType.RIGHT,
        ),
      ],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [header, ...rows],
  });
}

function buildTotals(input: RenderInput): Table {
  const { calc, blocks, document } = input;
  const currency = document.currency;
  const accent = accentHex(input);

  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: 'Subtotal', value: money(calc.subtotal, currency) },
  ];
  if (blocks.discountRow && calc.discountTotal > 0) {
    rows.push({ label: 'Discount', value: `− ${money(calc.discountTotal, currency)}` });
    rows.push({ label: 'Taxable value', value: money(calc.taxBase, currency) });
  }
  if (document.taxMode === 'gst_intra') {
    rows.push({ label: 'CGST', value: money(calc.cgstTotal, currency) });
    rows.push({ label: 'SGST', value: money(calc.sgstTotal, currency) });
  } else if (document.taxMode === 'gst_inter') {
    rows.push({ label: 'IGST', value: money(calc.igstTotal, currency) });
  } else if (document.taxMode === 'flat') {
    rows.push({ label: 'Tax', value: money(calc.taxTotal, currency) });
  }
  if (blocks.shippingRow && calc.shipping > 0) {
    rows.push({ label: 'Delivery', value: money(calc.shipping, currency) });
  }
  if (blocks.roundOffRow && calc.roundOff !== 0) {
    rows.push({
      label: 'Round off',
      value: `${calc.roundOff > 0 ? '+ ' : '− '}${money(Math.abs(calc.roundOff), currency)}`,
    });
  }
  rows.push({ label: 'Total', value: money(calc.grandTotal, currency), strong: true });

  if (document.type === 'invoice' && (document.paidTotal ?? 0) > 0) {
    rows.push({ label: 'Received', value: money(document.paidTotal ?? 0, currency) });
    rows.push({ label: 'Balance due', value: money(document.balanceDue ?? 0, currency), strong: true });
  }

  return new Table({
    width: { size: 55, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.RIGHT,
    rows: rows.map(
      (row) =>
        new TableRow({
          children: [
            new TableCell({
              shading: row.strong ? { fill: accent } : undefined,
              children: [
                new Paragraph({
                  children: [
                    text(row.label, {
                      color: row.strong ? 'FFFFFF' : MUTED,
                      bold: row.strong,
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              shading: row.strong ? { fill: accent } : undefined,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [text(row.value, { bold: true, color: row.strong ? 'FFFFFF' : INK })],
                }),
              ],
            }),
          ],
        }),
    ),
  });
}

function buildTaxSummary(input: RenderInput): Array<Paragraph | Table> {
  const { calc, blocks, document } = input;
  if (!blocks.taxSummary || !calc.showTaxSummary) return [];

  const intra = document.taxMode === 'gst_intra';
  const accent = accentHex(input);
  const currency = document.currency;

  const headers = intra
    ? ['HSN/SAC', 'Taxable', 'Rate', 'CGST', 'SGST', 'Total tax']
    : ['HSN/SAC', 'Taxable', 'Rate', 'IGST', 'Total tax'];

  return [
    new Paragraph({
      children: [text('Tax summary', { bold: true, size: SIZE.heading, color: MUTED })],
      spacing: { before: 240, after: 80 },
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: headers.map((label, index) =>
            headerCell(label, accent, index === 0 ? undefined : AlignmentType.RIGHT),
          ),
        }),
        ...calc.taxSummary.map(
          (row) =>
            new TableRow({
              children: [
                bodyCell([text(row.hsnSac || '—', { size: SIZE.small })]),
                bodyCell([text(money(row.taxableValue, currency), { size: SIZE.small })], AlignmentType.RIGHT),
                bodyCell([text(`${formatBasisPoints(row.taxRateBp)}%`, { size: SIZE.small })], AlignmentType.RIGHT),
                ...(intra
                  ? [
                      bodyCell([text(money(row.cgst, currency), { size: SIZE.small })], AlignmentType.RIGHT),
                      bodyCell([text(money(row.sgst, currency), { size: SIZE.small })], AlignmentType.RIGHT),
                    ]
                  : [bodyCell([text(money(row.igst, currency), { size: SIZE.small })], AlignmentType.RIGHT)]),
                bodyCell([text(money(row.totalTax, currency), { size: SIZE.small, bold: true })], AlignmentType.RIGHT),
              ],
            }),
        ),
      ],
    }),
  ];
}

function buildClosing(input: RenderInput): Array<Paragraph | Table> {
  const { document, business, blocks, options } = input;
  const out: Array<Paragraph | Table> = [];

  if (blocks.amountInWords && document.amountInWords) {
    out.push(
      new Paragraph({
        children: [
          text('Amount in words: ', { color: MUTED, size: SIZE.small }),
          text(document.amountInWords, { bold: true }),
        ],
        spacing: { before: 200, after: 120 },
      }),
    );
  }

  if (blocks.notes && document.notes.trim().length > 0) {
    out.push(headingPara('Notes'));
    for (const paragraph of document.notes.split(/\r?\n/)) {
      out.push(para([text(paragraph, { size: SIZE.small })]));
    }
  }

  if (blocks.terms && document.terms.trim().length > 0) {
    out.push(headingPara('Terms & conditions'));
    for (const paragraph of document.terms.split(/\r?\n/)) {
      out.push(para([text(paragraph, { size: SIZE.small, color: '3C4553' })]));
    }
  }

  const bankLines = [
    business.bankName ? `Bank: ${business.bankName}` : '',
    business.bankAccountName ? `Account name: ${business.bankAccountName}` : '',
    business.bankAccountNo ? `Account no.: ${business.bankAccountNo}` : '',
    business.bankIfsc ? `IFSC: ${business.bankIfsc}` : '',
    business.upiId ? `UPI: ${business.upiId}` : '',
  ].filter((line) => line.length > 0);

  if (blocks.bankDetails && bankLines.length > 0) {
    out.push(headingPara('Payment details'));
    for (const bankLine of bankLines) out.push(para([text(bankLine, { size: SIZE.small })]));
  }

  if (blocks.signature) {
    const signatureBase64 = base64FromDataUri(options.signatureDataUri);
    if (signatureBase64 && options.signatureDataUri) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 320, after: 20 },
          children: [
            new ImageRun({
              data: signatureBase64,
              // ~18mm tall, matching §7.2, at Word's 96dpi.
              transformation: { width: 150, height: 68 },
              type: imageType(options.signatureDataUri),
            }),
          ],
        }),
      );
    } else {
      // §7.2: no signature means a blank signing line, not a missing block.
      out.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 400, after: 20 },
          children: [text('____________________', { color: MUTED })],
        }),
      );
    }
    out.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [text(business.signatureLabel || 'Authorised Signatory', { bold: true, size: SIZE.small })],
      }),
    );
    out.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [text(`for ${business.name}`, { size: SIZE.tiny, color: MUTED })],
      }),
    );
  }

  return out;
}

function headingPara(label: string): Paragraph {
  return new Paragraph({
    children: [text(label, { bold: true, size: SIZE.heading, color: MUTED })],
    spacing: { before: 240, after: 60 },
  });
}

/** Build the `docx` Document object. Exported for testing without touching the filesystem. */
export function buildDocxDocument(input: RenderInput): Document {
  const { options, blocks } = input;
  const logoBase64 = base64FromDataUri(options.logoDataUri);

  const children: Array<Paragraph | Table> = [];

  if (logoBase64 && options.logoDataUri) {
    children.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new ImageRun({
            data: logoBase64,
            // ~22mm tall, matching §7.1.
            transformation: { width: 180, height: 83 },
            type: imageType(options.logoDataUri),
          }),
        ],
      }),
    );
  }

  children.push(...buildHeaderBlock(input));
  children.push(...buildTitleAndMeta(input));
  children.push(buildItemsTable(input));
  children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
  children.push(...buildTaxSummary(input));
  children.push(buildTotals(input));
  children.push(...buildClosing(input));

  if (blocks.footerLine) {
    children.push(
      new Paragraph({
        spacing: { before: 320 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'DCE2EA', space: 6 } },
        children: [
          text(
            [input.business.name, input.business.phone, input.business.email]
              .filter((part) => part && part.length > 0)
              .join('   ·   '),
            { size: SIZE.tiny, color: MUTED },
          ),
        ],
      }),
    );
  }

  return new Document({
    creator: input.business.name || 'CraftyDocs',
    title: `${input.document.type} ${input.document.number}`,
    description: 'Generated by CraftyDocs',
    styles: {
      default: {
        document: {
          run: {
            // §10.3: a font with rupee coverage. Word falls back per-glyph if absent.
            font: 'Noto Sans',
            size: SIZE.body,
            color: INK,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // A4 with §10.1's margins, in twentieths of a point.
            size: { width: 11906, height: 16838 },
            margin: { top: 907, bottom: 907, left: 1134, right: 1134 },
          },
        },
        children,
      },
    ],
  });
}

/**
 * Write the document as a `.docx` in the app cache.
 *
 * §10.3 prescribes `Packer.toBase64String()` plus a base64 write, which is what happens
 * here — `toBuffer` would need a working Node stream shim that React Native does not have.
 */
export async function exportDocx(
  input: RenderInput,
  filenameParts: Omit<FilenameParts, 'extension'>,
): Promise<GeneratedFile> {
  assertBufferPolyfill();

  const filename = buildExportFilename({ ...filenameParts, extension: 'docx' });
  const document = buildDocxDocument(input);
  const base64 = await Packer.toBase64String(document);

  const target = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  await FileSystem.writeAsStringAsync(target, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return { uri: target, filename, mimeType: MIME_TYPES.docx };
}
