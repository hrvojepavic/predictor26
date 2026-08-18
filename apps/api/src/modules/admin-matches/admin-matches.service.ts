import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MatchOddsInput, MatchRow } from '../../database/queries/matches.queries.js';
import { config } from '../../config/index.js';
import { verifyPassword } from '../../shared/utils/password.js';
import { MatchResponse } from '../matches/matches.interfaces.js';
import {
  AdminActionSecretRequest,
  CreateManualMatchRequest,
  CreateManualMatchResponse,
  AdminMatchesResponse,
  ImportMatchesResponse,
  ImportMatchesWithOddsResponse,
  MatchImportValidationResponse,
  ReleaseMatchRoundRequest,
  ReleaseMatchRoundResponse,
  SyncMatchOddsResponse,
  UpdateFinalScoreRequest,
  UpdateKickoffRequest,
  UpdatePostponedRequest,
  UpdatePostponedResponse,
  UpdatePlayoffMappingRequest
} from './admin-matches.interfaces.js';
import {
  backfillPredictionOdds,
  findAdminMatches,
  findSuperAdminForSecretCode,
  getMetadataValue,
  addManualMatch,
  applyTeamLogosToMatches,
  importMatches,
  importTeams,
  releaseImportedMatches,
  releaseRoundMatches,
  setFinalScore,
  setKickoff,
  setPostponed,
  setPlayoffTeamMapping,
  setMetadataValue,
  setMatchOdds
} from './admin-matches.repository.js';
import {
  ImportedMatchOdds,
  importOddsPortalOdds
} from './oddsportal-odds-importer.js';
import { importOddsPortalSchedule } from './oddsportal-schedule-importer.js';
import {
  findCompetitionForAdmin,
  findCompetitionCanonicalTeamNames,
  findCompetitionsWithAutoMatchImportEnabled,
  setCompetitionJobSettings
} from '../competitions/competitions.repository.js';

const autoMatchImportRunMetadataPrefix = 'auto_match_import_last_run';
const autoMatchImportLastReportMetadataPrefix = 'auto_match_import_last_report';
const schedulerMinimumDelayMs = 5_000;
const schedulerMaxDelayMs = 24 * 60 * 60 * 1_000;

let autoImportSchedulerTimer: NodeJS.Timeout | null = null;
let autoImportRunning = false;

