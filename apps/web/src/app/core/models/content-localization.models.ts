export interface LocalizedString {
  readonly languageCode: string;
  readonly value: string;
}
export interface CreateContentRuleRequest {
  readonly translations: readonly LocalizedString[];
  readonly valueLabel?: string | null;
  readonly defaultValue?: string | null;
}
export interface ApplicationLanguage {
  readonly code: string;
  readonly name: string;
  readonly enabled: boolean;
}
export interface LocalizedContentEntry {
  readonly id: string;
  readonly kind: 'rule' | 'round' | 'stage';
  readonly sourceText: string;
  readonly translations: readonly LocalizedString[];
}
export interface ContentLocalizationResponse {
  readonly languages: readonly ApplicationLanguage[];
  readonly entries: readonly LocalizedContentEntry[];
}
