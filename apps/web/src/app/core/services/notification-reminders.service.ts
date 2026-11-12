import { TranslationService } from '@services/translation.service';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotificationPreferencesResponse } from '@models/notification.models';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationBrowserAccountService } from './notification-browser-account.service';
import { NotificationsApiProvider } from './providers/notifications-api.provider';

export type NotificationReminderEnableResult = {
  readonly status: 'subscribed' | 'dismissed' | 'blocked' | 'unsupported' | 'failed';
  readonly permission: NotificationPermission | null;
  readonly settings?: NotificationPreferencesResponse;
};

@Injectable({ providedIn: 'root' })
export class NotificationRemindersService {
  private readonly translations = inject(TranslationService);
  private readonly notificationsApi = inject(NotificationsApiProvider);
  private readonly appState = inject(AppStateService);
  private readonly browserAccount = inject(NotificationBrowserAccountService);
  private readonly fingerprintSignal = signal<string | null>(null);
  readonly fingerprint = this.fingerprintSignal.asReadonly();
  private readonly browserStateSignal = signal(this.translations.translate("ui.checking_this_browser"));
  readonly browserState = this.browserStateSignal.asReadonly();
  readonly supported = typeof window !== 'undefined' && 'Notification' in window &&
    'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

  async refreshBrowserState(): Promise<void> {
    this.fingerprintSignal.set(null);
    if (!this.supported) {
      this.browserStateSignal.set(this.translations.translate("ui.push_notifications_are_not_supported_in_this_browser"));
      return;
    }
    if (Notification.permission !== 'granted') {
      this.browserStateSignal.set(Notification.permission === 'denied'
        ? this.translations.translate('notifications.setup.blocked')
        : this.translations.translate("ui.enable_this_browser_to_receive_your_selected_reminders_here"));
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/notification-sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) this.fingerprintSignal.set(await fingerprint(subscription.endpoint));
      this.browserStateSignal.set(subscription
        ? this.translations.translate("ui.browser_permission_is_allowed_use_the_enable_this_browser_button_to_register_it_for_your_s")
        : this.translations.translate("ui.browser_permission_is_allowed_enable_this_browser_to_finish_setup"));
    } catch {
      this.browserStateSignal.set(this.translations.translate("ui.browser_notification_status_could_not_be_checked"));
    }
  }

  async enableReminders(competitionId?: number, attachToCompetition = true): Promise<NotificationReminderEnableResult> {
    if (!this.supported) return { status: 'unsupported', permission: null };
    const token = this.appState.token();
    if (!token || !this.isCurrentBrowserSession(token)) return { status: 'failed', permission: null };
    let permission: NotificationPermission | null = null;
    try {
      // Start permission request directly from the click, before awaiting network work.
      permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') {
        // Closing a prompt can leave permission undecided. Browsers may also
        // suppress repeated prompts; the API does not expose the reason.
        if (Notification.permission === 'denied') permission = 'denied';
        const status = permission === 'default' ? 'dismissed' : 'blocked';
        await this.refreshBrowserState();
        this.browserStateSignal.set(this.translations.translate(`notifications.setup.${status}`));
        return { status, permission };
      }
      const config = await firstValueFrom(this.notificationsApi.getConfig(competitionId));
      const registration = await navigator.serviceWorker.register('/notification-sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      const key = urlBase64ToArrayBuffer(config.vapidPublicKey);
      const existingKey = subscription?.options.applicationServerKey;
      if (subscription && (!existingKey || !sameKey(existingKey, key))) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (!this.isCurrentBrowserSession(token)) return { status: 'failed', permission };
      const user = this.appState.currentUser();
      if (!user) return { status: 'failed', permission };
      const registered = await this.browserAccount.withCurrentAccount(user.id, token, async () => {
        const settings = attachToCompetition && competitionId !== undefined
          ? await firstValueFrom(this.notificationsApi.addBrowser(competitionId, subscription!))
          : (await firstValueFrom(this.notificationsApi.saveSubscription(subscription!)), undefined);
        return { settings };
      });
      if (!registered || !this.isCurrentBrowserSession(token)) return { status: 'failed', permission };
      const { settings } = registered;
      this.fingerprintSignal.set(await fingerprint(subscription.endpoint));
      this.browserStateSignal.set(this.translations.translate("ui.this_browser_is_ready_to_receive_your_selected_reminders"));
      return { status: 'subscribed', permission, settings };
    } catch {
      if (Notification.permission === 'denied') {
        this.browserStateSignal.set(this.translations.translate('notifications.setup.blocked'));
        return { status: 'blocked', permission: 'denied' };
      }
      this.browserStateSignal.set(this.translations.translate("ui.this_browser_could_not_be_enabled_please_try_again"));
      return { status: 'failed', permission };
    }
  }

  private isCurrentBrowserSession(token: string): boolean {
    try {
      return token === this.appState.token() && JSON.parse(localStorage.getItem('predictor26.session') ?? 'null')?.token === token;
    } catch { return false; }
  }

  enableCurrentBrowserForAdminTest(): Promise<NotificationReminderEnableResult> {
    // Register this browser without disabling the user's other devices or changing preferences.
    return this.enableReminders(this.appState.activeCompetition()?.id, false);
  }
}

function sameKey(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output.buffer as ArrayBuffer;
}

async function fingerprint(endpoint: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
