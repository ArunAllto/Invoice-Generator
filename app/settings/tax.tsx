/**
 * Settings → Tax rate presets (§5.8).
 *
 * §9.4's rule is honoured here too: an unregistered business sees an explanation instead of a
 * rate table, because presets they can never apply would be noise.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  ConfirmDialog,
  ErrorNotice,
  ListRow,
  Loading,
  Screen,
  Snackbar,
  TextField,
} from '../../src/components/ui';
import { isGstEnabled } from '../../src/core/gst';
import { uuid } from '../../src/core/ids';
import { formatBasisPoints, parsePercentToBasisPoints } from '../../src/core/money';
import {
  deleteTaxPreset,
  getBusinessProfile,
  listTaxPresets,
  saveTaxPreset,
  type TaxPreset,
} from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { palette, spacing } from '../../src/theme';

export default function TaxSettingsScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [label, setLabel] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TaxPreset | null>(null);

  const business = useQuery((database) => getBusinessProfile(database), []);
  const presets = useQuery((database) => listTaxPresets(database), []);

  if (business.loading || presets.loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (!isGstEnabled(business.data?.gstin)) {
    return (
      <Screen>
        <Card>
          <Body>{t('businessGstinHint')}</Body>
          <Caption>
            Add a GSTIN in Settings → Business profile and the tax options appear throughout the
            app.
          </Caption>
        </Card>
      </Screen>
    );
  }

  const add = async (): Promise<void> => {
    if (!db) return;
    const rateBp = parsePercentToBasisPoints(rate);
    if (rateBp === null || rateBp < 0 || rateBp > 10_000) {
      setError('Enter a rate between 0 and 100.');
      return;
    }
    setError(null);
    await saveTaxPreset(db, {
      id: uuid(),
      label: label.trim().length > 0 ? label.trim() : `${formatBasisPoints(rateBp)}% GST`,
      rateBp,
      isDefault: false,
    });
    setLabel('');
    setRate('');
    presets.refresh();
    setToast(t('saved'));
  };

  return (
    <Screen>
      {error ? <ErrorNotice message={error} /> : null}

      <Card padded={false}>
        {(presets.data ?? []).map((preset, index) => (
          <View key={preset.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <ListRow
              title={`${formatBasisPoints(preset.rateBp)}%`}
              subtitle={preset.label}
              onPress={async () => {
                if (!db) return;
                await saveTaxPreset(db, { ...preset, isDefault: true });
                presets.refresh();
                setToast(`${formatBasisPoints(preset.rateBp)}% is now the default.`);
              }}
              onLongPress={() => setPendingDelete(preset)}
              accessibilityHint="Tap to make default, long press to delete"
              right={preset.isDefault ? <Badge label="Default" tone="positive" /> : null}
            />
          </View>
        ))}
      </Card>
      <Caption>
        Tap a rate to make it the default for new catalogue items. Long press to delete.
      </Caption>

      <TextField
        label="New rate %"
        value={rate}
        onChangeText={setRate}
        keyboardType="decimal-pad"
        align="right"
      />
      <TextField label="Label" value={label} onChangeText={setLabel} placeholder="e.g. 18% GST" />
      <Button label={t('add')} onPress={() => void add()} />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this rate?"
        message="Documents already using it are unaffected — their rates are stored on the document."
        confirmLabel={t('delete')}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (db && pendingDelete) await deleteTaxPreset(db, pendingDelete.id);
          setPendingDelete(null);
          presets.refresh();
        }}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
});
