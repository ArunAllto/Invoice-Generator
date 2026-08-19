/**
 * All Documents — spec §6.6.
 *
 * Filter chips by type and status, search across number/client/item names, sort by date or
 * amount, a date-range filter, and long-press for duplicate / delete / share.
 *
 * Uses `FlashList` per §11's requirement that 1,000 documents scroll at 60 fps.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import {
  Body,
  BottomSheet,
  Button,
  Caption,
  Card,
  ChipGroup,
  ConfirmDialog,
  EmptyState,
  ErrorNotice,
  ListRow,
  Loading,
  Screen,
  Snackbar,
  StatusPill,
  TextField,
} from '../../src/components/ui';
import { formatIsoDate, isValidIsoDate } from '../../src/core/dates';
import { formatPaise } from '../../src/core/money';
import { canHardDelete, statusLabel, statusTone } from '../../src/core/status';
import type { DocumentStatus, DocumentType } from '../../src/core/types';
import {
  deleteDocument,
  duplicateDocument,
  listDocuments,
  type DocumentListItem,
} from '../../src/db/documents';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { fontSize, fontWeight, palette, radius, spacing, TOUCH_TARGET } from '../../src/theme';

type TypeFilter = 'all' | DocumentType;
type StatusFilter = 'all' | DocumentStatus;
type SortKey = 'date' | 'amount';

const TYPE_OPTIONS = [
  { value: 'all' as TypeFilter, label: t('all') },
  { value: 'quotation' as TypeFilter, label: t('quotations') },
  { value: 'invoice' as TypeFilter, label: t('invoices') },
  { value: 'receipt' as TypeFilter, label: t('receipts') },
];

const STATUS_OPTIONS = [
  { value: 'all' as StatusFilter, label: t('all') },
  { value: 'draft' as StatusFilter, label: t('statusDraft') },
  { value: 'sent' as StatusFilter, label: t('statusSent') },
  { value: 'accepted' as StatusFilter, label: t('statusAccepted') },
  { value: 'partially_paid' as StatusFilter, label: t('statusPartiallyPaid') },
  { value: 'paid' as StatusFilter, label: t('statusPaid') },
  { value: 'overdue' as StatusFilter, label: t('statusOverdue') },
  { value: 'expired' as StatusFilter, label: t('statusExpired') },
  { value: 'cancelled' as StatusFilter, label: t('statusCancelled') },
];

const TYPE_LABELS: Record<DocumentType, string> = {
  quotation: t('quotation'),
  invoice: t('invoice'),
  receipt: t('receipt'),
};

export default function DocumentsScreen(): React.ReactElement {
  const router = useRouter();
  const { db } = useDatabase();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actionsFor, setActionsFor] = useState<DocumentListItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentListItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const query = useQuery(
    (database) =>
      listDocuments(database, {
        types: typeFilter === 'all' ? undefined : [typeFilter],
        statuses: statusFilter === 'all' ? undefined : [statusFilter],
        search,
        fromDate: isValidIsoDate(fromDate) ? fromDate : undefined,
        toDate: isValidIsoDate(toDate) ? toDate : undefined,
        sortBy,
        sortDirection: 'desc',
      }),
    [typeFilter, statusFilter, search, sortBy, fromDate, toDate],
  );

  const items = useMemo(() => query.data ?? [], [query.data]);

  const handleDuplicate = useCallback(
    async (item: DocumentListItem) => {
      if (!db) return;
      setActionsFor(null);
      const created = await duplicateDocument(db, item.id);
      router.push(`/doc/${created.document.id}/edit`);
    },
    [db, router],
  );

  const handleDelete = useCallback(async () => {
    if (!db || !pendingDelete) return;
    await deleteDocument(db, pendingDelete.id);
    setPendingDelete(null);
    setToast('Document deleted.');
    query.refresh();
  }, [db, pendingDelete, query]);

  const activeFilterCount =
    (typeFilter === 'all' ? 0 : 1) +
    (statusFilter === 'all' ? 0 : 1) +
    (isValidIsoDate(fromDate) ? 1 : 0) +
    (isValidIsoDate(toDate) ? 1 : 0);

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={t('documentsSearch')}
          placeholderTextColor={palette.inkFaint}
          accessibilityLabel={t('documentsSearch')}
          returnKeyType="search"
        />
        <Button
          label={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
          onPress={() => setFiltersOpen(true)}
          variant="secondary"
        />
      </View>

      <ChipGroup
        options={TYPE_OPTIONS}
        value={typeFilter}
        onChange={setTypeFilter}
        label={t('tabDocuments')}
      />

      {query.error ? (
        <ErrorNotice message={t('errorGeneric')} detail={query.error.message} onRetry={query.refresh} />
      ) : query.loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('documentsEmpty')}
          message={search.length > 0 ? undefined : 'Create one from the Home tab.'}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Card padded={false} style={styles.rowCard}>
              <ListRow
                title={`${TYPE_LABELS[item.type]} ${item.number || `(${t('statusDraft').toLowerCase()})`}`}
                subtitle={`${item.clientName || t('clientNone')} · ${formatIsoDate(item.issueDate)}`}
                onPress={() => router.push(`/doc/${item.id}/edit`)}
                onLongPress={() => setActionsFor(item)}
                accessibilityHint="Long press for more actions"
                right={
                  <View style={styles.rowRight}>
                    <Body style={styles.amount}>
                      ₹{formatPaise(item.grandTotal, { decimals: false })}
                    </Body>
                    <View style={styles.pillRow}>
                      {item.numberWarning ? <StatusPill label="Duplicate no." tone="warning" /> : null}
                      <StatusPill
                        label={statusLabel(item.derivedStatus)}
                        tone={statusTone(item.derivedStatus)}
                      />
                    </View>
                    {item.type === 'invoice' && item.balance > 0 && item.derivedStatus !== 'draft' ? (
                      <Caption>
                        {t('totalsBalance')} ₹{formatPaise(item.balance, { decimals: false })}
                      </Caption>
                    ) : null}
                  </View>
                }
              />
            </Card>
          )}
        />
      )}

      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        <Caption>Status</Caption>
        <ChipGroup options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} />
        <Caption>Sort by</Caption>
        <ChipGroup
          options={[
            { value: 'date' as SortKey, label: t('documentsSortDate') },
            { value: 'amount' as SortKey, label: t('documentsSortAmount') },
          ]}
          value={sortBy}
          onChange={setSortBy}
        />
        <TextField
          label={t('documentsFilterFrom')}
          value={fromDate}
          onChangeText={setFromDate}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"
          error={fromDate.length > 0 && !isValidIsoDate(fromDate) ? 'Use YYYY-MM-DD' : null}
        />
        <TextField
          label={t('documentsFilterTo')}
          value={toDate}
          onChangeText={setToDate}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"
          error={toDate.length > 0 && !isValidIsoDate(toDate) ? 'Use YYYY-MM-DD' : null}
        />
        <Button
          label="Clear all filters"
          variant="secondary"
          onPress={() => {
            setTypeFilter('all');
            setStatusFilter('all');
            setFromDate('');
            setToDate('');
            setSortBy('date');
          }}
        />
        <Button label={t('done')} onPress={() => setFiltersOpen(false)} />
      </BottomSheet>

      <BottomSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        title={actionsFor ? `${TYPE_LABELS[actionsFor.type]} ${actionsFor.number}` : ''}
      >
        <Button
          label={t('duplicate')}
          variant="secondary"
          onPress={() => {
            if (actionsFor) void handleDuplicate(actionsFor);
          }}
        />
        <Button
          label={t('export')}
          variant="secondary"
          onPress={() => {
            const target = actionsFor;
            setActionsFor(null);
            if (target) router.push(`/doc/${target.id}/export`);
          }}
        />
        {actionsFor && canHardDelete(actionsFor.type, actionsFor.status) ? (
          <Button
            label={t('delete')}
            variant="danger"
            onPress={() => {
              setPendingDelete(actionsFor);
              setActionsFor(null);
            }}
          />
        ) : (
          // §6.4: an issued receipt is never hard-deleted.
          <Caption>{t('confirmCancelReceipt')}</Caption>
        )}
      </BottomSheet>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={t('confirmDeleteDocument')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  search: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  listContent: { paddingBottom: spacing.xxl },
  separator: { height: spacing.sm },
  rowCard: { overflow: 'hidden' },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  pillRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' },
  amount: { fontWeight: fontWeight.semibold },
});
