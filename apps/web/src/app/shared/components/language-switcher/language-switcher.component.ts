import { Component, computed, inject } from '@angular/core';
import { LANGUAGE_CONFIG, Language } from '@core/i18n/language.config';
import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-language-switcher',
  imports: [TranslatePipe],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss'
})
export class LanguageSwitcherComponent {
  protected readonly translations = inject(TranslationService);
  protected readonly languages = computed(() => this.translations.languages().map(language => ({
    language: language.code,
    name: language.name,
    labelKey: Object.hasOwn(LANGUAGE_CONFIG, language.code) ? LANGUAGE_CONFIG[language.code as Language].labelKey : null,
    flagUrl: Object.hasOwn(LANGUAGE_CONFIG, language.code) ? LANGUAGE_CONFIG[language.code as Language].flagUrl : null
  })));
}
