import { createHash } from 'node:crypto';
import webPush, { PushSubscription } from 'web-push';

import { config } from '../../config/index.js';
import { getAppMetadataValue, setAppMetadataValue } from '../../database/queries/app-metadata.queries.js';
import { getSuperAdminUser } from '../../database/queries/users.queries.js';
import { verifyPassword } from '../../shared/utils/password.js';
import { AdminNotificationSettingsResponse, NotificationPreferences, NotificationPreferencesResponse, SavePushSubscriptionRequest, UpdateNotificationSettingsRequest } from './notifications.interfaces.js';
import {
  findNotificationPreferences,
  isNotificationRecipient,
  skipNotificationReminder,
  listCompetitionNotificationMembers,
  listCompetitionNotificationBrowsers,
  removeCompetitionNotificationBrowser,
  saveNotificationPreferences,
  disableUserNotificationSubscription,
  findUserNotificationSubscriptions,
  findReminderCandidates,
  listRecentReminderAttempts,
  listRecentReminderDeliveries,
  markReminderAttempted,
  markReminderDelivered,
  saveUserNotificationSubscription
} from './notifications.repository.js';
import {
  findCompetitionForAdmin,
  findCompetitionsWithNotificationRemindersEnabled,
  setCompetitionJobSettings
} from '../competitions/competitions.repository.js';

webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);

const notificationReminderLastRunKey = 'notification_reminder_last_run';
const secretCodeMaxLength = 128;
const recentReminderDeliveryLimit = 20;
const recentReminderAttemptLimit = 30;
const dueReminderCandidateLimit = 20;
const reminderCandidateWindowMs = 10 * 60 * 1000;

const activeReminderRuns = new Map<number, Promise<NotificationReminderRunReport>>();

export interface NotificationReminderRunReport {
  readonly competitionId: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly enabled: boolean;
  readonly candidateCount: number;
  readonly attemptedSubscriptionCount: number;
  readonly acceptedSubscriptionCount: number;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly disabledSubscriptionCount: number;
  readonly errorMessage: string | null;
}

export type UpdateNotificationSettingsResult =
  | {
      readonly status: 'updated';
      readonly settings: {
        readonly remindersEnabled: boolean;
      };
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export async function getNotificationConfig(competitionId: number) {
  return {
    vapidPublicKey: config.vapidPublicKey,
    remindersEnabled: await areNotificationRemindersEnabled(competitionId)
  };
}

export async function getNotificationSettings(competitionId: number): Promise<AdminNotificationSettingsResponse> {
  return {
    members: listCompetitionNotificationMembers(competitionId).map(({ browserUserAgents, ...member }) => ({
      ...member,
      browsers: browserUserAgents.map(agent => `${formatBrowserLabel(agent)}${browserPlatform(agent)}`)
    })),
    remindersEnabled: await areNotificationRemindersEnabled(competitionId)
  };
}

export async function getNotificationReminderJobSnapshot(competitionId: number) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() - getReminderCandidateWindowMs());
  const remindersEnabled = await areNotificationRemindersEnabled(competitionId);
  const dueCandidates = remindersEnabled ? getDueReminderCandidates(competitionId, now, windowEnd) : [];
  const dueUsers = getUniqueDueReminderUsers(dueCandidates);

  return {
    enabled: remindersEnabled,
    intervalMs: config.notificationReminderIntervalMs,
    usersToNotifyNowCount: dueUsers.length,
    lastRun: await getLastNotificationReminderRun(competitionId),
    dueUsers: dueUsers.slice(0, dueReminderCandidateLimit),
    recentDeliveries: listRecentReminderDeliveries(competitionId, recentReminderDeliveryLimit).map((delivery) => ({
      userId: delivery.user_id,
      username: delivery.username,
      predictionRound: delivery.prediction_round,
      reminderHours: delivery.reminder_hours,
      deliveredAt: toUtcIsoTimestamp(delivery.created_at)
    })),
    recentAttempts: listRecentReminderAttempts(competitionId, recentReminderAttemptLimit).map((attempt) => ({
      userId: attempt.user_id,
      username: attempt.username,
      predictionRound: attempt.prediction_round,
      reminderHours: attempt.reminder_hours,
      subscriptionId: attempt.subscription_id,
      browser: formatBrowserLabel(attempt.user_agent),
      status: attempt.status,
      statusCode: attempt.status_code,
      errorMessage: attempt.error_message,
      attemptedAt: toUtcIsoTimestamp(attempt.created_at)
    }))
  };
}

