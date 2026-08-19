/**
 * Settings → Document numbering (§8).
 *
 * One series per document type by default. The live preview matters here: numbering is the
 * setting most likely to be got wrong, and the only way to be sure is to see the number the
 * next document will actually carry — computed by the same pure functions that allocate it.
 *
 * The gap report is included because a missing invoice number is the sort of thing a GST
 * audit asks about, and §8.3's whole design is aimed at not creating gaps.
 */

import React, { useState } from 'react';
import { View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  ChipGroup,
  ErrorNotice,
  Field,
  Loading,
  OptionList,
  Screen,
  Snackbar,
  SwitchRow,
  TextField,
} from '../../src/components/ui';
import { findSequenceGaps, previewNextNumber } from '../../src/core/numbering';
import type { DocumentType, FyFormat, ResetRule } from '../../src/core/types';
import { DOCUMENT_TYPES } from '../../src/core/types';
import {
  listSeries,
  readAllocationFacts,
  saveSeries,
  type NumberingSeries,
} from '../../src/db/masters';
import { todayIso } from '../../src/core/dates';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

const TYPE_LABELS: Record<DocumentType, string> = {
  quotation: t('quotations'),
  invoice: t('invoices'),
  receipt: t('receipts'),
};

export default function NumberingScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [activeType, setActiveType] = useState<DocumentType>('quotation');
  const [draft, setDraft] = useState<NumberingSeries | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const seriesQuery = useQuery((database) => listSeries(database, activeType), [activeType]);

  // Preview and gaps both need the same facts the allocator uses.
  const facts = useQuery(
    async (database) => {
      const series = draft ?? seriesQuery.data?.[0];
      if (!series) return null;
      const allocation = await readAllocationFacts(database, series, todayIso());
      const seqs = await database.getAllAsync<{ seq: number }>(
        'SELECT seq FROM documents WHERE series_id = ? AND seq IS NOT NULL ORDER BY seq;',
        series.id,
      );
      return { allocation, gaps: findSequenceGaps(seqs.map((row) => row.seq)) };
    },
    [activeType, draft?.id, draft?.resetRule, draft?.nextSeq, seriesQuery.data?.[0]?.id],
  );

  const series = draft ?? seriesQuery.data?.[0] ?? null;

  if (!series) {
    return (
      <Screen>
        {seriesQuery.loading ? <Loading /> : <Caption>No numbering series is configured.</Caption>}
      </Screen>
    );
  }

  const patch = (changes: Partial<NumberingSeries>): void => setDraft({ ...series, ...changes });

  const preview = facts.data
    ? previewNextNumber(series, facts.data.allocation, todayIso())
    : null;

  const save = async (): Promise<void> => {
    if (!db || !draft) return;
    setSaving(true);
    setError(null);
    try {
      await saveSeries(db, draft);
      setDraft(null);
      seriesQuery.refresh();
      facts.refresh();
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

      <ChipGroup
        options={DOCUMENT_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] }))}
        value={activeType}
        onChange={(type) => {
          setDraft(null);
          setActiveType(type);
        }}
      />

      <Card>
        <Caption>{t('numberingPreview')}</Caption>
        <Body>{preview ?? '—'}</Body>
        <Caption>
          Drafts do not take a number. It is assigned when you send or share the document.
        </Caption>
      </Card>

      <TextField
        label={t('numberingPrefix')}
        value={series.prefix}
        onChangeText={(value) => patch({ prefix: value })}
        autoCapitalize="characters"
        hint="For example CP/INV/"
      />
      <TextField
        label={t('numberingSuffix')}
        value={series.suffix}
        onChangeText={(value) => patch({ suffix: value })}
        autoCapitalize="characters"
      />

      <SwitchRow
        label={t('numberingIncludeFy')}
        description="Indian financial year, 1 April to 31 March."
        value={series.includeFy}
        onValueChange={(value) => patch({ includeFy: value })}
      />

      {series.includeFy ? (
        <>
          <Field label={t('numberingFyFormat')}>
            <ChipGroup
              options={[
                { value: '2026-27' as FyFormat, label: '2026-27' },
                { value: '26-27' as FyFormat, label: '26-27' },
              ]}
              value={series.fyFormat}
              onChange={(format) => patch({ fyFormat: format })}
            />
          </Field>
          <TextField
            label="Separator after the year"
            value={series.fySeparator}
            onChangeText={(value) => patch({ fySeparator: value })}
            hint="Printed between the financial year and the number."
          />
        </>
      ) : null}

      <TextField
        label={t('numberingPadWidth')}
        value={String(series.padWidth)}
        onChangeText={(value) => patch({ padWidth: Math.max(1, Math.min(9, Number(value) || 1)) })}
        keyboardType="numeric"
        align="right"
        hint="3 gives 001."
      />

      <TextField
        label={t('numberingNextSeq')}
        value={String(series.nextSeq)}
        onChangeText={(value) => patch({ nextSeq: Math.max(1, Number(value) || 1) })}
        keyboardType="numeric"
        align="right"
        hint="A number already in use is skipped automatically."
      />

      <Field label={t('numberingResetRule')}>
        <OptionList
          options={[
            { value: 'never' as ResetRule, label: t('numberingResetNever') },
            {
              value: 'yearly_april' as ResetRule,
              label: t('numberingResetYearly'),
              description: 'Numbering restarts at 001 in each new financial year.',
            },
          ]}
          value={series.resetRule}
          onChange={(rule) => patch({ resetRule: rule })}
        />
      </Field>

      {facts.data && facts.data.gaps.length > 0 ? (
        <Card>
          <Caption>{t('numberingGaps', { list: facts.data.gaps.join(', ') })}</Caption>
          <Caption>
            Gaps usually mean a document was deleted after being numbered.
          </Caption>
        </Card>
      ) : null}

      <View>
        <Button
          label={t('save')}
          onPress={() => void save()}
          loading={saving}
          disabled={draft === null}
        />
      </View>

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}
