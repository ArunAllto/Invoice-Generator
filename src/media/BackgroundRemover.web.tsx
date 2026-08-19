/**
 * Web implementation of `BackgroundRemover` — see the native file for the full rationale.
 *
 * The native version has to borrow a WebView's canvas because React Native has no pixel
 * buffer. On the web the canvas is simply there, so this does the same thresholding and
 * bounding-box trim directly, with no iframe and no message passing.
 *
 * The two implementations must stay behaviourally identical: same luminance weights, same
 * `>= threshold` comparison, same 4px padding. A signature processed on the desktop for review
 * has to look like the one the phone produces.
 */

import React, { useEffect, useRef } from 'react';

export interface BackgroundRemoverProps {
  sourceDataUri: string | null;
  threshold: number;
  padding?: number;
  onResult: (dataUri: string, empty: boolean) => void;
  onError: (message: string) => void;
}

export function BackgroundRemover({
  sourceDataUri,
  threshold,
  padding = 4,
  onResult,
  onError,
}: BackgroundRemoverProps): React.ReactElement | null {
  // Decode once per source and reuse the bitmap, so dragging the slider only re-thresholds.
  const imageRef = useRef<HTMLImageElement | null>(null);
  const loadedSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sourceDataUri) return;
    let cancelled = false;

    const process = (image: HTMLImageElement): void => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('This browser did not provide a 2D canvas.');
        context.drawImage(image, 0, 0);

        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = data.data;
        let minX = canvas.width;
        let minY = canvas.height;
        let maxX = -1;
        let maxY = -1;

        for (let i = 0; i < pixels.length; i += 4) {
          // Perceptual luminance, so blue ink on cream paper is judged as an eye would.
          const luminance =
            0.299 * (pixels[i] ?? 0) + 0.587 * (pixels[i + 1] ?? 0) + 0.114 * (pixels[i + 2] ?? 0);
          if (luminance >= threshold) {
            pixels[i + 3] = 0;
          } else {
            const index = i / 4;
            const x = index % canvas.width;
            const y = (index - x) / canvas.width;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        context.putImageData(data, 0, 0);

        if (cancelled) return;

        if (maxX < 0) {
          onResult(canvas.toDataURL('image/png'), true);
          return;
        }

        const left = Math.max(0, minX - padding);
        const top = Math.max(0, minY - padding);
        const width = Math.min(canvas.width - left, maxX - minX + 1 + padding * 2);
        const height = Math.min(canvas.height - top, maxY - minY + 1 + padding * 2);

        const trimmed = document.createElement('canvas');
        trimmed.width = width;
        trimmed.height = height;
        trimmed
          .getContext('2d')
          ?.drawImage(canvas, left, top, width, height, 0, 0, width, height);

        onResult(trimmed.toDataURL('image/png'), false);
      } catch (cause) {
        if (!cancelled) onError(cause instanceof Error ? cause.message : String(cause));
      }
    };

    if (loadedSourceRef.current === sourceDataUri && imageRef.current) {
      process(imageRef.current);
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      loadedSourceRef.current = sourceDataUri;
      if (!cancelled) process(image);
    };
    image.onerror = () => {
      if (!cancelled) onError('The image could not be decoded.');
    };
    image.src = sourceDataUri;

    return () => {
      cancelled = true;
    };
  }, [onError, onResult, padding, sourceDataUri, threshold]);

  return null;
}
