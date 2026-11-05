import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { NotificationPreferencesResponse } from '@models/notification.models';
import { notificationSetupMessages } from '@core/constants/notification-setup-messages';
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
  private readonly notificationsApi = inject(NotificationsApiProvider);
  private readonly appState = inject(AppStateService);
  private readonly browserAccount = inject(NotificationBrowserAccountService);
  private readonly fingerprintSignal = signal<string | null>(null);
  readonly fingerprint = this.fingerprintSignal.asReadonly();
  private readonly browserStateSignal = signal('Checking this browser...');
  readonly browserState = this.browserStateSignal.asReadonly();
  readonly supported = typeof window !== 'undefined' && 'Notification' in window &&
    'serviceWorker' in navigator && 'PushManager' in window && window.isSecureContext;

  async refreshBrowserState(): Promise<void> {
    this.fingerprintSignal.set(null);
    if (!this.supported) {
      this.browserStateSignal.set('Push notifications are not supported in this browser.');
      return;
    }
    if (Notification.permission !== 'granted') {
      this.browserStateSignal.set(Notification.permission === 'denied'
        ? notificationSetupMessages.blocked
        : 'Enable this browser to receive your selected reminders here.');
      return;
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/notification-sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) this.fingerprintSignal.set(await fingerprint(subscription.endpoint));
      this.browserStateSignal.set(subscription
        ? 'Browser permission is allowed. Use the Enable this browser button to register it for your signed-in account.'
        : 'Browser permission is allowed. Enable this browser to finish setup.');
    } catch {
      this.browserStateSignal.set('Browser notification status could not be checked.');
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
        this.browserStateSignal.set(notificationSetupMessages[status]);
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
      this.browserStateSignal.set('This browser is ready to receive your selected reminders.');
      return { status: 'subscribed', permission, settings };
    } catch {
      if (Notification.permission === 'denied') {
        this.browserStateSignal.set(notificationSetupMessages.blocked);
        return { status: 'blocked', permission: 'denied' };
      }
      this.browserStateSignal.set('This browser could not be enabled. Please try again.');
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
