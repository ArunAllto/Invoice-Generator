/**
 * Web implementation of `HtmlView` — see the native file for why this exists.
 *
 * An `<iframe srcDoc>` shows the very same self-contained HTML the PDF is generated from, so
 * the document preview is genuinely accurate in a desktop browser rather than an
 * approximation. `sandbox` is empty of permissions, which matches the native side's
 * `javaScriptEnabled={false}`.
 */

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export interface HtmlViewProps {
  html: string;
  style?: StyleProp<ViewStyle>;
  scaleToFit?: boolean;
  onLoadEnd?: () => void;
  width?: number;
  height?: number;
}

export function HtmlView({
  html,
  style,
  onLoadEnd,
  width,
  height,
}: HtmlViewProps): React.ReactElement {
  return (
    <View style={[{ flex: 1, backgroundColor: '#EEF1F5' }, style]}>
      <iframe
        title="Document preview"
        srcDoc={html}
        onLoad={onLoadEnd}
        sandbox=""
        style={{
          border: 'none',
          width: width ? `${width}px` : '100%',
          height: height ? `${height}px` : '100%',
          backgroundColor: '#EEF1F5',
        }}
      />
    </View>
  );
}
