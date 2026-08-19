/**
 * Renders a self-contained HTML string.
 *
 * On Android this is a `WebView`. There is a sibling `HtmlView.web.tsx` that renders an
 * `<iframe srcDoc>` instead, and Metro resolves the `.web` variant automatically — so
 * `react-native-webview`, which has no web implementation, is imported from exactly one
 * platform-specific file rather than from every screen that needs to show a document.
 *
 * That isolation is what lets the app run in a desktop browser for UI review without
 * changing a line of the Android build.
 */

import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export interface HtmlViewProps {
  html: string;
  style?: StyleProp<ViewStyle>;
  /** Let the engine scale an A4-wide page down to the viewport. */
  scaleToFit?: boolean;
  onLoadEnd?: () => void;
  /** Fixed pixel size, for the off-screen capture host. */
  width?: number;
  height?: number;
}

export function HtmlView({
  html,
  style,
  scaleToFit = true,
  onLoadEnd,
  width,
  height,
}: HtmlViewProps): React.ReactElement {
  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={[styles.fill, width && height ? { width, height } : null, style]}
      scrollEnabled={scaleToFit}
      scalesPageToFit={scaleToFit}
      setBuiltInZoomControls={scaleToFit}
      showsHorizontalScrollIndicator={false}
      onLoadEnd={onLoadEnd}
      // §11 privacy: a document never needs script or the network.
      javaScriptEnabled={false}
      cacheEnabled={false}
      androidLayerType={width ? 'software' : undefined}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#EEF1F5' },
});
