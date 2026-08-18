export interface MatchTeam {
  readonly name: string;
  readonly displayName?: string;
  readonly flag: string | null;
  readonly placeholderName: string | null;
}

export interface MatchScore {
  readonly home: number;
  readonly away: number;
}

export interface MatchOdds {
  readonly homeWin: number;
  readonly draw: number;
  readonly awayWin: number;
  readonly syncedAt: string | null;
}

export interface PredictionOdds {
  readonly outcome: '1' | 'X' | '2';
  readonly value: number;
  readonly syncedAt: string | null;
}

export interface MatchPrediction extends MatchScore {
  readonly odds: PredictionOdds | null;
}

export interface Match {
  readonly id: number;
  readonly matchNumber: number;
  readonly stage: string;
  readonly groupName: string | null;
  readonly roundLabel: string;
  readonly predictionRound: string;
  readonly predictionDeadlineAt: string;
  readonly predictionLocked: boolean;
  readonly kickoffAt: string;
  readonly sourceTimeZone: string;
  readonly homeTeam: MatchTeam;
  readonly awayTeam: MatchTeam;
  readonly venue: string;
  readonly city: string;
  readonly odds: MatchOdds | null;
  readonly releasedForPredictions: boolean;
  readonly isPostponed: boolean;
  readonly finalScore: MatchScore | null;
}

export interface MatchWithPrediction extends Match {
  readonly prediction: MatchPrediction | null;
}

export interface MatchesResponse {
  readonly matches: MatchWithPrediction[];
}

export interface AdminMatchesResponse {
  readonly matches: Match[];
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
  readonly match: Match;
  readonly matches: Match[];
}

export interface ImportMatchesResponse {
  readonly imported: number;
  readonly validation: MatchImportValidation | null;
  readonly matches: Match[];
}

export interface SyncMatchOddsResponse {
  readonly synced: number;
  readonly matched: number;
  readonly skippedExisting: number;
  readonly skippedFinished: number;
  readonly skippedUnresolved: number;
  readonly unmatched: number;
  readonly backfilled: number;
  readonly matches: Match[];
}

export interface ImportMatchesWithOddsResponse {
  readonly imported: number;
  readonly odds: Omit<SyncMatchOddsResponse, 'matches'>;
  readonly validation: MatchImportValidation;
  readonly matches: Match[];
}

export interface MatchImportValidation {
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
  readonly validation: MatchImportValidation;
  readonly released: number;
  readonly matches: Match[];
}

export interface SavePredictionRequest {
  readonly homeScore: number;
  readonly awayScore: number;
}

export interface SavePredictionResponse {
  readonly prediction: MatchPrediction;
}

export interface UpdateFinalScoreRequest {
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}

export interface UpdateFinalScoreResponse {
  readonly match: Match;
  readonly finalScore: MatchScore | null;
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
  readonly match: Match;
}

export interface UpdatePostponedRequest extends AdminActionSecretRequest {
  readonly isPostponed: boolean;
}

export interface UpdatePostponedResponse {
  readonly match: Match;
}

export type PlayoffMappingSide = 'home' | 'away';

export interface UpdatePlayoffMappingRequest {
  readonly side: PlayoffMappingSide;
  readonly teamName: string | null;
  readonly teamFlag: string | null;
}

export interface UpdatePlayoffMappingResponse {
  readonly match: Match;
}
