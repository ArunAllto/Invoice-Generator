/**
 * `renderDocumentHtml` — the single source of truth for document output (spec §10.1).
 *
 * PDF, PNG and the on-screen preview all consume this one string. Divergence between
 * preview and export is defined as a bug, and the only way to guarantee that is for there
 * to be nothing to diverge: one function, one set of CSS, one pagination decision.
 *
 * ## Why pagination is computed here rather than left to the print engine
 *
 * §10.1 asks for "Page N of M" in the footer. CSS has `counter(page)` and
 * `counter(pages)`, but only inside `@page` margin boxes, which Chromium — the engine
 * behind both `expo-print` and the preview WebView — has never implemented. There is
 * therefore no way to print a page number by asking the engine for it.
 *
 * So this module paginates explicitly: it estimates the height of each row and block,
 * packs them into fixed-size `.page` elements, and writes the page numbers itself. Three
 * other §10.1 requirements fall out of that for free — the items table header repeats
 * because every page has its own `<thead>`, no line item can split across pages because
 * rows are never divided, and the terms/signature/footer group cannot break because it is
 * placed as a unit and moved to a fresh page when it does not fit.
 *
 * The estimator is deliberately conservative. Being slightly early with a page break
 * costs a little whitespace; being late would clip content off the bottom of a PDF, which
 * is not recoverable.
 *
 * This module is pure and synchronous. Fonts and images arrive pre-encoded via `options`.
 */

import type { CalcResult, TaxSummaryRow } from '../core/calc';
import { formatIsoDate, type DateDisplayStyle } from '../core/dates';
import { formatBasisPoints, formatMilli, formatPaise } from '../core/money';
import {
  A4_PAGE,
  type DocumentBlocks,
  type DocumentType,
  type PageGeometry,
  type Paise,
  type TaxMode,
  type TemplateId,
} from '../core/types';
import {
  contentHeightMm,
  contentWidthMm,
  cssPageSize,
  resolvePageGeometry,
} from '../core/page-size';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface RenderParty {
  name: string;
  company?: string | undefined;
  tagline?: string | undefined;
  addressLine1?: string | undefined;
  addressLine2?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  pincode?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
  gstin?: string | null | undefined;
  pan?: string | null | undefined;
  bankName?: string | null | undefined;
  bankAccountName?: string | null | undefined;
  bankAccountNo?: string | null | undefined;
  bankIfsc?: string | null | undefined;
  upiId?: string | null | undefined;
  signatureLabel?: string | undefined;
  customFields?: ReadonlyArray<{ label: string; value: string }> | undefined;
}

export interface RenderLine {
  name: string;
  description: string;
  hsnSac: string;
  qtyMilli: number;
  unit: string;
  rate: Paise;
  taxRateBp: number;
  discountBp: number;
  isFree: boolean;
}

export interface RenderDocument {
  type: DocumentType;
  number: string;
  status: string;
  issueDate: string;
  validUntil?: string | null | undefined;
  dueDate?: string | null | undefined;
  currency: string;
  taxMode: TaxMode;
  notes: string;
  terms: string;
  templateId: TemplateId;
  accentColor: string;
  amountInWords: string;
  paymentMethodLabel?: string | null | undefined;
  paymentReference?: string | null | undefined;
  paymentAmount?: Paise | null | undefined;
  customFields: ReadonlyArray<{ label: string; value: string }>;
  /** Invoices: total received and balance, printed under the grand total. */
  paidTotal?: Paise | undefined;
  balanceDue?: Paise | undefined;
  /** Shown as a watermark when the document is cancelled or a draft. */
  watermark?: string | null | undefined;
}

export interface RenderOptions {
  /** `@font-face` CSS and the family stack (see `src/export/fonts.ts`). */
  fontCss: string;
  fontFamily: string;
  /** `data:` URIs. Anything else would break §10.1's self-containment. */
  logoDataUri?: string | null | undefined;
  signatureDataUri?: string | null | undefined;
  /** Inline SVG markup for the UPI QR (§7.6). */
  upiQrSvg?: string | null | undefined;
  dateStyle?: DateDisplayStyle | undefined;
  /**
   * Fixed pixel width for image export (§10.4 asks for 1240px ≈ A4 at 150 DPI). When
   * set, the page is laid out in pixels rather than millimetres so `react-native-view-shot`
   * captures a predictable bitmap.
   */
  pixelWidth?: number | undefined;
  /**
   * The paper to lay the document out on (§10.1).
   *
   * Omitted means A4, which is what every document used before this was configurable — so an old
   * backup, or any caller that does not care, keeps exactly the layout it had.
   */
  page?: PageGeometry | undefined;
  /** Screen preview mode: drops the print-only page shadows and centring. */
  forScreen?: boolean | undefined;
  /**
   * Emit only this one page (1-based), while still numbering it against the whole document.
   *
   * Used by the image exporter, which §10.4 requires to produce one PNG per page. The full
   * document is paginated first either way, so page 2 of 3 still says "Page 2 of 3" and
   * carries exactly the rows the PDF puts there — the two formats cannot drift apart.
   */
  onlyPage?: number | undefined;
}

