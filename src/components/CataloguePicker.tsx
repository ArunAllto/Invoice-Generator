/**
 * The catalogue picker — spec §7.3's "automated path".
 *
 * Searchable, multi-select, and ordered exactly as the spec asks: favourites first, then
 * most-used, then alphabetical, grouped by category. The ordering comes from the SQL query
 * (`listCatalogueItems`); the grouping is applied here without disturbing it.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { formatBasisPoints, formatPaise } from '../core/money';
import type { CatalogueItem } from '../db/masters';
import { listCatalogueItems } from '../db/masters';
import { useQuery } from '../hooks/useDatabase';
import { t } from '../strings';
import { fontSize, fontWeight, palette, radius, spacing, TOUCH_TARGET } from '../theme';
import { Badge, BottomSheet, Button, Caption, EmptyState, Loading, SectionTitle } from './ui';

export function CataloguePickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (items: CatalogueItem[]) => void;
}): React.ReactElement {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const query = useQuery((db) => listCatalogueItems(db, { search }), [search, visible]);
  const items = query.data ?? [];

  /**
   * Group by category while preserving the query's ordering.
   *
   * A `Map` keeps insertion order, so the first category to appear is the one holding the
   * highest-priority item — favourites stay at the top of the sheet rather than being
   * pushed down by an alphabetical category sort.
   */
  const groups = useMemo(() => {
    const map = new Map<string, CatalogueItem[]>();
    for (const item of items) {
      const key = item.category.trim().length > 0 ? item.category : 'Other';
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()];
  }, [items]);

  const selectedItems = items.filter((item) => selected[item.id]);
  const count = selectedItems.length;

  const commit = (): void => {
    if (count === 0) return;
    onPick(selectedItems);
    setSelected({});
    setSearch('');
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('itemsAddFromCatalogue')}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder={t('catalogueSearch')}
        placeholderTextColor={palette.inkFaint}
        accessibilityLabel={t('catalogueSearch')}
      />

      {query.loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('catalogueEmpty')}
          message={search.length > 0 ? 'Nothing matches that search.' : t('catalogueRateZeroHint')}
        />
      ) : (
        groups.map(([category, group]) => (
          <View key={category} style={styles.group}>
            <SectionTitle>{category}</SectionTitle>
            {group.map((item) => {
              const isSelected = Boolean(selected[item.id]);
              return (
                <Pressable
                  key={item.id}
                  onPress={() =>
                    setSelected((current) => ({ ...current, [item.id]: !current[item.id] }))
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={item.name}
                  style={[styles.row, isSelected && styles.rowSelected]}
                >
                  <View style={styles.checkbox}>
                    {isSelected ? <View style={styles.checkboxDot} /> : null}
                  </View>
                  <View style={styles.rowText}>
                    <View style={styles.titleRow}>
                      <Caption style={styles.name}>{item.name}</Caption>
                      {item.isFavourite ? <Badge label="★" tone="warning" /> : null}
                    </View>
                    {item.description.length > 0 ? (
                      <Caption numberOfLines={2}>{item.description}</Caption>
                    ) : null}
                    <Caption>
                      {item.defaultRate === 0
                        ? t('catalogueRateZeroHint')
                        : `₹${formatPaise(item.defaultRate)} / ${item.unit}`}
                      {item.taxRateBp > 0 ? ` · ${formatBasisPoints(item.taxRateBp)}%` : ''}
                      {item.timesUsed > 0 ? ` · ${t('catalogueTimesUsed', { count: item.timesUsed })}` : ''}
                    </Caption>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))
      )}

      <Button
        label={count === 0 ? t('add') : t('catalogueAddSelected', { count })}
        onPress={commit}
        disabled={count === 0}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  search: {
    minHeight: TOUCH_TARGET,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    color: palette.ink,
    backgroundColor: palette.surface,
  },
  group: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  rowSelected: { backgroundColor: palette.navyLight },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: palette.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDot: { width: 12, height: 12, borderRadius: 2, backgroundColor: palette.navy },
  rowText: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { fontSize: fontSize.body, color: palette.ink, fontWeight: fontWeight.medium },
});
