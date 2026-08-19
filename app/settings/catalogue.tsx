/**
 * Settings → Item & service catalogue (§5.3).
 *
 * The list is ordered exactly as the picker orders it, so what the owner arranges here is
 * what they will see when adding lines to a document.
 */

import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorNotice,
  ListRow,
  Loading,
  Screen,
  SwitchRow,
} from '../../src/components/ui';
import { formatBasisPoints, formatPaise } from '../../src/core/money';
import { listCatalogueItems, toggleCatalogueFavourite } from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { fontSize, palette, radius, spacing, TOUCH_TARGET } from '../../src/theme';

export default function CatalogueSettingsScreen(): React.ReactElement {
  const router = useRouter();
  const { db } = useDatabase();
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = useQuery(
    (database) => listCatalogueItems(database, { search, includeArchived }),
    [search, includeArchived],
  );
  const items = query.data ?? [];
  const unpriced = items.filter((item) => item.defaultRate === 0 && !item.archived).length;

  return (
    <Screen>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={t('catalogueSearch')}
          placeholderTextColor={palette.inkFaint}
          accessibilityLabel={t('catalogueSearch')}
        />
        <Button label={t('add')} onPress={() => router.push('/item/new')} />
      </View>

      {unpriced > 0 ? (
        <Card>
          <Caption>
            {unpriced} item{unpriced === 1 ? '' : 's'} still priced at ₹0. {t('catalogueRateZeroHint')}
          </Caption>
        </Card>
      ) : null}

      <SwitchRow
        label="Show archived items"
        value={includeArchived}
        onValueChange={setIncludeArchived}
      />

      {query.error ? (
        <ErrorNotice message={t('errorGeneric')} detail={query.error.message} onRetry={query.refresh} />
      ) : query.loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          title={t('catalogueEmpty')}
          message="Add the things you sell so their prices fill in automatically."
          action={<Button label={t('catalogueAdd')} onPress={() => router.push('/item/new')} />}
        />
      ) : (
        <Card padded={false}>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <ListRow
                title={item.name}
                subtitle={
                  [
                    item.defaultRate === 0 ? 'No rate set' : `₹${formatPaise(item.defaultRate)} / ${item.unit}`,
                    item.taxRateBp > 0 ? `${formatBasisPoints(item.taxRateBp)}%` : '',
                    item.category,
                  ]
                    .filter((part) => part.length > 0)
                    .join(' · ') || null
                }
                onPress={() => router.push(`/item/${item.id}`)}
                onLongPress={async () => {
                  if (!db) return;
                  await toggleCatalogueFavourite(db, item.id);
                  query.refresh();
                }}
                accessibilityHint="Long press to toggle favourite"
                right={
                  <View style={styles.rowRight}>
                    {item.isFavourite ? <Badge label="★" tone="warning" /> : null}
                    {item.archived ? <Badge label="Archived" tone="neutral" /> : null}
                    {item.timesUsed > 0 ? <Caption>{item.timesUsed}×</Caption> : null}
                  </View>
                }
              />
            </View>
          ))}
        </Card>
      )}

      <Body muted>
        Favourites sort to the top of the picker, then the items you use most.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  divider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
  rowRight: { alignItems: 'flex-end', gap: 4 },
});
