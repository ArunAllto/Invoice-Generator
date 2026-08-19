/**
 * The export orchestrator — spec §10.5.
 *
 * One entry point per action (share, save, print) that hides which of the three generators
 * is involved, plus the cache §10.5 asks for: "Cache the generated file against a hash of
 * the document state so re-sharing is instant."
 *
 * Error handling follows §11: every failure surfaces a human-readable message with the
 * technical detail available to copy. Nothing here throws a bare stack trace at the user,
 * and nothing fails silently.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';

import { t } from '../strings';
import type { RenderInput } from '../render/html';
import { renderDocumentHtml } from '../render/html';
import { exportDocx } from './docx';
import type { FilenameParts } from './filename';
import { exportImages, type ImageFormat } from './image';
import { exportPdf, printDocument, type GeneratedFile } from './pdf';

export type ExportFormat = 'pdf' | 'docx' | 'image';

export interface ExportRequest {
  input: RenderInput;
  filenameParts: Omit<FilenameParts, 'extension'>;
  format: ExportFormat;
  /** Image only: PNG or the smaller JPG (§10.4). */
  imageFormat?: ImageFormat;
  onProgress?: (stage: string, fraction: number) => void;
}

/**
 * A readable error carrying the underlying detail.
 *
 * §11: "Every export failure shows a human-readable message and the option to copy
 * diagnostic detail." `message` is for the user; `detail` is what the copy button copies.
 */
export class ExportError extends Error {
  readonly detail: string;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ExportError';
    this.detail =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}\n${cause.stack ?? ''}`
        : String(cause);
  }
}

// ---------------------------------------------------------------------------
// Cache (§10.5)
// ---------------------------------------------------------------------------

/**
 * A cheap, stable hash of a string.
 *
 * FNV-1a: not cryptographic, and it does not need to be — it only has to change when the
 * document changes. The input is the fully rendered HTML, so it already captures every
 * field, toggle, template and accent colour that could alter the output.
 */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

interface CacheEntry {
  files: GeneratedFile[];
  hash: string;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(request: ExportRequest): string {
  return `${request.format}:${request.imageFormat ?? ''}`;
}

/**
 * Reuse a previously generated file when nothing about the document has changed.
 *
 * The files still have to exist: the OS clears the cache directory whenever it likes, so a
 * hit is only a hit if every file is still on disk.
 */
async function readCache(request: ExportRequest, hash: string): Promise<GeneratedFile[] | null> {
  const entry = cache.get(cacheKey(request));
  if (!entry || entry.hash !== hash) return null;

  for (const file of entry.files) {
    const info = await FileSystem.getInfoAsync(file.uri);
    if (!info.exists) {
      cache.delete(cacheKey(request));
      return null;
    }
  }
  return entry.files;
}

export function clearExportCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Generate the file(s) for a request, using the cache where possible. */
export async function generateExport(request: ExportRequest): Promise<GeneratedFile[]> {
  const { input, filenameParts, format, imageFormat = 'png', onProgress } = request;

  // Hashing the rendered HTML rather than the record means a change to any input that
  // actually affects output invalidates the cache, and a change that does not — say
  // reopening the same document — does not.
  const hash = hashString(renderDocumentHtml(input));

  const cached = await readCache(request, hash);
  if (cached) {
    onProgress?.('cached', 1);
    return cached;
  }

  onProgress?.(t('exportWorking'), 0.15);

  try {
    let files: GeneratedFile[];
    if (format === 'pdf') {
      files = [await exportPdf(input, filenameParts)];
    } else if (format === 'docx') {
      files = [await exportDocx(input, filenameParts)];
    } else {
      files = await exportImages(input, filenameParts, {
        format: imageFormat,
        onProgress: (page, total) => onProgress?.(`Page ${page} of ${total}`, 0.2 + (0.7 * page) / total),
      });
    }

    onProgress?.('done', 1);
    cache.set(cacheKey(request), { files, hash });
    return files;
  } catch (error) {
    throw new ExportError(exportFailureMessage(format, error), error);
  }
}

function exportFailureMessage(format: ExportFormat, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  // The DOCX polyfill failure is the one worth naming explicitly, since §10.3 warns it
  // fails obscurely and the fix is a one-liner in the entry point.
  if (format === 'docx' && detail.includes('buffer')) {
    return 'Word export is not set up correctly on this build. The `buffer` polyfill is missing from the app entry point.';
  }
  if (format === 'image' && detail.includes('ImageExportHost')) {
    return 'Image export is unavailable on this screen. Please reopen the app and try again.';
  }
  return t('exportFailed');
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Share via the native sheet → WhatsApp, Gmail, Drive (§3, §10.5). */
export async function shareExport(request: ExportRequest): Promise<void> {
  const files = await generateExport(request);
  const first = files[0];
  if (!first) throw new ExportError(t('exportFailed'), new Error('No file was produced'));

  if (!(await Sharing.isAvailableAsync())) {
    throw new ExportError('Sharing is not available on this device.', new Error('Sharing unavailable'));
  }

  // `expo-sharing` shares one file at a time. A multi-page image export therefore opens
  // the sheet once per page, which is the honest behaviour — silently sharing only page 1
  // would lose half the document.
  for (const file of files) {
    await Sharing.shareAsync(file.uri, {
      mimeType: file.mimeType,
      dialogTitle: file.filename,
      UTI: file.mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    });
  }
}

export interface SaveResult {
  savedFiles: string[];
  /** Where it went, for the confirmation message. */
  location: 'downloads' | 'media-library' | 'chosen-folder';
}

/**
 * Save a copy outside the app (§3, §10.5).
 *
 * Two routes, in order of preference:
 *
 *  1. **Storage Access Framework** — the user picks a folder once and the file is written
 *     there. This is the only route that works for PDFs and DOCX on Android 10+, because
 *     `MediaLibrary` only accepts media files.
 *  2. **MediaLibrary** — used for images, where it puts the file in the gallery, which is
 *     where a user looks for a picture.
 *
 * §11 requires the permission to be requested at the moment of first use with an
 * in-context explanation; the caller shows that explanation before calling this.
 */
export async function saveExportToDownloads(request: ExportRequest): Promise<SaveResult> {
  const files = await generateExport(request);
  const isImage = request.format === 'image';

  if (isImage) {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      throw new ExportError(t('permissionDenied'), new Error('Media library permission denied'));
    }
    const saved: string[] = [];
    for (const file of files) {
      const asset = await MediaLibrary.createAssetAsync(file.uri);
      saved.push(asset.filename);
    }
    return { savedFiles: saved, location: 'media-library' };
  }

  const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permissions.granted) {
    throw new ExportError(t('permissionDenied'), new Error('SAF directory permission denied'));
  }

  const saved: string[] = [];
  try {
    for (const file of files) {
      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
        permissions.directoryUri,
        file.filename.replace(/\.[^.]+$/, ''),
        file.mimeType,
      );
      await FileSystem.writeAsStringAsync(targetUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      saved.push(file.filename);
    }
  } catch (error) {
    throw new ExportError('The file could not be written to that folder.', error);
  }

  return { savedFiles: saved, location: 'chosen-folder' };
}

/** Hand the document to the system print dialog (§10.5). */
export async function printExport(input: RenderInput): Promise<void> {
  try {
    await printDocument(input);
  } catch (error) {
    // The user cancelling the print dialog surfaces as an error on Android; that is not a
    // failure worth alarming them about.
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('cancel') || message.includes('dismiss')) return;
    throw new ExportError('The document could not be sent to the printer.', error);
  }
}

export type { GeneratedFile } from './pdf';
