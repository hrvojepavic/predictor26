import { queueRoundOpenings } from './round-opening-notifications.queries.js';
import { openDatabase } from '../index.js';
import { defaultCompetitionSlug } from '../../shared/constants/default-competition.constants.js';

export interface MatchRow {
  readonly id: number;
  readonly competition_id: number;
  readonly match_number: number;
  readonly stage: string;
  readonly group_name: string | null;
  readonly round_label: string;
  readonly kickoff_at: string;
  readonly source_time_zone: string;
  readonly home_team_name: string;
  readonly away_team_name: string;
  readonly home_team_flag: string | null;
  readonly away_team_flag: string | null;
  readonly home_team_display_name: string | null;
  readonly away_team_display_name: string | null;
  readonly home_mapped_team_name: string | null;
  readonly away_mapped_team_name: string | null;
  readonly home_mapped_team_flag: string | null;
  readonly away_mapped_team_flag: string | null;
  readonly venue: string;
  readonly city: string;
  readonly home_win_odds: number | null;
  readonly draw_odds: number | null;
  readonly away_win_odds: number | null;
  readonly odds_synced_at: string | null;
  readonly released_for_predictions: 0 | 1;
  readonly is_postponed: 0 | 1;
  readonly final_home_score: number | null;
  readonly final_away_score: number | null;
}

export interface MatchImportInput {
  readonly matchNumber: number;
  readonly stage: string;
  readonly groupName: string | null;
  readonly roundLabel: string;
  readonly kickoffAt: string;
  readonly sourceTimeZone: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly homeTeamFlag: string | null;
  readonly awayTeamFlag: string | null;
  readonly venue: string;
  readonly city: string;
}

export interface TeamImportInput {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly groupName?: string | null;
}

export interface PredictionRow {
  readonly match_id: number;
  readonly home_score: number;
  readonly away_score: number;
  readonly odds_outcome: PredictionOddsOutcome | null;
  readonly odds_value: number | null;
  readonly odds_synced_at: string | null;
}

export type PredictionOddsOutcome = '1' | 'X' | '2';

export interface MatchOddsInput {
  readonly matchId: number;
  readonly homeWinOdds: number;
  readonly drawOdds: number;
  readonly awayWinOdds: number;
}

export interface ManualMatchInput {
  readonly matchNumber: number;
  readonly roundLabel: string;
  readonly kickoffAt: string;
  readonly sourceTimeZone: string;
  readonly homeTeamName: string;
  readonly homeTeamFlag: string | null;
  readonly awayTeamName: string;
  readonly awayTeamFlag: string | null;
  readonly venue: string;
  readonly city: string;
  readonly homeWinOdds: number;
  readonly drawOdds: number;
  readonly awayWinOdds: number;
}

export type MatchSide = 'home' | 'away';

export function listMatches(competitionId?: number): MatchRow[] {
  const db = openDatabase();

  try {
    const resolvedCompetitionId = competitionId ?? getDefaultCompetitionId(db);

    return db
      .prepare(
        `
          SELECT
            id,
            competition_id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.home_team_name))
            ) AS home_team_display_name,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.away_team_name))
            ) AS away_team_display_name,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE competition_id = ?
          ORDER BY kickoff_at ASC, match_number ASC
        `
      )
      .all(resolvedCompetitionId) as MatchRow[];
  } finally {
    db.close();
  }
}

export function listDistinctMatchTeamNames(): string[] {
  const db = openDatabase();

  try {
    const rows = db
      .prepare(
        `
          SELECT team_name
          FROM (
            SELECT home_team_name AS team_name FROM matches
            UNION
            SELECT away_team_name AS team_name FROM matches
          )
          WHERE team_name IS NOT NULL
            AND team_name != ''
          ORDER BY team_name COLLATE NOCASE ASC
        `
      )
      .all() as Array<{ team_name: string }>;

    return rows.map((row) => row.team_name);
  } finally {
    db.close();
  }
}

export interface GroupTeamRow {
  readonly group_name: string;
  readonly team_name: string;
  readonly team_flag: string | null;
}

