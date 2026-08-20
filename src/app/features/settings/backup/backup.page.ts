import { Component, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

import { BackupService, type BackupFile } from '../../../data/backup.service';
import { SqliteService } from '../../../data/sqlite.service';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Settings → Backup & restore (§13).
 *
 * The only screen in the app that can destroy data, so it is deliberately slow: choosing a file
 * describes what is in it and what will be lost, and only then offers to go ahead. Restore is
 * all-or-nothing inside one transaction, so an abandoned or broken restore leaves what was already
 * there untouched.
 *
 * ## Why the backup is offered as a download
 *
 * There is no account and no server (§1), so a backup only means something once it is off the
 * device. A blob download hands it to Android's own download manager, from where the owner can put
 * it in Drive, on a cable, or wherever they keep things — without this app needing storage
 * permission or an opinion about their filing.
 */
@Component({
  selector: 'app-backup',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './backup.page.html',
  styleUrl: './backup.page.scss',
})
export class BackupPage {
  private readonly backups = inject(BackupService);
  private readonly db = inject(SqliteService);
  private readonly alerts = inject(AlertController);
  private readonly toast = inject(ToastService);

  readonly busy = signal(false);
  readonly lastBackupName = signal<string | null>(null);
  readonly status = this.db.status;

  /**
   * Write a backup out as a downloaded file.
   *
   * The object URL is revoked on a timer rather than immediately: revoking it in the same tick can
   * cancel the download before the browser has finished reading the blob.
   */
  async exportBackup(): Promise<void> {
    this.busy.set(true);
    try {
      const file = await this.backups.createBackup();
      const name = this.backups.backupFilename(file.createdAt);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      this.lastBackupName.set(name);
      const rows = Object.values(file.tables).reduce((sum, list) => sum + (list?.length ?? 0), 0);
      this.toast.show(`${rows} rows written to ${name}.`, 3200);
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Read a chosen file, describe it, and ask before replacing anything.
   *
   * Parsing and validation happen before the confirmation, so a file that was never a backup is
   * rejected without the owner having agreed to wipe anything.
   */
  async onRestoreFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.busy.set(true);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That file is not valid JSON, so it is not a backup this app wrote.');
      }
      const { file: backup, counts } = this.backups.inspect(parsed);
      await this.confirmRestore(backup, counts);
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.busy.set(false);
    }
  }

  private async confirmRestore(backup: BackupFile, counts: Record<string, number>): Promise<void> {
    const summary = [
      `${counts['documents'] ?? 0} documents`,
      `${counts['clients'] ?? 0} clients`,
      `${counts['catalogue_items'] ?? 0} catalogue items`,
      `${counts['payments'] ?? 0} payments`,
    ].join(', ');

    const alert = await this.alerts.create({
      header: 'Replace everything?',
      message:
        `This backup was taken on ${backup.createdAt.slice(0, 10)} and holds ${summary}. ` +
        'Everything currently on this device will be deleted and replaced. This cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Replace',
          role: 'destructive',
          handler: () => {
            void this.runRestore(backup);
          },
        },
      ],
    });
    await alert.present();
  }

  private async runRestore(backup: BackupFile): Promise<void> {
    this.busy.set(true);
    try {
      const summary = await this.backups.restore(backup);
      this.toast.show(`Restored ${summary.totalRows} rows. Reopening the app…`, 3200);
      // A full reload rather than refreshing each screen: every page holds its own loaded copy of
      // the data, and there is no reliable way to tell all of them that the ground moved. Reloading
      // is what the owner would do anyway, so the app does it for them.
      setTimeout(() => window.location.assign('/tabs/home'), 1200);
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.busy.set(false);
    }
  }

  /** Wipe everything, for handing the phone on or starting again. */
  async eraseEverything(): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Delete everything?',
      message:
        'Every document, client and setting on this device will be deleted. If you have not taken ' +
        'a backup, there is no way to get any of it back.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete everything',
          role: 'destructive',
          handler: () => {
            void this.runErase();
          },
        },
      ],
    });
    await alert.present();
  }

  private async runErase(): Promise<void> {
    this.busy.set(true);
    try {
      await this.db.clearAllData();
      this.toast.show('Everything deleted. Reopening the app…', 3200);
      setTimeout(() => window.location.assign('/tabs/home'), 1200);
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      this.busy.set(false);
    }
  }
}
