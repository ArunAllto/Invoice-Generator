/**
 * The client picker — spec §6.2 item 2.
 *
 * Search, an inline "add new client" route, and the explicit "No client / walk-in" option
 * that omits the client block from the output entirely (§7.4).
 *
 * Picking a client copies their details into the document as a snapshot rather than storing
 * only a reference, per §5.4: editing a client next month must never rewrite an invoice
 * that was already issued.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import type { PartySnapshot } from '../db/documents';
import { clientToSnapshot } from '../db/documents';
import { listClients } from '../db/masters';
import { useQuery } from '../hooks/useDatabase';
import { t } from '../strings';
import { fontSize, fontWeight, palette, radius, spacing, TOUCH_TARGET } from '../theme';
import { BottomSheet, Button, Caption, EmptyState, Loading } from './ui';

export function ClientPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** `null` snapshot means walk-in: no client block on the document. */
  onPick: (snapshot: PartySnapshot | null, clientId: string | null) => void;
}): React.ReactElement {
  const router = useRouter();
  const [search, setSearch] = useState('');

  // Re-runs when the sheet opens, so a client added on the client screen appears at once.
  const query = useQuery((db) => listClients(db, { search }), [search, visible]);
  const clients = query.data ?? [];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('clientPick')}>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder={t('clientSearch')}
        placeholderTextColor={palette.inkFaint}
        accessibilityLabel={t('clientSearch')}
      />

      <Pressable
        onPress={() => {
          onPick(null, null);
          onClose();
        }}
        accessibilityRole="button"
        accessibilityLabel={t('clientNone')}
        style={styles.row}
      >
        <View style={styles.rowText}>
          <Caption style={styles.name}>{t('clientNone')}</Caption>
          <Caption>{t('clientNoneHint')}</Caption>
        </View>
      </Pressable>

      <Button
        label={t('clientAddNew')}
        variant="secondary"
        onPress={() => {
          onClose();
          router.push('/client/new');
        }}
      />

      {query.loading ? (
        <Loading />
      ) : clients.length === 0 ? (
        <EmptyState title={t('clientEmpty')} />
      ) : (
        clients.map((client) => (
          <Pressable
            key={client.id}
            onPress={() => {
              onPick(clientToSnapshot(client), client.id);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel={client.company || client.name}
            style={styles.row}
          >
            <View style={styles.rowText}>
              <Caption style={styles.name}>{client.company || client.name}</Caption>
              <Caption>
                {[client.company ? client.name : '', client.city, client.phone]
                  .filter((part) => part && part.length > 0)
                  .join(' · ')}
              </Caption>
              {client.gstin ? <Caption>GSTIN {client.gstin}</Caption> : null}
            </View>
          </Pressable>
        ))
      )}
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
  row: {
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  rowText: { gap: 2 },
  name: { fontSize: fontSize.body, color: palette.ink, fontWeight: fontWeight.medium },
});
