/**
 * Settings → Saved terms & conditions blocks (§5.8, §6.2 item 7).
 *
 * The seeded quotation block holds the seven clauses the owner already uses. Editing a block
 * here changes what future documents start with; a document's own terms are a copy, so past
 * documents keep the wording they were issued with.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Card,
  ChipGroup,
  ConfirmDialog,
  ErrorNotice,
  Field,
  ListRow,
  Loading,
  Screen,
  Snackbar,
  SwitchRow,
  TextField,
} from '../../src/components/ui';
import { uuid } from '../../src/core/ids';
import type { DocumentType } from '../../src/core/types';
import {
  deleteTermsBlock,
  listTermsBlocks,
  saveTermsBlock,
  type TermsBlock,
} from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { palette, spacing } from '../../src/theme';

const SCOPE_OPTIONS: Array<{ value: DocumentType | 'all'; label: string }> = [
  { value: 'all', label: t('all') },
  { value: 'quotation', label: t('quotation') },
  { value: 'invoice', label: t('invoice') },
  { value: 'receipt', label: t('receipt') },
];

export default function TermsSettingsScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [editing, setEditing] = useState<TermsBlock | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TermsBlock | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const blocks = useQuery((database) => listTermsBlocks(database), []);

  const startNew = (): void =>
    setEditing({
      id: uuid(),
      title: '',
      body: '',
      docType: 'quotation',
      isDefault: false,
      position: (blocks.data?.length ?? 0) + 1,
    });

  const save = async (): Promise<void> => {
    if (!db || !editing) return;
    if (editing.title.trim().length === 0 || editing.body.trim().length === 0) {
      setError('A block needs both a title and some text.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveTermsBlock(db, editing);
      setEditing(null);
      blocks.refresh();
      setToast(t('saved'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (blocks.loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (editing) {
    return (
      <Screen>
        {error ? <ErrorNotice message={error} /> : null}
        <TextField
          label={t('termsTitle')}
          value={editing.title}
          onChangeText={(value) => setEditing({ ...editing, title: value })}
          required
        />
        <Field label="Applies to">
          <ChipGroup
            options={SCOPE_OPTIONS}
            value={editing.docType}
            onChange={(scope) => setEditing({ ...editing, docType: scope })}
          />
        </Field>
        <TextField
          label={t('termsBody')}
          value={editing.body}
          onChangeText={(value) => setEditing({ ...editing, body: value })}
          multiline
          numberOfLines={12}
          required
          hint="One clause per line."
        />
        <SwitchRow
          label={t('termsDefault')}
          description="Pre-filled on new documents of this type."
          value={editing.isDefault}
          onValueChange={(value) => setEditing({ ...editing, isDefault: value })}
        />
        <Button label={t('save')} onPress={() => void save()} loading={saving} />
        <Button label={t('cancel')} variant="ghost" onPress={() => setEditing(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Card padded={false}>
        {(blocks.data ?? []).map((block, index) => (
          <View key={block.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <ListRow
              title={block.title}
              subtitle={block.body.split('\n')[0]}
              onPress={() => setEditing(block)}
              onLongPress={() => setPendingDelete(block)}
              accessibilityHint="Long press to delete"
              right={
                <View style={styles.rowRight}>
                  <Badge
                    label={block.docType === 'all' ? t('all') : block.docType}
                    tone="neutral"
                  />
                  {block.isDefault ? <Badge label="Default" tone="positive" /> : null}
                </View>
              }
            />
          </View>
        ))}
      </Card>

      <Button label={t('termsAdd')} onPress={startNew} />
      <Body muted>
        A document keeps its own copy of the terms, so editing a block here never changes a
        document you have already issued.
      </Body>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this terms block?"
        confirmLabel={t('delete')}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (db && pendingDelete) await deleteTermsBlock(db, pendingDelete.id);
          setPendingDelete(null);
          blocks.refresh();
        }}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
  rowRight: { alignItems: 'flex-end', gap: 4 },
});
