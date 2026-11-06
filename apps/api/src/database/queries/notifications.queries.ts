import { AdminNotificationMember, NotificationPreferences, NotificationPreferencesResponse } from '../../modules/notifications/notifications.interfaces.js';
import { getPredictionRound } from '../../shared/utils/prediction-round.js';
import { openDatabase } from '../index.js';

export interface NotificationSubscriptionRow {
  readonly id: number;
  readonly user_id: number;
  readonly endpoint: string;
  readonly subscription_json: string;
  readonly is_enabled: 0 | 1;
}

export interface ReminderCandidateRow {
  readonly competition_id: number;
  readonly competition_slug: string;
  readonly competition_name: string;
  readonly user_id: number;
  readonly username: string;
  readonly prediction_round: string;
  readonly deadline_at: string;
  readonly expected_count: number;
  readonly submitted_count: number;
  readonly reminder_hours: 1 | 9;
  readonly subscription_id: number;
  readonly endpoint: string;
  readonly subscription_json: string;
  readonly user_agent: string | null;
  readonly browser_brand: string | null;
}

export interface ReminderDeliveryRow {
  readonly competition_id: number;
  readonly user_id: number;
  readonly username: string;
  readonly prediction_round: string;
  readonly reminder_hours: 1 | 9;
  readonly created_at: string;
}

export interface ReminderAttemptRow {
  readonly competition_id: number;
  readonly user_id: number;
  readonly username: string;
  readonly prediction_round: string;
  readonly reminder_hours: 1 | 9;
  readonly subscription_id: number | null;
  readonly user_agent: string | null;
  readonly browser_brand: string | null;
  readonly status: 'accepted' | 'failed' | 'disabled';
  readonly status_code: number | null;
  readonly error_message: string | null;
  readonly created_at: string;
}

export interface PushSubscriptionInput {
  readonly endpoint: string;
  readonly subscriptionJson: string;
  readonly userAgent: string | null;
  readonly browserBrand?: string | null;
}

export interface ReminderAttemptInput {
  readonly competitionId: number;
  readonly userId: number;
  readonly subscriptionId: number;
  readonly predictionRound: string;
  readonly reminderHours: 1 | 9;
  readonly status: 'accepted' | 'failed' | 'disabled';
  readonly statusCode: number | null;
  readonly errorMessage: string | null;
}

export function upsertNotificationSubscription(userId: number, input: PushSubscriptionInput, competitionId?: number): void {
  const db = openDatabase();

  try {
    db.transaction(() => {
    db.prepare(
      `
        INSERT INTO notification_subscriptions (user_id, endpoint, subscription_json, user_agent, browser_brand, is_enabled)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(endpoint) DO UPDATE SET
          user_id = excluded.user_id,
          subscription_json = excluded.subscription_json,
          user_agent = excluded.user_agent,
          browser_brand = COALESCE(excluded.browser_brand, notification_subscriptions.browser_brand),
          is_enabled = 1,
          updated_at = CURRENT_TIMESTAMP
      `
    ).run(userId, input.endpoint, input.subscriptionJson, input.userAgent, input.browserBrand ?? null);
      if (competitionId !== undefined) {
        db.prepare(`INSERT OR IGNORE INTO competition_notification_browsers (competition_id, user_id, subscription_id)
          SELECT ?, ?, id FROM notification_subscriptions WHERE endpoint = ? AND user_id = ?`).run(competitionId, userId, input.endpoint, userId);
      }
    })();
  } finally {
    db.close();
  }
}

export function disableNotificationSubscription(endpoint: string): void {
  const db = openDatabase();

  try {
    db.prepare(
      `
        UPDATE notification_subscriptions
        SET is_enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE endpoint = ?
      `
    ).run(endpoint);
  } finally {
    db.close();
  }
}

