import { Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
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
import { printOutline } from 'ionicons/icons';

import { buildUpiQrSvg } from '../../../core/qr';
import { DocumentsRepository, type FullDocument } from '../../../data/repositories/documents.repository';
import { countPages, renderDocumentHtml } from '../../../render/html';
import { toRenderInput } from '../../../render/adapt';
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
    addIcons({ printOutline });
  }

  async ngOnInit(): Promise<void> {
    const loaded = await this.repository.get(this.id());
    if (!loaded) {
      this.loading.set(false);
      this.toast.show('That document no longer exists.');
      return;
    }

    const calc = this.repository.calculate(loaded.document, loaded.lines);
    const input = toRenderInput(
      { document: loaded.document, lines: loaded.lines, calc, derived: loaded.derived },
      { forScreen: true, upiQrSvg: this.upiQr(loaded, calc.grandTotal) },
    );

    this.loaded.set(loaded);
    this.pageCount.set(countPages(input));
    this.html.set(renderDocumentHtml(input));
    this.loading.set(false);
  }

  /**
   * The UPI QR, when the document asks for one and there is a VPA to pay.
   *
   * Built here rather than in the adapter because encoding a QR is real work — a few thousand
   * operations — and the adapter is called for every export variant, once per page. Handing it a
   * finished SVG keeps that cost paid once.
   */
  private upiQr(loaded: FullDocument, grandTotal: number): string | null {
    const { document: record } = loaded;
    const vpa = record.businessSnapshot.upiId;
    if (!record.blocks.upiQr || !vpa || vpa.trim().length === 0) return null;

    try {
      return buildUpiQrSvg({
        vpa,
        payeeName: record.businessSnapshot.name,
        // Invoices ask for what is still owed; anything else encodes an open amount, since asking
        // for the full total of a part-paid invoice would collect the money twice.
        amountPaise: record.type === 'invoice' ? loaded.derived.balance || grandTotal : null,
        note: record.number,
      });
    } catch {
      // A QR that will not encode must not take the preview down with it. The document is still
      // perfectly readable without the code.
      return null;
    }
  }

  /**
   * Hand the rendered document to the browser's print dialogue.
   *
   * Printing the iframe rather than the host page is what makes this work: the host page is an Ionic
   * app shell, and printing it would produce a screenshot of a phone UI. `contentWindow.print()`
   * prints the document's own page, with its own page rules.
   */
  print(): void {
    const frame = document.querySelector<HTMLIFrameElement>('#cd-preview-frame');
    const view = frame?.contentWindow;
    if (!view) {
      this.toast.show('The preview is not ready yet.');
      return;
    }
    view.focus();
    view.print();
  }
}
