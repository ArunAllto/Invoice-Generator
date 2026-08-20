/**
 * Export filenames — spec §10.2.
 *
 * Pattern: `{Type}-{Number-sanitised}-{ClientOrBusiness}.{ext}`, e.g.
 * `Quotation-CP-Q-2026-001-Acme-Traders.pdf`.
 *
 * Sanitising matters more than it looks: a document number like `CP/Q/2026-27/001`
 * contains forward slashes, and a filename containing those either fails to write or is
 * silently interpreted as a directory path. Android's SAF and the share sheet are both
 * unforgiving here.
 */

import type { DocumentType } from '../core/types';

const TYPE_LABELS: Readonly<Record<DocumentType, string>> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  receipt: 'Receipt',
};

/**
 * Replace the characters §10.2 lists — `/ \ : * ? " < > |` — plus whitespace, with a
 * hyphen, then collapse repeats.
 *
 * Also strips leading dots so a name can never begin one (a hidden file on Android) and
 * trims trailing dots and spaces, which Windows rejects when the file is later copied to a
 * computer.
 */
export function sanitiseFilenamePart(value: string): string {
  return value
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    // Control characters survive the class above and break some file pickers.
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.\s]+$/, '');
}

/**
 * Extensions an export can carry.
 *
 * `html` is the self-contained single-file export of §10.1 — the one format the app can produce
 * without a third-party library, since `render/html.ts` already inlines the stylesheet and every
 * image as a `data:` URI.
 */
export type ExportExtension = 'pdf' | 'docx' | 'png' | 'jpg' | 'html';

export interface FilenameParts {
  type: DocumentType;
  number: string;
  clientName?: string | null;
  businessName?: string | null;
  extension: ExportExtension;
  /** Page suffix for multi-page image exports: 1 produces `-p1` (§10.4). */
  page?: number | null;
  pageCount?: number | null;
}

/** Longest filename before the base name is truncated. */
const MAX_BASE_LENGTH = 90;

export function buildExportFilename(parts: FilenameParts): string {
  const segments = [
    TYPE_LABELS[parts.type],
    sanitiseFilenamePart(parts.number || 'Draft'),
    sanitiseFilenamePart(parts.clientName?.trim() || parts.businessName?.trim() || ''),
  ].filter((segment) => segment.length > 0);

  let base = segments.join('-').replace(/-{2,}/g, '-');

  // Only add the page suffix when there is more than one page, so a single-page PNG is
  // not gratuitously called `-p1`.
  if (parts.page && (parts.pageCount ?? 1) > 1) base += `-p${parts.page}`;

  if (base.length > MAX_BASE_LENGTH) base = base.slice(0, MAX_BASE_LENGTH).replace(/[-.]+$/, '');
  if (base.length === 0) base = TYPE_LABELS[parts.type];

  return `${base}.${parts.extension}`;
}

export const MIME_TYPES: Readonly<Record<ExportExtension, string>> = {
  pdf: 'application/pdf',
  html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
};
