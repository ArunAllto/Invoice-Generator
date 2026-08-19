/**
 * Clients tab — list, search, add, archive (§4, §5.2).
 */

import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import {
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorNotice,
  ListRow,
  Loading,
  Screen,
  StatusPill,
  SwitchRow,
} from '../../src/components/ui';
import { listClients } from '../../src/db/masters';
import { useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { fontSize, palette, radius, spacing, TOUCH_TARGET } from '../../src/theme';

export default function ClientsScreen(): React.ReactElement {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = useQuery(
    (db) => listClients(db, { search, includeArchived }),
    [search, includeArchived],
  );
  const clients = query.data ?? [];

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={t('clientSearch')}
          placeholderTextColor={palette.inkFaint}
          accessibilityLabel={t('clientSearch')}
        />
        <Button label={t('add')} onPress={() => router.push('/client/new')} />
      </View>

      <SwitchRow
        label="Show archived clients"
        description="Archived clients stay off the pickers but keep their old documents."
        value={includeArchived}
        onValueChange={setIncludeArchived}
      />

      {query.error ? (
        <ErrorNotice message={t('errorGeneric')} detail={query.error.message} onRetry={query.refresh} />
      ) : query.loading ? (
        <Loading />
      ) : clients.length === 0 ? (
        <EmptyState
          title={t('clientEmpty')}
          message="Add a client once and reuse them on every document."
          action={<Button label={t('clientAddNew')} onPress={() => router.push('/client/new')} />}
        />
      ) : (
        <FlashList
          data={clients}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <Card padded={false} style={styles.rowCard}>
              <ListRow
                title={item.company || item.name}
                subtitle={
                  [item.company ? item.name : '', item.city, item.phone]
                    .filter((part) => part && part.length > 0)
                    .join(' · ') || null
                }
                onPress={() => router.push(`/client/${item.id}`)}
                right={
                  <View style={styles.rowRight}>
                    {item.archived ? <StatusPill label="Archived" tone="neutral" /> : null}
                    {item.gstin ? <Caption>GST</Caption> : null}
                  </View>
                }
              />
            </Card>
          )}
        />
      )}
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
});
