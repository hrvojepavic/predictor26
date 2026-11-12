import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AdminPaymentSettings } from '@models/admin-payment.models';
import { AdminPaymentsApiProvider } from '@services/providers/admin-payments-api.provider';
import { ModalShellComponent } from '@shared/components/modal-shell/modal-shell.component';
import { SecretCodeModalComponent } from '@shared/components/secret-code-modal/secret-code-modal.component';

@Component({
  selector: 'app-admin-payments-page',
  imports: [TranslatePipe, ModalShellComponent, ReactiveFormsModule, RouterLink, SecretCodeModalComponent],
  templateUrl: './admin-payments-page.component.html',
  styleUrl: './admin-payments-page.component.scss'
})
export class AdminPaymentsPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly adminPaymentsApi = inject(AdminPaymentsApiProvider);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly secretCodeErrorMessage = signal<string | null>(null);
  protected readonly pendingSettings = signal<AdminPaymentSettings | null>(null);

  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    iban: ['', [Validators.maxLength(200)]],
    ibanHolderName: ['', [Validators.maxLength(200)]],
    keks: ['', [Validators.maxLength(200)]],
    keksFastPayUrl: ['', [Validators.maxLength(500)]],
    revolut: ['', [Validators.maxLength(200)]],
    revolutFastPayUrl: ['', [Validators.maxLength(500)]],
    cashEnabled: [false],
    showPaymentInfo: [false]
  });

  constructor() {
    this.loadPaymentSettings();
  }

  protected savePaymentSettings(): void {
    if (this.paymentForm.invalid || this.saving()) {
      this.paymentForm.markAllAsTouched();
      return;
    }

    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);
    this.pendingSettings.set(this.paymentForm.getRawValue());
  }

  protected cancelSecretCode(): void {
    if (!this.saving()) {
      this.pendingSettings.set(null);
      this.secretCodeErrorMessage.set(null);
    }
  }

  protected confirmSecretCode(secretCode: string): void {
    const settings = this.pendingSettings();

    if (!settings || this.saving()) {
      return;
    }

    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    this.secretCodeErrorMessage.set(null);

    this.adminPaymentsApi.updatePaymentSettings({ ...settings, secretCode }).subscribe({
      next: (updatedSettings) => {
        this.paymentForm.setValue(updatedSettings);
        this.paymentForm.markAsPristine();
        this.successMessage.set(this.translations.translate("ui.payment_settings_saved"));
        this.pendingSettings.set(null);
        this.saving.set(false);
      },
      error: (error: unknown) => {
        const message = readErrorMessage(error, this.translations.translate("ui.payment_settings_could_not_be_saved"));

        if (error instanceof HttpErrorResponse && error.status === 403) {
          this.secretCodeErrorMessage.set(message);
        } else {
          this.errorMessage.set(message);
          this.pendingSettings.set(null);
        }

        this.saving.set(false);
      }
    });
  }

  private loadPaymentSettings(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.adminPaymentsApi.getPaymentSettings().subscribe({
      next: (settings) => {
        this.paymentForm.setValue(settings);
        this.paymentForm.markAsPristine();
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.errorMessage.set(readErrorMessage(error, this.translations.translate("ui.payment_settings_could_not_be_loaded")));
        this.loading.set(false);
      }
    });
  }
}

function readErrorMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
    ? error.error.message
    : fallbackMessage;
}
