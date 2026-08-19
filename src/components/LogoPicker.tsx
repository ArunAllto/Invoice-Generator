/**
 * Logo picker — spec §7.1.
 *
 * Gallery or camera; PNG/JPG/WebP only; over 8 MB rejected with a clear message; a crop step
 * offered in both square and free-form; the stored copy downscaled to 800px on the long edge
 * with transparency preserved; preview with Replace and Remove.
 */

import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { deleteStoredImage, describeImageProblem, pickLogo } from '../media/images';
import { t } from '../strings';
import { palette, radius, spacing } from '../theme';
import { Button, Caption, Card, ErrorNotice, Field, SwitchRow } from './ui';

export interface LogoPickerProps {
  logoUri: string | null;
  onChange: (uri: string | null) => void;
}

export function LogoPicker({ logoUri, onChange }: LogoPickerProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [squareCrop, setSquareCrop] = useState(true);

  const pick = async (source: 'gallery' | 'camera'): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await pickLogo({ source, allowCrop: true, square: squareCrop });
      const message = describeImageProblem(result.problem);
      if (message) setError(message);
      if (result.image) {
        // Remove the file being replaced so the document directory does not fill up with
        // every logo the owner has ever tried.
        const previous = logoUri;
        onChange(result.image.uri);
        if (previous && previous !== result.image.uri) await deleteStoredImage(previous);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {error ? <ErrorNotice message={error} /> : null}

      {logoUri ? (
        <Card style={styles.previewCard}>
          <Image
            source={{ uri: logoUri }}
            style={styles.preview}
            resizeMode="contain"
            accessibilityLabel={t('logo')}
          />
          <Caption>Prints at up to 22 mm tall, aspect ratio preserved.</Caption>
          <View style={styles.row}>
            <Button
              label={t('replace')}
              variant="secondary"
              onPress={() => void pick('gallery')}
              loading={busy}
            />
            <Button
              label={t('remove')}
              variant="danger"
              onPress={() => {
                const previous = logoUri;
                onChange(null);
                void deleteStoredImage(previous);
              }}
            />
          </View>
        </Card>
      ) : (
        <View style={styles.container}>
          <Field label={t('logoAdd')} hint="PNG, JPG or WebP, up to 8 MB.">
            <SwitchRow
              label="Crop to a square"
              description="Turn this off to keep a wide logo's own shape."
              value={squareCrop}
              onValueChange={setSquareCrop}
            />
          </Field>
          <Button
            label={t('logoPickGallery')}
            onPress={() => void pick('gallery')}
            loading={busy}
          />
          <Button
            label={t('logoPickCamera')}
            variant="secondary"
            onPress={() => void pick('camera')}
            loading={busy}
          />
          <Caption>{t('permissionCameraExplain')}</Caption>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  previewCard: { gap: spacing.md, alignItems: 'stretch' },
  preview: {
    height: 140,
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: palette.surfaceSunken,
  },
  row: { flexDirection: 'row', gap: spacing.sm },
});
