import type { TranslationKey } from '@models/translation.models';

export enum Language {
  English = 'en',
  Croatian = 'hr'
}

export const DEFAULT_LANGUAGE = Language.English;
export const LANGUAGE_STORAGE_KEY = 'predictor26.language';

export const LANGUAGE_CONFIG: Record<Language, {
  name: string;
  labelKey: TranslationKey;
  url: string;
  flagUrl: string;
}> = {
  [Language.English]: { name: 'English', labelKey: 'language.english', url: '/i18n/en.json', flagUrl: '/flags/en.svg' },
  [Language.Croatian]: { name: 'Hrvatski', labelKey: 'language.croatian', url: '/i18n/hr.json', flagUrl: '/flags/hr.svg' }
};

export const AVAILABLE_LANGUAGES = Object.values(Language).map(language => ({
  language,
  name: LANGUAGE_CONFIG[language].name,
  labelKey: LANGUAGE_CONFIG[language].labelKey,
  flagUrl: LANGUAGE_CONFIG[language].flagUrl
}));
