/**
 * The signature drawing surface (§7.2, "Draw").
 *
 * Wraps `react-native-signature-canvas`. A sibling `SignaturePad.web.tsx` draws on a DOM
 * canvas instead, so `SignatureCapture` can import this without pulling
 * `react-native-signature-canvas` — and therefore `react-native-webview` — into a web bundle
 * that has no implementation for either.
 *
 * Both variants honour the same contract: black ink on white, an undo and a clear control, and
 * `onDone` handing back a PNG data URI. Trimming and background removal happen afterwards in
 * `BackgroundRemover`, identically for both.
 */

import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas';

import { palette, spacing } from '../theme';
import { Button, Caption } from './ui';
import { t } from '../strings';

export interface SignaturePadProps {
  /** Receives a PNG data URI (or bare base64) once the user confirms. */
  onDone: (dataUri: string) => void;
  onEmpty: () => void;
}

/** CSS for the library's internal web view. Buttons get 44dp for §11. */
const WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: 1px solid ${palette.border}; border-radius: 8px; }
  .m-signature-pad--footer { display: none; }
  body, html { margin: 0; padding: 0; background: transparent; }
`;

export function SignaturePad({ onDone, onEmpty }: SignaturePadProps): React.ReactElement {
  const ref = useRef<SignatureViewRef>(null);

  return (
    <View style={styles.container}>
      <Caption>{t('signatureDrawHint')}</Caption>
      <View style={styles.canvas}>
        <SignatureScreen
          ref={ref}
          onOK={onDone}
          onEmpty={onEmpty}
          descriptionText=""
          penColor="#000000"
          backgroundColor="#FFFFFF"
          imageType="image/png"
          webStyle={WEB_STYLE}
        />
      </View>
      <View style={styles.row}>
        <Button label={t('undo')} variant="ghost" onPress={() => ref.current?.undo()} />
        <Button label={t('signatureClear')} variant="secondary" onPress={() => ref.current?.clearSignature()} />
        <Button label={t('done')} onPress={() => ref.current?.readSignature()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  canvas: { height: 240 },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