function getUniqueDueReminderUsers(candidates: ReturnType<typeof findReminderCandidates>) {
  const users = new Map<string, {
    readonly userId: number;
    readonly username: string;
    readonly predictionRound: string;
    readonly deadlineAt: string;
    readonly expectedCount: number;
    readonly submittedCount: number;
    readonly reminderHours: 1 | 9;
  }>();

  for (const candidate of candidates) {
    const key = `${candidate.user_id}:${candidate.prediction_round}:${candidate.reminder_hours}`;

    if (!users.has(key)) {
      users.set(key, {
        userId: candidate.user_id,
        username: candidate.username,
        predictionRound: candidate.prediction_round,
        deadlineAt: candidate.deadline_at,
        expectedCount: candidate.expected_count,
        submittedCount: candidate.submitted_count,
        reminderHours: candidate.reminder_hours
      });
    }
  }

  return [...users.values()];
}

export async function updateNotificationSettings(
  competitionId: number,
  input: Partial<UpdateNotificationSettingsRequest> | undefined
): Promise<UpdateNotificationSettingsResult> {
  if (
    typeof input?.remindersEnabled !== 'boolean' ||
    typeof input.secretCode !== 'string' ||
    input.secretCode.length < 1 ||
    input.secretCode.length > secretCodeMaxLength
  ) {
    return { status: 'invalid' };
  }

  if (!(await isValidSecretCode(input.secretCode))) {
    return { status: 'invalid_secret' };
  }

  const remindersEnabled = input.remindersEnabled === true;
  const competition = findCompetitionForAdmin(competitionId);
  const nextRemindersEnabled = remindersEnabled && competition?.is_finished === 0;

  setCompetitionJobSettings(competitionId, { notificationRemindersEnabled: nextRemindersEnabled });

  return {
    status: 'updated',
    settings: {
      remindersEnabled: nextRemindersEnabled
    }
  };
}

export async function savePushSubscription(
  userId: number,
  input: Partial<SavePushSubscriptionRequest> | undefined,
  userAgent: string | null,
  competitionId?: number
): Promise<boolean> {
  if (!isValidSubscriptionRequest(input)) {
    return false;
  }

  saveUserNotificationSubscription(userId, {
    endpoint: input.endpoint,
    subscriptionJson: JSON.stringify(input),
    userAgent
  }, competitionId);

  return true;
}

export function startNotificationReminderScheduler(): void {
  if (config.notificationReminderIntervalMs <= 0) {
    return;
  }

  void sendDuePredictionReminders();

  setInterval(() => {
    void sendDuePredictionReminders();
  }, config.notificationReminderIntervalMs);
}

export async function sendDuePredictionReminders(): Promise<NotificationReminderRunReport> {
  return runDuePredictionRemindersForEnabledCompetitions();
}

export async function sendDuePredictionRemindersForCompetition(competitionId: number): Promise<NotificationReminderRunReport> {
  const active = activeReminderRuns.get(competitionId);
  if (active) return active;
  const run = runDuePredictionReminders(competitionId).finally(() => activeReminderRuns.delete(competitionId));
  activeReminderRuns.set(competitionId, run);
  return run;
}

async function runDuePredictionRemindersForEnabledCompetitions(): Promise<NotificationReminderRunReport> {
  let lastReport: NotificationReminderRunReport | null = null;

  for (const competition of findCompetitionsWithNotificationRemindersEnabled()) {
    lastReport = await sendDuePredictionRemindersForCompetition(competition.id);
  }

  if (lastReport) {
    return lastReport;
  }

  const now = new Date().toISOString();
  return {
    competitionId: 0,
    startedAt: now,
    finishedAt: now,
    enabled: false,
    candidateCount: 0,
    attemptedSubscriptionCount: 0,
    acceptedSubscriptionCount: 0,
    sentCount: 0,
    failedCount: 0,
    disabledSubscriptionCount: 0,
    errorMessage: null
  };
}

