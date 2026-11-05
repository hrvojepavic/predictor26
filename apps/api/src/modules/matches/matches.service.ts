import { getPredictionRound } from '../../shared/utils/prediction-round.js';
import { listMatches, MatchRow, PredictionOddsOutcome, PredictionRow } from '../../database/queries/matches.queries.js';
import { LatestLiveScoreSnapshotRow } from '../../database/queries/live-scores.queries.js';
import {
  MatchesResponse,
  MatchWithPredictionResponse,
  SavePredictionRequest,
  SavePredictionResponse,
  ScoreResponse
} from './matches.interfaces.js';
import { findMatchesForUser, findPredictedMatchesForUser, savePrediction } from './matches.repository.js';
import { findLatestLiveScoreSnapshotsForCompetition } from '../live-scores/live-scores.repository.js';

export type SavePredictionResult =
  | {
      readonly status: 'saved';
      readonly prediction: SavePredictionResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'not_found';
    }
  | {
      readonly status: 'locked';
    };

export async function getMatchesForUser(userId: number, competitionId: number): Promise<MatchesResponse> {
  return toMatchesResponse(findMatchesForUser(userId, competitionId), getLatestSnapshotsByMatchId(competitionId));
}

export async function getPredictedMatchesForUser(userId: number, competitionId: number): Promise<MatchesResponse> {
  return toMatchesResponse(findPredictedMatchesForUser(userId, competitionId), getLatestSnapshotsByMatchId(competitionId));
}

function toMatchesResponse(
  matches: ReturnType<typeof findMatchesForUser>,
  latestSnapshotsByMatchId: ReadonlyMap<number, LatestLiveScoreSnapshotRow>
): MatchesResponse {
  return {
    matches: withPredictionLockData(matches).map((match) => ({
      ...toMatchResponse(match, latestSnapshotsByMatchId.get(match.id)),
      prediction:
        match.prediction_home_score === null || match.prediction_away_score === null
          ? null
          : toPredictionResponse({
              match_id: match.id,
              home_score: match.prediction_home_score,
              away_score: match.prediction_away_score,
              odds_outcome: match.prediction_odds_outcome,
              odds_value: match.prediction_odds_value,
              odds_synced_at: match.prediction_odds_synced_at
            })
    }))
  };
}

function getLatestSnapshotsByMatchId(competitionId: number): Map<number, LatestLiveScoreSnapshotRow> {
  return new Map(findLatestLiveScoreSnapshotsForCompetition(competitionId).map((snapshot) => [snapshot.match_id, snapshot]));
}

export async function submitPrediction(
  userId: number,
  competitionId: number,
  matchId: number,
  input: Partial<SavePredictionRequest> | undefined
): Promise<SavePredictionResult> {
  if (!Number.isInteger(matchId) || matchId < 1 || !isValidScore(input?.homeScore) || !isValidScore(input?.awayScore)) {
    return { status: 'invalid' };
  }

  const match = withPredictionLockData(listMatches(competitionId)).find((currentMatch) => currentMatch.id === matchId);

  if (!match) {
    return { status: 'not_found' };
  }

  if (match.released_for_predictions !== 1) {
    return { status: 'not_found' };
  }

  if (match.is_postponed === 1 || match.predictionLocked) {
    return { status: 'locked' };
  }

  const oddsSnapshot = getPredictionOddsSnapshot(match, input.homeScore, input.awayScore);
  const prediction = savePrediction(
    userId,
    matchId,
    input.homeScore,
    input.awayScore,
    oddsSnapshot.outcome,
    oddsSnapshot.value,
    oddsSnapshot.syncedAt
  );

  if (!prediction) {
    return { status: 'not_found' };
  }

  return {
    status: 'saved',
    prediction: {
      prediction: toPredictionResponse(prediction)
    }
  };
}

function toPredictionResponse(prediction: PredictionRow): SavePredictionResponse['prediction'] {
  return {
    home: prediction.home_score,
    away: prediction.away_score,
    odds:
      prediction.odds_outcome === null || prediction.odds_value === null
        ? null
        : {
            outcome: prediction.odds_outcome,
            value: prediction.odds_value,
            syncedAt: prediction.odds_synced_at
          }
  };
}

