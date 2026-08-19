/**
 * PDF export — spec §10.2.
 *
 * `expo-print`'s `printToFileAsync` renders the HTML through the OS print engine, which
 * produces a real vector PDF: text stays selectable and the ₹ glyph is embedded from the
 * font rather than rasterised.
 */

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';

import { renderDocumentHtml, type RenderInput } from '../render/html';
import { buildExportFilename, type FilenameParts } from './filename';

/** A4 at 72dpi in points, as §10.2 specifies for `printToFileAsync`. */
export const A4_POINTS = { width: 595, height: 842 } as const;

export interface GeneratedFile {
  uri: string;
  filename: string;
  mimeType: string;
}

/**
 * Render a document to a PDF in the app cache and return its URI.
 *
 * `printToFileAsync` writes to a temporary name of its own choosing, so the file is moved
 * to the §10.2 filename afterwards — the name is what the recipient sees in WhatsApp or
 * Gmail, so it has to be right.
 */
export async function exportPdf(
  input: RenderInput,
  filenameParts: Omit<FilenameParts, 'extension'>,
): Promise<GeneratedFile> {
  const html = renderDocumentHtml(input);
  const filename = buildExportFilename({ ...filenameParts, extension: 'pdf' });

  const { uri: temporaryUri } = await Print.printToFileAsync({
    html,
    width: A4_POINTS.width,
    height: A4_POINTS.height,
    base64: false,
  });

  const target = `${FileSystem.cacheDirectory ?? ''}${filename}`;
  try {
    // A previous export of the same document would otherwise make the move fail.
    const existing = await FileSystem.getInfoAsync(target);
    if (existing.exists) await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: temporaryUri, to: target });
    return { uri: target, filename, mimeType: 'application/pdf' };
  } catch {
    // If the move fails for any reason the PDF itself is still valid — hand back the
    // temporary file rather than losing the export over a filename.
    return { uri: temporaryUri, filename, mimeType: 'application/pdf' };
  }
}

/**
 * Send a document straight to the system print dialog (§10.5's Print action).
 *
 * Uses the same HTML, so what prints is what was previewed.
 */
export async function printDocument(input: RenderInput): Promise<void> {
  await Print.printAsync({
    html: renderDocumentHtml(input),
    width: A4_POINTS.width,
    height: A4_POINTS.height,
  });
}
