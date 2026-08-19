/**
 * Catalogue item add / edit — spec §5.3, the table that powers "automated price".
 *
 * `new` creates, an id edits. As with clients, an item already used on a document is archived
 * rather than deleted, so old line items keep their link back to the catalogue entry.
 */

import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  Button,
  Caption,
  ChipGroup,
  ConfirmDialog,
  ErrorNotice,
  Field,
  Loading,
  Screen,
  Snackbar,
  SwitchRow,
  TextField,
  Title,
} from '../../src/components/ui';
import {
  formatBasisPoints,
  formatPaise,
  parseCurrencyToPaise,
  parsePercentToBasisPoints,
} from '../../src/core/money';
import { isGstEnabled } from '../../src/core/gst';
import {
  deleteOrArchiveCatalogueItem,
  emptyCatalogueItem,
  getBusinessProfile,
  getCatalogueItem,
  listTaxPresets,
  saveCatalogueItem,
  type CatalogueItem,
} from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

/** Units the owner actually bills in, per §5.3's examples. */
const UNIT_OPTIONS = ['nos', 'hour', 'day', 'poster', 'page', 'sq.ft', 'set'];

export default function CatalogueItemScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db } = useDatabase();

  const isNew = id === 'new';
  const [item, setItem] = useState<CatalogueItem | null>(null);
  const [rateDraft, setRateDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedName, setTouchedName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const taxPresets = useQuery((database) => listTaxPresets(database), []);
  const business = useQuery((database) => getBusinessProfile(database), []);
  const gstEnabled = isGstEnabled(business.data?.gstin);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    if (isNew) {
      const blank = emptyCatalogueItem();
      setItem(blank);
      setRateDraft(formatPaise(blank.defaultRate));
      return;
    }
    void getCatalogueItem(db, id).then((loaded) => {
      if (cancelled || !loaded) return;
      setItem(loaded);
      setRateDraft(formatPaise(loaded.defaultRate));
    });
    return () => {
      cancelled = true;
    };
  }, [db, id, isNew]);

  if (!item) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const patch = (changes: Partial<CatalogueItem>): void =>
    setItem((current) => (current ? { ...current, ...changes } : current));

  const nameMissing = item.name.trim().length === 0;

  const submit = async (): Promise<void> => {
    if (!db) return;
    setTouchedName(true);
    if (nameMissing) return;
    setSaving(true);
    setError(null);
    try {
      await saveCatalogueItem(db, item);
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Title>{isNew ? t('catalogueAdd') : item.name}</Title>
      {error ? <ErrorNotice message={t('errorGeneric')} detail={error} /> : null}

      <TextField
        label="Name"
        value={item.name}
        onChangeText={(value) => patch({ name: value })}
        onBlur={() => setTouchedName(true)}
        required
        error={touchedName && nameMissing ? 'Give this item a name.' : null}
      />

      <TextField
        label="Description"
        value={item.description}
        onChangeText={(value) => patch({ description: value })}
        multiline
        hint="Inserted automatically whenever this item is added to a document."
      />

      <TextField
        label={t('catalogueDefaultRate')}
        value={rateDraft}
        onChangeText={setRateDraft}
        onBlur={() => {
          const parsed = parseCurrencyToPaise(rateDraft);
          if (parsed === null || parsed < 0) setRateDraft(formatPaise(item.defaultRate));
          else {
            patch({ defaultRate: parsed });
            setRateDraft(formatPaise(parsed));
          }
        }}
        keyboardType="decimal-pad"
        align="right"
        hint={item.defaultRate === 0 ? t('catalogueRateZeroHint') : null}
      />

      <Field label={t('itemUnit')}>
        <ChipGroup
          options={UNIT_OPTIONS.map((unit) => ({ value: unit, label: unit }))}
          value={item.unit}
          onChange={(unit) => patch({ unit })}
        />
      </Field>
      <TextField
        label="Or type a unit"
        value={item.unit}
        onChangeText={(value) => patch({ unit: value })}
        autoCapitalize="none"
      />

      <TextField
        label={t('catalogueCategory')}
        value={item.category}
        onChangeText={(value) => patch({ category: value })}
        hint="Groups this item in the picker."
      />

      {/* §9.4: no GST fields anywhere when the business is not registered. */}
      {gstEnabled ? (
        <>
          <TextField
            label={t('itemHsn')}
            value={item.hsnSac ?? ''}
            onChangeText={(value) => patch({ hsnSac: value.trim().length > 0 ? value : null })}
            autoCapitalize="characters"
          />
          <Field label={t('itemTax')}>
            <ChipGroup
              options={(taxPresets.data ?? []).map((preset) => ({
                value: String(preset.rateBp),
                label: `${formatBasisPoints(preset.rateBp)}%`,
              }))}
              value={String(item.taxRateBp)}
              onChange={(value) => patch({ taxRateBp: Number(value) })}
            />
          </Field>
          <TextField
            label="Or type a rate %"
            value={formatBasisPoints(item.taxRateBp)}
            onChangeText={(value) => patch({ taxRateBp: parsePercentToBasisPoints(value) ?? 0 })}
            keyboardType="decimal-pad"
            align="right"
          />
        </>
      ) : null}

      <SwitchRow
        label={t('catalogueFavourite')}
        description="Favourites sort to the top of the picker."
        value={item.isFavourite}
        onValueChange={(value) => patch({ isFavourite: value })}
      />

      {!isNew ? (
        <>
          <SwitchRow
            label="Archived"
            description="Hidden from the picker. Existing documents are unaffected."
            value={item.archived}
            onValueChange={(value) => patch({ archived: value })}
          />
          <Caption>{t('catalogueTimesUsed', { count: item.timesUsed })}</Caption>
        </>
      ) : null}

      <Button label={t('save')} onPress={() => void submit()} loading={saving} />

      {!isNew ? (
        <Button label={t('delete')} variant="danger" onPress={() => setConfirmDelete(true)} />
      ) : null}

      <ConfirmDialog
        visible={confirmDelete}
        title={t('confirmDeleteItem')}
        message="If this item appears on any document it will be archived instead."
        confirmLabel={t('delete')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!db) return;
          const outcome = await deleteOrArchiveCatalogueItem(db, item.id);
          setConfirmDelete(false);
          if (outcome === 'archived') {
            setToast('This item is used on existing documents, so it was archived.');
            setItem({ ...item, archived: true });
          } else {
            router.back();
          }
        }}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} duration={6000} /> : null}
    </Screen>
  );
}
