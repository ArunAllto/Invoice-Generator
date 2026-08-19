/**
 * Digital signature capture — spec §7.2. Both input methods are required.
 *
 * **Draw:** a full-width canvas, black ink, undo and clear, "Use this signature". The stroke
 * is exported as a transparent PNG trimmed to the ink bounding box with 4px padding.
 *
 * **Upload:** pick a photograph of a signature on paper, then a "remove white background"
 * step that thresholds near-white pixels to transparent, with a slider and a live preview —
 * because, as the spec notes, photographed signatures vary.
 *
 * The trimming and thresholding both run in `BackgroundRemover`'s canvas, which means the
 * drawn and uploaded paths converge on exactly the same processing and cannot produce
 * differently-cropped results.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import SignatureScreen from 'react-native-signature-canvas';

import { BackgroundRemover } from '../media/BackgroundRemover';
import { deleteStoredImage, describeImageProblem, pickLogo, storeBase64Png } from '../media/images';
import { toDataUri } from '../render/prepare';
import { t } from '../strings';
import { palette, radius, spacing } from '../theme';
import { Slider } from './Slider';
import {
  Body,
  Button,
  Caption,
  Card,
  ChipGroup,
  ErrorNotice,
  Field,
  Loading,
  TextField,
} from './ui';

type Method = 'draw' | 'upload';

/**
 * Default luminance cut-off for background removal.
 *
 * 200 of 255 clears white and off-white paper while keeping grey ballpoint strokes. It is
 * the starting point, not a fixed value — the slider exists precisely because a photo taken
 * in warm indoor light needs a different threshold from one taken by a window.
 */
const DEFAULT_THRESHOLD = 200;

export interface SignatureCaptureProps {
  signatureUri: string | null;
  signatureLabel: string;
  onChange: (uri: string | null) => void;
  onChangeLabel: (label: string) => void;
}

