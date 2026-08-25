import { listMatches } from '../../database/queries/matches.queries.js';
import {
  listLeaderboardPredictions,
  listLeaderboardUsers
} from '../../database/queries/leaderboard.queries.js';

export function findLeaderboardMatches(competitionId: number) {
  return listMatches(competitionId).filter((match) => match.released_for_predictions === 1);
}

export function findLeaderboardPredictions(competitionId: number) {
  return listLeaderboardPredictions(competitionId);
}

export function findLeaderboardUsers(competitionId: number) {
  return listLeaderboardUsers(competitionId);
}
