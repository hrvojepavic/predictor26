import { DestroyRef, inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AppStateService } from '@core/state/app-state.service';
import { NotificationsApiProvider } from './providers/notifications-api.provider';

// Shared with notification-sw.js. Logout deliberately keeps this value.
const recipientCache = 'predictor26-notification-recipient';
const recipientKey = '/notification-recipient';

@Injectable({ providedIn: 'root' })
export class NotificationBrowserAccountService {
  private readonly appState = inject(AppStateService);
  private readonly api = inject(NotificationsApiProvider);
  private pending: Promise<void> = Promise.resolve();
  private retryAccount: { userId: number; token: string } | null = null;
  private synchronizationVersion = 0;

  constructor() {
    // Retry a failed server update when connectivity or the active tab returns.
    const retry = () => {
      const user = this.appState.currentUser();
      const token = this.appState.token();
      if (user && token && this.retryAccount?.userId === user.id
        && this.retryAccount.token === token && this.isCurrentSession(token)) {
        void this.synchronize(user.id, token).catch(() => {});
      }
    };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', retry);
      window.removeEventListener('focus', retry);
    });
  }

  synchronize(userId: number, token: string): Promise<void> {
    return this.withCurrentAccount(userId, token, async () => {}).then(() => {});
  }

  withCurrentAccount<T>(userId: number, token: string, action: () => Promise<T>): Promise<T | undefined> {
    const version = ++this.synchronizationVersion;
    this.retryAccount = null;
    const remember = async () => {
      if (!this.isCurrentSession(token) || !('caches' in window) || !('serviceWorker' in navigator)) return false;
      const cache = await caches.open(recipientCache);
      if (!this.isCurrentSession(token)) return false;
      await cache.put(recipientKey, new Response(JSON.stringify({ userId })));
      return true;
    };
    // Update the display guard without waiting for an older network request.
    const remembered = (navigator.locks
      ? navigator.locks.request('predictor26-notification-recipient', remember) : remember()).catch(() => false);
    const update = async () => {
      if (!await remembered || !this.isCurrentSession(token)) return;
      try {
        const registration = await navigator.serviceWorker.getRegistration('/notification-sw.js');
        if (registration) void registration.update().catch(() => {});
        const subscription = await registration?.pushManager.getSubscription();
        if (!this.isCurrentSession(token)) return;
        if (subscription) await firstValueFrom(this.api.saveSubscription(subscription));
      } catch (error) {
        if (version === this.synchronizationVersion && this.isCurrentSession(token)) {
          this.retryAccount = { userId, token };
        }
        throw error;
      }
      if (!this.isCurrentSession(token)) return;
      return action();
    };
    // Serialize login and registration requests across tabs, so an older request
    // cannot arrive after the new login and reclaim this browser on the server.
    const result = this.pending.then(async (): Promise<T | undefined> =>
      navigator.locks ? await navigator.locks.request('predictor26-notification-account', update) : await update());
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private isCurrentSession(token: string): boolean {
    if (this.appState.token() !== token) return false;
    // An older tab must not reclaim the browser after another account logs in.
    try {
      return JSON.parse(localStorage.getItem('predictor26.session') ?? 'null')?.token === token;
    } catch { return false; }
  }
}