export function listGroupTeams(): GroupTeamRow[] {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT group_name, team_name, team_flag
          FROM (
            SELECT group_name, home_team_name AS team_name, home_team_flag AS team_flag
            FROM matches
            WHERE group_name IS NOT NULL
            UNION
            SELECT group_name, away_team_name AS team_name, away_team_flag AS team_flag
            FROM matches
            WHERE group_name IS NOT NULL
          )
          WHERE team_name IS NOT NULL
            AND team_name != ''
          ORDER BY group_name ASC, team_name COLLATE NOCASE ASC
        `
      )
      .all() as GroupTeamRow[];
  } finally {
    db.close();
  }
}

export function listMatchesWithPredictions(userId: number, competitionId: number): Array<MatchRow & PredictionRowNullable> {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT
            matches.id,
            matches.competition_id,
            matches.match_number,
            matches.stage,
            matches.group_name,
            matches.round_label,
            matches.kickoff_at,
            matches.source_time_zone,
            matches.home_team_name,
            matches.away_team_name,
            matches.home_team_flag,
            matches.away_team_flag,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.home_team_name))
            ) AS home_team_display_name,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.away_team_name))
            ) AS away_team_display_name,
            matches.home_mapped_team_name,
            matches.away_mapped_team_name,
            matches.home_mapped_team_flag,
            matches.away_mapped_team_flag,
            matches.venue,
            matches.city,
            matches.home_win_odds,
            matches.draw_odds,
            matches.away_win_odds,
            matches.odds_synced_at,
            matches.released_for_predictions,
            matches.is_postponed,
            matches.final_home_score,
            matches.final_away_score,
            predictions.home_score AS prediction_home_score,
            predictions.away_score AS prediction_away_score,
            predictions.odds_outcome AS prediction_odds_outcome,
            predictions.odds_value AS prediction_odds_value,
            predictions.odds_synced_at AS prediction_odds_synced_at
          FROM matches
          LEFT JOIN predictions
            ON predictions.match_id = matches.id
            AND predictions.user_id = ?
          WHERE matches.competition_id = ?
            AND matches.released_for_predictions = 1
          ORDER BY matches.kickoff_at ASC, matches.match_number ASC
        `
      )
      .all(userId, competitionId) as Array<MatchRow & PredictionRowNullable>;
  } finally {
    db.close();
  }
}

export function listPredictedMatchesWithPredictions(userId: number, competitionId: number): Array<MatchRow & PredictionRowNullable> {
  const db = openDatabase();

  try {
    return db
      .prepare(
        `
          SELECT
            matches.id,
            matches.competition_id,
            matches.match_number,
            matches.stage,
            matches.group_name,
            matches.round_label,
            matches.kickoff_at,
            matches.source_time_zone,
            matches.home_team_name,
            matches.away_team_name,
            matches.home_team_flag,
            matches.away_team_flag,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.home_team_name))
            ) AS home_team_display_name,
            (
              SELECT NULLIF(competition_teams.display_name, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.away_team_name))
            ) AS away_team_display_name,
            matches.home_mapped_team_name,
            matches.away_mapped_team_name,
            matches.home_mapped_team_flag,
            matches.away_mapped_team_flag,
            matches.venue,
            matches.city,
            matches.home_win_odds,
            matches.draw_odds,
            matches.away_win_odds,
            matches.odds_synced_at,
            matches.released_for_predictions,
            matches.is_postponed,
            matches.final_home_score,
            matches.final_away_score,
            predictions.home_score AS prediction_home_score,
            predictions.away_score AS prediction_away_score,
            predictions.odds_outcome AS prediction_odds_outcome,
            predictions.odds_value AS prediction_odds_value,
            predictions.odds_synced_at AS prediction_odds_synced_at
          FROM matches
          INNER JOIN predictions
            ON predictions.match_id = matches.id
            AND predictions.user_id = ?
          WHERE matches.competition_id = ?
            AND matches.released_for_predictions = 1
          ORDER BY matches.kickoff_at ASC, matches.match_number ASC
        `
      )
      .all(userId, competitionId) as Array<MatchRow & PredictionRowNullable>;
  } finally {
    db.close();
  }
}

