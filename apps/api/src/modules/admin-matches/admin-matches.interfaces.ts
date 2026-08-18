import { MatchResponse, ScoreResponse } from '../matches/matches.interfaces.js';

export interface AdminMatchesResponse {
  readonly matches: MatchResponse[];
  readonly importMatchesWithOddsEnabled: boolean;
}

export interface AdminActionSecretRequest {
  readonly secretCode: string;
}

export interface CreateManualMatchRequest extends AdminActionSecretRequest {
  readonly kickoffAt: string;
  readonly city: string;
  readonly venue: string;
  readonly homeTeamName: string;
  readonly homeTeamLogoDataUrl?: string | null;
  readonly awayTeamName: string;
  readonly awayTeamLogoDataUrl?: string | null;
  readonly homeWinOdds: number;
  readonly drawOdds: number;
  readonly awayWinOdds: number;
}

export interface CreateManualMatchResponse {
  readonly match: MatchResponse;
  readonly matches: MatchResponse[];
}

export interface ImportMatchesResponse {
  readonly imported: number;
  readonly validation: MatchImportValidationResponse | null;
  readonly matches: MatchResponse[];
}

export interface SyncMatchOddsResponse {
  readonly synced: number;
  readonly matched: number;
  readonly skippedExisting: number;
  readonly skippedFinished: number;
  readonly skippedUnresolved: number;
  readonly unmatched: number;
  readonly backfilled: number;
  readonly matches: MatchResponse[];
}

export interface ImportMatchesWithOddsResponse {
  readonly imported: number;
  readonly odds: Omit<SyncMatchOddsResponse, 'matches'>;
  readonly validation: MatchImportValidationResponse;
  readonly matches: MatchResponse[];
}

export interface MatchImportValidationResponse {
  readonly roundLabel: string;
  readonly complete: boolean;
  readonly released: boolean;
  readonly matchCount: number;
  readonly missingOddsMatchNumbers: number[];
  readonly incompleteMatchNumbers: number[];
  readonly missingTeamNames: string[];
}

export interface ReleaseMatchRoundRequest extends AdminActionSecretRequest {
  readonly roundLabel: string;
}

export interface ReleaseMatchRoundResponse {
  readonly validation: MatchImportValidationResponse;
  readonly released: number;
  readonly matches: MatchResponse[];
}

export interface UpdateFinalScoreRequest {
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}

export interface UpdateFinalScoreResponse {
  readonly match: MatchResponse;
  readonly finalScore: ScoreResponse | null;
}

export interface UpdateKickoffRequest {
  readonly kickoffAt: string;
  readonly city: string;
  readonly venue: string;
  readonly homeWinOdds?: number;
  readonly drawOdds?: number;
  readonly awayWinOdds?: number;
  readonly secretCode: string;
}

export interface UpdateKickoffResponse {
  readonly match: MatchResponse;
}

export interface UpdatePostponedRequest extends AdminActionSecretRequest {
  readonly isPostponed: boolean;
}

export interface UpdatePostponedResponse {
  readonly match: MatchResponse;
}

export type PlayoffMappingSide = 'home' | 'away';

export interface UpdatePlayoffMappingRequest {
  readonly side: PlayoffMappingSide;
  readonly teamName: string | null;
  readonly teamFlag: string | null;
}

export interface UpdatePlayoffMappingResponse {
  readonly match: MatchResponse;
}