export function listNotificationSubscriptionsForUser(userId: number): NotificationSubscriptionRow[] {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT
            id,
            user_id,
            endpoint,
            subscription_json,
            is_enabled
          FROM notification_subscriptions
          WHERE user_id = ?
            AND is_enabled = 1
          ORDER BY created_at ASC
        `
      )
      .all(userId) as NotificationSubscriptionRow[];
  } finally {
    db.close();
  }
}

export function listRecentReminderDeliveries(competitionId: number, limit: number): ReminderDeliveryRow[] {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT
            notification_reminder_deliveries.competition_id,
            users.id AS user_id,
            users.username,
            notification_reminder_deliveries.prediction_round,
            notification_reminder_deliveries.reminder_hours,
            notification_reminder_deliveries.created_at
          FROM notification_reminder_deliveries
          INNER JOIN users ON users.id = notification_reminder_deliveries.user_id
          WHERE notification_reminder_deliveries.competition_id = ?
          ORDER BY notification_reminder_deliveries.created_at DESC
          LIMIT ?
        `
      )
      .all(competitionId, limit) as ReminderDeliveryRow[];
  } finally {
    db.close();
  }
}

export function listRecentReminderAttempts(competitionId: number, limit: number): ReminderAttemptRow[] {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT
            notification_reminder_attempts.competition_id,
            users.id AS user_id,
            users.username,
            notification_reminder_attempts.prediction_round,
            notification_reminder_attempts.reminder_hours,
            notification_reminder_attempts.subscription_id,
            notification_subscriptions.user_agent,
            notification_subscriptions.browser_brand,
            notification_reminder_attempts.status,
            notification_reminder_attempts.status_code,
            notification_reminder_attempts.error_message,
            notification_reminder_attempts.created_at
          FROM notification_reminder_attempts
          INNER JOIN users ON users.id = notification_reminder_attempts.user_id
          LEFT JOIN notification_subscriptions ON notification_subscriptions.id = notification_reminder_attempts.subscription_id
          WHERE notification_reminder_attempts.competition_id = ?
          ORDER BY notification_reminder_attempts.created_at DESC
          LIMIT ?
        `
      )
      .all(competitionId, limit) as ReminderAttemptRow[];
  } finally {
    db.close();
  }
}

export function listReminderCandidates(competitionId: number): ReminderCandidateRow[] {
  const db = openDatabase();
  db.function('prediction_round', { deterministic: true }, (label, number) =>
    getPredictionRound({ round_label: String(label), match_number: Number(number) }));

  try {
    return db
      .prepare(
        `
          WITH match_rounds AS (
            SELECT
              matches.id AS match_id,
              prediction_round(matches.round_label, matches.match_number) AS prediction_round,
              matches.kickoff_at
            FROM matches
            WHERE matches.competition_id = ?
              AND matches.released_for_predictions = 1
              AND matches.is_postponed = 0
          ),
          round_summaries AS (
            SELECT
              prediction_round,
              MIN(kickoff_at) AS deadline_at,
              COUNT(*) AS expected_count
            FROM match_rounds
            GROUP BY prediction_round
          ),
          reminder_windows AS (
            SELECT 9 AS reminder_hours
            UNION ALL
            SELECT 1 AS reminder_hours
          )
          SELECT
            users.id AS user_id,
            users.username,
            round_summaries.prediction_round,
            round_summaries.deadline_at,
            round_summaries.expected_count,
            COUNT(predictions.id) AS submitted_count,
            reminder_windows.reminder_hours,
            ? AS competition_id,
            competitions.slug AS competition_slug,
            competitions.name AS competition_name,
            notification_subscriptions.id AS subscription_id,
            notification_subscriptions.endpoint,
            notification_subscriptions.subscription_json,
            notification_subscriptions.user_agent, notification_subscriptions.browser_brand
          FROM users
          INNER JOIN competitions ON competitions.id = ?
          INNER JOIN competition_notification_browsers browsers
            ON browsers.competition_id = competitions.id AND browsers.user_id = users.id
          INNER JOIN notification_subscriptions
            ON notification_subscriptions.id = browsers.subscription_id
            AND notification_subscriptions.is_enabled = 1
          INNER JOIN competition_users
            ON competition_users.user_id = users.id
            AND competition_users.competition_id = ?
            AND competition_users.is_verified = 1
          INNER JOIN competition_notification_preferences preferences
            ON preferences.user_id = users.id
            AND preferences.competition_id = competitions.id
            AND preferences.enabled = 1
          CROSS JOIN round_summaries
          CROSS JOIN reminder_windows
          LEFT JOIN match_rounds
            ON match_rounds.prediction_round = round_summaries.prediction_round
          LEFT JOIN predictions
            ON predictions.user_id = users.id
            AND predictions.match_id = match_rounds.match_id
          LEFT JOIN notification_reminder_deliveries
            ON notification_reminder_deliveries.user_id = users.id
            AND notification_reminder_deliveries.competition_id = ?
            AND notification_reminder_deliveries.prediction_round = round_summaries.prediction_round
            AND notification_reminder_deliveries.reminder_hours = reminder_windows.reminder_hours
          WHERE notification_reminder_deliveries.id IS NULL
            AND competitions.notification_reminders_enabled = 1
            AND competitions.is_finished = 0 AND competitions.is_archived = 0
            AND ((reminder_windows.reminder_hours = 9 AND preferences.reminder_9h = 1)
              OR (reminder_windows.reminder_hours = 1 AND preferences.reminder_1h = 1))
            AND NOT EXISTS (
              SELECT 1
              FROM notification_reminder_deliveries processed_deliveries
              WHERE processed_deliveries.competition_id = ?
                AND processed_deliveries.user_id = users.id
                AND processed_deliveries.prediction_round = round_summaries.prediction_round
                AND processed_deliveries.reminder_hours = reminder_windows.reminder_hours
            )
            AND NOT EXISTS (
              SELECT 1
              FROM notification_reminder_attempts processed_attempts
              WHERE processed_attempts.competition_id = ?
                AND processed_attempts.user_id = users.id
                AND processed_attempts.prediction_round = round_summaries.prediction_round
                AND processed_attempts.reminder_hours = reminder_windows.reminder_hours
                AND processed_attempts.status = 'accepted'
            )
            AND NOT EXISTS (SELECT 1 FROM notification_reminder_skips skipped
              WHERE skipped.competition_id = competitions.id AND skipped.user_id = users.id
                AND skipped.subscription_id = notification_subscriptions.id
                AND skipped.prediction_round = round_summaries.prediction_round
                AND skipped.reminder_hours = reminder_windows.reminder_hours)
            AND (SELECT COUNT(*) FROM notification_reminder_attempts retries
              WHERE retries.competition_id = competitions.id AND retries.user_id = users.id
                AND retries.prediction_round = round_summaries.prediction_round
                AND retries.reminder_hours = reminder_windows.reminder_hours
                AND retries.subscription_id = notification_subscriptions.id) < 3
            AND NOT EXISTS (SELECT 1 FROM notification_reminder_attempts recent
              WHERE recent.competition_id = competitions.id AND recent.user_id = users.id
                AND recent.prediction_round = round_summaries.prediction_round
                AND recent.reminder_hours = reminder_windows.reminder_hours
                AND recent.subscription_id = notification_subscriptions.id
                AND datetime(recent.created_at) > datetime('now', '-60 seconds'))
          GROUP BY
            users.id,
            users.username,
            round_summaries.prediction_round,
            round_summaries.deadline_at,
            round_summaries.expected_count,
            reminder_windows.reminder_hours,
            competitions.slug,
            competitions.name,
            notification_subscriptions.id,
            notification_subscriptions.endpoint,
            notification_subscriptions.subscription_json,
            notification_subscriptions.user_agent, notification_subscriptions.browser_brand
          ORDER BY round_summaries.deadline_at ASC, reminder_windows.reminder_hours DESC
        `
      )
      .all(competitionId, competitionId, competitionId, competitionId, competitionId, competitionId, competitionId) as ReminderCandidateRow[];
  } finally {
    db.close();
  }
}

export function recordReminderDelivery(competitionId: number, userId: number, predictionRound: string, reminderHours: 1 | 9): void {
  const db = openDatabase();

  try {
    db.prepare(
      `
        INSERT INTO notification_reminder_deliveries (competition_id, user_id, prediction_round, reminder_hours)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(competition_id, user_id, prediction_round, reminder_hours) DO NOTHING
      `
    ).run(competitionId, userId, predictionRound, reminderHours);
  } finally {
    db.close();
  }
}

export function recordReminderAttempt(input: ReminderAttemptInput): void {
  const db = openDatabase();

  try {
    db.prepare(
      `
        INSERT INTO notification_reminder_attempts (
          user_id,
          competition_id,
          subscription_id,
          prediction_round,
          reminder_hours,
          status,
          status_code,
          error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      input.userId,
      input.competitionId,
      input.subscriptionId,
      input.predictionRound,
      input.reminderHours,
      input.status,
      input.statusCode,
      input.errorMessage
    );
  } finally {
    db.close();
  }
}

