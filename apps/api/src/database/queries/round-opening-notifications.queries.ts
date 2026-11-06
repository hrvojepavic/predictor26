import { AppDatabase, openDatabase } from '../index.js';
import { getPredictionRound } from '../../shared/utils/prediction-round.js';

interface ReleaseMatch {
  id: number; round_label: string; match_number: number; kickoff_at: string;
  released_for_predictions: number; is_postponed: number;
}

// Called inside the release transaction with its pre-update snapshot. A release
// and its notification recipients either commit together or neither commits.
export function queueRoundOpenings(db: AppDatabase, competitionId: number, before: ReleaseMatch[]): void {
  const alreadyOpen = new Set(before.filter(match => match.released_for_predictions === 1).map(getPredictionRound));
  const after = db.prepare('SELECT * FROM matches WHERE competition_id = ?').all(competitionId) as ReleaseMatch[];
  const rounds = new Map<string, string>();
  for (const match of after) {
    const round = getPredictionRound(match);
    if (alreadyOpen.has(round) || match.released_for_predictions !== 1 || match.is_postponed === 1) continue;
    const deadline = rounds.get(round);
    if (!deadline || Date.parse(match.kickoff_at) < Date.parse(deadline)) rounds.set(round, match.kickoff_at);
  }
  for (const [round, deadline] of rounds) {
    if (Date.parse(deadline) <= Date.now()) continue;
    const inserted = db.prepare(`INSERT OR IGNORE INTO notification_round_openings
      (competition_id, prediction_round, deadline_at) VALUES (?, ?, ?)`).run(competitionId, round, deadline);
    if (!inserted.changes) continue;
    db.prepare(`INSERT INTO notification_round_opening_attempts (opening_id, user_id, subscription_id)
      SELECT ?, p.user_id, s.id FROM competition_notification_preferences p
      JOIN competitions c ON c.id = p.competition_id
      JOIN competition_users cu ON cu.competition_id = p.competition_id AND cu.user_id = p.user_id
      JOIN competition_notification_browsers b ON b.competition_id = p.competition_id AND b.user_id = p.user_id
      JOIN notification_subscriptions s ON s.id = b.subscription_id AND s.user_id = p.user_id
      WHERE p.competition_id = ? AND p.enabled = 1 AND p.round_opened = 1 AND cu.is_verified = 1
        AND c.notification_reminders_enabled = 1 AND c.is_finished = 0 AND c.is_archived = 0 AND s.is_enabled = 1`)
      .run(inserted.lastInsertRowid, competitionId);
  }
}

export interface RoundOpeningAttempt {
  opening_id: number; user_id: number; subscription_id: number;
  competition_id: number; prediction_round: string; deadline_at: string;
  slug: string; name: string; endpoint: string; subscription_json: string;
}

export function listPendingRoundOpenings(competitionId?: number): RoundOpeningAttempt[] {
  const db = openDatabase();
  try {
    return db.prepare(`SELECT a.opening_id, a.user_id, a.subscription_id,
      o.competition_id, o.prediction_round, o.deadline_at, c.slug, c.name, s.endpoint, s.subscription_json
      FROM notification_round_opening_attempts a
      JOIN notification_round_openings o ON o.id = a.opening_id
      JOIN competitions c ON c.id = o.competition_id
      JOIN notification_subscriptions s ON s.id = a.subscription_id
      WHERE a.status = 'pending' AND (? IS NULL OR o.competition_id = ?) ORDER BY o.id, a.user_id, a.subscription_id`)
      .all(competitionId ?? null, competitionId ?? null) as RoundOpeningAttempt[];
  } finally { db.close(); }
}

export function claimRoundOpening(attempt: RoundOpeningAttempt): boolean {
  const db = openDatabase();
  try {
    return db.prepare(`UPDATE notification_round_opening_attempts SET status = 'sending', updated_at = CURRENT_TIMESTAMP
      WHERE opening_id = ? AND user_id = ? AND subscription_id = ? AND status = 'pending'`)
      .run(attempt.opening_id, attempt.user_id, attempt.subscription_id).changes === 1;
  } finally { db.close(); }
}

export function finishRoundOpening(attempt: RoundOpeningAttempt, status: 'accepted' | 'failed' | 'disabled' | 'skipped', code: number | null = null, error: string | null = null): void {
  const db = openDatabase();
  try {
    db.prepare(`UPDATE notification_round_opening_attempts SET status = ?, status_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
      WHERE opening_id = ? AND user_id = ? AND subscription_id = ?`)
      .run(status, code, error, attempt.opening_id, attempt.user_id, attempt.subscription_id);
  } finally { db.close(); }
}