async function runDuePredictionReminders(competitionId: number): Promise<NotificationReminderRunReport> {
  const startedAt = new Date();
  const enabled = await areNotificationRemindersEnabled(competitionId);
  const now = new Date();
  const windowEnd = new Date(now.getTime() - getReminderCandidateWindowMs());
  const candidates = enabled ? getDueReminderCandidates(competitionId, now, windowEnd) : [];
  const candidateGroups = groupReminderCandidatesByUser(candidates);
  let acceptedSubscriptionCount = 0;
  let attemptedSubscriptionCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  let disabledSubscriptionCount = 0;
  let errorMessage: string | null = null;

  for (const group of candidateGroups) {
    const payload = buildReminderPayload(group.reminder);
    let groupAcceptedCount = 0;
    let groupAttemptedCount = 0;

    for (const candidate of group.subscriptions) {
      // A user can opt out while an earlier push in this batch is in flight.
      const settings = findNotificationPreferences(candidate.user_id, competitionId);
      if (!settings.competitionEnabled || !settings.eligible || !settings.preferences.enabled ||
          !(candidate.reminder_hours === 9 ? settings.preferences.reminder9h : settings.preferences.reminder1h)) continue;
      const subscriptionActive = listCompetitionNotificationBrowsers(candidate.user_id, competitionId).some(subscription => subscription.id === candidate.subscription_id);
      if (!subscriptionActive || Date.parse(candidate.deadline_at) <= Date.now()) continue;
      if (!isNotificationRecipient(candidate.subscription_id, candidate.user_id)) {
        skipNotificationReminder(candidate);
        continue;
      }
      attemptedSubscriptionCount += 1;
      groupAttemptedCount += 1;
      try {
        await webPush.sendNotification(
          JSON.parse(candidate.subscription_json) as PushSubscription,
          JSON.stringify(payload),
          { TTL: Math.max(1, Math.floor((Date.parse(candidate.deadline_at) - Date.now()) / 1000)) }
        );
        markReminderAttempted({
          userId: candidate.user_id,
          competitionId: candidate.competition_id,
          subscriptionId: candidate.subscription_id,
          predictionRound: candidate.prediction_round,
          reminderHours: candidate.reminder_hours,
          status: 'accepted',
          statusCode: null,
          errorMessage: null
        });
        groupAcceptedCount += 1;
        acceptedSubscriptionCount += 1;
      } catch (error) {
        const statusCode = readWebPushStatusCode(error);
        errorMessage = readWebPushErrorMessage(error);
        const attemptStatus = statusCode === 404 || statusCode === 410 ? 'disabled' : 'failed';

        markReminderAttempted({
          userId: candidate.user_id,
          competitionId: candidate.competition_id,
          subscriptionId: candidate.subscription_id,
          predictionRound: candidate.prediction_round,
          reminderHours: candidate.reminder_hours,
          status: attemptStatus,
          statusCode,
          errorMessage
        });

        if (statusCode === 404 || statusCode === 410) {
          disableUserNotificationSubscription(candidate.endpoint);
          disabledSubscriptionCount += 1;
        }

        console.error('Prediction reminder notification failed', {
          userId: candidate.user_id,
          predictionRound: candidate.prediction_round,
          reminderHours: candidate.reminder_hours,
          subscriptionId: candidate.subscription_id,
          statusCode
        });
      }
    }

    if (groupAcceptedCount > 0) {
      markReminderDelivered(
        competitionId,
        group.reminder.user_id,
        group.reminder.prediction_round,
        group.reminder.reminder_hours
      );
      sentCount += 1;
    } else if (groupAttemptedCount > 0) {
      failedCount += 1;
    }
  }

  const report = {
    competitionId,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    enabled,
    candidateCount: candidateGroups.length,
    attemptedSubscriptionCount,
    acceptedSubscriptionCount,
    sentCount,
    failedCount,
    disabledSubscriptionCount,
    errorMessage
  };

  setAppMetadataValue(`${notificationReminderLastRunKey}:${competitionId}`, JSON.stringify(report));

  return report;
}

type ReminderCandidate = ReturnType<typeof findReminderCandidates>[number];

function getDueReminderCandidates(competitionId: number, now: Date, windowEnd: Date): ReminderCandidate[] {
  return findReminderCandidates(competitionId).filter((candidate) => isReminderCandidateDue(candidate, now, windowEnd));
}