export function getNotificationPreferences(userId: number, competitionId: number): Omit<NotificationPreferencesResponse, 'browsers'> {
  const db = openDatabase();
  try {
    const row = db.prepare(`SELECT
        COALESCE(p.enabled, 0) AS enabled, COALESCE(p.reminder_9h, 0) AS reminder9h,
        COALESCE(p.reminder_1h, 0) AS reminder1h, COALESCE(p.round_opened, 0) AS roundOpened,
        (c.notification_reminders_enabled = 1 AND c.is_finished = 0 AND c.is_archived = 0) AS competitionEnabled,
        (c.is_finished = 1 OR c.is_archived = 1) AS competitionClosed,
        COALESCE(cu.is_verified, 0) AS eligible
      FROM competitions c
      LEFT JOIN competition_users cu ON cu.competition_id = c.id AND cu.user_id = ?
      LEFT JOIN competition_notification_preferences p ON p.competition_id = c.id AND p.user_id = ?
      WHERE c.id = ?`).get(userId, userId, competitionId) as Record<string, number> | undefined;
    return {
      preferences: { enabled: row?.enabled === 1, reminder9h: row?.reminder9h === 1, reminder1h: row?.reminder1h === 1, roundOpened: row?.roundOpened === 1 },
      competitionEnabled: row?.competitionEnabled === 1,
      competitionClosed: row?.competitionClosed === 1,
      eligible: row?.eligible === 1
    };
  } finally { db.close(); }
}

