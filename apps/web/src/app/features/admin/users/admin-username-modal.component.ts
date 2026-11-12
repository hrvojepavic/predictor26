import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, effect, inject, input, output } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

export interface UsernameChangeConfirmation {
  readonly username: string;
  readonly secretCode: string;
}

@Component({
  selector: 'app-admin-username-modal',
  imports: [TranslatePipe, ReactiveFormsModule, FormFieldStateDirective],
  templateUrl: './admin-username-modal.component.html',
  styleUrl: './admin-username-modal.component.scss'
})
export class AdminUsernameModalComponent {
  private readonly formBuilder = inject(FormBuilder);

  readonly currentUsername = input.required<string>();
  readonly errorMessage = input<string | null>(null);
  readonly isSubmitting = input(false);

  readonly confirmUsernameChange = output<UsernameChangeConfirmation>();
  readonly cancelModal = output<void>();

  protected readonly usernameForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(40)]],
    secretCode: ['', [Validators.required, Validators.maxLength(128)]]
  });

  constructor() {
    effect(() => {
      this.usernameForm.controls.username.setValue(this.currentUsername(), { emitEvent: false });
    });
  }

  protected confirm(): void {
    if (this.usernameForm.invalid || this.isSubmitting()) {
      this.usernameForm.markAllAsTouched();
      return;
    }

    this.confirmUsernameChange.emit(this.usernameForm.getRawValue());
  }

  protected cancel(): void {
    if (this.isSubmitting()) {
      return;
    }

    this.cancelModal.emit();
  }
}