function isReminderCandidateDue(candidate: ReminderCandidate, now: Date, windowEnd: Date): boolean {
  const deadlineTime = Date.parse(candidate.deadline_at);

  if (Number.isNaN(deadlineTime) || deadlineTime <= now.getTime()) {
    return false;
  }

  const reminderTime = deadlineTime - candidate.reminder_hours * 60 * 60 * 1000;

  return reminderTime <= now.getTime() && reminderTime > windowEnd.getTime();
}

function groupReminderCandidatesByUser(candidates: ReminderCandidate[]) {
  const groups = new Map<
    string,
    {
      readonly reminder: ReminderCandidate;
      readonly subscriptions: ReminderCandidate[];
    }
  >();

  for (const candidate of candidates) {
    const key = `${candidate.user_id}:${candidate.prediction_round}:${candidate.reminder_hours}`;
    const group = groups.get(key);

    if (group) {
      group.subscriptions.push(candidate);
    } else {
      groups.set(key, {
        reminder: candidate,
        subscriptions: [candidate]
      });
    }
  }

  return [...groups.values()];
}

export async function sendTestNotification(userId: number, competitionId: number): Promise<{ readonly sent: number; readonly subscriptions: number }> {
  const subscriptions = findUserNotificationSubscriptions(userId);
  let sent = 0;

  for (const subscription of subscriptions) {
    if (!isNotificationRecipient(subscription.id, userId)) continue;
    try {
      await webPush.sendNotification(
        JSON.parse(subscription.subscription_json) as PushSubscription,
        JSON.stringify({
          title: `${findCompetitionForAdmin(competitionId)?.name ?? 'Competition'}: test reminder`,
          body: 'This is a manual test. Your reminder preferences have not changed.',
          icon: '/icons/predictor26-icon.svg',
          badge: '/icons/predictor26-icon.svg',
          tag: `prediction-reminder:test:${competitionId}:${userId}`,
          data: {
            url: `/competition/${findCompetitionForAdmin(competitionId)?.slug}/settings`,
            competitionId,
            userId,
            test: true
          }
        })
      );
      sent += 1;
    } catch (error) {
      const statusCode = readWebPushStatusCode(error);

      if (statusCode === 404 || statusCode === 410) {
        disableUserNotificationSubscription(subscription.endpoint);
      }

      console.error('Test notification failed', {
        userId,
        subscriptionId: subscription.id,
        statusCode
      });
    }
  }

  return {
    sent,
    subscriptions: subscriptions.length
  };
}

export function getUserNotificationPreferences(userId: number, competitionId: number): NotificationPreferencesResponse {
  return {
    ...findNotificationPreferences(userId, competitionId),
    browsers: listCompetitionNotificationBrowsers(userId, competitionId).map(browser => ({
      id: browser.id,
      name: `${formatBrowserLabel(browser.user_agent)}${browserPlatform(browser.user_agent)}`,
      fingerprint: createHash('sha256').update(browser.endpoint).digest('hex')
    }))
  };
}

export function updateUserNotificationPreferences(userId: number, competitionId: number, input: unknown): NotificationPreferencesResponse | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Partial<NotificationPreferences>;
  if (typeof value.enabled !== 'boolean' || typeof value.reminder9h !== 'boolean' || typeof value.reminder1h !== 'boolean') return null;
  saveNotificationPreferences(userId, competitionId, value as NotificationPreferences);
  return getUserNotificationPreferences(userId, competitionId);
}

async function areNotificationRemindersEnabled(competitionId: number): Promise<boolean> {
  const competition = findCompetitionForAdmin(competitionId);

  return competition?.notification_reminders_enabled === 1 && competition.is_finished === 0 && competition.is_archived === 0;
}

async function getLastNotificationReminderRun(competitionId: number): Promise<NotificationReminderRunReport | null> {
  const value =
    await getAppMetadataValue(`${notificationReminderLastRunKey}:${competitionId}`);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as NotificationReminderRunReport;
  } catch {
    return null;
  }
}

async function isValidSecretCode(secretCode: string): Promise<boolean> {
  const superAdmin = await getSuperAdminUser();

  return Boolean(superAdmin && verifyPassword(secretCode, superAdmin.password_hash));
}

