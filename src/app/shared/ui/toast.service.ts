/**
 * Notifications: success, warning, error and plain.
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
 * methods return `void`: there is no promise to await by accident, and the critical path cannot be
 * made hostage to an animation frame.
 *
 * ## Why the kinds differ in more than colour
 *
 * Colour alone fails two ways: it is invisible to a red/green colour-blind reader, and it is washed
 * out on a phone screen in Kerala sunlight — the condition this app is most often used in. So each
 * kind carries an icon and a duration as well, and the icon is what actually distinguishes them.
 *
 * Durations are deliberately unequal. "Saved." is a confirmation of something the owner already
 * knows they did, so it gets out of the way. An error is something they did *not* expect and may
 * need to read twice, so it stays, and errors alone get a dismiss button — a message you cannot
 * re-read is no use when it names a constraint you have to go and fix.
 */

import { inject, Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  informationCircleOutline,
} from 'ionicons/icons';

export type ToastKind = 'success' | 'warning' | 'error' | 'info';

interface KindStyle {
  /** Ionic colour role, resolved to our tokens by `theme/variables.scss`. */
  color: string;
  icon: string;
  duration: number;
  /** Errors get a dismiss button so a long message can be re-read rather than chased. */
  dismissable: boolean;
}

const STYLES: Readonly<Record<ToastKind, KindStyle>> = {
  success: { color: 'success', icon: 'checkmark-circle-outline', duration: 2000, dismissable: false },
  warning: { color: 'warning', icon: 'alert-circle-outline', duration: 3600, dismissable: false },
  error: { color: 'danger', icon: 'close-circle-outline', duration: 6000, dismissable: true },
  info: { color: 'medium', icon: 'information-circle-outline', duration: 2400, dismissable: false },
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly toasts = inject(ToastController);

  constructor() {
    // Registered here rather than in each page: a toast can be raised from anywhere, including a
    // page that never imports an icon of its own.
    addIcons({
      checkmarkCircleOutline,
      alertCircleOutline,
      closeCircleOutline,
      informationCircleOutline,
    });
  }

  /** Something worked. */
  success(message: string): void {
    this.present('success', message);
  }

  /**
   * Something worked, but not the way the owner probably expects.
   *
   * The distinction from `error` is whether anything was written. A GSTIN that fails its checksum is
   * saved and warned about (§8.4); a database constraint that rejected the write is an error.
   */
  warning(message: string): void {
    this.present('warning', message);
  }

  /** Something failed. Takes a caught value of any shape, or a plain message. */
  error(cause: unknown): void {
    this.present('error', cause instanceof Error ? cause.message : String(cause));
  }

  /** Neutral acknowledgement — no judgement about whether it went well. */
  info(message: string): void {
    this.present('info', message);
  }

  /**
   * Backwards-compatible plain toast.
   *
   * Kept because a message that is neither good nor bad news — "Tax rates is not built yet" — should
   * not have to pick a side. New code should prefer the named kinds, which is why this one takes no
   * colour: an untyped toast is a deliberate choice, not a default to fall into.
   */
  show(message: string, duration?: number): void {
    this.present('info', message, duration);
  }

  /**
   * A message with one action, e.g. "Line removed. [Undo]".
   *
   * The longer default is deliberate: an action the owner has to notice, read and reach for needs
   * more than the two seconds a bare acknowledgement does.
   */
  withAction(message: string, actionText: string, handler: () => void, duration = 5000): void {
    void this.raise({
      message,
      duration,
      color: STYLES.info.color,
      icon: STYLES.info.icon,
      buttons: [{ text: actionText, handler }],
    });
  }

  private present(kind: ToastKind, message: string, duration?: number): void {
    const style = STYLES[kind];
    void this.raise({
      message,
      duration: duration ?? style.duration,
      color: style.color,
      icon: style.icon,
      ...(style.dismissable ? { buttons: [{ text: 'Dismiss', role: 'cancel' }] } : {}),
    });
  }

  private async raise(options: Parameters<ToastController['create']>[0]): Promise<void> {
    try {
      const toast = await this.toasts.create({
        position: 'bottom',
        // Keeps a two-line error clear of the tab bar rather than sitting on top of it.
        swipeGesture: 'vertical',
        ...options,
      });
      await toast.present();
    } catch {
      // Nothing useful to do: the only failure mode here is being unable to tell the owner
      // something, and there is no second channel to tell them on.
    }
  }
}