export interface RenderInput {
  document: RenderDocument;
  lines: readonly RenderLine[];
  business: RenderParty;
  client?: RenderParty | null | undefined;
  calc: CalcResult;
  blocks: DocumentBlocks;
  options: RenderOptions;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape text for HTML.
 *
 * Every string that reaches the template goes through this. A client called "Smith & Co"
 * or a note containing "<3" must not be able to break the document, and since the same
 * HTML is rendered in a WebView, unescaped input would be a script-injection route from
 * data the user pasted in.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape and convert newlines to `<br>`, for notes and terms. */
function escapeMultiline(value: string | null | undefined): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

// ---------------------------------------------------------------------------
// Template metrics
// ---------------------------------------------------------------------------

interface TemplateMetrics {
  /** Body font size in points. */
  fontPt: number;
  /** Estimated height of one item row with no description, in mm. */
  rowMm: number;
  /** Additional height per wrapped description line, in mm. */
  descriptionLineMm: number;
  /** Characters that fit on one description line at this size. */
  descriptionCharsPerLine: number;
  /** Characters of the item name that fit on one line. */
  nameCharsPerLine: number;
  /** Height of the letterhead block on page 1, in mm. */
  headerMm: number;
  /** Height of the smaller repeated header on later pages, in mm. */
  continuationHeaderMm: number;
  /** Height of the items table's own header row, in mm. */
  tableHeadMm: number;
  /**
   * Multiplier applied to the estimated height of the closing group.
   *
   * The closing blocks are laid out by the same markup in every template but the
   * per-template CSS changes their padding, so a single estimate would be wrong for the
   * dense templates. Compact in particular has to fit ~20 rows *and* its totals on one
   * page (§10.6), which it only does because its padding is roughly a fifth tighter.
   */
  closingScale: number;
}

const METRICS: Readonly<Record<TemplateId, TemplateMetrics>> = {
  classic: {
    fontPt: 9.5,
    rowMm: 8.4,
    descriptionLineMm: 4.0,
    descriptionCharsPerLine: 78,
    nameCharsPerLine: 46,
    headerMm: 52,
    continuationHeaderMm: 20,
    tableHeadMm: 9,
    closingScale: 1,
  },
  minimal: {
    fontPt: 9.5,
    rowMm: 9.0,
    descriptionLineMm: 4.2,
    descriptionCharsPerLine: 80,
    nameCharsPerLine: 48,
    headerMm: 50,
    continuationHeaderMm: 18,
    tableHeadMm: 8,
    closingScale: 1,
  },
  bold: {
    fontPt: 10,
    rowMm: 9.2,
    descriptionLineMm: 4.4,
    descriptionCharsPerLine: 72,
    nameCharsPerLine: 42,
    headerMm: 58,
    continuationHeaderMm: 22,
    tableHeadMm: 10,
    closingScale: 1.05,
  },
  // §10.6: Compact must fit ~20 line items on one page.
  compact: {
    fontPt: 8.5,
    rowMm: 6.2,
    descriptionLineMm: 3.4,
    descriptionCharsPerLine: 92,
    nameCharsPerLine: 54,
    headerMm: 38,
    continuationHeaderMm: 16,
    tableHeadMm: 7,
    closingScale: 0.74,
  },
};

/**
 * The page geometry for a render, defaulting to §10.1's A4.
 *
 * Resolved rather than trusted: this is the read path for every document, and a stored geometry with
 * margins wider than its own page would give pagination a negative content height to divide by.
 */
function pageOf(options: RenderOptions): PageGeometry {
  return options.page ? resolvePageGeometry(options.page) : A4_PAGE;
}

/** Height reserved for the page footer strip on every page. */
const FOOTER_MM = 10;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginatedRow {
  line: RenderLine;
  calcIndex: number;
  heightMm: number;
}

interface Page {
  rows: PaginatedRow[];
  /** Closing blocks (totals through footer) are rendered on the page holding them. */
  closing: boolean;
}

function estimateRowHeight(
  line: RenderLine,
  metrics: TemplateMetrics,
  showDescriptions: boolean,
): number {
  const nameLines = Math.max(1, Math.ceil(line.name.length / metrics.nameCharsPerLine));
  let height = metrics.rowMm + (nameLines - 1) * metrics.descriptionLineMm;

  if (showDescriptions && line.description.trim().length > 0) {
    // Explicit newlines each start a line; long lines wrap.
    const explicitLines = line.description.split(/\r?\n/);
    const wrapped = explicitLines.reduce(
      (total, text) => total + Math.max(1, Math.ceil(text.length / metrics.descriptionCharsPerLine)),
      0,
    );
    height += wrapped * metrics.descriptionLineMm;
  }
  return height;
}

/** Estimated height of everything from the totals block to the footer, in mm. */
function estimateClosingHeight(input: RenderInput, metrics: TemplateMetrics): number {
  const { document, blocks, calc, business, options } = input;

  let height = 6; // spacing above the totals block

  // Totals rows: subtotal is always shown, the rest depend on the toggles and the data.
  let totalRows = 2; // subtotal + grand total
  if (blocks.discountRow && calc.discountTotal > 0) totalRows += 1;
  if (document.taxMode === 'gst_intra') totalRows += 2;
  else if (document.taxMode === 'gst_inter' || document.taxMode === 'flat') totalRows += 1;
  if (blocks.shippingRow && calc.shipping > 0) totalRows += 1;
  if (blocks.roundOffRow && calc.roundOff !== 0) totalRows += 1;
  if (document.type === 'invoice' && (document.paidTotal ?? 0) > 0) totalRows += 2;
  height += totalRows * 6.2;

  if (blocks.amountInWords) height += 10;

  if (blocks.taxSummary && calc.showTaxSummary) {
    height += 10 + calc.taxSummary.length * 6;
  }

  if (blocks.notes && document.notes.trim().length > 0) {
    height += 8 + countWrappedLines(document.notes, metrics.descriptionCharsPerLine) * 4;
  }

  if (blocks.terms && document.terms.trim().length > 0) {
    height += 8 + countWrappedLines(document.terms, metrics.descriptionCharsPerLine) * 4;
  }

  const showBank =
    blocks.bankDetails &&
    Boolean(business.bankName || business.bankAccountNo || business.upiId);
  const showQr = blocks.upiQr && Boolean(options.upiQrSvg);
  if (showBank || showQr) height += Math.max(showQr ? 34 : 0, showBank ? 26 : 0);

  if (blocks.signature) height += 28;

  return height * metrics.closingScale;
}

function countWrappedLines(text: string, charsPerLine: number): number {
  return text
    .split(/\r?\n/)
    .reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}

/**
 * Pack rows into pages, then place the closing blocks.
 *
 * The closing group is treated as indivisible: if it does not fit under the last row it
 * gets a page of its own. That satisfies §10.1's "Terms, signature, and footer blocks
 * must not break across pages" without needing the engine's cooperation.
 */
function paginate(input: RenderInput): Page[] {
  const metrics = METRICS[input.document.templateId];
  const rows: PaginatedRow[] = input.lines.map((line, index) => ({
    line,
    calcIndex: index,
    heightMm: estimateRowHeight(line, metrics, input.blocks.descriptions),
  }));

  const closingMm = estimateClosingHeight(input, metrics);
  const pages: Page[] = [];

  let current: Page = { rows: [], closing: false };
  let used = metrics.headerMm + metrics.tableHeadMm;
  // Derived from the chosen paper, which is the whole point of making it configurable: an A5 sheet
  // has to fit fewer rows per page, and the row count is what decides that.
  const available = contentHeightMm(pageOf(input.options)) - FOOTER_MM;

  for (const row of rows) {
    if (current.rows.length > 0 && used + row.heightMm > available) {
      pages.push(current);
      current = { rows: [], closing: false };
      used = metrics.continuationHeaderMm + metrics.tableHeadMm;
    }
    current.rows.push(row);
    used += row.heightMm;
  }
  pages.push(current);

  const last = pages[pages.length - 1];
  if (last && used + closingMm <= available) {
    last.closing = true;
  } else {
    pages.push({ rows: [], closing: true });
  }

  return pages;
}

// ---------------------------------------------------------------------------
// Column model
// ---------------------------------------------------------------------------

interface ColumnPlan {
  showHsn: boolean;
  showUnit: boolean;
  showQty: boolean;
  showRate: boolean;
  showTax: boolean;
  showDiscount: boolean;
}

function planColumns(input: RenderInput): ColumnPlan {
  const { blocks, document, lines } = input;
  const anyLineDiscount = lines.some((line) => line.discountBp > 0);
  return {
    showHsn: blocks.hsnColumn && lines.some((line) => line.hsnSac.trim().length > 0),
    showUnit: blocks.unitColumn,
    showQty: true,
    showRate: true,
    // §9.2: tax mode 'none' means no tax columns anywhere.
    showTax: blocks.taxColumns && document.taxMode !== 'none',
    showDiscount: anyLineDiscount,
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const TYPE_TITLES: Readonly<Record<DocumentType, string>> = {
  quotation: 'QUOTATION',
  invoice: 'INVOICE',
  receipt: 'RECEIPT',
};

function money(amount: Paise, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : '';
  return `${symbol}${formatPaise(amount)}`;
}

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

export function renderDocumentHtml(input: RenderInput): string {
  const { document, business, blocks, options } = input;
  const metrics = METRICS[document.templateId];
  const columns = planColumns(input);
  const pages = paginate(input);
  const accent = sanitiseColor(document.accentColor);

  // `onlyPage` narrows what is emitted without changing how it was paginated, so a
  // single-page capture still reports its true position in the document.
  const wanted = options.onlyPage;
  const body = pages
    .map((page, index) => ({ page, index }))
    .filter(({ index }) => wanted === undefined || index === wanted - 1)
    .map(({ page, index }) =>
      renderPage({
        input,
        page,
        pageNumber: index + 1,
        pageCount: pages.length,
        columns,
        isFirst: index === 0,
        accent,
      }),
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${TYPE_TITLES[document.type]} ${document.number}`)}</title>
<style>
${options.fontCss}
${baseCss(metrics, options, accent)}
${templateCss(document.templateId, accent)}
</style>
</head>
<body class="tpl-${escapeHtml(document.templateId)}${options.forScreen ? ' screen' : ''}">
${body}
</body>
</html>`;

  function renderPage(args: {
    input: RenderInput;
    page: Page;
    pageNumber: number;
    pageCount: number;
    columns: ColumnPlan;
    isFirst: boolean;
    accent: string;
  }): string {
    const { page, pageNumber, pageCount, isFirst } = args;

    const parts: string[] = [];
    parts.push(isFirst ? renderLetterhead(input, accent) : renderContinuationHeader(input));
    if (isFirst) parts.push(renderMetaBlock(input));
    if (page.rows.length > 0) parts.push(renderItemsTable(input, page.rows, args.columns));
    if (page.closing) parts.push(renderClosing(input));

    const watermark = document.watermark
      ? `<div class="watermark">${escapeHtml(document.watermark)}</div>`
      : '';

    return `<section class="page${pageNumber === pageCount ? ' last' : ''}">
  ${watermark}
  <div class="page-body">
${parts.join('\n')}
  </div>
  <footer class="page-footer">
    <span class="footer-left">${
      blocks.footerLine
        ? escapeHtml(
            [business.name, business.phone, business.email].filter((v) => v && v.length > 0).join('  ·  '),
          )
        : ''
    }</span>
    <span class="footer-right">Page ${pageNumber} of ${pageCount}</span>
  </footer>
</section>`;
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function renderLetterhead(input: RenderInput, accent: string): string {
  const { business, document, options } = input;
  void accent;

  const logo = options.logoDataUri
    ? `<img class="logo" src="${escapeHtml(options.logoDataUri)}" alt="">`
    : '';

  const addressLines = [
    business.addressLine1,
    business.addressLine2,
    [business.city, business.state, business.pincode].filter((v) => v && v.trim().length > 0).join(' '),
  ].filter((line): line is string => Boolean(line && line.trim().length > 0));

  const contactLines = [
    business.phone ? `Phone: ${business.phone}` : '',
    business.email ? `Email: ${business.email}` : '',
    business.website ? business.website : '',
  ].filter((line) => line.length > 0);

  // §9.2/§9.4: no GSTIN is printed anywhere when there is no tax on the document.
  const taxIds = [
    document.taxMode !== 'none' && business.gstin ? `GSTIN: ${business.gstin}` : '',
    business.pan ? `PAN: ${business.pan}` : '',
  ].filter((line) => line.length > 0);

  return `<header class="letterhead">
  <div class="brand">
    ${logo}
    <div class="brand-text">
      <h1 class="business-name">${escapeHtml(business.name)}</h1>
      ${business.tagline ? `<p class="tagline">${escapeHtml(business.tagline)}</p>` : ''}
    </div>
  </div>
  <div class="brand-contact">
    ${addressLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    ${contactLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
    ${taxIds.map((line) => `<p class="tax-id">${escapeHtml(line)}</p>`).join('')}
  </div>
</header>
<div class="title-bar">
  <h2 class="doc-title">${escapeHtml(TYPE_TITLES[document.type])}</h2>
</div>`;
}

function renderContinuationHeader(input: RenderInput): string {
  const { business, document } = input;
  return `<header class="letterhead continuation">
  <div class="brand-text">
    <h1 class="business-name">${escapeHtml(business.name)}</h1>
  </div>
  <div class="continuation-meta">
    <span>${escapeHtml(TYPE_TITLES[document.type])}</span>
    ${document.number ? `<span>${escapeHtml(document.number)}</span>` : ''}
    <span>continued</span>
  </div>
</header>`;
}

function renderMetaBlock(input: RenderInput): string {
  const { document, client, blocks, options } = input;
  const dateStyle = options.dateStyle ?? 'dd MMM yyyy';

  const metaRows: Array<[string, string]> = [];
  if (document.number) metaRows.push(['No.', document.number]);
  metaRows.push(['Date', formatIsoDate(document.issueDate, dateStyle)]);
  if (document.type === 'quotation' && document.validUntil) {
    metaRows.push(['Valid until', formatIsoDate(document.validUntil, dateStyle)]);
  }
  if (document.type === 'invoice' && document.dueDate) {
    metaRows.push(['Due date', formatIsoDate(document.dueDate, dateStyle)]);
  }
  if (document.type === 'receipt' && document.paymentMethodLabel) {
    metaRows.push(['Paid by', document.paymentMethodLabel]);
  }
  if (document.type === 'receipt' && document.paymentReference) {
    metaRows.push(['Reference', document.paymentReference]);
  }
  for (const field of document.customFields) {
    if (field.label.trim().length > 0 && field.value.trim().length > 0) {
      metaRows.push([field.label, field.value]);
    }
  }

  // §7.4: with the client block off, the layout must still look deliberate — so the meta
  // panel widens to fill the row rather than leaving a gap where the client used to be.
  const showClient = blocks.clientBlock && client !== null && client !== undefined;

  const clientBlock = showClient
    ? `<div class="party">
        <p class="party-label">${escapeHtml(document.type === 'receipt' ? 'Received from' : 'Billed to')}</p>
        <p class="party-name">${escapeHtml(client.company || client.name)}</p>
        ${client.company && client.name ? `<p>${escapeHtml(client.name)}</p>` : ''}
        ${[
          client.addressLine1,
          client.addressLine2,
          [client.city, client.state, client.pincode].filter((v) => v && v.trim().length > 0).join(' '),
        ]
          .filter((line): line is string => Boolean(line && line.trim().length > 0))
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('')}
        ${client.phone ? `<p>${escapeHtml(client.phone)}</p>` : ''}
        ${client.email ? `<p>${escapeHtml(client.email)}</p>` : ''}
        ${
          document.taxMode !== 'none' && client.gstin
            ? `<p class="tax-id">GSTIN: ${escapeHtml(client.gstin)}</p>`
            : ''
        }
        ${(client.customFields ?? [])
          .filter((f) => f.label.trim().length > 0 && f.value.trim().length > 0)
          .map((f) => `<p>${escapeHtml(f.label)}: ${escapeHtml(f.value)}</p>`)
          .join('')}
      </div>`
    : '';

  return `<div class="meta-row${showClient ? '' : ' no-client'}">
  ${clientBlock}
  <div class="meta">
    <table class="meta-table">
      ${metaRows
        .map(
          ([label, value]) =>
            `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
        )
        .join('')}
    </table>
  </div>
</div>`;
}

function renderItemsTable(
  input: RenderInput,
  rows: readonly PaginatedRow[],
  columns: ColumnPlan,
): string {
  const { document, calc, blocks } = input;
  const currency = document.currency;

  const headCells: string[] = ['<th class="col-sn">#</th>', '<th class="col-desc">Description</th>'];
  if (columns.showHsn) headCells.push('<th class="col-hsn">HSN/SAC</th>');
  if (columns.showQty) headCells.push('<th class="col-qty">Qty</th>');
  if (columns.showUnit) headCells.push('<th class="col-unit">Unit</th>');
  if (columns.showRate) headCells.push('<th class="col-rate">Rate</th>');
  if (columns.showDiscount) headCells.push('<th class="col-disc">Disc.</th>');
  if (columns.showTax) headCells.push('<th class="col-tax">Tax</th>');
  headCells.push('<th class="col-amount">Amount</th>');

  const bodyRows = rows
    .map((row) => {
      const line = row.line;
      const lineCalc = calc.lines[row.calcIndex];
      const cells: string[] = [
        `<td class="col-sn">${row.calcIndex + 1}</td>`,
        `<td class="col-desc"><span class="item-name">${escapeHtml(line.name)}</span>${
          blocks.descriptions && line.description.trim().length > 0
            ? `<span class="item-desc">${escapeMultiline(line.description)}</span>`
            : ''
        }</td>`,
      ];
      if (columns.showHsn) cells.push(`<td class="col-hsn">${escapeHtml(line.hsnSac)}</td>`);
      if (columns.showQty) cells.push(`<td class="col-qty">${escapeHtml(formatMilli(line.qtyMilli))}</td>`);
      if (columns.showUnit) cells.push(`<td class="col-unit">${escapeHtml(line.unit)}</td>`);
      if (columns.showRate) {
        cells.push(`<td class="col-rate">${line.isFree ? '—' : escapeHtml(money(line.rate, currency))}</td>`);
      }
      if (columns.showDiscount) {
        cells.push(
          `<td class="col-disc">${
            line.discountBp > 0 ? `${escapeHtml(formatBasisPoints(line.discountBp))}%` : '—'
          }</td>`,
        );
      }
      if (columns.showTax) {
        cells.push(
          `<td class="col-tax">${
            (lineCalc?.effectiveTaxRateBp ?? 0) > 0
              ? `${escapeHtml(formatBasisPoints(lineCalc?.effectiveTaxRateBp ?? 0))}%`
              : '—'
          }</td>`,
        );
      }
      // §7.3: a complimentary line prints FREE in the amount column and keeps its
      // description, rather than being faked with a zero rate.
      cells.push(
        `<td class="col-amount">${
          line.isFree
            ? '<span class="free-badge">FREE</span>'
            : escapeHtml(money(lineCalc?.lineTotal ?? 0, currency))
        }</td>`,
      );

      return `<tr>${cells.join('')}</tr>`;
    })
    .join('\n');

  return `<table class="items">
  <thead><tr>${headCells.join('')}</tr></thead>
  <tbody>
${bodyRows}
  </tbody>
</table>`;
}

function renderClosing(input: RenderInput): string {
  const { document, business, calc, blocks, options } = input;
  const currency = document.currency;

  const totalRows: string[] = [];
  const push = (label: string, value: string, cls = ''): void => {
    totalRows.push(
      `<tr class="${cls}"><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`,
    );
  };

  push('Subtotal', money(calc.subtotal, currency));
  if (blocks.discountRow && calc.discountTotal > 0) {
    push('Discount', `− ${money(calc.discountTotal, currency)}`);
  }
  if (calc.discountTotal > 0) push('Taxable value', money(calc.taxBase, currency));

  if (document.taxMode === 'gst_intra') {
    push('CGST', money(calc.cgstTotal, currency));
    push('SGST', money(calc.sgstTotal, currency));
  } else if (document.taxMode === 'gst_inter') {
    push('IGST', money(calc.igstTotal, currency));
  } else if (document.taxMode === 'flat') {
    push('Tax', money(calc.taxTotal, currency));
  }

  if (blocks.shippingRow && calc.shipping > 0) push('Delivery', money(calc.shipping, currency));
  if (blocks.roundOffRow && calc.roundOff !== 0) {
    push('Round off', `${calc.roundOff > 0 ? '+ ' : '− '}${money(Math.abs(calc.roundOff), currency)}`);
  }
  push('Total', money(calc.grandTotal, currency), 'grand');

  if (document.type === 'invoice' && (document.paidTotal ?? 0) > 0) {
    push('Received', money(document.paidTotal ?? 0, currency));
    push('Balance due', money(document.balanceDue ?? 0, currency), 'balance');
  }

  const totalsBlock = `<div class="totals">
    <table class="totals-table">${totalRows.join('')}</table>
  </div>`;

  const wordsBlock =
    blocks.amountInWords && document.amountInWords
      ? `<div class="in-words"><span class="in-words-label">Amount in words</span><span class="in-words-value">${escapeHtml(
          document.amountInWords,
        )}</span></div>`
      : '';

  const taxSummaryBlock =
    blocks.taxSummary && calc.showTaxSummary ? renderTaxSummary(calc.taxSummary, document) : '';

  const notesBlock =
    blocks.notes && document.notes.trim().length > 0
      ? `<div class="block notes"><h3>Notes</h3><p>${escapeMultiline(document.notes)}</p></div>`
      : '';

  const termsBlock =
    blocks.terms && document.terms.trim().length > 0
      ? `<div class="block terms"><h3>Terms &amp; conditions</h3><p>${escapeMultiline(
          document.terms,
        )}</p></div>`
      : '';

  const bankLines = [
    business.bankName ? `Bank: ${business.bankName}` : '',
    business.bankAccountName ? `Account name: ${business.bankAccountName}` : '',
    business.bankAccountNo ? `Account no.: ${business.bankAccountNo}` : '',
    business.bankIfsc ? `IFSC: ${business.bankIfsc}` : '',
    business.upiId ? `UPI: ${business.upiId}` : '',
  ].filter((line) => line.length > 0);

  const showBank = blocks.bankDetails && bankLines.length > 0;
  const showQr = blocks.upiQr && Boolean(options.upiQrSvg);

  const payBlock =
    showBank || showQr
      ? `<div class="block pay">
          ${
            showBank
              ? `<div class="bank"><h3>Payment details</h3>${bankLines
                  .map((line) => `<p>${escapeHtml(line)}</p>`)
                  .join('')}</div>`
              : ''
          }
          ${
            showQr
              ? `<div class="qr"><div class="qr-image">${options.upiQrSvg ?? ''}</div><p class="qr-caption">Scan to pay</p></div>`
              : ''
          }
        </div>`
      : '';

  const signatureBlock = blocks.signature
    ? `<div class="block signature">
        ${
          options.signatureDataUri
            ? `<img class="signature-image" src="${escapeHtml(options.signatureDataUri)}" alt="">`
            : '<div class="signature-line"></div>'
        }
        <p class="signature-label">${escapeHtml(business.signatureLabel || 'Authorised Signatory')}</p>
        <p class="signature-for">for ${escapeHtml(business.name)}</p>
      </div>`
    : '';

  // Kept as one `.closing` element so the group moves together — §10.1 forbids breaking
  // the terms, signature and footer blocks across pages.
  return `<div class="closing">
  ${taxSummaryBlock}
  ${totalsBlock}
  ${wordsBlock}
  <div class="closing-columns">
    <div class="closing-left">
      ${notesBlock}
      ${termsBlock}
      ${payBlock}
    </div>
    <div class="closing-right">
      ${signatureBlock}
    </div>
  </div>
</div>`;
}

function renderTaxSummary(rows: readonly TaxSummaryRow[], document: RenderDocument): string {
  const intra = document.taxMode === 'gst_intra';
  const currency = document.currency;

  const head = intra
    ? '<tr><th>HSN/SAC</th><th>Taxable</th><th>Rate</th><th>CGST</th><th>SGST</th><th>Total tax</th></tr>'
    : '<tr><th>HSN/SAC</th><th>Taxable</th><th>Rate</th><th>IGST</th><th>Total tax</th></tr>';

  const body = rows
    .map((row) => {
      const cells = [
        `<td>${escapeHtml(row.hsnSac || '—')}</td>`,
        `<td>${escapeHtml(money(row.taxableValue, currency))}</td>`,
        `<td>${escapeHtml(formatBasisPoints(row.taxRateBp))}%</td>`,
      ];
      if (intra) {
        cells.push(`<td>${escapeHtml(money(row.cgst, currency))}</td>`);
        cells.push(`<td>${escapeHtml(money(row.sgst, currency))}</td>`);
      } else {
        cells.push(`<td>${escapeHtml(money(row.igst, currency))}</td>`);
      }
      cells.push(`<td>${escapeHtml(money(row.totalTax, currency))}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  return `<div class="block tax-summary">
    <h3>Tax summary</h3>
    <table class="tax-summary-table"><thead>${head}</thead><tbody>${body}</tbody></table>
  </div>`;
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/** Only allow a hex colour through to the stylesheet. */
function sanitiseColor(value: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value.trim()) ? value.trim() : '#0F4C81';
}

function baseCss(metrics: TemplateMetrics, options: RenderOptions, accent: string): string {
  const pixelMode = typeof options.pixelWidth === 'number' && options.pixelWidth > 0;
  const page = pageOf(options);
  // Scale millimetres to pixels for the image path (§10.4), against the *chosen* page width — a
  // fixed 210 would squash a Letter page and stretch an A5 one.
  const scale = pixelMode ? (options.pixelWidth ?? 1240) / page.widthMm : 1;
  const unit = (mm: number): string => (pixelMode ? `${(mm * scale).toFixed(2)}px` : `${mm}mm`);
  const fontSize = pixelMode
    ? `${((metrics.fontPt * 4 * scale) / 3 / 3.7795).toFixed(2)}px`
    : `${metrics.fontPt}pt`;

  return `
@page { size: ${cssPageSize(page)}; margin: ${page.marginYMm}mm ${page.marginXMm}mm; }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

body {
  font-family: ${options.fontFamily};
  font-size: ${fontSize};
  line-height: 1.42;
  color: #14181F;
  background: #FFFFFF;
  /* §10.1: keep background fills when printing. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.page {
  position: relative;
  width: ${unit(contentWidthMm(page))};
  min-height: ${unit(contentHeightMm(page))};
  margin: 0 auto;
  padding: 0;
  page-break-after: always;
  break-after: page;
  display: flex;
  flex-direction: column;
}
.page.last { page-break-after: auto; break-after: auto; }
.page-body { flex: 1 1 auto; }

/* On screen the pages sit on a grey field with a little separation, so the preview reads
   as paper. In print this is all inert. */
body.screen { background: #EEF1F5; padding: ${unit(6)} 0; }
body.screen .page {
  background: #FFFFFF;
  padding: ${unit(page.marginYMm)} ${unit(page.marginXMm)};
  width: ${unit(page.widthMm)};
  margin: 0 auto ${unit(6)};
  box-shadow: 0 1px 6px rgba(15, 26, 42, 0.18);
}

.page-footer {
  margin-top: ${unit(4)};
  padding-top: ${unit(2)};
  border-top: 0.4mm solid #DCE2EA;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.78em;
  color: #5A6472;
  page-break-inside: avoid;
  break-inside: avoid;
}

.watermark {
  position: absolute;
  top: 45%;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 4.2em;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: rgba(20, 24, 31, 0.07);
  transform: rotate(-22deg);
  pointer-events: none;
  z-index: 0;
}

/* Letterhead ------------------------------------------------------------- */
.letterhead { display: flex; justify-content: space-between; align-items: flex-start; gap: ${unit(6)}; }
.brand { display: flex; align-items: flex-start; gap: ${unit(4)}; }
/* §7.1: logo prints at a maximum height of 22mm with the aspect ratio preserved. */
.logo { max-height: ${unit(22)}; max-width: ${unit(55)}; object-fit: contain; }
.business-name { margin: 0; font-size: 1.5em; font-weight: 600; letter-spacing: 0.01em; }
.tagline { margin: ${unit(1)} 0 0; color: #5A6472; font-size: 0.9em; }
.brand-contact { text-align: right; font-size: 0.85em; color: #5A6472; max-width: 46%; }
.brand-contact p { margin: 0; }
.brand-contact .tax-id { color: #14181F; font-weight: 600; margin-top: ${unit(1)}; }

.letterhead.continuation { align-items: center; padding-bottom: ${unit(2)}; border-bottom: 0.3mm solid #DCE2EA; }
.letterhead.continuation .business-name { font-size: 1.05em; }
.continuation-meta { display: flex; gap: ${unit(3)}; font-size: 0.8em; color: #5A6472; }

.title-bar { margin-top: ${unit(4)}; }
.doc-title { margin: 0; font-size: 1.35em; font-weight: 600; letter-spacing: 0.16em; color: ${accent}; }

/* Meta row --------------------------------------------------------------- */
.meta-row { display: flex; justify-content: space-between; gap: ${unit(8)}; margin-top: ${unit(4)}; }
.meta-row.no-client { justify-content: flex-start; }
.party { max-width: 55%; }
.party-label { margin: 0 0 ${unit(1)}; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: #5A6472; }
.party-name { margin: 0; font-weight: 600; font-size: 1.05em; }
.party p { margin: 0; }
.party .tax-id { margin-top: ${unit(1)}; font-weight: 600; }
.meta { min-width: ${unit(58)}; }
.meta-table { border-collapse: collapse; width: 100%; }
.meta-table th, .meta-table td { padding: ${unit(0.8)} 0; font-size: 0.88em; vertical-align: top; }
.meta-table th { text-align: left; color: #5A6472; font-weight: 400; padding-right: ${unit(3)}; white-space: nowrap; }
.meta-table td { text-align: right; font-weight: 600; }

/* Items table ------------------------------------------------------------ */
.items { width: 100%; border-collapse: collapse; margin-top: ${unit(5)}; }
/* §10.1: the header repeats on every page and no row splits across pages. */
.items thead { display: table-header-group; }
.items tfoot { display: table-footer-group; }
.items tr { page-break-inside: avoid; break-inside: avoid; }
.items th {
  text-align: left;
  font-size: 0.8em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: ${unit(2)} ${unit(1.6)};
  white-space: nowrap;
}
.items td { padding: ${unit(1.8)} ${unit(1.6)}; vertical-align: top; }
.items .col-sn { width: ${unit(8)}; text-align: right; color: #5A6472; }
.items .col-desc { width: auto; }
.items .col-hsn { width: ${unit(18)}; }
.items .col-qty, .items .col-unit { width: ${unit(14)}; text-align: right; white-space: nowrap; }
.items .col-unit { text-align: left; }
.items .col-rate, .items .col-amount { width: ${unit(24)}; text-align: right; white-space: nowrap; }
.items .col-disc, .items .col-tax { width: ${unit(14)}; text-align: right; white-space: nowrap; }
.items .col-amount { font-weight: 600; }
.item-name { display: block; }
.item-desc { display: block; margin-top: ${unit(0.8)}; font-size: 0.86em; color: #5A6472; }
.free-badge { font-weight: 600; letter-spacing: 0.06em; color: ${accent}; }

/* Closing ---------------------------------------------------------------- */
.closing { margin-top: ${unit(5)}; page-break-inside: avoid; break-inside: avoid; }
.totals { display: flex; justify-content: flex-end; }
.totals-table { border-collapse: collapse; min-width: ${unit(72)}; }
.totals-table th, .totals-table td { padding: ${unit(1.3)} ${unit(2)}; font-size: 0.95em; }
.totals-table th { text-align: left; font-weight: 400; color: #5A6472; }
.totals-table td { text-align: right; font-weight: 600; white-space: nowrap; }
.totals-table tr.grand th, .totals-table tr.grand td { font-size: 1.16em; font-weight: 600; color: ${accent}; }
.totals-table tr.balance th, .totals-table tr.balance td { font-weight: 600; }

.in-words { margin-top: ${unit(3)}; display: flex; gap: ${unit(3)}; align-items: baseline; }
.in-words-label { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: #5A6472; white-space: nowrap; }
.in-words-value { font-weight: 600; }

.closing-columns { display: flex; justify-content: space-between; gap: ${unit(8)}; margin-top: ${unit(5)}; }
.closing-left { flex: 1 1 auto; max-width: 62%; }
.closing-right { flex: 0 0 auto; width: ${unit(52)}; }

.block { margin-top: ${unit(4)}; page-break-inside: avoid; break-inside: avoid; }
.block h3 { margin: 0 0 ${unit(1.4)}; font-size: 0.82em; text-transform: uppercase; letter-spacing: 0.08em; color: #5A6472; }
.block p { margin: 0; font-size: 0.9em; }
.terms p { color: #3C4553; }

.pay { display: flex; gap: ${unit(6)}; align-items: flex-start; }
.qr-image svg { width: ${unit(26)}; height: ${unit(26)}; display: block; }
.qr-caption { margin-top: ${unit(1)}; font-size: 0.78em; color: #5A6472; text-align: center; }

.signature { text-align: center; page-break-inside: avoid; break-inside: avoid; }
/* §7.2: signature prints at a maximum height of 18mm above the label. */
.signature-image { max-height: ${unit(18)}; max-width: 100%; object-fit: contain; }
.signature-line { height: ${unit(18)}; border-bottom: 0.35mm solid #8A93A1; }
.signature-label { margin: ${unit(1.5)} 0 0; font-weight: 600; font-size: 0.9em; }
.signature-for { margin: 0; font-size: 0.8em; color: #5A6472; }

.tax-summary-table { width: 100%; border-collapse: collapse; margin-top: ${unit(1)}; }
.tax-summary-table th, .tax-summary-table td { padding: ${unit(1.2)} ${unit(1.6)}; font-size: 0.85em; text-align: right; }
.tax-summary-table th:first-child, .tax-summary-table td:first-child { text-align: left; }
`;
}

/**
 * Per-template styling (§10.6). All four share the structure above and differ only here,
 * which is what guarantees "switching template does not change any number".
 */
function templateCss(template: TemplateId, accent: string): string {
  switch (template) {
    case 'minimal':
      return `
.tpl-minimal .doc-title { letter-spacing: 0.22em; font-weight: 400; color: #14181F; }
.tpl-minimal .items th { border-bottom: 0.35mm solid #14181F; color: #14181F; }
.tpl-minimal .items td { border-bottom: 0.2mm solid #E6EAF0; }
.tpl-minimal .totals-table tr.grand th, .tpl-minimal .totals-table tr.grand td {
  border-top: 0.35mm solid #14181F; color: #14181F;
}
.tpl-minimal .title-bar { border-bottom: 0.2mm solid #DCE2EA; padding-bottom: 2mm; }
.tpl-minimal .tax-summary-table th { border-bottom: 0.2mm solid #DCE2EA; }
`;

    case 'bold':
      return `
.tpl-bold .letterhead {
  background: ${accent};
  color: #FFFFFF;
  padding: 6mm;
  margin: 0 0 4mm;
  border-radius: 1.5mm;
}
.tpl-bold .letterhead .tagline,
.tpl-bold .letterhead .brand-contact { color: rgba(255,255,255,0.86); }
.tpl-bold .letterhead .brand-contact .tax-id { color: #FFFFFF; }
.tpl-bold .letterhead.continuation { background: ${accent}; color: #FFFFFF; padding: 3mm 6mm; }
.tpl-bold .letterhead.continuation .continuation-meta { color: rgba(255,255,255,0.86); }
.tpl-bold .doc-title { font-size: 2.1em; letter-spacing: 0.1em; }
.tpl-bold .items thead tr { background: ${accent}; }
.tpl-bold .items th { color: #FFFFFF; }
.tpl-bold .items tbody tr:nth-child(even) { background: #F6F8FA; }
.tpl-bold .totals-table tr.grand th, .tpl-bold .totals-table tr.grand td {
  background: ${accent}; color: #FFFFFF; font-size: 1.25em;
}
.tpl-bold .tax-summary-table thead tr { background: #EEF1F5; }
`;

    case 'compact':
      return `
.tpl-compact .doc-title { font-size: 1.1em; }
.tpl-compact .items th { background: #EEF1F5; border-bottom: 0.3mm solid ${accent}; }
.tpl-compact .items td { border-bottom: 0.15mm solid #E6EAF0; }
.tpl-compact .items th, .tpl-compact .items td { padding: 1mm 1.2mm; }
.tpl-compact .item-desc { font-size: 0.8em; }
.tpl-compact .closing { margin-top: 3mm; }
.tpl-compact .block { margin-top: 2.5mm; }
.tpl-compact .totals-table th, .tpl-compact .totals-table td { padding: 0.8mm 1.6mm; }
.tpl-compact .tax-summary-table th, .tpl-compact .tax-summary-table td { padding: 0.8mm 1.2mm; }
`;

    case 'classic':
    default:
      // §10.6: the owner's existing house style — navy accent bar, header-row table,
      // boxed totals.
      return `
.tpl-classic .title-bar {
  border-top: 1.2mm solid ${accent};
  padding-top: 2.5mm;
  margin-top: 5mm;
}
.tpl-classic .items thead tr { background: ${accent}; }
.tpl-classic .items th { color: #FFFFFF; }
.tpl-classic .items td { border-bottom: 0.2mm solid #DCE2EA; }
.tpl-classic .items tbody tr:last-child td { border-bottom: 0.35mm solid ${accent}; }
.tpl-classic .totals { margin-top: 3mm; }
.tpl-classic .totals-table {
  border: 0.3mm solid #DCE2EA;
  background: #F6F8FA;
}
.tpl-classic .totals-table tr.grand th, .tpl-classic .totals-table tr.grand td {
  background: ${accent};
  color: #FFFFFF;
}
.tpl-classic .party-label { color: ${accent}; font-weight: 600; }
.tpl-classic .tax-summary-table thead tr { background: #EEF1F5; }
.tpl-classic .tax-summary-table th, .tpl-classic .tax-summary-table td {
  border-bottom: 0.2mm solid #DCE2EA;
}
`;
  }
}

/**
 * How many pages the document will produce.
 *
 * Exposed so the image exporter can create one PNG per page (§10.4) without re-deriving
 * the layout, and so the export sheet can warn about a long document before generating.
 */
export function countPages(input: RenderInput): number {
  return paginate(input).length;
}
