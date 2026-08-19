/**
 * Settings → Document defaults (§7.4: "Every one of these must be individually toggleable per
 * document, defaulting from settings").
 *
 * This screen owns those defaults. Changing one here affects *new* documents only — an
 * existing document keeps the toggles it was saved with, which is what makes re-exporting an
 * old invoice reproduce the original.
 */

import React, { useEffect, useState } from 'react';

import {
  Body,
  Button,
  Caption,
  Card,
  ErrorNotice,
  Loading,
  Screen,
  SectionTitle,
  Snackbar,
  SwitchRow,
  TextField,
} from '../../src/components/ui';
import { DEFAULT_BLOCKS, type DocumentBlocks } from '../../src/core/types';
import { parseBlocks } from '../../src/db/rows';
import { getSetting, setSetting, SETTINGS_KEYS } from '../../src/db/masters';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

const BLOCK_LABELS: Array<[keyof DocumentBlocks, string]> = [
  ['clientBlock', t('blockClient')],
  ['descriptions', t('blockDescriptions')],
  ['hsnColumn', t('blockHsn')],
  ['unitColumn', t('blockUnit')],
  ['taxColumns', t('blockTax')],
  ['taxSummary', t('blockTaxSummary')],
  ['discountRow', t('blockDiscountRow')],
  ['shippingRow', t('blockShippingRow')],
  ['roundOffRow', t('blockRoundOffRow')],
  ['amountInWords', t('blockAmountInWords')],
  ['bankDetails', t('blockBank')],
  ['upiQr', t('blockUpiQr')],
  ['signature', t('blockSignature')],
  ['terms', t('blockTerms')],
  ['notes', t('blockNotes')],
  ['footerLine', t('blockFooter')],
];

export default function DefaultsScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [blocks, setBlocks] = useState<DocumentBlocks | null>(null);
  const [validityDays, setValidityDays] = useState('15');
  const [dueDays, setDueDays] = useState('15');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    (async () => {
      const [stored, validity, due] = await Promise.all([
        getSetting(db, SETTINGS_KEYS.defaultBlocks),
        getSetting(db, SETTINGS_KEYS.quotationValidityDays),
        getSetting(db, SETTINGS_KEYS.invoiceDueDays),
      ]);
      if (cancelled) return;
      setBlocks(stored ? parseBlocks(stored) : { ...DEFAULT_BLOCKS });
      setValidityDays(validity ?? '15');
      setDueDays(due ?? '15');
    })();
    return () => {
      cancelled = true;
    };
  }, [db]);

  if (!blocks) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const save = async (): Promise<void> => {
    if (!db) return;
    setSaving(true);
    setError(null);
    try {
      await setSetting(db, SETTINGS_KEYS.defaultBlocks, JSON.stringify(blocks));
      await setSetting(db, SETTINGS_KEYS.quotationValidityDays, String(Math.max(0, Number(validityDays) || 0)));
      await setSetting(db, SETTINGS_KEYS.invoiceDueDays, String(Math.max(0, Number(dueDays) || 0)));
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

      <Card>
        <Body>
          These apply to documents you create from now on. Documents you have already made keep
          their own settings.
        </Body>
      </Card>

      <SectionTitle>Dates</SectionTitle>
      <TextField
        label="Quotation validity (days)"
        value={validityDays}
        onChangeText={setValidityDays}
        keyboardType="numeric"
        align="right"
        hint="Sets the Valid until date on a new quotation."
      />
      <TextField
        label="Invoice payment terms (days)"
        value={dueDays}
        onChangeText={setDueDays}
        keyboardType="numeric"
        align="right"
        hint="Sets the Due date on a new invoice."
      />

      <SectionTitle>{t('editorBlocks')}</SectionTitle>
      <Caption>
        Each of these can still be switched on or off per document, in the editor or the export
        sheet.
      </Caption>
      {BLOCK_LABELS.map(([key, label]) => (
        <SwitchRow
          key={key}
          label={label}
          value={blocks[key]}
          onValueChange={(value) => setBlocks({ ...blocks, [key]: value })}
        />
      ))}

      <Button label={t('save')} onPress={() => void save()} loading={saving} />
      <Button
        label="Reset to the standard set"
        variant="ghost"
        onPress={() => setBlocks({ ...DEFAULT_BLOCKS })}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}
