import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CompetitionSettingsApiProvider } from '@services/providers/competition-settings-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';

@Component({
  selector: 'app-admin-settings-page',
  imports: [TranslatePipe, ModalShellComponent, RouterLink, SecretCodeModalComponent],
  templateUrl: './admin-settings-page.component.html',
  styleUrl: './admin-settings-page.component.scss'
})
export class AdminSettingsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly competitionSettingsApi = inject(CompetitionSettingsApiProvider);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly registrationsDisabled = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly secretCodeErrorMessage = signal<string | null>(null);
  protected readonly pendingRegistrationsDisabled = signal<boolean | null>(null);

  constructor() {
    this.loadSettings();
  }

  protected toggleRegistrations(): void {
    if (this.saving()) {
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingRegistrationsDisabled.set(!this.registrationsDisabled());
  }

  protected cancelSecretCode(): void {
    if (!this.saving()) {
      this.pendingRegistrationsDisabled.set(null);
      this.secretCodeErrorMessage.set(null);
    }
  }

  protected confirmSecretCode(secretCode: string): void {
    const nextDisabled = this.pendingRegistrationsDisabled();

    if (nextDisabled === null || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.competitionSettingsApi.updateAdminSettings({ registrationsDisabled: nextDisabled, secretCode }).subscribe({
      next: (settings) => {
        this.registrationsDisabled.set(settings.registrationsDisabled);
        this.successMessage.set(settings.registrationsDisabled ? this.translations.translate("ui.registrations_disabled") : this.translations.translate("ui.registrations_enabled"));
        this.pendingRegistrationsDisabled.set(null);
        this.saving.set(false);
      },
      error: (error: unknown) => {
        const message =
          error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
            ? error.error.message
            : this.translations.translate("ui.registration_settings_could_not_be_saved");

        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.secretCodeErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.pendingRegistrationsDisabled.set(null);
        }

        this.saving.set(false);
      }
    });
  }

  private loadSettings(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.competitionSettingsApi.getAdminSettings().subscribe({
      next: (settings) => {
        this.registrationsDisabled.set(settings.registrationsDisabled);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set(this.translations.translate("ui.registration_settings_could_not_be_loaded"));
        this.loading.set(false);
      }
    });
  }
}
