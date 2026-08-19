/**
 * Threshold-based background removal for photographed signatures — spec §7.2.
 *
 * "Offer a 'remove white background' step: threshold the image so near-white pixels become
 * transparent. Provide a slider for the threshold with live preview, because photographed
 * signatures vary."
 *
 * ## Why this runs in a WebView
 *
 * The work is per-pixel: read the image, compare each pixel's brightness against a
 * threshold, and set alpha to zero where it is above. React Native has no pixel buffer, and
 * `expo-image-manipulator` only does geometric operations — crop, resize, rotate, flip —
 * so there is no native route to it. A `<canvas>` inside a WebView does have pixel access,
 * so the image is handed in as a data URI, thresholded in the canvas, and posted back as a
 * transparent PNG. No new dependency, no network, and the same WebView engine that renders
 * the documents.
 *
 * The alternative would have been to add an image-processing library, which §3.1 forbids.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/**
 * The page that does the work.
 *
 * Also trims to the ink bounding box with padding, which §7.2 requires of the *drawn*
 * signature and which is just as useful here — a photograph of a signature is mostly paper,
 * and trimming it means the signature prints at a sensible size instead of as a small mark
 * in a large empty box.
 */
const PROCESSOR_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0">
<script>
  var sourceImage = null;

  function post(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function process(threshold, padding) {
    if (!sourceImage) return;
    try {
      var canvas = document.createElement('canvas');
      canvas.width = sourceImage.width;
      canvas.height = sourceImage.height;
      var context = canvas.getContext('2d');
      context.drawImage(sourceImage, 0, 0);

      var data = context.getImageData(0, 0, canvas.width, canvas.height);
      var pixels = data.data;
      var minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;

      for (var i = 0; i < pixels.length; i += 4) {
        // Perceptual luminance, so a blue ballpoint on cream paper is judged the way an
        // eye would judge it rather than by a flat channel average.
        var luminance = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        if (luminance >= threshold) {
          pixels[i + 3] = 0;
        } else {
          var index = i / 4;
          var x = index % canvas.width;
          var y = (index - x) / canvas.width;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      context.putImageData(data, 0, 0);

      // Nothing survived the threshold: return the untrimmed result so the user sees a
      // blank preview and can lower the slider, rather than getting an error.
      if (maxX < 0) {
        post({ type: 'result', dataUri: canvas.toDataURL('image/png'), empty: true });
        return;
      }

      var pad = padding || 4;
      var left = Math.max(0, minX - pad);
      var top = Math.max(0, minY - pad);
      var width = Math.min(canvas.width - left, maxX - minX + 1 + pad * 2);
      var height = Math.min(canvas.height - top, maxY - minY + 1 + pad * 2);

      var trimmed = document.createElement('canvas');
      trimmed.width = width;
      trimmed.height = height;
      trimmed.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);

      post({ type: 'result', dataUri: trimmed.toDataURL('image/png'), empty: false });
    } catch (error) {
      post({ type: 'error', message: String(error && error.message ? error.message : error) });
    }
  }

  window.__load = function (dataUri, threshold, padding) {
    var image = new Image();
    image.onload = function () {
      sourceImage = image;
      process(threshold, padding);
    };
    image.onerror = function () {
      post({ type: 'error', message: 'The image could not be decoded.' });
    };
    image.src = dataUri;
  };

  window.__apply = function (threshold, padding) {
    process(threshold, padding);
  };

  post({ type: 'ready' });
</script>
</body></html>`;

export interface BackgroundRemoverProps {
  /** Source image as a `data:` URI. */
  sourceDataUri: string | null;
  /** Luminance cut-off, 0–255. Pixels at or above this become transparent. */
  threshold: number;
  /** Padding in pixels around the ink bounding box. §7.2 asks for 4. */
  padding?: number;
  /** Called with the processed transparent PNG as a data URI. */
  onResult: (dataUri: string, empty: boolean) => void;
  onError: (message: string) => void;
}

/**
 * An invisible processor. Render it while the threshold screen is open; it re-processes
 * whenever the threshold changes, which is what makes the preview live.
 */
export function BackgroundRemover({
  sourceDataUri,
  threshold,
  padding = 4,
  onResult,
  onError,
}: BackgroundRemoverProps): React.ReactElement | null {
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const loadedSourceRef = useRef<string | null>(null);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as
          | { type: 'ready' }
          | { type: 'result'; dataUri: string; empty: boolean }
          | { type: 'error'; message: string };

        if (message.type === 'ready') setReady(true);
        else if (message.type === 'result') onResult(message.dataUri, message.empty);
        else onError(message.message);
      } catch {
        onError('The background remover returned something unreadable.');
      }
    },
    [onError, onResult],
  );

  // Load the image once, then only re-apply the threshold — decoding a multi-megapixel
  // photograph on every slider movement would make the preview crawl.
  useEffect(() => {
    if (!ready || !sourceDataUri) return;

    if (loadedSourceRef.current !== sourceDataUri) {
      loadedSourceRef.current = sourceDataUri;
      webviewRef.current?.injectJavaScript(
        `window.__load(${JSON.stringify(sourceDataUri)}, ${threshold}, ${padding}); true;`,
      );
    } else {
      webviewRef.current?.injectJavaScript(`window.__apply(${threshold}, ${padding}); true;`);
    }
  }, [padding, ready, sourceDataUri, threshold]);

  if (!sourceDataUri) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: PROCESSOR_HTML }}
        onMessage={handleMessage}
        javaScriptEnabled
        // §11 privacy: the processor is local markup and must never reach the network.
        cacheEnabled={false}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: -10_000, top: 0, width: 1, height: 1, opacity: 0 },
  webview: { width: 1, height: 1 },
});