export function upsertImportedMatches(matches: readonly MatchImportInput[], competitionId?: number): number {
  const db = openDatabase();

  try {
    const resolvedCompetitionId = competitionId ?? getDefaultCompetitionId(db);
    const teamLogoByName = new Map(
      (
        db
          .prepare('SELECT normalized_name, logo_url FROM competition_teams WHERE competition_id = ? AND logo_url != ?')
          .all(resolvedCompetitionId, '') as Array<{ normalized_name: string; logo_url: string }>
      ).map((team) => [team.normalized_name, team.logo_url])
    );
    const upsert = db.prepare(
      `
        INSERT INTO matches (
          match_number,
          competition_id,
          stage,
          group_name,
          round_label,
          kickoff_at,
          source_time_zone,
          home_team_name,
          away_team_name,
          home_team_flag,
          away_team_flag,
          venue,
          city,
          released_for_predictions
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(competition_id, match_number) DO UPDATE SET
          stage = excluded.stage,
          group_name = excluded.group_name,
          round_label = excluded.round_label,
          kickoff_at = excluded.kickoff_at,
          source_time_zone = excluded.source_time_zone,
          home_team_name = excluded.home_team_name,
          away_team_name = excluded.away_team_name,
          home_team_flag = excluded.home_team_flag,
          away_team_flag = excluded.away_team_flag,
          venue = excluded.venue,
          city = excluded.city,
          imported_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      `
    );

    const transaction = db.transaction((items: readonly MatchImportInput[]) => {
      for (const match of items) {
        upsert.run(
          match.matchNumber,
          resolvedCompetitionId,
          match.stage,
          match.groupName,
          match.roundLabel,
          match.kickoffAt,
          match.sourceTimeZone,
          match.homeTeamName,
          match.awayTeamName,
          match.homeTeamFlag ?? teamLogoByName.get(normalizeTeamName(match.homeTeamName)) ?? null,
          match.awayTeamFlag ?? teamLogoByName.get(normalizeTeamName(match.awayTeamName)) ?? null,
          match.venue,
          match.city
        );
      }
    });

    transaction(matches);

    return matches.length;
  } finally {
    db.close();
  }
}

export function upsertCompetitionTeams(competitionId: number, teams: readonly TeamImportInput[]): void {
  const db = openDatabase();

  try {
    const statement = db.prepare(
      `
        INSERT INTO competition_teams (competition_id, normalized_name, name, display_name, logo_url, group_name)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(competition_id, normalized_name) DO UPDATE SET
          name = excluded.name,
          logo_url = CASE
            WHEN competition_teams.logo_url = '' THEN excluded.logo_url
            ELSE competition_teams.logo_url
          END,
          group_name = COALESCE(competition_teams.group_name, excluded.group_name),
          updated_at = CURRENT_TIMESTAMP
      `
    );
    const transaction = db.transaction((items: readonly TeamImportInput[]) => {
      for (const team of items) {
        const normalizedName = normalizeTeamName(team.name);

        if (!normalizedName) {
          continue;
        }

        statement.run(competitionId, normalizedName, team.name, team.name, team.logoUrl ?? '', team.groupName ?? null);
      }
    });

    transaction(teams);
  } finally {
    db.close();
  }
}

export function insertManualMatch(competitionId: number, input: ManualMatchInput): MatchRow | undefined {
  const db = openDatabase();

  try {
    const transaction = db.transaction(() => {
      const teamLogoByName = new Map(
        (
          db
            .prepare('SELECT normalized_name, logo_url FROM competition_teams WHERE competition_id = ? AND logo_url != ?')
            .all(competitionId, '') as Array<{ normalized_name: string; logo_url: string }>
        ).map((team) => [team.normalized_name, team.logo_url])
      );

      const upsertTeam = db.prepare(
        `
          INSERT INTO competition_teams (competition_id, normalized_name, name, display_name, logo_url, group_name)
          VALUES (?, ?, ?, ?, ?, NULL)
          ON CONFLICT(competition_id, normalized_name) DO UPDATE SET
            name = excluded.name,
            logo_url = CASE
              WHEN competition_teams.logo_url = '' THEN excluded.logo_url
              ELSE competition_teams.logo_url
            END,
            updated_at = CURRENT_TIMESTAMP
        `
      );

      upsertTeam.run(competitionId, normalizeTeamName(input.homeTeamName), input.homeTeamName, input.homeTeamName, input.homeTeamFlag ?? '');
      upsertTeam.run(competitionId, normalizeTeamName(input.awayTeamName), input.awayTeamName, input.awayTeamName, input.awayTeamFlag ?? '');

      const result = db
        .prepare(
          `
            INSERT INTO matches (
              match_number,
              competition_id,
              stage,
              group_name,
              round_label,
              kickoff_at,
              source_time_zone,
              home_team_name,
              away_team_name,
              home_team_flag,
              away_team_flag,
              venue,
              city,
              home_win_odds,
              draw_odds,
              away_win_odds,
              odds_synced_at,
              released_for_predictions
            )
            VALUES (
              ?, ?, 'League', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM matches
                  WHERE competition_id = ?
                    AND round_label = ?
                    AND released_for_predictions = 0
                ) THEN 0
                ELSE 1
              END
            )
          `
        )
        .run(
          input.matchNumber,
          competitionId,
          input.roundLabel,
          input.kickoffAt,
          input.sourceTimeZone,
          input.homeTeamName,
          input.awayTeamName,
          input.homeTeamFlag ?? teamLogoByName.get(normalizeTeamName(input.homeTeamName)) ?? null,
          input.awayTeamFlag ?? teamLogoByName.get(normalizeTeamName(input.awayTeamName)) ?? null,
          input.venue,
          input.city,
          input.homeWinOdds,
          input.drawOdds,
          input.awayWinOdds,
          competitionId,
          input.roundLabel
        );

      return Number(result.lastInsertRowid);
    });

    const matchId = transaction();

    return db
      .prepare(
        `
          SELECT
            id,
            competition_id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE id = ?
            AND competition_id = ?
        `
      )
      .get(matchId, competitionId) as MatchRow | undefined;
  } finally {
    db.close();
  }
}

