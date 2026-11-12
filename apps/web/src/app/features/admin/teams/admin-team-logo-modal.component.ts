import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

export interface TeamLogoChangeConfirmation {
  readonly logoDataUrl: string | null;
  readonly secretCode: string;
}

@Component({
  selector: 'app-admin-team-logo-modal',
  imports: [TranslatePipe, ReactiveFormsModule],
  templateUrl: './admin-team-logo-modal.component.html',
  styleUrl: './admin-team-logo-modal.component.scss'
})
export class AdminTeamLogoModalComponent {
  private readonly translations = inject(TranslationService);
  private readonly formBuilder = inject(FormBuilder);

  readonly teamName = input.required<string>();
  readonly currentLogoUrl = input<string | null>(null);
  readonly errorMessage = input<string | null>(null);
  readonly isSubmitting = input(false);
  readonly confirmLogoChange = output<TeamLogoChangeConfirmation>();
  readonly cancelModal = output<void>();

  protected readonly logoForm = this.formBuilder.nonNullable.group({
    secretCode: ['', [Validators.required, Validators.maxLength(128)]]
  });
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly selectedLogoDataUrl = signal<string | null>(null);
  protected readonly isLogoRemoved = signal(false);
  protected readonly fileErrorMessage = signal<string | null>(null);
  protected readonly hasLogoChange = signal(false);

  constructor() {
    effect(() => {
      this.logoForm.controls.secretCode.setValue('');
      this.previewUrl.set(this.currentLogoUrl());
      this.selectedLogoDataUrl.set(null);
      this.isLogoRemoved.set(false);
      this.fileErrorMessage.set(null);
      this.hasLogoChange.set(false);
    });
  }

  protected handleFileInput(event: Event): void {
    const fileInput = event.target instanceof HTMLInputElement ? event.target : null;
    const file = fileInput?.files?.[0] ?? null;

    if (file) {
      this.readImageFile(file);
    }

    if (fileInput) {
      fileInput.value = '';
    }
  }

  protected handlePaste(event: ClipboardEvent): void {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/')) ?? null;

    if (!file) {
      return;
    }

    event.preventDefault();
    this.readImageFile(file);
  }

  protected handleDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected handleDrop(event: DragEvent): void {
    event.preventDefault();
    const file = [...(event.dataTransfer?.files ?? [])].find((item) => item.type.startsWith('image/')) ?? null;

    if (file) {
      this.readImageFile(file);
    }
  }

  protected removeLogo(): void {
    this.previewUrl.set(null);
    this.selectedLogoDataUrl.set(null);
    this.isLogoRemoved.set(true);
    this.hasLogoChange.set(Boolean(this.currentLogoUrl()));
    this.fileErrorMessage.set(null);
  }

  protected submit(): void {
    if (this.logoForm.invalid || this.isSubmitting() || !this.hasLogoChange()) {
      this.logoForm.markAllAsTouched();
      return;
    }

    const value = this.logoForm.getRawValue();

    this.confirmLogoChange.emit({
      logoDataUrl: this.isLogoRemoved() ? null : this.selectedLogoDataUrl(),
      secretCode: value.secretCode
    });
  }

  protected cancel(): void {
    if (!this.isSubmitting()) {
      this.cancelModal.emit();
    }
  }

  private readImageFile(file: File): void {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.fileErrorMessage.set(this.translations.translate("ui.choose_a_png_jpg_or_webp_image"));
      return;
    }

    if (file.size < 1 || file.size > 300_000) {
      this.fileErrorMessage.set(this.translations.translate("ui.image_must_be_smaller_than_300_kb"));
      return;
    }

    const reader = new FileReader();

    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        this.fileErrorMessage.set(this.translations.translate("ui.image_could_not_be_read"));
        return;
      }

      this.previewUrl.set(reader.result);
      this.selectedLogoDataUrl.set(reader.result);
      this.isLogoRemoved.set(false);
      this.hasLogoChange.set(true);
      this.fileErrorMessage.set(null);
    });

    reader.addEventListener('error', () => {
      this.fileErrorMessage.set(this.translations.translate("ui.image_could_not_be_read"));
    });

    reader.readAsDataURL(file);
  }
}
