import type { LocalizedString } from './content-localization.models';
export interface Competition {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly isFinished: boolean;
  readonly playoffsEnabled: boolean;
  readonly buyInEur: number;
  readonly isJoined: boolean;
  readonly tiebreakerName: string | null;
}

export interface CompetitionsResponse {
  readonly competitions: Competition[];
}

export interface UpdateCompetitionTiebreakerRequest {
  readonly tiebreakerName: string;
}

export interface JoinCompetitionRequest {
  readonly passcode: string;
}

export interface JoinCompetitionResponse {
  readonly competition: Competition;
}

export interface UpdateCompetitionTiebreakerResponse {
  readonly competition: Competition;
}

export interface AdminCompetitionSettings {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly isFinished: boolean;
  readonly playoffsEnabled: boolean;
  readonly buyInEur: number;
  readonly passcodeSet: boolean;
  readonly scheduleSourceUrl: string;
  readonly oddsSourceUrl: string;
  readonly importMatchesWithOddsEnabled: boolean;
  readonly autoImportMatchesEnabled: boolean;
  readonly autoImportMatchesWeekday: number;
  readonly autoImportMatchesTime: string;
  readonly autoImportMatchesTimeZone: string;
  readonly notificationRemindersEnabled: boolean;
  readonly liveScoreSyncEnabled: boolean;
  readonly rules: AdminCompetitionRule[];
}

export interface UpdateAdminCompetitionSettingsRequest {
  readonly name: string;
  readonly logoUrl: string;
  readonly passcode?: string;
  readonly isFinished: boolean;
  readonly playoffsEnabled: boolean;
  readonly scheduleSourceUrl?: string;
  readonly oddsSourceUrl: string;
  readonly importMatchesWithOddsEnabled?: boolean;
  readonly autoImportMatchesEnabled?: boolean;
  readonly autoImportMatchesWeekday?: number;
  readonly autoImportMatchesTime?: string;
  readonly autoImportMatchesTimeZone?: string;
  readonly secretCode: string;
  readonly rules: AdminCompetitionRuleRequest[];
}

export interface CreateAdminCompetitionRequest {
  readonly name: string;
  readonly logoUrl: string;
  readonly passcode: string;
  readonly isFinished: boolean;
  readonly playoffsEnabled?: boolean;
  readonly scheduleSourceUrl?: string;
  readonly oddsSourceUrl: string;
  readonly importMatchesWithOddsEnabled?: boolean;
  readonly autoImportMatchesEnabled?: boolean;
  readonly autoImportMatchesWeekday?: number;
  readonly autoImportMatchesTime?: string;
  readonly autoImportMatchesTimeZone?: string;
  readonly secretCode: string;
  readonly rules: AdminCompetitionRuleRequest[];
}

export interface CreateAdminCompetitionResponse {
  readonly competition: Competition;
}

export interface AdminRuleTemplate {
  readonly key: string;
  readonly textTemplate: string;
  readonly valueLabel: string | null;
  readonly defaultValue: string | null;
}

export interface AdminRuleTemplatesResponse {
  readonly templates: AdminRuleTemplate[];
}

export interface AdminCompetitionRule extends AdminRuleTemplate {
  readonly value: string | null;
}

export interface AdminCompetitionRuleRequest {
  readonly templateKey: string;
  readonly value: string | null;
}

export interface CompetitionRulesResponse {
  readonly competition: Competition;
  readonly rules: LocalizedString[][];
}

export interface DefaultCompetitionRulesResponse {
  readonly rules: LocalizedString[][];
}

export interface CompetitionTeamsResponse {
  readonly teams: string[];
  readonly groupTeams: CompetitionGroupTeam[];
}

export interface CompetitionGroupTeam {
  readonly name: string;
  readonly flag: string | null;
  readonly groupName: string;
}