export function applyCompetitionTeamLogosToMatches(competitionId: number): void {
  const db = openDatabase();

  try {
    db.prepare(
      `
        UPDATE matches
        SET
          home_team_flag = COALESCE(
            NULLIF(home_team_flag, ''),
            (
              SELECT NULLIF(competition_teams.logo_url, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.home_team_name))
            )
          ),
          away_team_flag = COALESCE(
            NULLIF(away_team_flag, ''),
            (
              SELECT NULLIF(competition_teams.logo_url, '')
              FROM competition_teams
              WHERE competition_teams.competition_id = matches.competition_id
                AND competition_teams.normalized_name = lower(trim(matches.away_team_name))
            )
          ),
          updated_at = CURRENT_TIMESTAMP
        WHERE competition_id = ?
          AND (
            home_team_flag IS NULL
            OR home_team_flag = ''
            OR away_team_flag IS NULL
            OR away_team_flag = ''
          )
      `
    ).run(competitionId);
  } finally {
    db.close();
  }
}

export function deleteMatchesAfterMatchNumber(matchNumber: number, competitionId?: number): number {
  const db = openDatabase();

  try {
    const resolvedCompetitionId = competitionId ?? getDefaultCompetitionId(db);
    const result = db
      .prepare(
        `
          DELETE FROM matches
          WHERE competition_id = ?
            AND match_number > ?
        `
      )
      .run(resolvedCompetitionId, matchNumber);

    return result.changes;
  } finally {
    db.close();
  }
}

export function releaseMatchesForRound(competitionId: number, roundLabel: string): number {
  const db = openDatabase();
  try {
    return db.transaction(() => {
      const before = db.prepare('SELECT * FROM matches WHERE competition_id = ?').all(competitionId) as MatchRow[];
      const result = db.prepare(`UPDATE matches SET released_for_predictions = 1, updated_at = CURRENT_TIMESTAMP
        WHERE competition_id = ? AND round_label = ? AND released_for_predictions = 0`).run(competitionId, roundLabel);
      if (result.changes) queueRoundOpenings(db, competitionId, before);
      return result.changes;
    }).immediate();
  } finally { db.close(); }
}

export function releaseMatchesByIds(competitionId: number, matchIds: readonly number[]): number {
  if (!matchIds.length) return 0;
  const db = openDatabase();
  try {
    return db.transaction(() => {
      const before = db.prepare('SELECT * FROM matches WHERE competition_id = ?').all(competitionId) as MatchRow[];
      const update = db.prepare(`UPDATE matches SET released_for_predictions = 1, updated_at = CURRENT_TIMESTAMP
        WHERE competition_id = ? AND id = ? AND released_for_predictions = 0`);
      let changes = 0;
      for (const id of matchIds) changes += update.run(competitionId, id).changes;
      if (changes) queueRoundOpenings(db, competitionId, before);
      return changes;
    }).immediate();
  } finally { db.close(); }
}

