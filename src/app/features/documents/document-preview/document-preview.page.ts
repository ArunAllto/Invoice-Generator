import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  ActionSheetController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { shareOutline } from 'ionicons/icons';

import { DocumentsRepository, type FullDocument } from '../../../data/repositories/documents.repository';
import { buildExportFilename } from '../../../export/filename';
import { ExportService } from '../../../export/export.service';
import { countPages, renderDocumentHtml } from '../../../render/html';
import { toRenderInput } from '../../../render/adapt';
import { buildDocumentUpiQr } from '../../../render/upi-qr';
import { ToastService } from '../../../shared/ui/toast.service';

/**
 * Full-page document preview (§10.2).
 *
 * ## Why an iframe and not just innerHTML
 *
 * The rendered document is a complete HTML page with its own stylesheet — page rules, table layout,
 * a font stack, an accent colour. Injected into the app's DOM it would collide with Ionic's styles
 * in both directions: the document's `table`/`h1` rules would leak out, and Ionic's reset would
 * quietly change the thing the owner is checking before they send it. An iframe with `srcdoc` gives
 * the document its own styling context, which is also exactly the context the PDF exporter will
 * render it in — so what is on screen is what will be in the file.
 *
 * ## Why the page count comes from `countPages`
 *
 * Chromium never implemented the `@page` margin boxes, so "Page 2 of 3" cannot come from CSS. The
 * renderer paginates explicitly and `countPages` reports the same answer, which means the count in
 * the toolbar and the count printed in the footer come from one calculation rather than two.
 */
@Component({
  selector: 'app-document-preview',
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonNote,
    IonSpinner,
  ],
  templateUrl: './document-preview.page.html',
  styleUrl: './document-preview.page.scss',
})
export class DocumentPreviewPage implements OnInit {
  private readonly repository = inject(DocumentsRepository);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(ToastService);
  private readonly exports = inject(ExportService);
  private readonly sheets = inject(ActionSheetController);

  /** Bound by `withComponentInputBinding` from `document/:id/preview`. */
  readonly id = input.required<string>();

  readonly loaded = signal<FullDocument | null>(null);
  readonly loading = signal(true);
  readonly html = signal<string>('');
  readonly pageCount = signal(0);

  readonly heading = computed(() => {
    const doc = this.loaded()?.document;
    if (!doc) return 'Preview';
    return doc.number.trim().length > 0 ? doc.number : 'Draft';
  });

  /**
   * The document markup, marked safe for `srcdoc`.
   *
   * Bypassing the sanitizer is safe here and would be wrong to skip: Angular strips a full HTML
   * document down to fragments, which destroys the stylesheet the document depends on. Every string
   * that reaches the markup has already gone through `escapeHtml` in the renderer, which is the
   * layer that actually knows which values are data.
   */
  readonly safeHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.html()),
  );

  constructor() {
    addIcons({ shareOutline });
  }

  async ngOnInit(): Promise<void> {
    const loaded = await this.repository.get(this.id());
    if (!loaded) {
      this.loading.set(false);
      this.toast.error('That document no longer exists.');
      return;
    }

    const calc = this.repository.calculate(loaded.document, loaded.lines);
    const input = toRenderInput(
      { document: loaded.document, lines: loaded.lines, calc, derived: loaded.derived },
      {
        forScreen: true,
        upiQrSvg: buildDocumentUpiQr({
          document: loaded.document,
          balance: loaded.derived.balance,
          grandTotal: calc.grandTotal,
        }),
      },
    );

    this.loaded.set(loaded);
    this.pageCount.set(countPages(input));
    this.html.set(renderDocumentHtml(input));
    this.loading.set(false);
  }

  /**
   * The export sheet.
   *
   * Print goes first because "Save as PDF" lives *inside* the platform print dialogue — it is the
   * route to a PDF, not an alternative to one.
   */
  async openExport(): Promise<void> {
    const loaded = this.loaded();
    if (!loaded) return;

    const buttons: Array<{ text: string; role?: 'cancel' | 'destructive'; handler?: () => void }> = [
      { text: 'Print or save as PDF', handler: () => void this.print() },
      { text: 'Save as an HTML file', handler: () => this.exports.saveHtml(this.payload()) },
    ];
    if (this.exports.canShareFiles || this.exports.canShareText) {
      buttons.push({ text: 'Share…', handler: () => void this.shareDocument() });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });

    const sheet = await this.sheets.create({
      header: this.heading(),
      subHeader: `${this.pageCount()} ${this.pageCount() === 1 ? 'page' : 'pages'} · A4`,
      buttons,
    });
    await sheet.present();
  }

  /** The rendered document plus the name it should be saved under. */
  private payload(): { html: string; baseName: string } {
    const loaded = this.loaded();
    const record = loaded?.document;
    const filename = buildExportFilename({
      type: record?.type ?? 'invoice',
      number: record?.number ?? '',
      clientName: record?.clientSnapshot?.company || record?.clientSnapshot?.name || null,
      businessName: record?.businessSnapshot.name ?? null,
      extension: 'html',
    });
    return { html: this.html(), baseName: filename.replace(/.html$/, '') };
  }

  private async shareDocument(): Promise<void> {
    await this.exports.share(this.payload(), this.heading());
  }

  /**
   * Print the document.
   *
   * Prints the iframe already on screen rather than building another: the host page is an Ionic
   * shell, and printing *that* would produce a screenshot of a phone UI. Reusing the visible frame
   * also makes it impossible for the printed page to differ from the one just reviewed.
   */
  async print(): Promise<void> {
    const frame = document.querySelector<HTMLIFrameElement>('#cd-preview-frame');
    if (!frame?.contentWindow) {
      this.toast.warning('The preview is not ready yet.');
      return;
    }
    await this.exports.print(this.payload(), frame);
  }
}
