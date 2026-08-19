/**
 * Client add / edit — spec §4 and §5.2.
 *
 * The route takes `new` to create, or a client id to edit. Deleting a client who appears on
 * a document archives them instead (§5.2: "archived clients hide from pickers but keep old
 * documents intact"), and the screen says which of the two happened rather than leaving the
 * user guessing.
 */

import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  Button,
  Caption,
  Collapsible,
  ConfirmDialog,
  ErrorNotice,
  Loading,
  Screen,
  Snackbar,
  SwitchRow,
  TextField,
  Title,
} from '../../src/components/ui';
import { validateGstin } from '../../src/core/gst';
import { listCustomFieldDefs } from '../../src/db/masters';
import {
  deleteOrArchiveClient,
  emptyClient,
  getClient,
  saveClient,
  type Client,
} from '../../src/db/masters';
import { useDatabase, useQuery } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

export default function ClientScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db } = useDatabase();

  const isNew = id === 'new';
  const [client, setClient] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedName, setTouchedName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const fieldDefs = useQuery((database) => listCustomFieldDefs(database, 'client'), []);

  useEffect(() => {
    if (!db) return;
    let cancelled = false;
    if (isNew) {
      setClient(emptyClient());
      return;
    }
    void getClient(db, id).then((loaded) => {
      if (!cancelled) setClient(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [db, id, isNew]);

  if (!client) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  const patch = (changes: Partial<Client>): void =>
    setClient((current) => (current ? { ...current, ...changes } : current));

  const nameMissing = client.name.trim().length === 0 && client.company.trim().length === 0;
  const gstinProblem = client.gstin ? validateGstin(client.gstin) : null;

  const submit = async (): Promise<void> => {
    if (!db) return;
    setTouchedName(true);
    if (nameMissing) return;
    setSaving(true);
    setError(null);
    try {
      await saveClient(db, client);
      router.back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Title>{isNew ? t('clientAddNew') : client.company || client.name}</Title>
      {error ? <ErrorNotice message={t('errorGeneric')} detail={error} /> : null}

      <TextField
        label="Contact name"
        value={client.name}
        onChangeText={(value) => patch({ name: value })}
        onBlur={() => setTouchedName(true)}
        required
        error={touchedName && nameMissing ? 'Enter a name or a company.' : null}
      />
      <TextField
        label="Company"
        value={client.company}
        onChangeText={(value) => patch({ company: value })}
        hint="Printed in place of the contact name when set."
      />
      <TextField
        label={t('businessPhone')}
        value={client.phone}
        onChangeText={(value) => patch({ phone: value })}
        keyboardType="phone-pad"
      />
      <TextField
        label={t('businessEmail')}
        value={client.email}
        onChangeText={(value) => patch({ email: value })}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <Collapsible title={t('businessAddress')} initiallyOpen={false}>
        <TextField
          label={t('businessAddressLine1')}
          value={client.addressLine1}
          onChangeText={(value) => patch({ addressLine1: value })}
        />
        <TextField
          label={t('businessAddressLine2')}
          value={client.addressLine2}
          onChangeText={(value) => patch({ addressLine2: value })}
        />
        <TextField
          label={t('businessCity')}
          value={client.city}
          onChangeText={(value) => patch({ city: value })}
        />
        <TextField
          label={t('businessState')}
          value={client.state}
          onChangeText={(value) => patch({ state: value })}
          hint="Decides CGST+SGST versus IGST when this client has no GSTIN."
        />
        <TextField
          label={t('businessPincode')}
          value={client.pincode}
          onChangeText={(value) => patch({ pincode: value })}
          keyboardType="numeric"
        />
      </Collapsible>

      <TextField
        label={t('businessGstin')}
        value={client.gstin ?? ''}
        onChangeText={(value) => patch({ gstin: value.trim().length > 0 ? value.toUpperCase() : null })}
        autoCapitalize="characters"
        error={
          gstinProblem === 'format' || gstinProblem === 'checksum' || gstinProblem === 'unknown_state'
            ? t('businessGstinInvalid')
            : null
        }
      />

      {(fieldDefs.data ?? []).length > 0 ? (
        <Collapsible title={t('editorCustomFields')} initiallyOpen={false}>
          {(fieldDefs.data ?? []).map((def) => {
            const existing = client.customFields.find((field) => field.label === def.label);
            return (
              <TextField
                key={def.id}
                label={def.label}
                value={existing?.value ?? ''}
                keyboardType={def.fieldType === 'number' ? 'decimal-pad' : 'default'}
                onChangeText={(value) => {
                  const others = client.customFields.filter((field) => field.label !== def.label);
                  patch({
                    customFields:
                      value.trim().length > 0 ? [...others, { label: def.label, value }] : others,
                  });
                }}
              />
            );
          })}
        </Collapsible>
      ) : null}

      <TextField
        label="Notes"
        value={client.notes}
        onChangeText={(value) => patch({ notes: value })}
        multiline
      />

      {!isNew ? (
        <SwitchRow
          label="Archived"
          description="Hidden from pickers. Existing documents are unaffected."
          value={client.archived}
          onValueChange={(value) => patch({ archived: value })}
        />
      ) : null}

      <Button label={t('save')} onPress={() => void submit()} loading={saving} />

      {!isNew ? (
        <Button label={t('delete')} variant="danger" onPress={() => setConfirmDelete(true)} />
      ) : null}

      <ConfirmDialog
        visible={confirmDelete}
        title={t('confirmDeleteClient')}
        message="If this client appears on any document they will be archived instead, so those documents stay intact."
        confirmLabel={t('delete')}
        destructive
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!db) return;
          const outcome = await deleteOrArchiveClient(db, client.id);
          setConfirmDelete(false);
          if (outcome === 'archived') {
            setToast('This client is used on existing documents, so they were archived.');
            setClient({ ...client, archived: true });
          } else {
            router.back();
          }
        }}
      />

      <Caption>{isNew ? 'Saved details are reused on every document.' : null}</Caption>

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} duration={6000} /> : null}
    </Screen>
  );
}