type SecretCodeResult =
  | {
      readonly status: 'valid';
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export type ImportScheduleResult =
  | {
      readonly status: 'imported';
      readonly response: ImportMatchesResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>;

export type SyncOddsResult =
  | {
      readonly status: 'synced';
      readonly response: SyncMatchOddsResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>;

export type ImportScheduleWithOddsResult =
  | {
      readonly status: 'imported';
      readonly response: ImportMatchesWithOddsResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>;

export type CreateManualMatchResult =
  | {
      readonly status: 'created';
      readonly response: CreateManualMatchResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>;

export type ReleaseMatchRoundResult =
  | {
      readonly status: 'released';
      readonly response: ReleaseMatchRoundResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>
;

export interface AutoMatchImportRunReport {
  readonly competitionId: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly enabled: boolean;
  readonly status: 'success' | 'skipped' | 'failed';
  readonly imported: number;
  readonly oddsSynced: number;
  readonly roundLabel: string | null;
  readonly released: boolean;
  readonly nextRunAt: string | null;
  readonly errorMessage: string | null;
}

export interface AutoMatchImportJobSnapshot {
  readonly enabled: boolean;
  readonly weekday: number;
  readonly time: string;
  readonly timeZone: string;
  readonly nextRunAt: string | null;
  readonly lastRun: AutoMatchImportRunReport | null;
}

interface MatchOddsSyncPlan {
  readonly odds: MatchOddsInput[];
  readonly matched: number;
  readonly skippedExisting: number;
  readonly skippedFinished: number;
  readonly skippedUnresolved: number;
  readonly unmatched: number;
}

export type UpdateFinalScoreResult =
  | {
      readonly status: 'updated';
      readonly match: MatchResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'not_found';
  };

export type UpdateKickoffResult =
  | {
      readonly status: 'updated';
      readonly match: MatchResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>
  | {
      readonly status: 'not_found';
    };

export type UpdatePostponedResult =
  | {
      readonly status: 'updated';
      readonly response: UpdatePostponedResponse;
    }
  | Exclude<SecretCodeResult, { readonly status: 'valid' }>
  | {
      readonly status: 'not_found';
    };

export type UpdatePlayoffMappingResult =
  | {
      readonly status: 'updated';
      readonly match: MatchResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'not_found';
    };

export async function getAdminMatches(competitionId: number): Promise<AdminMatchesResponse> {
  const competition = findCompetitionForAdmin(competitionId);

  return {
    matches: findAdminMatches(competitionId).map(toMatchResponse),
    importMatchesWithOddsEnabled: competition?.import_matches_with_odds_enabled === 1
  };
}

export function startAutoMatchImportScheduler(): void {
  scheduleNextAutoMatchImport(0);
}

export function rescheduleAutoMatchImportScheduler(): void {
  if (autoImportSchedulerTimer) {
    clearTimeout(autoImportSchedulerTimer);
    autoImportSchedulerTimer = null;
  }

  void runAutoMatchImportSchedulerCycle();
}

export async function getAutoMatchImportJobSnapshot(competitionId: number): Promise<AutoMatchImportJobSnapshot> {
  const competition = findCompetitionForAdmin(competitionId);
  const enabled = isAutoMatchImportEnabled(competition);
  const schedule = {
    weekday: competition?.auto_import_matches_weekday ?? 2,
    time: competition?.auto_import_matches_time ?? '08:00',
    timeZone: competition?.auto_import_matches_time_zone ?? 'Europe/Zagreb'
  };

  return {
    enabled,
    ...schedule,
    nextRunAt: enabled ? getNextScheduledInstant(new Date(), schedule).toISOString() : null,
    lastRun: await getLastAutoMatchImportRun(competitionId)
  };
}

export async function updateAutoMatchImportJobSettings(
  competitionId: number,
  input: {
    readonly enabled?: unknown;
    readonly weekday?: unknown;
    readonly time?: unknown;
    readonly timeZone?: unknown;
  }
): Promise<AutoMatchImportJobSnapshot | null> {
  const competition = findCompetitionForAdmin(competitionId);

  if (!competition || !isValidAutoImportSettings(input)) {
    return null;
  }

  setCompetitionJobSettings(competitionId, {
    autoImportMatchesEnabled: input.enabled === true && competition.is_finished === 0,
    autoImportMatchesWeekday: input.weekday,
    autoImportMatchesTime: input.time,
    autoImportMatchesTimeZone: input.timeZone
  });

  if (input.enabled === true) {
    await runDueAutoMatchImports();
  }

  rescheduleAutoMatchImportScheduler();

  return getAutoMatchImportJobSnapshot(competitionId);
}

export async function runAutoMatchImportNow(competitionId: number): Promise<AutoMatchImportRunReport> {
  return runAutoMatchImportJob(competitionId, { force: true });
}

export async function createManualMatch(
  competitionId: number,
  input: Partial<CreateManualMatchRequest> | undefined
): Promise<CreateManualMatchResult> {
  if (
    typeof input?.kickoffAt !== 'string' ||
    !isValidIsoDate(input.kickoffAt) ||
    !isValidVenuePart(input.city, 80) ||
    !isValidVenuePart(input.venue, 120) ||
    !isValidTeamName(input.homeTeamName) ||
    !isValidTeamName(input.awayTeamName) ||
    normalizeTeamName(input.homeTeamName) === normalizeTeamName(input.awayTeamName) ||
    !isValidNullableLogoDataUrl(input.homeTeamLogoDataUrl) ||
    !isValidNullableLogoDataUrl(input.awayTeamLogoDataUrl) ||
    !isValidOddsValue(input.homeWinOdds) ||
    !isValidOddsValue(input.drawOdds) ||
    !isValidOddsValue(input.awayWinOdds)
  ) {
    return { status: 'invalid' };
  }

  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const homeTeamFlag = saveManualTeamLogo(input.homeTeamName, input.homeTeamLogoDataUrl);
  const awayTeamFlag = saveManualTeamLogo(input.awayTeamName, input.awayTeamLogoDataUrl);

  if (homeTeamFlag === false || awayTeamFlag === false) {
    return { status: 'invalid' };
  }

  const matches = findAdminMatches(competitionId);
  const nextMatchNumber = Math.max(0, ...matches.map((match) => match.match_number)) + 1;
  const roundLabel = findManualMatchRoundLabel(matches);
  const match = addManualMatch(competitionId, {
    matchNumber: nextMatchNumber,
    roundLabel,
    kickoffAt: input.kickoffAt,
    sourceTimeZone: 'Europe/Zagreb',
    homeTeamName: input.homeTeamName.trim(),
    homeTeamFlag,
    awayTeamName: input.awayTeamName.trim(),
    awayTeamFlag,
    venue: input.venue.trim(),
    city: input.city.trim(),
    homeWinOdds: input.homeWinOdds,
    drawOdds: input.drawOdds,
    awayWinOdds: input.awayWinOdds
  });

  if (!match) {
    return { status: 'invalid' };
  }

  return {
    status: 'created',
    response: {
      match: toMatchResponse(match),
      matches: findAdminMatches(competitionId).map(toMatchResponse)
    }
  };
}

export async function importSchedule(
  competitionId: number,
  input: Partial<AdminActionSecretRequest> | undefined
): Promise<ImportScheduleResult> {
  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const competition = findCompetitionForAdmin(competitionId);
  const sourceUrl = competition?.odds_source_url.trim() ?? '';

  if (!isValidSourceUrl(sourceUrl)) {
    return { status: 'invalid' };
  }

  const imported = await importScheduleForCompetition(competitionId, sourceUrl);
  const roundLabel = imported.roundLabel;
  const validation = roundLabel ? validateImportedRound(competitionId, roundLabel, imported.requiredTeamNames) : null;

  return {
    status: 'imported',
    response: {
      imported: imported.imported,
      validation,
      matches: findAdminMatches(competitionId).map(toMatchResponse)
    }
  };
}

export async function importScheduleWithOdds(
  competitionId: number,
  input: Partial<AdminActionSecretRequest> | undefined
): Promise<ImportScheduleWithOddsResult> {
  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const competition = findCompetitionForAdmin(competitionId);
  const sourceUrl = competition?.odds_source_url.trim() ?? '';

  if (!isValidSourceUrl(sourceUrl)) {
    return { status: 'invalid' };
  }

  const imported = await importScheduleForCompetition(competitionId, sourceUrl);
  const oddsResponse = await syncOddsForCompetition(competitionId, sourceUrl, { roundLabel: imported.roundLabel });
  const validation = imported.roundLabel
    ? validateImportedRound(competitionId, imported.roundLabel, imported.requiredTeamNames)
    : createEmptyValidation();

  if (validation.complete) {
    releaseImportedMatches(competitionId, findAdminMatches(competitionId).filter((match) => match.round_label === validation.roundLabel).map((match) => match.id));
  }

  const finalValidation = validation.complete
    ? {
        ...validation,
        released: true
      }
    : validation;

  return {
    status: 'imported',
    response: {
      imported: imported.imported,
      odds: {
        synced: oddsResponse.synced,
        matched: oddsResponse.matched,
        skippedExisting: oddsResponse.skippedExisting,
        skippedFinished: oddsResponse.skippedFinished,
        skippedUnresolved: oddsResponse.skippedUnresolved,
        unmatched: oddsResponse.unmatched,
        backfilled: oddsResponse.backfilled
      },
      validation: finalValidation,
      matches: findAdminMatches(competitionId).map(toMatchResponse)
    }
  };
}

export async function runAutoMatchImportForCompetition(
  competitionId: number,
  options: { readonly requireAutoEnabled: boolean } = { requireAutoEnabled: true }
): Promise<ImportMatchesWithOddsResponse | null> {
  const competition = findCompetitionForAdmin(competitionId);
  const sourceUrl = competition?.odds_source_url.trim() ?? '';

  if (
    !competition ||
    competition.is_finished === 1 ||
    (options.requireAutoEnabled && competition.auto_import_matches_enabled !== 1) ||
    competition.import_matches_with_odds_enabled !== 1 ||
    !isValidSourceUrl(sourceUrl)
  ) {
    return null;
  }

  const imported = await importScheduleForCompetition(competitionId, sourceUrl);
  const oddsResponse = await syncOddsForCompetition(competitionId, sourceUrl, { roundLabel: imported.roundLabel });
  const validation = imported.roundLabel
    ? validateImportedRound(competitionId, imported.roundLabel, imported.requiredTeamNames)
    : createEmptyValidation();

  if (validation.complete) {
    releaseImportedMatches(competitionId, findAdminMatches(competitionId).filter((match) => match.round_label === validation.roundLabel).map((match) => match.id));
  }

  return {
    imported: imported.imported,
    odds: {
      synced: oddsResponse.synced,
      matched: oddsResponse.matched,
      skippedExisting: oddsResponse.skippedExisting,
      skippedFinished: oddsResponse.skippedFinished,
      skippedUnresolved: oddsResponse.skippedUnresolved,
      unmatched: oddsResponse.unmatched,
      backfilled: oddsResponse.backfilled
    },
    validation: validation.complete
      ? {
          ...validation,
          released: true
        }
      : validation,
    matches: findAdminMatches(competitionId).map(toMatchResponse)
  };
}

function scheduleNextAutoMatchImport(delayMs: number): void {
  if (autoImportSchedulerTimer) {
    clearTimeout(autoImportSchedulerTimer);
  }

  autoImportSchedulerTimer = setTimeout(() => {
    void runAutoMatchImportSchedulerCycle();
  }, Math.max(delayMs, schedulerMinimumDelayMs));
}

async function runAutoMatchImportSchedulerCycle(): Promise<void> {
  try {
    const nextRunAt = await runDueAutoMatchImports();
    scheduleNextAutoMatchImport(Math.max(nextRunAt - Date.now(), schedulerMinimumDelayMs));
  } catch (error) {
    console.error('Auto match import scheduler failed:', error instanceof Error ? error.message : error);
    scheduleNextAutoMatchImport(schedulerMaxDelayMs);
  }
}

async function runDueAutoMatchImports(): Promise<number> {
  if (autoImportRunning) {
    return Date.now() + schedulerMinimumDelayMs;
  }

  autoImportRunning = true;
  const now = new Date();
  let nextRunAt: number | null = null;

  try {
    for (const competition of findCompetitionsWithAutoMatchImportEnabled()) {
      const scheduledAt = getScheduledInstantForLocalWeek(now, {
        weekday: competition.auto_import_matches_weekday,
        time: competition.auto_import_matches_time,
        timeZone: competition.auto_import_matches_time_zone
      });
      const localRunSlot = getLocalScheduleSlotKey(
        scheduledAt,
        competition.auto_import_matches_time_zone,
        competition.auto_import_matches_time
      );
      const metadataKey = `${autoMatchImportRunMetadataPrefix}:${competition.id}`;
      const lastRunLocalSlot = await getMetadataValue(metadataKey);

      if (scheduledAt.getTime() <= now.getTime() && lastRunLocalSlot !== localRunSlot) {
        try {
          await runAutoMatchImportJob(competition.id, { force: false });
          setMetadataValue(metadataKey, localRunSlot);
        } catch (error) {
          console.error(
            `Auto match import failed for competition ${competition.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      }

      const nextCompetitionRunAt = getNextScheduledInstant(now, {
        weekday: competition.auto_import_matches_weekday,
        time: competition.auto_import_matches_time,
        timeZone: competition.auto_import_matches_time_zone
      }).getTime();

      if (nextRunAt === null || nextCompetitionRunAt < nextRunAt) {
        nextRunAt = nextCompetitionRunAt;
      }
    }
  } finally {
    autoImportRunning = false;
  }

  return nextRunAt ?? Date.now() + schedulerMaxDelayMs;
}

async function runAutoMatchImportJob(
  competitionId: number,
  options: { readonly force: boolean }
): Promise<AutoMatchImportRunReport> {
  const startedAt = new Date();
  const competition = findCompetitionForAdmin(competitionId);
  const enabled = isAutoMatchImportEnabled(competition);
  const schedule = {
    weekday: competition?.auto_import_matches_weekday ?? 2,
    time: competition?.auto_import_matches_time ?? '08:00',
    timeZone: competition?.auto_import_matches_time_zone ?? 'Europe/Zagreb'
  };
  let imported = 0;
  let oddsSynced = 0;
  let roundLabel: string | null = null;
  let released = false;
  let status: AutoMatchImportRunReport['status'] = 'success';
  let errorMessage: string | null = null;

  try {
    if (!enabled && !options.force) {
      status = 'skipped';
      errorMessage = 'Auto match import is disabled.';
    } else {
      const result = await runAutoMatchImportForCompetition(competitionId, { requireAutoEnabled: !options.force });

      if (!result) {
        status = 'skipped';
        errorMessage = 'Competition is not configured for combined match and odds import.';
      } else {
        imported = result.imported;
        oddsSynced = result.odds.synced;
        roundLabel = result.validation.roundLabel || null;
        released = result.validation.released;
      }
    }
  } catch (error) {
    status = 'failed';
    errorMessage = error instanceof Error ? error.message : 'Auto match import failed.';
  }

  const finishedAt = new Date();
  const report: AutoMatchImportRunReport = {
    competitionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    enabled,
    status,
    imported,
    oddsSynced,
    roundLabel,
    released,
    nextRunAt: enabled ? getNextScheduledInstant(finishedAt, schedule).toISOString() : null,
    errorMessage
  };
  setMetadataValue(`${autoMatchImportLastReportMetadataPrefix}:${competitionId}`, JSON.stringify(report));

  return report;
}

async function getLastAutoMatchImportRun(competitionId: number): Promise<AutoMatchImportRunReport | null> {
  const value = await getMetadataValue(`${autoMatchImportLastReportMetadataPrefix}:${competitionId}`);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as AutoMatchImportRunReport;
  } catch {
    return null;
  }
}

function isAutoMatchImportEnabled(competition: ReturnType<typeof findCompetitionForAdmin>): boolean {
  return (
    competition?.is_finished === 0 &&
    competition.auto_import_matches_enabled === 1 &&
    competition.import_matches_with_odds_enabled === 1
  );
}

function isValidAutoImportSettings(input: {
  readonly enabled?: unknown;
  readonly weekday?: unknown;
  readonly time?: unknown;
  readonly timeZone?: unknown;
}): input is { readonly enabled: boolean; readonly weekday: number; readonly time: string; readonly timeZone: string } {
  if (
    typeof input.enabled !== 'boolean' ||
    typeof input.weekday !== 'number' ||
    !Number.isInteger(input.weekday) ||
    input.weekday < 0 ||
    input.weekday > 6 ||
    typeof input.time !== 'string' ||
    !/^\d{2}:\d{2}$/.test(input.time) ||
    Number(input.time.slice(0, 2)) > 23 ||
    Number(input.time.slice(3, 5)) > 59 ||
    typeof input.timeZone !== 'string' ||
    input.timeZone.length < 1 ||
    input.timeZone.length > 80
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getNextScheduledInstant(
  now: Date,
  schedule: { readonly weekday: number; readonly time: string; readonly timeZone: string }
): Date {
  const currentWeekRun = getScheduledInstantForLocalWeek(now, schedule);

  if (currentWeekRun.getTime() > now.getTime()) {
    return currentWeekRun;
  }

  return getScheduledInstantForLocalWeek(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000), schedule);
}

function getScheduledInstantForLocalWeek(
  reference: Date,
  schedule: { readonly weekday: number; readonly time: string; readonly timeZone: string }
): Date {
  const parts = getLocalDateTimeParts(reference, schedule.timeZone);
  const daysSinceScheduledWeekday = (parts.weekday - schedule.weekday + 7) % 7;
  const scheduledDateUtc = Date.UTC(parts.year, parts.month - 1, parts.day - daysSinceScheduledWeekday);
  const [hour, minute] = schedule.time.split(':').map(Number);
  const scheduledLocalAsUtc = new Date(scheduledDateUtc + hour * 60 * 60 * 1_000 + minute * 60 * 1_000);
  const offsetMs = getTimeZoneOffsetMs(scheduledLocalAsUtc, schedule.timeZone);

  return new Date(scheduledLocalAsUtc.getTime() - offsetMs);
}

function getLocalDateTimeParts(date: Date, timeZone: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(valueByType.get('year')),
    month: Number(valueByType.get('month')),
    day: Number(valueByType.get('day')),
    weekday: weekdayNumber(valueByType.get('weekday') ?? 'Sun')
  };
}

function getLocalDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));

  return `${valueByType.get('year')}-${valueByType.get('month')}-${valueByType.get('day')}`;
}

function getLocalScheduleSlotKey(date: Date, timeZone: string, time: string): string {
  return `${getLocalDateKey(date, timeZone)}T${time}@${timeZone}`;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const localAsUtc = Date.UTC(
    Number(valueByType.get('year')),
    Number(valueByType.get('month')) - 1,
    Number(valueByType.get('day')),
    Number(valueByType.get('hour')),
    Number(valueByType.get('minute')),
    Number(valueByType.get('second'))
  );

  return localAsUtc - date.getTime();
}

function weekdayNumber(value: string): number {
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  return weekdays[value] ?? 0;
}

async function importScheduleForCompetition(
  competitionId: number,
  sourceUrl: string
): Promise<{ readonly imported: number; readonly roundLabel: string | null; readonly requiredTeamNames: string[] }> {
  const existingMatches = findAdminMatches(competitionId);
  const requiredTeamNames = findCompetitionCanonicalTeamNames(competitionId);
  const importedSchedule = await importOddsPortalSchedule(sourceUrl, existingMatches);
  importTeams(importedSchedule.teams, competitionId);
  applyTeamLogosToMatches(competitionId);
  const imported = importMatches(importedSchedule.matches, competitionId);
  applyTeamLogosToMatches(competitionId);
  const matchesAfterImport = findAdminMatches(competitionId);

  return {
    imported,
    roundLabel: importedSchedule.matches[0]?.roundLabel ?? findUpcomingRoundLabel(matchesAfterImport),
    requiredTeamNames
  };
}

export async function releaseMatchRound(
  competitionId: number,
  input: Partial<ReleaseMatchRoundRequest> | undefined
): Promise<ReleaseMatchRoundResult> {
  if (typeof input?.roundLabel !== 'string' || input.roundLabel.trim().length < 1 || input.roundLabel.length > 80) {
    return { status: 'invalid' };
  }

  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const roundLabel = input.roundLabel.trim();
  const validation = validateImportedRound(competitionId, roundLabel);
  const released = releaseRoundMatches(competitionId, roundLabel);

  return {
    status: 'released',
    response: {
      validation: {
        ...validation,
        released: released > 0 || validation.released
      },
      released,
      matches: findAdminMatches(competitionId).map(toMatchResponse)
    }
  };
}

export async function syncOdds(competitionId: number, input: Partial<AdminActionSecretRequest> | undefined): Promise<SyncOddsResult> {
  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const competition = findCompetitionForAdmin(competitionId);
  const oddsSourceUrl = competition?.odds_source_url.trim() ?? '';

  if (!isValidSourceUrl(oddsSourceUrl)) {
    return { status: 'invalid' };
  }

  const response = await syncOddsForCompetition(competitionId, oddsSourceUrl);

  return {
    status: 'synced',
    response
  };
}

async function syncOddsForCompetition(
  competitionId: number,
  oddsSourceUrl: string,
  options: { readonly roundLabel?: string | null } = {}
): Promise<SyncMatchOddsResponse> {
  const matches = getOddsSyncScope(findAdminMatches(competitionId), options.roundLabel);
  const importedOdds = await importOddsPortalOdds(oddsSourceUrl);
  const syncPlan = mapImportedOddsToMatches(matches, importedOdds);
  const synced = setMatchOdds(syncPlan.odds);
  const backfilled = backfillPredictionOdds(competitionId);

  return {
    synced,
    matched: syncPlan.matched,
    skippedExisting: syncPlan.skippedExisting,
    skippedFinished: syncPlan.skippedFinished,
    skippedUnresolved: syncPlan.skippedUnresolved,
    unmatched: syncPlan.unmatched,
    backfilled,
    matches: findAdminMatches(competitionId).map(toMatchResponse)
  };
}

function validateImportedRound(
  competitionId: number,
  roundLabel: string,
  requiredTeamNamesOverride?: readonly string[]
): MatchImportValidationResponse {
  const matches = findAdminMatches(competitionId).filter((match) => match.round_label === roundLabel);
  const requiredTeamNames = requiredTeamNamesOverride ?? findCompetitionCanonicalTeamNames(competitionId);
  const presentTeamNames = new Set<string>();
  const missingOddsMatchNumbers: number[] = [];
  const incompleteMatchNumbers: number[] = [];

  for (const match of matches) {
    const homeTeamName = getResolvedHomeTeamName(match);
    const awayTeamName = getResolvedAwayTeamName(match);

    presentTeamNames.add(normalizeTeamName(homeTeamName));
    presentTeamNames.add(normalizeTeamName(awayTeamName));

    if (
      match.is_postponed !== 1 &&
      (!homeTeamName.trim() ||
        !awayTeamName.trim() ||
        !match.kickoff_at.trim() ||
        Number.isNaN(Date.parse(match.kickoff_at)) ||
        !match.city.trim() ||
        !match.venue.trim())
    ) {
      incompleteMatchNumbers.push(match.match_number);
    }

    if (match.is_postponed !== 1 && (match.home_win_odds === null || match.draw_odds === null || match.away_win_odds === null)) {
      missingOddsMatchNumbers.push(match.match_number);
    }
  }

  const missingTeamNames = requiredTeamNames.filter((teamName) => !presentTeamNames.has(normalizeTeamName(teamName)));
  const complete =
    matches.length > 0 &&
    incompleteMatchNumbers.length === 0 &&
    missingOddsMatchNumbers.length === 0 &&
    missingTeamNames.length === 0;

  return {
    roundLabel,
    complete,
    released: matches.length > 0 && matches.every((match) => match.released_for_predictions === 1),
    matchCount: matches.length,
    missingOddsMatchNumbers,
    incompleteMatchNumbers,
    missingTeamNames
  };
}

function createEmptyValidation(): MatchImportValidationResponse {
  return {
    roundLabel: '',
    complete: false,
    released: false,
    matchCount: 0,
    missingOddsMatchNumbers: [],
    incompleteMatchNumbers: [],
    missingTeamNames: []
  };
}

function findUpcomingRoundLabel(matches: readonly MatchRow[]): string | null {
  return (
    matches
      .filter((match) => !isFinished(match))
      .sort((firstMatch, secondMatch) => firstMatch.kickoff_at.localeCompare(secondMatch.kickoff_at))[0]?.round_label ?? null
  );
}

function findManualMatchRoundLabel(matches: readonly MatchRow[]): string {
  const unreleasedRoundLabel = matches
    .filter((match) => match.released_for_predictions === 0)
    .sort(sortMatchesByKickoff)[0]?.round_label;

  if (unreleasedRoundLabel) {
    return unreleasedRoundLabel;
  }

  const nextWeekNumber = Math.max(0, ...matches.map((match) => weekNumber(match.round_label)).filter((week) => week > 0)) + 1;

  return `Week ${nextWeekNumber}`;
}

function getOddsSyncScope(matches: readonly MatchRow[], roundLabel: string | null | undefined): MatchRow[] {
  if (roundLabel) {
    return matches.filter((match) => match.round_label === roundLabel && match.is_postponed !== 1 && !isFinished(match));
  }

  return matches.filter((match) => match.is_postponed !== 1 && !isFinished(match));
}

function sortMatchesByKickoff(firstMatch: MatchRow, secondMatch: MatchRow): number {
  const kickoffComparison = Date.parse(firstMatch.kickoff_at) - Date.parse(secondMatch.kickoff_at);

  if (kickoffComparison !== 0) {
    return kickoffComparison;
  }

  return firstMatch.match_number - secondMatch.match_number;
}

function isValidSourceUrl(value: string): boolean {
  if (value.length < 1 || value.length > 500) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidTeamName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80;
}

function isValidNullableLogoDataUrl(value: unknown): value is string | null | undefined {
  if (value === null || value === undefined || value === '') {
    return true;
  }

  if (typeof value !== 'string' || value.length > 450_000) {
    return false;
  }

  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(value);
}

function saveManualTeamLogo(teamName: string, logoDataUrl: string | null | undefined): string | null | false {
  if (!logoDataUrl) {
    return null;
  }

  const match = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+=*)$/i.exec(logoDataUrl);

  if (!match) {
    return false;
  }

  const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length < 1 || buffer.length > 300_000) {
    return false;
  }

  const slug = slugifyTeamName(teamName);
  const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  const fileName = `${slug}-${hash}.${extension}`;

  mkdirSync(config.teamLogoAssetsPath, { recursive: true });
  writeFileSync(join(config.teamLogoAssetsPath, fileName), buffer);

  return `/api/assets/team-logos/${fileName}`;
}

function slugifyTeamName(teamName: string): string {
  const slug = teamName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'team';
}

function isValidOddsValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 1 && value <= 1000;
}

async function validateSecretCode(input: Partial<AdminActionSecretRequest> | undefined): Promise<SecretCodeResult> {
  if (typeof input?.secretCode !== 'string' || input.secretCode.length < 1 || input.secretCode.length > 128) {
    return { status: 'invalid' };
  }

  const superAdmin = await findSuperAdminForSecretCode();

  if (!superAdmin || !verifyPassword(input.secretCode, superAdmin.password_hash)) {
    return { status: 'invalid_secret' };
  }

  return { status: 'valid' };
}

export async function changeFinalScore(
  competitionId: number,
  matchId: number,
  input: Partial<UpdateFinalScoreRequest> | undefined
): Promise<UpdateFinalScoreResult> {
  if (!Number.isInteger(matchId) || matchId < 1) {
    return { status: 'invalid' };
  }

  const bothEmpty = input?.homeScore === null && input.awayScore === null;
  const bothScores = isValidNullableScore(input?.homeScore) && isValidNullableScore(input?.awayScore);

  if (!bothEmpty && (!bothScores || input?.homeScore === null || input.awayScore === null)) {
    return { status: 'invalid' };
  }

  const match = setFinalScore(competitionId, matchId, input.homeScore, input.awayScore);

  if (!match) {
    return { status: 'not_found' };
  }

  return {
    status: 'updated',
    match: toMatchResponse(match)
  };
}

export async function changeKickoff(
  competitionId: number,
  matchId: number,
  input: Partial<UpdateKickoffRequest> | undefined
): Promise<UpdateKickoffResult> {
  const hasOddsInput =
    input?.homeWinOdds !== undefined ||
    input?.drawOdds !== undefined ||
    input?.awayWinOdds !== undefined;

  if (
    !Number.isInteger(matchId) ||
    matchId < 1 ||
    typeof input?.kickoffAt !== 'string' ||
    !isValidIsoDate(input.kickoffAt) ||
    !isValidVenuePart(input.city, 80) ||
    !isValidVenuePart(input.venue, 120) ||
    (hasOddsInput && (!isValidOddsValue(input.homeWinOdds) || !isValidOddsValue(input.drawOdds) || !isValidOddsValue(input.awayWinOdds)))
  ) {
    return { status: 'invalid' };
  }

  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const existingMatch = findAdminMatches(competitionId).find((match) => match.id === matchId);

  if (!existingMatch) {
    return { status: 'not_found' };
  }

  if (
    hasOddsInput &&
    (existingMatch.home_win_odds !== null ||
      existingMatch.draw_odds !== null ||
      existingMatch.away_win_odds !== null ||
      existingMatch.final_home_score !== null ||
      existingMatch.final_away_score !== null)
  ) {
    return { status: 'invalid' };
  }

  let match = setKickoff(competitionId, matchId, input.kickoffAt, input.city.trim(), input.venue.trim());

  if (!match) {
    return { status: 'not_found' };
  }

  if (hasOddsInput) {
    const homeWinOdds = input.homeWinOdds;
    const drawOdds = input.drawOdds;
    const awayWinOdds = input.awayWinOdds;

    if (!isValidOddsValue(homeWinOdds) || !isValidOddsValue(drawOdds) || !isValidOddsValue(awayWinOdds)) {
      return { status: 'invalid' };
    }

    const updated = setMatchOdds([
      {
        matchId,
        homeWinOdds,
        drawOdds,
        awayWinOdds
      }
    ]);

    if (updated !== 1) {
      return { status: 'invalid' };
    }

    match = findAdminMatches(competitionId).find((currentMatch) => currentMatch.id === matchId) ?? match;
  }

  return {
    status: 'updated',
    match: toMatchResponse(match)
  };
}

export async function changePostponed(
  competitionId: number,
  matchId: number,
  input: Partial<UpdatePostponedRequest> | undefined
): Promise<UpdatePostponedResult> {
  if (!Number.isInteger(matchId) || matchId < 1 || typeof input?.isPostponed !== 'boolean') {
    return { status: 'invalid' };
  }

  const secretCodeResult = await validateSecretCode(input);

  if (secretCodeResult.status !== 'valid') {
    return secretCodeResult;
  }

  const match = setPostponed(competitionId, matchId, input.isPostponed);

  if (!match) {
    return { status: 'not_found' };
  }

  return {
    status: 'updated',
    response: {
      match: toMatchResponse(match)
    }
  };
}

export async function changePlayoffMapping(
  competitionId: number,
  matchId: number,
  input: Partial<UpdatePlayoffMappingRequest> | undefined
): Promise<UpdatePlayoffMappingResult> {
  if (
    !Number.isInteger(matchId) ||
    matchId < 1 ||
    (input?.side !== 'home' && input?.side !== 'away') ||
    !isValidNullableTeamName(input.teamName) ||
    !isValidNullableTeamFlag(input.teamFlag)
  ) {
    return { status: 'invalid' };
  }

  if (input.teamName === null && input.teamFlag !== null) {
    return { status: 'invalid' };
  }

  const competition = findCompetitionForAdmin(competitionId);

  if (!competition || competition.playoffs_enabled !== 1) {
    return { status: 'invalid' };
  }

  const match = setPlayoffTeamMapping(competitionId, matchId, input.side, input.teamName, input.teamFlag);

  if (!match) {
    return { status: 'not_found' };
  }

  return {
    status: 'updated',
    match: toMatchResponse(match)
  };
}

function toMatchResponse(match: MatchRow): MatchResponse {
  return {
    id: match.id,
    matchNumber: match.match_number,
    stage: match.stage,
    groupName: match.group_name,
    roundLabel: match.round_label,
    predictionRound: getPredictionRound(match),
    predictionDeadlineAt: match.kickoff_at,
    predictionLocked: false,
    kickoffAt: match.kickoff_at,
    sourceTimeZone: match.source_time_zone,
    homeTeam: {
      name: match.home_mapped_team_name ?? match.home_team_name,
      flag: match.home_mapped_team_flag ?? match.home_team_flag,
      placeholderName: match.home_mapped_team_name ? match.home_team_name : null
    },
    awayTeam: {
      name: match.away_mapped_team_name ?? match.away_team_name,
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
    finalScore:
      match.is_postponed === 1 || match.final_home_score === null || match.final_away_score === null
        ? null
        : {
            home: match.final_home_score,
            away: match.final_away_score
          }
  };
}

function isValidNullableScore(score: unknown): score is number | null {
  return score === null || (typeof score === 'number' && Number.isInteger(score) && score >= 0 && score <= 99);
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isValidVenuePart(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= maxLength;
}

function weekNumber(roundLabel: string): number {
  const match = /^Week (\d+)$/.exec(roundLabel);

  return match ? Number(match[1]) : 0;
}

function isValidNullableTeamName(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 80);
}

function isValidNullableTeamFlag(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 16);
}

function mapImportedOddsToMatches(matches: readonly MatchRow[], importedOdds: readonly ImportedMatchOdds[]): MatchOddsSyncPlan {
  const matchedOdds: MatchOddsInput[] = [];
  const oddsByTeams = new Map<string, ImportedMatchOdds>();
  let skippedExisting = 0;
  let skippedFinished = 0;
  let skippedUnresolved = 0;
  let unmatched = 0;

  for (const odds of importedOdds) {
    oddsByTeams.set(toTeamKey(odds.homeTeamName, odds.awayTeamName), odds);
  }

  for (const match of matches) {
    if (hasOdds(match)) {
      skippedExisting += 1;
      continue;
    }

    if (isFinished(match)) {
      skippedFinished += 1;
      continue;
    }

    const homeTeamName = getResolvedHomeTeamName(match);
    const awayTeamName = getResolvedAwayTeamName(match);

    if (isUnresolvedTeamSlot(homeTeamName) || isUnresolvedTeamSlot(awayTeamName)) {
      skippedUnresolved += 1;
      continue;
    }

    const odds = oddsByTeams.get(toTeamKey(homeTeamName, awayTeamName));

    if (!odds) {
      unmatched += 1;
      continue;
    }

    matchedOdds.push({
      matchId: match.id,
      homeWinOdds: odds.homeWinOdds,
      drawOdds: odds.drawOdds,
      awayWinOdds: odds.awayWinOdds
    });
  }

  return {
    odds: matchedOdds,
    matched: matchedOdds.length,
    skippedExisting,
    skippedFinished,
    skippedUnresolved,
    unmatched
  };
}

function toTeamKey(homeTeamName: string, awayTeamName: string): string {
  return `${normalizeTeamName(homeTeamName)}|${normalizeTeamName(awayTeamName)}`;
}

function getResolvedHomeTeamName(match: MatchRow): string {
  return match.home_mapped_team_name ?? match.home_team_name;
}

function getResolvedAwayTeamName(match: MatchRow): string {
  return match.away_mapped_team_name ?? match.away_team_name;
}

function hasOdds(match: MatchRow): boolean {
  return match.home_win_odds !== null || match.draw_odds !== null || match.away_win_odds !== null;
}

function isFinished(match: MatchRow): boolean {
  return match.final_home_score !== null && match.final_away_score !== null;
}

function isUnresolvedTeamSlot(teamName: string): boolean {
  const normalized = teamName.trim().toUpperCase();

  return (
    /^([A-L]\s*[1-4]|[1-4]\s*[A-L])$/.test(normalized) ||
    /^[WL]\s*\d{1,3}$/.test(normalized) ||
    /\b(?:WINNER|LOSER)\b/.test(normalized) ||
    /\bGROUP\s+[A-L]\b/.test(normalized)
  );
}

function normalizeTeamName(teamName: string): string {
  const normalized = teamName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();

  return teamNameAliases[normalized] ?? normalized;
}

const teamNameAliases: Record<string, string> = {
  bosniaandherzegovina: 'bosniaherzegovina',
  bosniaherzegovina: 'bosniaherzegovina',
  czechrepublic: 'czechia',
  drcongo: 'drcongo',
  ivorycoast: 'ivorycoast',
  turkiye: 'turkey',
  turkey: 'turkey',
  usa: 'unitedstates',
  unitedstates: 'unitedstates'
};

function getPredictionRound(match: MatchRow): string {
  if (isWeekRoundLabel(match.round_label)) {
    return match.round_label;
  }

  if (match.match_number <= 24) {
    return 'Group stage - Round 1';
  }

  if (match.match_number <= 48) {
    return 'Group stage - Round 2';
  }

  if (match.match_number <= 72) {
    return 'Group stage - Round 3';
  }

  return match.round_label;
}

function isWeekRoundLabel(label: string): boolean {
  return /^Week \d+$/.test(label);
}
