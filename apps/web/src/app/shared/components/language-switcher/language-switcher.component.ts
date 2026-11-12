import { Component, inject } from '@angular/core';
import { AVAILABLE_LANGUAGES } from '@core/i18n/language.config';
import { TranslationService } from '@services/translation.service';
import { TranslatePipe } from '@shared/pipes/translate.pipe';

@Component({
  selector: 'app-language-switcher',
  imports: [TranslatePipe],
  templateUrl: './language-switcher.component.html',
  styleUrl: './language-switcher.component.scss'
})
export class LanguageSwitcherComponent {
  protected readonly languages = AVAILABLE_LANGUAGES;
  protected readonly translations = inject(TranslationService);
}