function buildReminderPayload(candidate: ReturnType<typeof findReminderCandidates>[number]) {
  const missingCount = Math.max(candidate.expected_count - candidate.submitted_count, 0);
  const roundLabel = getShortRoundLabel(candidate.prediction_round);
  const title = missingCount > 0 ? `${roundLabel}: ${missingCount} predictions left` : `${roundLabel}: predictions complete`;
  const timing = `Prediction round closes in about ${candidate.reminder_hours} ${candidate.reminder_hours === 1 ? 'hour' : 'hours'}.`;
  const body =
    missingCount > 0
      ? `${timing} Post ${missingCount} missing ${missingCount === 1 ? 'prediction' : 'predictions'}.`
      : `${timing} You can still update your predictions.`;

  return {
    title: `${candidate.competition_name}: ${title}`,
    body,
    icon: '/icons/predictor26-icon.svg',
    badge: '/icons/predictor26-icon.svg',
    tag: `prediction-reminder:${candidate.competition_id}:${candidate.user_id}:${candidate.prediction_round}:${candidate.reminder_hours}`,
    renotify: true,
    data: {
      url: `/competition/${candidate.competition_slug}/predictions`,
      competitionId: candidate.competition_id,
      userId: candidate.user_id,
      predictionRound: candidate.prediction_round,
      deadlineAt: candidate.deadline_at,
      reminderHours: candidate.reminder_hours,
      expectedCount: candidate.expected_count,
      submittedCount: candidate.submitted_count,
      missingCount
    }
  };
}

function getShortRoundLabel(label: string): string {
  const labels = new Map<string, string>([
    ['Group stage - Round 1', 'Round 1'],
    ['Group stage - Round 2', 'Round 2'],
    ['Group stage - Round 3', 'Round 3']
  ]);

  return labels.get(label) ?? label;
}

function isValidSubscriptionRequest(input: Partial<SavePushSubscriptionRequest> | undefined): input is SavePushSubscriptionRequest {
  return (
    typeof input?.endpoint === 'string' &&
    input.endpoint.startsWith('https://') &&
    typeof input.keys?.p256dh === 'string' &&
    input.keys.p256dh.length > 0 &&
    typeof input.keys.auth === 'string' &&
    input.keys.auth.length > 0
  );
}

function readWebPushStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return null;
  }

  const statusCode = (error as { readonly statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function readWebPushErrorMessage(error: unknown): string {
  const fallback = error instanceof Error ? error.message : 'Prediction reminder notification failed.';

  if (typeof error !== 'object' || error === null || !('body' in error)) {
    return fallback;
  }

  const body = (error as { readonly body?: unknown }).body;

  if (typeof body !== 'string' || body.trim().length === 0) {
    return fallback;
  }

  return `${fallback}: ${body.trim().slice(0, 500)}`;
}

function getReminderCandidateWindowMs(): number {
  return reminderCandidateWindowMs;
}

function toUtcIsoTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    return value;
  }

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return new Date(value).toISOString();
  }

  return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
}

function formatBrowserLabel(userAgent: string | null): string {
  if (!userAgent) {
    return 'Unknown browser';
  }

  if (/Edg\/|EdgiOS\/|EdgA\//.test(userAgent)) {
    return 'Edge';
  }

  if (userAgent.includes('OPR/') || userAgent.includes('Opera')) {
    return 'Opera';
  }

  if (/Firefox\/|FxiOS\//.test(userAgent)) {
    return 'Firefox';
  }

  if (/Chrome\/|CriOS\//.test(userAgent)) {
    return 'Chrome/Chromium';
  }

  if (userAgent.includes('Safari/') && userAgent.includes('Version/')) {
    return 'Safari';
  }

  return 'Unknown browser';
}

function browserPlatform(agent: string | null): string {
  if (!agent) return '';
  if (/iPhone|iPad/.test(agent)) return ' on iOS';
  if (agent.includes('Android')) return ' on Android';
  if (agent.includes('Windows')) return ' on Windows';
  if (agent.includes('Macintosh')) return ' on Mac';
  if (agent.includes('Linux')) return ' on Linux';
  return '';
}

export function removeUserNotificationBrowser(userId: number, competitionId: number, subscriptionId: number) {
  return removeCompetitionNotificationBrowser(userId, competitionId, subscriptionId);
}
