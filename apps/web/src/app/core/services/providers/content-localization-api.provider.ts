import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CreateContentRuleRequest } from '@models/content-localization.models';
import type { ApplicationLanguage, ContentLocalizationResponse, LocalizedContentEntry } from '@models/content-localization.models';

@Injectable({ providedIn: 'root' })
export class ContentLocalizationApiProvider {
  private readonly http = inject(HttpClient);
  getContent() { return this.http.get<ContentLocalizationResponse>('/api/content-localization'); }
  createRule(rule: CreateContentRuleRequest) {
    return this.http.post<ContentLocalizationResponse>('/api/admin/content-rules', rule);
  }
  getAdminContent() { return this.http.get<ContentLocalizationResponse>('/api/admin/content-localization'); }
  saveLanguage(language: ApplicationLanguage) {
    return this.http.put<ContentLocalizationResponse>('/api/admin/languages', language);
  }
  saveTranslation(entry: LocalizedContentEntry) {
    return this.http.put<ContentLocalizationResponse>('/api/admin/content-translations', entry);
  }
}
