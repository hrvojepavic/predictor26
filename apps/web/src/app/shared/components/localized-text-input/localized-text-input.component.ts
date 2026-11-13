import { Component, computed, DestroyRef, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, FormControl, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ApplicationLanguage, LocalizedString } from '@models/content-localization.models';
import { TranslationService } from '@services/translation.service';
import { DEFAULT_LANGUAGE } from '@core/i18n/language.config';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-localized-text-input',
  imports: [ReactiveFormsModule, TranslatePipe],
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LocalizedTextInputComponent), multi: true }],
  template: `
    <div class="languages" role="group" [attr.aria-label]="'content.edit_language' | translate">
      @for (language of languages(); track language.code) {
        <button type="button" [disabled]="disabled()" [attr.aria-pressed]="selectedLanguage() === language.code"
          [class.selected]="selectedLanguage() === language.code" (click)="selectLanguage(language.code)">{{ language.name }}</button>
      }
    </div>
    <label>
      <span>{{ label() }} · {{ selectedName() }}</span>
      <textarea [formControl]="text" [attr.maxlength]="maxLength()" rows="3" (blur)="touch()"></textarea>
    </label>
    <small>{{ 'content.fallback_hint' | translate }}</small>
  `,
  styles: `
    :host { display: block; }
    .languages { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    button { padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: white; cursor: pointer; }
    button.selected { color: #3730a3; background: #eef2ff; border-color: #6366f1; }
    label { display: grid; gap: 6px; font-size: .85rem; }
    textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font: inherit; }
    small { display: block; color: #6b7280; margin-top: 6px; }
  `
})
export class LocalizedTextInputComponent implements ControlValueAccessor {
  readonly languages = input.required<readonly ApplicationLanguage[]>();
  readonly label = input.required<string>();
  readonly maxLength = input(500);
  private readonly translations = inject(TranslationService);
  protected readonly selectedLanguage = signal(this.translations.language());
  protected readonly selectedName = computed(() => this.languages().find(l => l.code === this.selectedLanguage())?.name ?? this.selectedLanguage());
  protected readonly disabled = signal(false);
  protected readonly text = new FormControl('', { nonNullable: true });
  private values: readonly LocalizedString[] = [];
  private change: (value: readonly LocalizedString[]) => void = () => {};
  protected touch: () => void = () => {};

  constructor() {
    this.text.valueChanges.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(value => {
      this.values = [...this.values.filter(item => item.languageCode !== this.selectedLanguage()), { languageCode: this.selectedLanguage(), value }];
      this.change(this.values);
    });
  }
  writeValue(value: readonly LocalizedString[] | null): void {
    this.values = value ?? [];
    this.selectLanguage(this.selectedLanguage() || DEFAULT_LANGUAGE);
  }
  registerOnChange(fn: (value: readonly LocalizedString[]) => void): void { this.change = fn; }
  registerOnTouched(fn: () => void): void { this.touch = fn; }
  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
    if (disabled) this.text.disable({ emitEvent: false }); else this.text.enable({ emitEvent: false });
  }
  protected selectLanguage(code: string): void {
    this.selectedLanguage.set(code);
    this.text.setValue(this.values.find(value => value.languageCode === code)?.value ?? '', { emitEvent: false });
  }
}
