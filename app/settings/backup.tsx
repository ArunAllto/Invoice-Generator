/**
 * Settings → Backup and restore (§11, acceptance §14.15).
 *
 * Export writes one JSON file holding every table plus the logo and signature as base64, and
 * hands it to the share sheet. Import validates the file's format version, states exactly
 * what it contains, and asks before overwriting — because restore is destructive and the
 * thing being destroyed is the owner's only copy of their invoices.
 */

import React, { useState } from 'react';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

import {
  Body,
  Button,
  Caption,
  Card,
  ConfirmDialog,
  ErrorNotice,
  Screen,
  SectionTitle,
  Snackbar,
} from '../../src/components/ui';
import { closeDatabase } from '../../src/db';
import {
  createBackup,
  describeBackupProblem,
  parseBackupFile,
  restoreBackup,
  shareBackup,
  type ParsedBackup,
} from '../../src/db/backup';
import { clearImageCache } from '../../src/render/prepare';
import { clearExportCache } from '../../src/export';
import { useDatabase } from '../../src/hooks/useDatabase';
import { t } from '../../src/strings';

export default function BackupScreen(): React.ReactElement {
  const { db } = useDatabase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const doExport = async (): Promise<void> => {
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createBackup(db, appVersion);
      await shareBackup(result);
      setToast(t('backupExportDone'));
    } catch (cause) {
      setError({
        message: 'The backup could not be created.',
        detail: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  const pickAndParse = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // The system picker returns a content URI; copy it into the cache first so the JSON can
      // be read with the plain file API.
      const picked = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!picked.granted) {
        setError({ message: t('permissionDenied') });
        return;
      }
      const files = await FileSystem.StorageAccessFramework.readDirectoryAsync(picked.directoryUri);
      const candidates = files.filter((uri) => uri.toLowerCase().includes('.json'));

      if (candidates.length === 0) {
        setError({ message: 'No .json backup file was found in that folder.' });
        return;
      }

      // Most recent CraftyDocs backup in the chosen folder: the filenames carry the date, so
      // the last one alphabetically is the newest.
      const chosen = candidates.sort().reverse()[0];
      if (!chosen) return;

      const parsed = await parseBackupFile(chosen);
      if ('kind' in parsed) {
        setError({ message: describeBackupProblem(parsed) });
        return;
      }
      setPending(parsed);
    } catch (cause) {
      setError({
        message: 'That file could not be read.',
        detail: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (): Promise<void> => {
    if (!db || !pending) return;
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(db, pending.backup);
      // Anything derived from the old data has to go: cached logo bytes and cached exports
      // would otherwise belong to documents that no longer exist.
      clearImageCache();
      clearExportCache();
      setPending(null);
      setToast(t('backupImportDone'));
    } catch (cause) {
      setError({
        message: 'The restore did not complete.',
        detail: cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {error ? <ErrorNotice message={error.message} detail={error.detail ?? null} /> : null}

      <SectionTitle>Backup</SectionTitle>
      <Card>
        <Body>
          One file holds every document, client, catalogue item, setting, plus your logo and
          signature. Keep it somewhere off the phone — Drive, email to yourself, a computer.
        </Body>
        <Caption>Nothing is uploaded anywhere by the app itself; you choose where it goes.</Caption>
      </Card>
      <Button label={t('backupExport')} onPress={() => void doExport()} loading={busy} />

      <SectionTitle>Restore</SectionTitle>
      <Card>
        <Body>{t('backupImportWarning')}</Body>
        <Caption>
          Choose the folder holding your backup; the most recent CraftyDocs backup in it is
          offered.
        </Caption>
      </Card>
      <Button
        label={t('backupImport')}
        variant="secondary"
        onPress={() => void pickAndParse()}
        loading={busy}
      />

      <ConfirmDialog
        visible={pending !== null}
        title="Restore this backup?"
        message={
          pending
            ? `Made ${pending.backup.createdAt.slice(0, 10)} by app v${pending.backup.appVersion}. ` +
              `Contains ${pending.summary.documents} document(s), ${pending.summary.clients} client(s), ` +
              `${pending.summary.catalogue} catalogue item(s). ${t('backupImportWarning')}`
            : undefined
        }
        confirmLabel="Replace everything"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => void doRestore()}
      />

      <Caption>
        After a restore, close and reopen the app so every screen reads the new data.
      </Caption>
      <Button
        label="Close the database now"
        variant="ghost"
        onPress={() => void closeDatabase()}
      />

      {toast ? <Snackbar message={toast} onHide={() => setToast(null)} duration={6000} /> : null}
    </Screen>
  );
}
