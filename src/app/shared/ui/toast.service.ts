/**
 * One-line notifications.
 *
 * ## Why every method returns `void`
 *
 * Showing an Ionic overlay is not a cheap synchronous call. `ToastController.create()` waits for the
 * custom element to be defined *and* for Stencil to render it, and Stencil schedules rendering with
 * `requestAnimationFrame` — which the browser pauses whenever the page is not visible. So code shaped
 * like
 *
 * ```ts
 * await this.masters.saveBusinessProfile(profile);
 * await this.toast('Saved.');   // ← never resolves while the app is backgrounded
 * ```
 *
 * stops dead at the toast, and anything after it — clearing a `saving` flag, navigating away — never
 * happens. This was reproducible: a save with the page hidden committed to the database and then left
 * the button reading "Saving…" and disabled, permanently.
 *
 * A toast is a notification, not a step in a process. Nothing downstream may depend on it, so these
 * methods return `void` rather than a promise: there is no promise to await by accident, and the
 * critical path cannot be made hostage to an animation frame. Failures to *show* a message are
 * swallowed for the same reason — the message is the least important thing happening.
 */

import { inject, Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toasts = inject(ToastController);

  /** Show a message. Returns immediately; the toast appears when the app is next painting. */
  show(message: string, duration = 2200): void {
    void this.present({ message, duration });
  }

  /** Report a caught value, whatever shape it arrived in. */
  error(cause: unknown): void {
    this.show(cause instanceof Error ? cause.message : String(cause), 3000);
  }

  /**
   * A message with one action, e.g. "Line removed. [Undo]".
   *
   * The longer default is deliberate: an action the user has to notice, read and reach for needs
   * more than the two seconds a bare acknowledgement does.
   */
  withAction(message: string, actionText: string, handler: () => void, duration = 4000): void {
    void this.present({ message, duration, buttons: [{ text: actionText, handler }] });
  }

  private async present(options: Parameters<ToastController['create']>[0]): Promise<void> {
    try {
      const toast = await this.toasts.create(options);
      await toast.present();
    } catch {
      // Nothing useful to do: the only failure mode is being unable to tell the user something, and
      // there is no second channel to tell them on.
    }
  }
}