export function upsertNotificationPreferences(userId: number, competitionId: number, input: NotificationPreferences): void {
  const db = openDatabase();
  try {
    db.transaction(() => {
      db.prepare(`INSERT INTO competition_notification_preferences (user_id, competition_id, enabled, reminder_9h, reminder_1h, round_opened)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(competition_id, user_id) DO UPDATE SET
          enabled = excluded.enabled, reminder_9h = excluded.reminder_9h, reminder_1h = excluded.reminder_1h, round_opened = excluded.round_opened,
          updated_at = CURRENT_TIMESTAMP`).run(userId, competitionId, Number(input.enabled), Number(input.reminder9h), Number(input.reminder1h), Number(input.roundOpened ?? false));
      if (!input.reminder9h && !input.reminder1h && !input.roundOpened) {
        db.prepare('DELETE FROM competition_notification_browsers WHERE user_id = ? AND competition_id = ?').run(userId, competitionId);
      }
    }).immediate();
  } finally { db.close(); }
}

export function listCompetitionNotificationBrowsers(userId: number, competitionId: number) {
  const db = openDatabase();
  try {
    return db.prepare(`SELECT s.id, s.endpoint, s.user_agent, s.browser_brand FROM competition_notification_browsers b
      JOIN notification_subscriptions s ON s.id = b.subscription_id
      WHERE b.user_id = ? AND b.competition_id = ? AND s.is_enabled = 1
      ORDER BY b.created_at, s.id`).all(userId, competitionId) as Array<{ id: number; endpoint: string; user_agent: string | null; browser_brand: string | null }>;
  } finally { db.close(); }
}

