import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, ReactiveFormsModule, ValidationErrors, Validators, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';

import { AppStateService } from '@core/state/app-state.service';
import { AuthApiProvider } from '@services/providers/auth-api.provider';
import { CompetitionSettingsApiProvider } from '@services/providers/competition-settings-api.provider';
import { FormFieldStateDirective } from '@shared/directives/form-field-state.directive';

@Component({
  selector: 'app-register-page',
  imports: [TranslatePipe, ReactiveFormsModule, FormFieldStateDirective],
  templateUrl: './register-page.component.html',
  styleUrl: './register-page.component.scss'
})
export class RegisterPageComponent {
  private readonly translations = inject(TranslationService);
  private readonly appState = inject(AppStateService);
  private readonly authApi = inject(AuthApiProvider);
  private readonly competitionSettingsApi = inject(CompetitionSettingsApiProvider);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly registrationsDisabled = signal(false);
  protected readonly registrationClosedMessage = this.translations.translate("ui.registrations_are_not_possible");
  protected readonly formMessage = computed(() =>
    this.registrationsDisabled() ? this.registrationClosedMessage : this.errorMessage()
  );

  protected readonly registerForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(40)]],
    name: ['', [Validators.required, Validators.maxLength(80)]],
    lastname: ['', [Validators.required, Validators.maxLength(80)]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmPassword: ['', [Validators.required, Validators.maxLength(128), matchingPasswordValidator]],
    acceptedRules: [false, [Validators.requiredTrue]]
  });

  constructor() {
    this.registerForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.errorMessage.set(null);
    });

    this.registerForm.controls.username.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      const usernameControl = this.registerForm.controls.username;

      if (usernameControl.hasError('usernameTaken')) {
        const errors = { ...usernameControl.errors };
        delete errors['usernameTaken'];
        usernameControl.setErrors(Object.keys(errors).length ? errors : null);
      }
    });

    this.registerForm.controls.password.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.registerForm.controls.confirmPassword.updateValueAndValidity({ emitEvent: false });
    });

    this.competitionSettingsApi.getSettings().subscribe({
      next: (settings) => {
        this.registrationsDisabled.set(settings.registrationsDisabled);
      }
    });
  }

  protected register(): void {
    if (this.registrationsDisabled()) {
      this.errorMessage.set(this.registrationClosedMessage);
      return;
    }

    if (this.registerForm.invalid || this.isSubmitting()) {
      this.registerForm.markAllAsTouched();
      this.errorMessage.set(
        this.hasOnlyPasswordMinLengthError()
          ? this.translations.translate("ui.password_must_be_at_least_8_characters_2")
          : this.translations.translate("ui.please_check_the_highlighted_fields")
      );
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const registration = this.registerForm.getRawValue();

    this.authApi
      .register({
        username: registration.username,
        name: registration.name,
        lastname: registration.lastname,
        password: registration.password,
        acceptedRules: registration.acceptedRules
      })
      .subscribe({
        next: (session) => {
          this.appState.setSession(session);
          void this.router.navigateByUrl('/');
        },
        error: (error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 409) {
            this.registerForm.controls.username.setErrors({
              ...this.registerForm.controls.username.errors,
              usernameTaken: true
            });
            this.registerForm.controls.username.markAsTouched();
          }

          if (error instanceof HttpErrorResponse && error.status === 403) {
            this.registrationsDisabled.set(true);
          }

          this.errorMessage.set(
            error instanceof HttpErrorResponse && error.status === 409
              ? this.translations.translate("ui.username_is_already_taken")
              : error instanceof HttpErrorResponse && error.status === 403
                ? this.registrationClosedMessage
                : this.translations.translate("ui.please_check_the_registration_fields")
          );
          this.isSubmitting.set(false);
        }
      });
  }

  private hasOnlyPasswordMinLengthError(): boolean {
    const passwordControl = this.registerForm.controls.password;

    if (!passwordControl.hasError('minlength')) {
      return false;
    }

    return Object.entries(this.registerForm.controls).every(([controlName, control]) => {
      if (controlName === 'password') {
        return control.errors ? Object.keys(control.errors).length === 1 : false;
      }

      return control.valid;
    });
  }
}

function matchingPasswordValidator(control: AbstractControl<string>): ValidationErrors | null {
  const password = control.parent?.get('password')?.value;

  if (!password || !control.value) {
    return null;
  }

  return control.value === password ? null : { passwordMismatch: true };
}