function toMatchResponse(
  match: MatchRowWithLockData,
  snapshot: LatestLiveScoreSnapshotRow | undefined
): Omit<MatchWithPredictionResponse, 'prediction'> {
  const score = getLiveScore(match, snapshot);

  return {
    id: match.id,
    matchNumber: match.match_number,
    stage: match.stage,
    groupName: match.group_name,
    roundLabel: match.round_label,
    predictionRound: match.predictionRound,
    predictionDeadlineAt: match.predictionDeadlineAt,
    predictionLocked: match.predictionLocked,
    kickoffAt: match.kickoff_at,
    sourceTimeZone: match.source_time_zone,
    homeTeam: {
      name: match.home_mapped_team_name ?? match.home_team_name,
      displayName: match.home_team_display_name ?? match.home_mapped_team_name ?? match.home_team_name,
      flag: match.home_mapped_team_flag ?? match.home_team_flag,
      placeholderName: match.home_mapped_team_name ? match.home_team_name : null
    },
    awayTeam: {
      name: match.away_mapped_team_name ?? match.away_team_name,
      displayName: match.away_team_display_name ?? match.away_mapped_team_name ?? match.away_team_name,
      flag: match.away_mapped_team_flag ?? match.away_team_flag,
      placeholderName: match.away_mapped_team_name ? match.away_team_name : null
    },
    venue: match.venue,
    city: match.city,
    odds:
      match.home_win_odds === null || match.draw_odds === null || match.away_win_odds === null
        ? null
        : {
            homeWin: match.home_win_odds,
            draw: match.draw_odds,
            awayWin: match.away_win_odds,
            syncedAt: match.odds_synced_at
    },
    releasedForPredictions: match.released_for_predictions === 1,
    isPostponed: match.is_postponed === 1,
    finalScore: score
  };
}

function getLiveScore(match: MatchRow, snapshot: LatestLiveScoreSnapshotRow | undefined): ScoreResponse | null {
  if (match.is_postponed === 1) {
    return null;
  }

  if (snapshot?.home_score !== null && snapshot?.away_score !== null && snapshot) {
    return {
      home: snapshot.home_score,
      away: snapshot.away_score
    };
  }

  if (match.final_home_score !== null && match.final_away_score !== null) {
    return {
      home: match.final_home_score,
      away: match.final_away_score
    };
  }

  return null;
}

function isValidScore(score: unknown): score is number {
  return typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 99;
}

function getPredictionOddsSnapshot(
  match: MatchRow,
  homeScore: number,
  awayScore: number
): { readonly outcome: PredictionOddsOutcome; readonly value: number | null; readonly syncedAt: string | null } {
  if (homeScore > awayScore) {
    return {
      outcome: '1',
      value: match.home_win_odds,
      syncedAt: match.odds_synced_at
    };
  }

  if (homeScore === awayScore) {
    return {
      outcome: 'X',
      value: match.draw_odds,
      syncedAt: match.odds_synced_at
    };
  }

  return {
    outcome: '2',
    value: match.away_win_odds,
    syncedAt: match.odds_synced_at
  };
}

function withPredictionLockData<T extends MatchRow>(matches: readonly T[]): Array<T & PredictionLockData> {
  const deadlines = new Map<string, string>();

  for (const match of matches) {
    if (match.is_postponed === 1) {
      continue;
    }

    const predictionRound = getPredictionRound(match);
    const currentDeadline = deadlines.get(predictionRound);

    if (!currentDeadline || Date.parse(match.kickoff_at) < Date.parse(currentDeadline)) {
      deadlines.set(predictionRound, match.kickoff_at);
    }
  }

  return matches.map((match) => {
    const predictionRound = getPredictionRound(match);
    const predictionDeadlineAt = deadlines.get(predictionRound) ?? match.kickoff_at;

    return {
      ...match,
      predictionRound,
      predictionDeadlineAt,
      predictionLocked: match.is_postponed === 1 || Date.now() >= Date.parse(predictionDeadlineAt)
    };
  });
}

interface PredictionLockData {
  readonly predictionRound: string;
  readonly predictionDeadlineAt: string;
  readonly predictionLocked: boolean;
}

type MatchRowWithLockData = MatchRow & PredictionLockData;