export function removeCompetitionNotificationBrowser(userId: number, competitionId: number, subscriptionId: number): 'removed' | 'last_browser' | 'not_found' {
  const db = openDatabase();
  try {
    return db.transaction(() => {
      const browsers = db.prepare(`SELECT b.subscription_id FROM competition_notification_browsers b
        JOIN notification_subscriptions s ON s.id = b.subscription_id
        WHERE b.user_id = ? AND b.competition_id = ? AND s.is_enabled = 1`).all(userId, competitionId) as Array<{ subscription_id: number }>;
      if (!browsers.some(browser => browser.subscription_id === subscriptionId)) return 'not_found' as const;
      if (browsers.length <= 1) return 'last_browser' as const;
      db.prepare('DELETE FROM competition_notification_browsers WHERE user_id = ? AND competition_id = ? AND subscription_id = ?').run(userId, competitionId, subscriptionId);
      return 'removed' as const;
    }).immediate();
  } finally { db.close(); }
}

export function listCompetitionNotificationMembers(competitionId: number): Array<Omit<AdminNotificationMember, 'browsers'> & { browserUserAgents: Array<{userAgent: string | null; browserBrand: string | null}> }> {
  const db = openDatabase();
  try {
    const rows = db.prepare(`SELECT u.id AS userId, u.username,
        COALESCE(p.reminder_1h, 0) AS reminder1h, COALESCE(p.round_opened, 0) AS roundOpened, COALESCE(p.reminder_9h, 0) AS reminder9h
      FROM competition_users cu JOIN users u ON u.id = cu.user_id
      LEFT JOIN competition_notification_preferences p ON p.user_id = cu.user_id AND p.competition_id = cu.competition_id
      WHERE cu.competition_id = ? ORDER BY u.username COLLATE NOCASE, u.id`).all(competitionId) as Array<{
        userId: number; username: string; reminder1h: number; reminder9h: number; roundOpened: number;
      }>;
    const registrations = db.prepare(`SELECT b.user_id AS userId, s.user_agent AS userAgent, s.browser_brand AS browserBrand
      FROM competition_notification_browsers b
      JOIN notification_subscriptions s ON s.id = b.subscription_id AND s.is_enabled = 1
      JOIN competition_notification_preferences p ON p.competition_id = b.competition_id AND p.user_id = b.user_id
      WHERE b.competition_id = ? AND p.enabled = 1 AND (p.reminder_1h = 1 OR p.reminder_9h = 1 OR p.round_opened = 1)
      ORDER BY b.created_at, s.id`).all(competitionId) as Array<{userId: number; userAgent: string | null; browserBrand: string | null}>;
    const browsers = new Map<number, Array<{userAgent: string | null; browserBrand: string | null}>>();
    for (const registration of registrations) {
      const agents = browsers.get(registration.userId) ?? [];
      agents.push({userAgent: registration.userAgent, browserBrand: registration.browserBrand});
      browsers.set(registration.userId, agents);
    }
    return rows.map(row => ({ ...row, reminder1h: row.reminder1h === 1, reminder9h: row.reminder9h === 1, roundOpened: row.roundOpened === 1,
      browserUserAgents: browsers.get(row.userId) ?? [] }));
  } finally { db.close(); }
}

export function isNotificationRecipient(subscriptionId: number, userId: number): boolean {
  const db = openDatabase();
  try {
    return !!db.prepare('SELECT 1 FROM notification_subscriptions WHERE id = ? AND user_id = ? AND is_enabled = 1').get(subscriptionId, userId);
  } finally { db.close(); }
}

export function skipNotificationReminder(candidate: ReminderCandidateRow): void {
  const db = openDatabase();
  try {
    db.prepare(`INSERT OR IGNORE INTO notification_reminder_skips
      (competition_id, user_id, subscription_id, prediction_round, reminder_hours) VALUES (?, ?, ?, ?, ?)`)
      .run(candidate.competition_id, candidate.user_id, candidate.subscription_id, candidate.prediction_round, candidate.reminder_hours);
  } finally { db.close(); }
}
