import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DEFAULT_LANGUAGE } from '@core/i18n/language.config';
import type { ApplicationLanguage, ContentLocalizationResponse, LocalizedContentEntry, LocalizedString } from '@models/content-localization.models';
import { ContentLocalizationService } from '@services/content-localization.service';
import { ContentLocalizationApiProvider } from '@services/providers/content-localization-api.provider';
import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';
import { LocalizedTextInputComponent } from '@shared/components/localized-text-input/localized-text-input.component';

interface ContentRow { readonly entry: LocalizedContentEntry; readonly control: FormControl<readonly LocalizedString[]>; }

@Component({
  selector: 'app-admin-content-page',
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, LocalizedTextInputComponent],
  templateUrl: './admin-content-page.component.html',
  styleUrl: './admin-content-page.component.scss'
})
export class AdminContentPageComponent {
  protected readonly content = inject(ContentLocalizationService);
  private readonly api = inject(ContentLocalizationApiProvider);
  private readonly translations = inject(TranslationService);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly defaultLanguage = DEFAULT_LANGUAGE;
  protected readonly saving = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly success = signal(false);
  protected readonly rows = signal<ContentRow[]>([]);
  protected readonly kind = signal<LocalizedContentEntry['kind']>('rule');
  protected readonly visibleRows = computed(() => this.rows().filter(row => row.entry.kind === this.kind()));
  protected readonly kinds = ['rule', 'round', 'stage'] as const;
  protected readonly languageForm = this.formBuilder.nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/), Validators.maxLength(35)]],
    name: ['', [Validators.required, Validators.maxLength(80)]]
  });
  protected readonly wordingForm = this.formBuilder.nonNullable.group({ source: ['', [Validators.required, Validators.maxLength(140)]] });
  protected readonly ruleForm = this.formBuilder.nonNullable.group({
    translations: new FormControl<readonly LocalizedString[]>([], { nonNullable: true,
      validators: control => control.value.some((t: LocalizedString) => t.languageCode === DEFAULT_LANGUAGE && t.value.trim()) ? null : { englishRequired: true } }),
    valueLabel: ['', Validators.maxLength(120)],
    defaultValue: ['', Validators.maxLength(120)]
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.getAdminContent());
      await this.content.apply(response);
      this.rows.set(response.entries.map(entry => ({ entry, control: new FormControl(entry.translations, { nonNullable: true }) })));
    } catch {
      this.error.set(this.translations.translate('content.load_failed'));
    } finally { this.loading.set(false); }
  }

  protected async addLanguage(): Promise<void> {
    if (this.languageForm.invalid || this.saving()) return;
    const language = this.languageForm.getRawValue();
    if (this.content.languages().some(item => item.code === language.code)) {
      this.error.set(this.translations.translate('content.language_exists')); return;
    }
    if (await this.save(() => firstValueFrom(this.api.saveLanguage({ ...language, enabled: true })))) this.languageForm.reset();
  }

  protected toggleLanguage(language: ApplicationLanguage): void {
    void this.save(() => firstValueFrom(this.api.saveLanguage({ ...language, enabled: !language.enabled })));
  }

  protected async saveRow(row: ContentRow): Promise<void> {
    if (await this.save(() => firstValueFrom(this.api.saveTranslation({ ...row.entry, translations: row.control.getRawValue() })))) row.control.markAsPristine();
  }

  protected async addWording(): Promise<void> {
    if (this.wordingForm.invalid || this.kind() === 'rule' || this.saving()) return;
    const sourceText = this.wordingForm.getRawValue().source.trim();
    const entry: LocalizedContentEntry = { id: '', kind: this.kind(), sourceText,
      translations: [{ languageCode: DEFAULT_LANGUAGE, value: sourceText }] };
    if (await this.save(() => firstValueFrom(this.api.saveTranslation(entry)))) this.wordingForm.reset();
  }

  protected async addRule(): Promise<void> {
    if (this.ruleForm.invalid || this.saving()) return;
    const input = this.ruleForm.getRawValue();
    if (await this.save(() => firstValueFrom(this.api.createRule(input)))) this.ruleForm.reset();
  }

  private async save(action: () => Promise<ContentLocalizationResponse>): Promise<boolean> {
    if (this.saving()) return false;
    this.saving.set(true); this.error.set(''); this.success.set(false);
    this.ruleForm.disable({ emitEvent: false });
    this.rows().forEach(row => row.control.disable({ emitEvent: false }));
    try {
      const response = await action();
      await this.content.apply(response);
      // Preserve unsaved edits in other rows when one entry or a language is saved.
      this.rows.update(rows => response.entries.map(entry => {
        const existing = rows.find(row => row.entry.kind === entry.kind &&
          (entry.kind === 'rule' ? row.entry.id === entry.id : row.entry.sourceText === entry.sourceText));
        return existing ? { ...existing, entry } : { entry, control: new FormControl(entry.translations, { nonNullable: true }) };
      }));
      this.success.set(true);
      return true;
    } catch (error) {
      this.error.set(error instanceof HttpErrorResponse && typeof error.error?.message === 'string'
        ? error.error.message : this.translations.translate('content.save_failed'));
      return false;
    } finally {
      this.saving.set(false);
      this.ruleForm.enable({ emitEvent: false });
      this.rows().forEach(row => row.control.enable({ emitEvent: false }));
    }
  }
}
