import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

import {
  AdminNotificationSettingsResponse,
  NotificationPreferences,
  NotificationPreferencesResponse,
  NotificationConfigResponse,
  NotificationSettingsResponse,
  SavePushSubscriptionResponse,
  SendTestNotificationResponse,
  UpdateNotificationSettingsRequest
} from '@models/notification.models';

@Injectable({
  providedIn: 'root'
})
export class NotificationsApiProvider {
  private readonly http = inject(HttpClient);

  getConfig(competitionId?: number) {
    return this.http.get<NotificationConfigResponse>('/api/notifications/config', competitionId === undefined
      ? {} : { headers: { 'X-Competition-Id': String(competitionId) } });
  }

  getPreferences(competitionId: number) {
    return this.http.get<NotificationPreferencesResponse>(`/api/competitions/${competitionId}/notification-preferences`);
  }

  savePreferences(competitionId: number, preferences: NotificationPreferences) {
    return this.http.put<NotificationPreferencesResponse>(`/api/competitions/${competitionId}/notification-preferences`, preferences);
  }

  addBrowser(competitionId: number, subscription: PushSubscription) {
    return this.http.post<NotificationPreferencesResponse>(`/api/competitions/${competitionId}/notification-browsers`, subscription.toJSON());
  }

  removeBrowser(competitionId: number, browserId: number) {
    return this.http.delete<NotificationPreferencesResponse>(`/api/competitions/${competitionId}/notification-browsers/${browserId}`);
  }

  saveSubscription(subscription: PushSubscription) {
    return this.http.post<SavePushSubscriptionResponse>('/api/notifications/subscriptions', subscription.toJSON());
  }

  getAdminSettings() {
    return this.http.get<AdminNotificationSettingsResponse>('/api/admin/notifications/settings');
  }

  updateAdminSettings(request: UpdateNotificationSettingsRequest) {
    return this.http.patch<NotificationSettingsResponse>('/api/admin/notifications/settings', request);
  }

  sendTestNotification() {
    return this.http.post<SendTestNotificationResponse>('/api/admin/notifications/test', {});
  }

}