export function SignatureCapture({
  signatureUri,
  signatureLabel,
  onChange,
  onChangeLabel,
}: SignatureCaptureProps): React.ReactElement {
  const [method, setMethod] = useState<Method>('draw');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Upload path state.
  const [sourceDataUri, setSourceDataUri] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [processedDataUri, setProcessedDataUri] = useState<string | null>(null);
  const [processedEmpty, setProcessedEmpty] = useState(false);

  const handleDrawn = useCallback(
    async (base64: string) => {
      setBusy(true);
      setError(null);
      try {
        // The canvas hands back an opaque white PNG, so it goes through the same
        // threshold-and-trim pass as an uploaded photo. That is what produces §7.2's
        // "transparent PNG, trimmed to the ink bounding box with 4 px padding".
        setSourceDataUri(base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`);
        setThreshold(DEFAULT_THRESHOLD);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const pickPhoto = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Free-form crop: a signature is wide, and forcing it square would cut it.
      const result = await pickLogo({ source: 'gallery', allowCrop: true, square: false });
      const message = describeImageProblem(result.problem);
      if (message) {
        setError(message);
        return;
      }
      if (result.image) {
        const dataUri = await toDataUri(result.image.uri);
        setSourceDataUri(dataUri);
        setThreshold(DEFAULT_THRESHOLD);
        // The picked file was only a staging copy; the processed PNG is what gets stored.
        await deleteStoredImage(result.image.uri);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const commit = useCallback(async () => {
    if (!processedDataUri) return;
    setBusy(true);
    try {
      const previous = signatureUri;
      const stored = await storeBase64Png(processedDataUri, 'signature');
      onChange(stored);
      if (previous && previous !== stored) await deleteStoredImage(previous);
      setSourceDataUri(null);
      setProcessedDataUri(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [onChange, processedDataUri, signatureUri]);

  // A stored signature: show it with Replace / Remove.
  const [storedPreview, setStoredPreview] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (signatureUri) {
      void toDataUri(signatureUri).then((dataUri) => {
        if (!cancelled) setStoredPreview(dataUri);
      });
    } else {
      setStoredPreview(null);
    }
    return () => {
      cancelled = true;
    };
  }, [signatureUri]);

  const inCaptureFlow = sourceDataUri !== null;

  return (
    <View style={styles.container}>
      {error ? <ErrorNotice message={error} /> : null}

      {/* Processing host: invisible, re-runs whenever the threshold moves. */}
      <BackgroundRemover
        sourceDataUri={sourceDataUri}
        threshold={threshold}
        padding={4}
        onResult={(dataUri, empty) => {
          setProcessedDataUri(dataUri);
          setProcessedEmpty(empty);
        }}
        onError={setError}
      />

      {signatureUri && !inCaptureFlow ? (
        <Card style={styles.previewCard}>
          {storedPreview ? (
            <Image
              source={{ uri: storedPreview }}
              style={styles.storedPreview}
              resizeMode="contain"
              accessibilityLabel={t('signature')}
            />
          ) : (
            <Loading />
          )}
          <Caption>Prints at up to 18 mm tall, above the label below.</Caption>
          <TextField
            label={t('signatureLabel')}
            value={signatureLabel}
            onChangeText={onChangeLabel}
          />
          <View style={styles.row}>
            <Button
              label={t('replace')}
              variant="secondary"
              onPress={() => {
                setSourceDataUri(null);
                setProcessedDataUri(null);
                onChange(null);
                void deleteStoredImage(signatureUri);
              }}
            />
            <Button
              label={t('remove')}
              variant="danger"
              onPress={() => {
                const previous = signatureUri;
                onChange(null);
                void deleteStoredImage(previous);
              }}
            />
          </View>
        </Card>
      ) : null}

      {inCaptureFlow ? (
        <Card style={styles.previewCard}>
          <Field
            label={t('signatureRemoveBackground')}
            hint="Slide until the paper disappears but the ink stays."
          >
            {processedDataUri ? (
              <View style={styles.checkerboard}>
                <Image
                  source={{ uri: processedDataUri }}
                  style={styles.storedPreview}
                  resizeMode="contain"
                  accessibilityLabel="Signature preview"
                />
              </View>
            ) : (
              <Loading />
            )}
            <Slider
              value={threshold}
              onChange={(value) => setThreshold(Math.round(value))}
              minimum={40}
              maximum={250}
              step={1}
              accessibilityLabel={t('signatureThreshold')}
            />
            <Caption>
              {t('signatureThreshold')}: {threshold}
              {processedEmpty ? ' — nothing left; lower the slider.' : ''}
            </Caption>
          </Field>
          <View style={styles.row}>
            <Button
              label={t('cancel')}
              variant="ghost"
              onPress={() => {
                setSourceDataUri(null);
                setProcessedDataUri(null);
              }}
            />
            <Button
              label={t('signatureUse')}
              onPress={() => void commit()}
              loading={busy}
              disabled={!processedDataUri || processedEmpty}
            />
          </View>
        </Card>
      ) : null}

      {!signatureUri && !inCaptureFlow ? (
        <View style={styles.container}>
          <ChipGroup
            options={[
              { value: 'draw' as Method, label: t('signatureDraw') },
              { value: 'upload' as Method, label: t('signatureUpload') },
            ]}
            value={method}
            onChange={setMethod}
          />

          {method === 'draw' ? (
            <View>
              <Caption>{t('signatureDrawHint')}</Caption>
              <View style={styles.canvasWrapper}>
                <SignatureScreen
                  onOK={(signature) => void handleDrawn(signature)}
                  onEmpty={() => setError('Draw your signature first.')}
                  descriptionText=""
                  clearText={t('signatureClear')}
                  confirmText={t('done')}
                  penColor="#000000"
                  backgroundColor="#FFFFFF"
                  imageType="image/png"
                  webStyle={SIGNATURE_WEB_STYLE}
                />
              </View>
              <Caption>
                Draw, then tap {t('done')} to trim it and remove the background.
              </Caption>
            </View>
          ) : (
            <View style={styles.container}>
              <Body muted>
                Photograph your signature on plain paper in even light, then crop to the
                signature.
              </Body>
              <Button label={t('logoPickGallery')} onPress={() => void pickPhoto()} loading={busy} />
            </View>
          )}

          <Caption>{t('signatureNone')}</Caption>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Styling for the signature canvas's own web view.
 *
 * The library renders an HTML canvas, so its chrome is styled with CSS rather than RN
 * props. The buttons are given a real height so they meet §11's 44dp minimum.
 */
const SIGNATURE_WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: 1px solid ${palette.border}; border-radius: 8px; }
  .m-signature-pad--footer { margin: 8px 0 0; }
  .m-signature-pad--footer .button {
    background-color: ${palette.navy};
    color: #FFFFFF;
    border-radius: 8px;
    min-height: 44px;
    padding: 0 16px;
    font-size: 15px;
  }
  .m-signature-pad--footer .button.clear { background-color: ${palette.surfaceSunken}; color: ${palette.ink}; }
  .m-signature-pad--footer .description { display: none; }
  body, html { margin: 0; padding: 0; background: transparent; }
`;

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  previewCard: { gap: spacing.md },
  storedPreview: {
    height: 120,
    width: '100%',
    backgroundColor: 'transparent',
  },
  // A light checkerboard makes transparency visible, so the user can see the paper is gone
  // rather than merely white-on-white.
  checkerboard: {
    backgroundColor: palette.surfaceSunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.sm,
  },
  canvasWrapper: { height: 260, marginVertical: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
});
