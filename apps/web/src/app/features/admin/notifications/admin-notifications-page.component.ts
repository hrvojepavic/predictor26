import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { AdminNotificationMember } from '@models/notification.models';
import { RouterLink } from '@angular/router';

import { NotificationRemindersService } from '@services/notification-reminders.service';
import { NotificationsApiProvider } from '@services/providers/notifications-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';

@Component({
  selector: 'app-admin-notifications-page',
  imports: [TranslatePipe, ModalShellComponent, RouterLink, SecretCodeModalComponent],
  templateUrl: './admin-notifications-page.component.html',
  styleUrl: './admin-notifications-page.component.scss'
})
export class AdminNotificationsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly notificationsApi = inject(NotificationsApiProvider);
  private readonly notificationRemindersService = inject(NotificationRemindersService);

  protected readonly members = signal<readonly (AdminNotificationMember & { browsersLabel: string })[]>([]);
  protected readonly membersLoaded = signal(false);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly enablingBrowser = signal(false);
  protected readonly testing = signal(false);
  protected readonly remindersEnabled = signal(false);
  protected readonly competitionClosed = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly secretCodeErrorMessage = signal<string | null>(null);
  protected readonly pendingRemindersEnabled = signal<boolean | null>(null);

  constructor() {
    this.loadSettings();
  }

  protected toggleReminders(): void {
    if (this.saving() || this.competitionClosed()) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingRemindersEnabled.set(!this.remindersEnabled());
  }

  protected cancelSecretCode(): void {
    if (!this.saving()) {
      this.pendingRemindersEnabled.set(null);
      this.secretCodeErrorMessage.set(null);
    }
  }

  protected confirmSecretCode(secretCode: string): void {
    const nextEnabled = this.pendingRemindersEnabled();

    if (nextEnabled === null || this.saving() || this.competitionClosed()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.notificationsApi.updateAdminSettings({ remindersEnabled: nextEnabled, secretCode }).subscribe({
      next: (settings) => {
        this.remindersEnabled.set(settings.remindersEnabled);
        this.successMessage.set(settings.remindersEnabled ? this.translations.translate("ui.notification_reminders_enabled") : this.translations.translate("ui.notification_reminders_disabled"));
        this.pendingRemindersEnabled.set(null);
        this.saving.set(false);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.notification_settings_could_not_be_saved");

        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.secretCodeErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.pendingRemindersEnabled.set(null);
        }

        this.saving.set(false);
      }
    });
  }

  protected sendTestNotification(): void {
    if (this.testing() || this.competitionClosed()) {
      return;
    }

    this.testing.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.notificationsApi.sendTestNotification().subscribe({
      next: ({ sent, subscriptions }) => {
        this.successMessage.set(this.translations.translate('ui.test_notification_sent_to_p0_p1_active_subscriptions', { p0: sent, p1: subscriptions }));
        this.testing.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.test_notification_could_not_be_sent"));
        this.testing.set(false);
      }
    });
  }

  protected async enableThisBrowser(): Promise<void> {
    if (this.enablingBrowser() || this.competitionClosed()) {
      return;
    }

    this.enablingBrowser.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    const result = await this.notificationRemindersService.enableCurrentBrowserForAdminTest();

    if (result.status === 'subscribed') {
      this.successMessage.set(this.translations.translate("ui.this_browser_is_ready_for_admin_test_notifications"));
    } else {
      this.errorMessage.set(this.translations.translate(`notifications.setup.${result.status}`));
    }

    this.enablingBrowser.set(false);
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.notificationsApi.getAdminSettings().subscribe({
      next: (settings) => {
        this.remindersEnabled.set(settings.remindersEnabled);
        this.members.set(settings.members.map(member => ({ ...member, browsersLabel: member.browsers.join(', ') || '\u2014' })));
        this.competitionClosed.set(settings.competitionClosed);
        this.membersLoaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.notification_settings_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }
}
