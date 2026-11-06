import {
  disableNotificationSubscription,
  listRecentReminderAttempts,
  listNotificationSubscriptionsForUser,
  listRecentReminderDeliveries,
  listReminderCandidates,
  PushSubscriptionInput,
  recordReminderAttempt,
  recordReminderDelivery,
  ReminderAttemptInput,
  upsertNotificationSubscription
} from '../../database/queries/notifications.queries.js';

export { listPendingRoundOpenings, claimRoundOpening, finishRoundOpening } from '../../database/queries/round-opening-notifications.queries.js';

export function saveUserNotificationSubscription(userId: number, input: PushSubscriptionInput, competitionId?: number): void {
  upsertNotificationSubscription(userId, input, competitionId);
}

export function disableUserNotificationSubscription(endpoint: string): void {
  disableNotificationSubscription(endpoint);
}

export function findUserNotificationSubscriptions(userId: number) {
  return listNotificationSubscriptionsForUser(userId);
}

export function findReminderCandidates(competitionId: number) {
  return listReminderCandidates(competitionId);
}

export function markReminderDelivered(competitionId: number, userId: number, predictionRound: string, reminderHours: 1 | 9): void {
  recordReminderDelivery(competitionId, userId, predictionRound, reminderHours);
}

export function markReminderAttempted(input: ReminderAttemptInput): void {
  recordReminderAttempt(input);
}

export { listRecentReminderAttempts, listRecentReminderDeliveries };

export { getNotificationPreferences as findNotificationPreferences, upsertNotificationPreferences as saveNotificationPreferences } from '../../database/queries/notifications.queries.js';

export { listCompetitionNotificationBrowsers, removeCompetitionNotificationBrowser } from '../../database/queries/notifications.queries.js';

export { listCompetitionNotificationMembers } from '../../database/queries/notifications.queries.js';

export { isNotificationRecipient, skipNotificationReminder } from '../../database/queries/notifications.queries.js';