export function updateFinalScore(
  competitionId: number,
  matchId: number,
  finalHomeScore: number | null,
  finalAwayScore: number | null
): MatchRow | undefined {
  const db = openDatabase();

  try {
    db.prepare(
      `
        UPDATE matches
        SET
          final_home_score = ?,
          final_away_score = ?,
          is_postponed = CASE WHEN ? IS NULL OR ? IS NULL THEN is_postponed ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND competition_id = ?
      `
    ).run(finalHomeScore, finalAwayScore, finalHomeScore, finalAwayScore, matchId, competitionId);

    return db
      .prepare(
        `
          SELECT
            id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE id = ? AND competition_id = ?
        `
      )
      .get(matchId, competitionId) as MatchRow | undefined;
  } finally {
    db.close();
  }
}

export function updateFinalScoreIfChanged(
  competitionId: number,
  matchId: number,
  finalHomeScore: number,
  finalAwayScore: number
): boolean {
  const db = openDatabase();

  try {
    const result = db
      .prepare(
        `
          UPDATE matches
          SET
            final_home_score = ?,
            final_away_score = ?,
            is_postponed = 0,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND competition_id = ?
            AND is_postponed = 0
            AND (
              final_home_score IS NULL
              OR final_away_score IS NULL
              OR final_home_score != ?
              OR final_away_score != ?
            )
        `
      )
      .run(finalHomeScore, finalAwayScore, matchId, competitionId, finalHomeScore, finalAwayScore);

    return result.changes > 0;
  } finally {
    db.close();
  }
}

export function updateMatchPostponed(competitionId: number, matchId: number, isPostponed: boolean): MatchRow | undefined {
  const db = openDatabase();

  try {
    db.prepare(
      `
        UPDATE matches
        SET
          is_postponed = ?,
          final_home_score = CASE WHEN ? = 1 THEN NULL ELSE final_home_score END,
          final_away_score = CASE WHEN ? = 1 THEN NULL ELSE final_away_score END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND competition_id = ?
      `
    ).run(isPostponed ? 1 : 0, isPostponed ? 1 : 0, isPostponed ? 1 : 0, matchId, competitionId);

    return db
      .prepare(
        `
          SELECT
            id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE id = ? AND competition_id = ?
        `
      )
      .get(matchId, competitionId) as MatchRow | undefined;
  } finally {
    db.close();
  }
}

export function updateMatchKickoff(
  competitionId: number,
  matchId: number,
  kickoffAt: string,
  city: string,
  venue: string
): MatchRow | undefined {
  const db = openDatabase();

  try {
    db.prepare(
      `
        UPDATE matches
        SET kickoff_at = ?, city = ?, venue = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND competition_id = ?
      `
    ).run(kickoffAt, city, venue, matchId, competitionId);

    return db
      .prepare(
        `
          SELECT
            id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE id = ? AND competition_id = ?
        `
      )
      .get(matchId, competitionId) as MatchRow | undefined;
  } finally {
    db.close();
  }
}

export function updatePlayoffTeamMapping(
  competitionId: number,
  matchId: number,
  side: MatchSide,
  teamName: string | null,
  teamFlag: string | null
): MatchRow | undefined {
  const db = openDatabase();
  const nameColumn = side === 'home' ? 'home_mapped_team_name' : 'away_mapped_team_name';
  const flagColumn = side === 'home' ? 'home_mapped_team_flag' : 'away_mapped_team_flag';

  try {
    db.prepare(
      `
        UPDATE matches
        SET ${nameColumn} = ?, ${flagColumn} = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND competition_id = ?
      `
    ).run(teamName, teamFlag, matchId, competitionId);

    return db
      .prepare(
        `
          SELECT
            id,
            match_number,
            stage,
            group_name,
            round_label,
            kickoff_at,
            source_time_zone,
            home_team_name,
            away_team_name,
            home_team_flag,
            away_team_flag,
            home_mapped_team_name,
            away_mapped_team_name,
            home_mapped_team_flag,
            away_mapped_team_flag,
            venue,
            city,
            home_win_odds,
            draw_odds,
            away_win_odds,
            odds_synced_at,
            released_for_predictions,
            is_postponed,
            final_home_score,
            final_away_score
          FROM matches
          WHERE id = ? AND competition_id = ?
        `
      )
      .get(matchId, competitionId) as MatchRow | undefined;
  } finally {
    db.close();
  }
}

