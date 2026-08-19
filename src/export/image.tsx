/**
 * Image export — spec §10.4.
 *
 * The same HTML is rendered in an off-screen `WebView` at a fixed 1240px width (A4 at
 * ~150 DPI) and captured with `react-native-view-shot`. Rendering the identical markup is
 * what guarantees §10.1's promise that the image matches the PDF; a separate
 * React-Native-drawn layout would drift from the print output immediately.
 *
 * Multi-page documents produce one file per page, named `-p1`, `-p2` (§10.4), by asking the
 * renderer for one page at a time via its `onlyPage` option.
 *
 * ## Why a host component rather than a plain function
 *
 * `captureRef` needs a mounted, laid-out native view. So a single invisible host lives at
 * the root of the app (`app/_layout.tsx`) and the export code drives it through the
 * module-level controller below. The alternative — mounting a WebView inside the export
 * sheet — would tie capture to that screen staying open.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';

import { countPages, renderDocumentHtml, type RenderInput } from '../render/html';
import { buildExportFilename, MIME_TYPES, type FilenameParts } from './filename';
import type { GeneratedFile } from './pdf';

/** §10.4: A4 at ~150 DPI. */
export const IMAGE_WIDTH_PX = 1240;
/** A4 aspect ratio, so the captured bitmap is a full page rather than a crop. */
export const IMAGE_HEIGHT_PX = Math.round((IMAGE_WIDTH_PX * 297) / 210);

export type ImageFormat = 'png' | 'jpg';

interface CaptureRequest {
  html: string;
  format: ImageFormat;
  quality: number;
}

interface HostHandle {
  capture: (request: CaptureRequest) => Promise<string>;
}

const hostRef: { current: HostHandle | null } = { current: null };

/**
 * Invisible capture host. Mount exactly once, at the app root.
 *
 * Positioned far off-screen rather than hidden with `display: none` or zero opacity: a view
 * that is not laid out has nothing for `captureRef` to read, so it has to be genuinely
 * rendered, just somewhere the user cannot see.
 */
export function ImageExportHost(): React.ReactElement {
  const [request, setRequest] = useState<CaptureRequest | null>(null);
  const containerRef = useRef<View>(null);
  const resolveRef = useRef<((uri: string) => void) | null>(null);
  const rejectRef = useRef<((error: Error) => void) | null>(null);
  const settledRef = useRef(false);

  const capture = useCallback(
    (next: CaptureRequest) =>
      new Promise<string>((resolve, reject) => {
        settledRef.current = false;
        resolveRef.current = resolve;
        rejectRef.current = reject;
        setRequest(next);

        // A WebView that never fires onLoadEnd — a malformed data URI, an OS-level
        // failure — would otherwise leave the export spinner running for ever.
        setTimeout(() => {
          if (settledRef.current) return;
          settledRef.current = true;
          rejectRef.current?.(new Error('Timed out while rendering the image.'));
          setRequest(null);
        }, 20_000);
      }),
    [],
  );

  // Registered in an effect rather than during render, so a re-render cannot leave the
  // module-level controller pointing at a host that is being unmounted.
  useEffect(() => {
    hostRef.current = { capture };
    return () => {
      hostRef.current = null;
    };
  }, [capture]);

  const onLoadEnd = useCallback(async () => {
    if (!request || settledRef.current) return;
    try {
      // One frame for the WebView to paint what it has just laid out. Capturing in the
      // same tick reliably yields a blank bitmap on Android.
      await new Promise((resolve) => setTimeout(resolve, 350));
      const uri = await captureRef(containerRef, {
        format: request.format === 'jpg' ? 'jpg' : 'png',
        quality: request.quality,
        width: IMAGE_WIDTH_PX,
        height: IMAGE_HEIGHT_PX,
        result: 'tmpfile',
      });
      if (settledRef.current) return;
      settledRef.current = true;
      resolveRef.current?.(uri);
    } catch (error) {
      if (settledRef.current) return;
      settledRef.current = true;
      rejectRef.current?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      setRequest(null);
    }
  }, [request]);

  if (!request) return <View style={styles.idle} pointerEvents="none" />;

  return (
    <View style={styles.offscreen} pointerEvents="none" collapsable={false}>
      <View
        ref={containerRef}
        collapsable={false}
        style={{ width: IMAGE_WIDTH_PX, height: IMAGE_HEIGHT_PX, backgroundColor: '#FFFFFF' }}
      >
        <WebView
          originWhitelist={['*']}
          source={{ html: request.html }}
          style={{ width: IMAGE_WIDTH_PX, height: IMAGE_HEIGHT_PX, backgroundColor: '#FFFFFF' }}
          scrollEnabled={false}
          scalesPageToFit={false}
          onLoadEnd={onLoadEnd}
          // §11 privacy: the capture WebView must not be able to reach the network even
          // if a document somehow contained a remote reference.
          javaScriptEnabled={false}
          cacheEnabled={false}
          androidLayerType="software"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idle: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  offscreen: {
    position: 'absolute',
    left: -20_000,
    top: 0,
    width: IMAGE_WIDTH_PX,
    height: IMAGE_HEIGHT_PX,
    opacity: 0,
  },
});

export interface ExportImageOptions {
  format?: ImageFormat;
  /** JPG quality. §10.4 asks for 92% as the WhatsApp-friendly option. */
  quality?: number;
  onProgress?: (page: number, total: number) => void;
}

/**
 * Capture a document as one image per page.
 *
 * Pages are rendered sequentially rather than in parallel: there is one host WebView, and
 * a 1240×1754 bitmap per page is heavy enough that doing several at once on a mid-range
 * phone risks an out-of-memory kill.
 */
export async function exportImages(
  input: RenderInput,
  filenameParts: Omit<FilenameParts, 'extension'>,
  options: ExportImageOptions = {},
): Promise<GeneratedFile[]> {
  const host = hostRef.current;
  if (!host) {
    throw new Error(
      'Image export is not ready: <ImageExportHost /> must be mounted at the app root.',
    );
  }

  const { format = 'png', quality = 0.92, onProgress } = options;
  const pageCount = countPages(input);
  const results: GeneratedFile[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    onProgress?.(page, pageCount);

    const html = renderDocumentHtml({
      ...input,
      options: { ...input.options, pixelWidth: IMAGE_WIDTH_PX, forScreen: false, onlyPage: page },
    });

    const temporaryUri = await host.capture({ html, format, quality });
    const filename = buildExportFilename({ ...filenameParts, extension: format, page, pageCount });
    const target = `${FileSystem.cacheDirectory ?? ''}${filename}`;

    try {
      const existing = await FileSystem.getInfoAsync(target);
      if (existing.exists) await FileSystem.deleteAsync(target, { idempotent: true });
      await FileSystem.moveAsync({ from: temporaryUri, to: target });
      results.push({ uri: target, filename, mimeType: MIME_TYPES[format] });
    } catch {
      results.push({ uri: temporaryUri, filename, mimeType: MIME_TYPES[format] });
    }
  }

  return results;
}

/** Whether the host is mounted, so the export sheet can disable the option if not. */
export function isImageExportReady(): boolean {
  return hostRef.current !== null;
}
