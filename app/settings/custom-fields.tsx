/**
 * Settings → Extra fields (§7.5).
 *
 * Fields can be defined at three levels — business, client and document — each with a label,
 * a type, and whether it prints. Document-level fields appear in the editor and render in the
 * output's header block.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  ChipGroup,
  ConfirmDialog,
  ErrorNotice,
  Field,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
  Snackbar,
  SwitchRow,
  TextField,
} from '../../src/components/ui';
import { uuid } from '../../src/core/ids';
import type { CustomFieldScope, CustomFieldType } from '../../src/core/types';
import {
  deleteCustomFieldDef,
  listCustomFieldDefs,
  saveCustomFieldDef,
  type CustomFieldDef,
} from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';
import { palette, spacing } from '../../src/theme';

const SCOPE_OPTIONS: Array<{ value: CustomFieldScope; label: string; description: string }> = [
  { value: 'document', label: 'Document', description: 'Asked for on each document, e.g. Project Code.' },
  { value: 'client', label: 'Client', description: 'Stored against a client, e.g. PO Number.' },
  { value: 'business', label: 'Business', description: 'Your own details, e.g. Licence No.' },
];

const TYPE_OPTIONS: Array<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: t('customFieldTypeText') },
  { value: 'number', label: t('customFieldTypeNumber') },
  { value: 'date', label: t('customFieldTypeDate') },
];

export default function CustomFieldsScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CustomFieldDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const defs = useQuery((database) => listCustomFieldDefs(database), []);

  const startNew = (): void =>
    setEditing({
      id: uuid(),
      label: '',
      fieldType: 'text',
      appliesTo: 'document',
      showOnDocument: true,
      position: (defs.data?.length ?? 0) + 1,
    });

  const save = async (): Promise<void> => {
    if (!db || !editing) return;
    if (editing.label.trim().length === 0) {
      setError('Give the field a label.');
      return;
    }
    setError(null);
    await saveCustomFieldDef(db, { ...editing, label: editing.label.trim() });
    setEditing(null);
    defs.refresh();
    setToast(t('saved'));
  };

  if (defs.loading) {
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
          label={t('customFieldLabel')}
          value={editing.label}
          onChangeText={(value) => setEditing({ ...editing, label: value })}
          required
          hint="Printed exactly as typed."
        />
        <Field label={t('customFieldAppliesTo')}>
          <ChipGroup
            options={SCOPE_OPTIONS}
            value={editing.appliesTo}
            onChange={(scope) => setEditing({ ...editing, appliesTo: scope })}
          />
        </Field>
        <Caption>{SCOPE_OPTIONS.find((option) => option.value === editing.appliesTo)?.description}</Caption>
        <Field label={t('customFieldType')}>
          <ChipGroup
            options={TYPE_OPTIONS}
            value={editing.fieldType}
            onChange={(fieldType) => setEditing({ ...editing, fieldType })}
          />
        </Field>
        <SwitchRow
          label={t('customFieldShowOnDocument')}
          value={editing.showOnDocument}
          onValueChange={(value) => setEditing({ ...editing, showOnDocument: value })}
        />
        <Button label={t('save')} onPress={() => void save()} />
        <Button label={t('cancel')} variant="ghost" onPress={() => setEditing(null)} />
      </Screen>
    );
  }

  const grouped = SCOPE_OPTIONS.map((scope) => ({
    scope,
    items: (defs.data ?? []).filter((def) => def.appliesTo === scope.value),
  }));

  return (
    <Screen>
      {grouped.map(({ scope, items }) => (
        <View key={scope.value}>
          <SectionTitle>{scope.label}</SectionTitle>
          {items.length === 0 ? (
            <Caption>None yet.</Caption>
          ) : (
            <Card padded={false}>
              {items.map((def, index) => (
                <View key={def.id}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <ListRow
                    title={def.label}
                    subtitle={TYPE_OPTIONS.find((option) => option.value === def.fieldType)?.label}
                    onPress={() => setEditing(def)}
                    onLongPress={() => setPendingDelete(def)}
                    accessibilityHint="Long press to delete"
                    right={
                      def.showOnDocument ? <Badge label="Printed" tone="info" /> : <Badge label="Hidden" tone="neutral" />
                    }
                  />
                </View>
              ))}
            </Card>
          )}
        </View>
      ))}

      <Button label={t('customFieldsAdd')} onPress={startNew} />
      <Body muted>
        Document fields appear in the editor's Extra fields section and print in the header
        block.
      </Body>

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Delete this field?"
        message="Values already stored on documents are kept."
        confirmLabel={t('delete')}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (db && pendingDelete) await deleteCustomFieldDef(db, pendingDelete.id);
          setPendingDelete(null);
          defs.refresh();
        }}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: palette.border, marginHorizontal: spacing.lg },
});
