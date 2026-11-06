import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AppStateService } from '@core/state/app-state.service';
import { notificationSetupMessages } from '@core/constants/notification-setup-messages';
import { NotificationPreferences, NotificationPreferencesResponse } from '@models/notification.models';
import { NotificationsApiProvider } from './providers/notifications-api.provider';
import { NotificationReminderEnableResult, NotificationRemindersService } from './notification-reminders.service';

@Injectable({ providedIn: 'root' })
export class CompetitionNotificationSettingsService {
  private readonly api = inject(NotificationsApiProvider);
  private readonly appState = inject(AppStateService);
  private readonly browser = inject(NotificationRemindersService);
  private readonly settingsSignal = signal<NotificationPreferencesResponse | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly savingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private generation = 0;
  readonly settings = this.settingsSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly saving = this.savingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  async load(competitionId: number): Promise<void> {
    const generation = ++this.generation;
    const token = this.appState.token();
    this.settingsSignal.set(null);
    this.loadingSignal.set(true);
    this.savingSignal.set(false);
    this.errorSignal.set(null);
    try {
      const response = await firstValueFrom(this.api.getPreferences(competitionId));
      if (generation === this.generation && token === this.appState.token()) this.settingsSignal.set(response);
    } catch {
      if (generation === this.generation) this.errorSignal.set('Could not load notifications. Please try again.');
    } finally {
      if (generation === this.generation) this.loadingSignal.set(false);
    }
  }

  async save(competitionId: number, preferences: NotificationPreferences, registerBrowser = false): Promise<boolean> {
    return this.change(async isCurrent => {
      if (registerBrowser) {
        const setup = await this.browser.enableReminders(competitionId);
        if (setup.status !== 'subscribed') throw new Error(browserError(setup.status));
        if (!isCurrent()) return null;
        try {
          return await firstValueFrom(this.api.savePreferences(competitionId, preferences));
        } catch (error) {
          if (isCurrent() && setup.settings) this.settingsSignal.set(setup.settings);
          throw error;
        }
      }
      if (!isCurrent()) return null;
      return firstValueFrom(this.api.savePreferences(competitionId, preferences));
    });
  }

  async addBrowser(competitionId: number): Promise<boolean> {
    return this.change(async () => {
      const result = await this.browser.enableReminders(competitionId);
      if (result.status !== 'subscribed' || !result.settings) throw new Error(browserError(result.status));
      return result.settings;
    });
  }

  async removeBrowser(competitionId: number, browserId: number): Promise<boolean> {
    return this.change(() => firstValueFrom(this.api.removeBrowser(competitionId, browserId)));
  }

  private async change(action: (isCurrent: () => boolean) => Promise<NotificationPreferencesResponse | null>): Promise<boolean> {
    if (this.savingSignal()) return false;
    const generation = this.generation;
    const token = this.appState.token();
    const isCurrent = () => generation === this.generation && token === this.appState.token();
    this.savingSignal.set(true);
    this.errorSignal.set(null);
    try {
      const response = await action(isCurrent);
      if (isCurrent() && response) {
        this.settingsSignal.set(response);
        return true;
      }
    } catch (error) {
      if (isCurrent()) this.errorSignal.set(error instanceof HttpErrorResponse
        ? (error.status === 409 ? (typeof error.error?.message === 'string' ? error.error.message : 'Keep at least one browser.') : 'Changes were not saved. Please try again.')
        : error instanceof Error ? error.message : 'Changes were not saved. Please try again.');
    } finally {
      if (generation === this.generation) this.savingSignal.set(false);
    }
    return false;
  }
}

function browserError(status: NotificationReminderEnableResult['status']): string {
  return notificationSetupMessages[status === 'subscribed' ? 'failed' : status];
}
