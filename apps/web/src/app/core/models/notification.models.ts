export interface NotificationConfigResponse {
  readonly vapidPublicKey: string;
  readonly remindersEnabled: boolean;
}

export interface SavePushSubscriptionResponse {
  readonly subscribed: true;
}

export interface NotificationSettingsResponse {
  readonly remindersEnabled: boolean;
}

export interface UpdateNotificationSettingsRequest {
  readonly remindersEnabled: boolean;
  readonly secretCode: string;
}

export interface SendTestNotificationResponse {
  readonly sent: number;
  readonly subscriptions: number;
}

export interface NotificationPreferences {
  readonly enabled: boolean;
  readonly reminder9h: boolean;
  readonly roundOpened: boolean;
  readonly reminder1h: boolean;
}

export interface NotificationBrowser {
  readonly id: number;
  readonly name: string;
  readonly fingerprint: string;
}

export interface NotificationPreferencesResponse {
  readonly browsers: readonly NotificationBrowser[];
  readonly preferences: NotificationPreferences;
  readonly competitionEnabled: boolean;
  readonly competitionClosed: boolean;
  readonly eligible: boolean;
}

export interface AdminNotificationMember {
  readonly browsers: readonly string[];
  readonly userId: number;
  readonly username: string;
  readonly reminder1h: boolean;
  readonly reminder9h: boolean;
  readonly roundOpened: boolean;
}

export interface AdminNotificationSettingsResponse extends NotificationSettingsResponse {
  readonly competitionClosed: boolean;
  readonly members: readonly AdminNotificationMember[];
}