export function updateMatchOdds(odds: readonly MatchOddsInput[]): number {
  const db = openDatabase();

  try {
    const updateOdds = db.prepare(
      `
        UPDATE matches
        SET
          home_win_odds = ?,
          draw_odds = ?,
          away_win_odds = ?,
          odds_synced_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND home_win_odds IS NULL
          AND draw_odds IS NULL
          AND away_win_odds IS NULL
          AND final_home_score IS NULL
          AND final_away_score IS NULL
      `
    );

    const transaction = db.transaction((items: readonly MatchOddsInput[]) => {
      let changes = 0;

      for (const item of items) {
        changes += updateOdds.run(item.homeWinOdds, item.drawOdds, item.awayWinOdds, item.matchId).changes;
      }

      return changes;
    });

    return transaction(odds) as number;
  } finally {
    db.close();
  }
}

export function backfillMissingPredictionOdds(competitionId: number): number {
  const db = openDatabase();

  try {
    const result = db
      .prepare(
        `
          UPDATE predictions
          SET
            odds_outcome =
              CASE
                WHEN home_score > away_score THEN '1'
                WHEN home_score = away_score THEN 'X'
                ELSE '2'
              END,
            odds_value =
              CASE
                WHEN home_score > away_score THEN (
                  SELECT matches.home_win_odds
                  FROM matches
                  WHERE matches.id = predictions.match_id
                )
                WHEN home_score = away_score THEN (
                  SELECT matches.draw_odds
                  FROM matches
                  WHERE matches.id = predictions.match_id
                )
                ELSE (
                  SELECT matches.away_win_odds
                  FROM matches
                  WHERE matches.id = predictions.match_id
                )
              END,
            odds_synced_at = (
              SELECT matches.odds_synced_at
              FROM matches
              WHERE matches.id = predictions.match_id
            ),
            updated_at = CURRENT_TIMESTAMP
          WHERE odds_value IS NULL
            AND EXISTS (
              SELECT 1
              FROM matches
              WHERE matches.id = predictions.match_id
                AND matches.competition_id = ?
                AND matches.home_win_odds IS NOT NULL
                AND matches.draw_odds IS NOT NULL
                AND matches.away_win_odds IS NOT NULL
            )
        `
      )
      .run(competitionId);

    return result.changes;
  } finally {
    db.close();
  }
}

export function upsertPrediction(
  userId: number,
  matchId: number,
  homeScore: number,
  awayScore: number,
  oddsOutcome: PredictionOddsOutcome | null,
  oddsValue: number | null,
  oddsSyncedAt: string | null
): PredictionRow | undefined {
  const db = openDatabase();

  try {
    db.prepare(
      `
        INSERT INTO predictions (user_id, match_id, home_score, away_score, odds_outcome, odds_value, odds_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, match_id) DO UPDATE SET
          home_score = excluded.home_score,
          away_score = excluded.away_score,
          odds_outcome = excluded.odds_outcome,
          odds_value = excluded.odds_value,
          odds_synced_at = excluded.odds_synced_at,
          updated_at = CURRENT_TIMESTAMP
      `
    ).run(userId, matchId, homeScore, awayScore, oddsOutcome, oddsValue, oddsSyncedAt);

    return db
      .prepare(
        `
          SELECT match_id, home_score, away_score, odds_outcome, odds_value, odds_synced_at
          FROM predictions
          WHERE user_id = ? AND match_id = ?
        `
      )
      .get(userId, matchId) as PredictionRow | undefined;
  } finally {
    db.close();
  }
}

interface PredictionRowNullable {
  readonly prediction_home_score: number | null;
  readonly prediction_away_score: number | null;
  readonly prediction_odds_outcome: PredictionOddsOutcome | null;
  readonly prediction_odds_value: number | null;
  readonly prediction_odds_synced_at: string | null;
}

function getDefaultCompetitionId(db: ReturnType<typeof openDatabase>): number {
  const competition = db
    .prepare('SELECT id FROM competitions WHERE slug = ?')
    .get(defaultCompetitionSlug) as { id: number } | undefined;

  if (!competition) {
    throw new Error('Default competition could not be loaded.');
  }

  return competition.id;
}

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
