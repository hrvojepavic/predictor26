import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

@Component({
  selector: 'app-secret-code-modal',
  imports: [TranslatePipe, ReactiveFormsModule, FormFieldStateDirective],
  templateUrl: './secret-code-modal.component.html',
  styleUrl: './secret-code-modal.component.scss'
})
export class SecretCodeModalComponent {
  private readonly translations = inject(TranslationService);
  private readonly formBuilder = inject(FormBuilder);

  readonly title = input(this.translations.translate("ui.confirm_action"));
  readonly label = input(this.translations.translate("ui.what_is_the_secret_code"));
  readonly confirmLabel = input(this.translations.translate("ui.confirm"));
  readonly cancelLabel = input(this.translations.translate("ui.cancel"));
  readonly errorMessage = input<string | null>(null);
  readonly isSubmitting = input(false);

  readonly confirmSecretCode = output<string>();
  readonly cancelModal = output<void>();

  protected readonly secretCodeForm = this.formBuilder.nonNullable.group({
    secretCode: ['', [Validators.required, Validators.maxLength(128)]]
  });

  protected confirm(): void {
    if (this.secretCodeForm.invalid || this.isSubmitting()) {
      this.secretCodeForm.markAllAsTouched();
      return;
    }

    this.confirmSecretCode.emit(this.secretCodeForm.getRawValue().secretCode);
  }

  protected cancel(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.cancelModal.emit();
  }
}
