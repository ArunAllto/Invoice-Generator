/**
 * Getting a finished document out of the app (§10.2, §10.5).
 *
 * ## What this does and does not do
 *
 * Three routes out, all of which work with no native plugin and no extra dependency:
 *
 * - **Print / Save as PDF** — hands the rendered document to the platform print dialogue, which on
 *   both Android and desktop offers "Save as PDF". This is a real PDF of the real document, produced
 *   by the same engine that laid out the preview, so it cannot disagree with what was on screen.
 * - **Save as HTML** — one self-contained `.html` file. Every image is already a `data:` URI and the
 *   stylesheet is inline (§10.1), so the file renders identically on a machine that has never seen
 *   this app. It opens in any browser and prints from there.
 * - **Share** — the Web Share API, when the platform has it. Android's WebView does, so this reaches
 *   WhatsApp and Gmail directly, which is how these documents actually get delivered.
 *
 * A generated PDF *byte stream* (rather than via the print dialogue), DOCX, and PNG per page are all
 * still unwritten: each needs a library — `pdf-lib`, `docx`, and a canvas rasteriser respectively —
 * and adding one to produce a worse result than the print dialogue already gives would be a poor
 * trade. `render/html.ts` already accepts `pixelWidth` and `onlyPage` for the image path when it
 * comes.
 *
 * ## Why printing goes through a detached iframe
 *
 * `window.print()` on the app itself would print the Ionic shell — a screenshot of a phone UI. The
 * document has to be printed from its *own* browsing context, which means an iframe holding just
 * that HTML. The preview screen already has one; everywhere else needs a throwaway.
 */

import { Injectable, inject } from '@angular/core';

import { ToastService } from '../shared/ui/toast.service';

export interface ExportPayload {
  /** A complete HTML document, as produced by `renderDocumentHtml`. */
  html: string;
  /** Filename without extension, from `export/filename.ts`. */
  baseName: string;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly toast = inject(ToastService);

  /** Whether this platform can share a file, so the UI can leave the option out rather than fail. */
  readonly canShareFiles = (() => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
    try {
      const probe = new File(['x'], 'probe.html', { type: 'text/html' });
      return navigator.canShare({ files: [probe] });
    } catch {
      return false;
    }
  })();

  /** Whether plain text/URL sharing is available, as a fallback when files are not. */
  readonly canShareText = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  /**
   * Save the document as a self-contained HTML file.
   *
   * The object URL is revoked on a timer rather than immediately: revoking in the same tick can
   * cancel the download before the browser has finished reading the blob.
   */
  saveHtml(payload: ExportPayload): void {
    try {
      const blob = new Blob([payload.html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${payload.baseName}.html`;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      this.toast.success(`Saved ${payload.baseName}.html`);
    } catch (cause) {
      this.toast.error(cause);
    }
  }

  /**
   * Open the platform print dialogue on the document.
   *
   * `existingFrame` lets the preview screen print the iframe it is already showing, rather than
   * building a second one — printing the frame the owner is looking at is both faster and impossible
   * to get out of step with what they reviewed.
   */
  async print(payload: ExportPayload, existingFrame?: HTMLIFrameElement | null): Promise<void> {
    if (existingFrame?.contentWindow) {
      existingFrame.contentWindow.focus();
      existingFrame.contentWindow.print();
      return;
    }

    let frame: HTMLIFrameElement | null = null;
    try {
      frame = await this.mountHiddenFrame(payload.html);
      const view = frame.contentWindow;
      if (!view) throw new Error('The document could not be prepared for printing.');
      view.focus();
      view.print();
    } catch (cause) {
      this.toast.error(cause);
    } finally {
      // Left in place briefly: removing the frame during the print dialogue cancels the job in
      // Chromium, because the document being printed goes away underneath it.
      const doomed = frame;
      if (doomed) setTimeout(() => doomed.remove(), 60_000);
    }
  }

  /**
   * Hand the document to the platform share sheet.
   *
   * Shares the HTML file when the platform accepts files, and falls back to text when it does not —
   * a share sheet that only offers a title is nearly useless, so the fallback says explicitly that
   * the file has to be saved instead.
   */
  async share(payload: ExportPayload, subject: string): Promise<void> {
    if (this.canShareFiles) {
      try {
        const file = new File([payload.html], `${payload.baseName}.html`, {
          type: 'text/html',
        });
        await navigator.share({ files: [file], title: subject, text: subject });
        return;
      } catch (cause) {
        // An abort is the owner backing out of the sheet, not a failure worth reporting.
        if (this.wasAborted(cause)) return;
        this.toast.error(cause);
        return;
      }
    }

    if (this.canShareText) {
      try {
        await navigator.share({ title: subject, text: subject });
        this.toast.info('Shared the text. Save the file to attach the document itself.');
        return;
      } catch (cause) {
        if (this.wasAborted(cause)) return;
        this.toast.error(cause);
        return;
      }
    }

    this.toast.warning('This device cannot share directly. Save the file and attach it instead.');
  }

  private wasAborted(cause: unknown): boolean {
    return cause instanceof DOMException && cause.name === 'AbortError';
  }

  /**
   * Put the HTML in an off-screen iframe and wait for it to be ready to print.
   *
   * `srcdoc` rather than a blob URL, so nothing has to be revoked and there is no origin to argue
   * about. The load event is awaited because printing a frame that has not finished laying out
   * produces a blank first page.
   */
  private mountHiddenFrame(html: string): Promise<HTMLIFrameElement> {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.position = 'fixed';
      frame.style.left = '-10000px';
      frame.style.top = '0';
      frame.style.width = '210mm';
      frame.style.height = '297mm';
      frame.style.border = '0';

      const timeout = setTimeout(() => {
        frame.remove();
        reject(new Error('The document took too long to prepare for printing.'));
      }, 15_000);

      frame.addEventListener('load', () => {
        clearTimeout(timeout);
        resolve(frame);
      });
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
  }
}
