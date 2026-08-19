/**
 * Settings → Logo, signature, template and accent colour (§4, §7.1, §7.2, §10.6).
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { LogoPicker } from '../../src/components/LogoPicker';
import { SignatureCapture } from '../../src/components/SignatureCapture';
import {
  Body,
  Button,
  Caption,
  ChipGroup,
  Collapsible,
  ErrorNotice,
  Field,
  Loading,
  Screen,
  SectionTitle,
  Snackbar,
  TextField,
} from '../../src/components/ui';
import type { TemplateId } from '../../src/core/types';
import { TEMPLATE_IDS } from '../../src/core/types';
import { getBusinessProfile, saveBusinessProfile, type BusinessProfile } from '../../src/db/masters';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { ACCENT_PRESETS, contrastOn, palette, radius, spacing } from '../../src/theme';

const TEMPLATE_DESCRIPTIONS: Record<TemplateId, string> = {
  classic: 'Navy accent bar, header-row table, boxed totals — the house style.',
  minimal: 'No fills, hairline rules, generous whitespace.',
  bold: 'Full-width coloured header band, large numerals.',
  compact: 'Fits around twenty line items on one page.',
};

export default function BrandingScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    void getBusinessProfile(db).then((loaded) => {
      if (!cancelled) setProfile(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  if (!profile) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const patch = (changes: Partial<BusinessProfile>): void =>
    setProfile((current) => (current ? { ...current, ...changes } : current));

  const save = async (): Promise<void> => {
    if (!db) return;
    setSaving(true);
    setError(null);
    try {
      await saveBusinessProfile(db, profile);
      setToast(t('saved'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {error ? <ErrorNotice message={t('errorGeneric')} detail={error} /> : null}

      <SectionTitle>{t('logo')}</SectionTitle>
      <LogoPicker logoUri={profile.logoUri} onChange={(uri) => patch({ logoUri: uri })} />

      <SectionTitle>{t('signature')}</SectionTitle>
      <SignatureCapture
        signatureUri={profile.signatureUri}
        signatureLabel={profile.signatureLabel}
        onChange={(uri) => patch({ signatureUri: uri })}
        onChangeLabel={(label) => patch({ signatureLabel: label })}
      />
      <TextField
        label={t('signatureLabel')}
        value={profile.signatureLabel}
        onChangeText={(value) => patch({ signatureLabel: value })}
        hint="Printed under the signature, e.g. Authorised Signatory."
      />

      <SectionTitle>{t('settingsTemplate')}</SectionTitle>
      <Field label={t('exportTemplate')}>
        <ChipGroup
          options={TEMPLATE_IDS.map((id) => ({
            value: id,
            label: id.charAt(0).toUpperCase() + id.slice(1),
          }))}
          value={profile.defaultTemplateId}
          onChange={(id) => patch({ defaultTemplateId: id })}
          accentColor={profile.accentColor}
        />
      </Field>
      <Caption>{TEMPLATE_DESCRIPTIONS[profile.defaultTemplateId]}</Caption>
      <Caption>
        Switching template changes the layout only — never a number on the document.
      </Caption>

      <SectionTitle>{t('settingsAccent')}</SectionTitle>
      <View style={styles.swatchRow}>
        {ACCENT_PRESETS.map((colour) => {
          const selected = profile.accentColor.toUpperCase() === colour.toUpperCase();
          return (
            <Pressable
              key={colour}
              onPress={() => patch({ accentColor: colour })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Accent colour ${colour}`}
              style={[styles.swatch, { backgroundColor: colour }, selected && styles.swatchSelected]}
            >
              {selected ? (
                <Body style={{ color: contrastOn(colour) }}>✓</Body>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Collapsible title="Use a specific colour" initiallyOpen={false}>
        <TextField
          label="Hex colour"
          value={profile.accentColor}
          onChangeText={(value) => patch({ accentColor: value })}
          autoCapitalize="characters"
          placeholder="#0F4C81"
          hint="Anything that is not a valid hex colour falls back to the default navy."
        />
      </Collapsible>

      <Button label={t('save')} onPress={() => void save()} loading={saving} />
      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchSelected: { borderColor: palette.ink },
});
