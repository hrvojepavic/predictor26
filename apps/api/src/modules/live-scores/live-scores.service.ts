import { config } from '../../config/index.js';
import { LatestLiveScoreSnapshotRow } from '../../database/queries/live-scores.queries.js';
import { MatchRow } from '../../database/queries/matches.queries.js';
import { fetchOddsPortalLiveScores, ProviderLiveScore } from './oddsportal-live-score-provider.js';
import {
  addLiveScoreJobRun,
  addLiveScoreUpdate,
  applyLiveScoreToFinalScore,
  findLastLiveScoreJobRunForCompetition,
  findLatestLiveScoreSnapshotsForCompetition,
  findLiveScoreMatchesForCompetition,
  findRecentLiveScoreJobRunsForCompetition,
  findRecentLiveScoreUpdatesForCompetition,
  setLiveScoreSnapshot
} from './live-scores.repository.js';
import {
  findCompetitionForAdmin,
  findCompetitionsWithLiveScoreSyncEnabled,
  setCompetitionJobSettings
} from '../competitions/competitions.repository.js';
import { getAutoMatchImportJobSnapshot } from '../admin-matches/admin-matches.service.js';

const provider = 'oddsportal';
const recentRunLimit = 10;
const recentUpdateLimit = 20;
const schedulerMinimumDelayMs = 5_000;
const autoImportLiveScoreDelayMs = 5 * 60 * 1_000;
const noReleasedMatchRetryMs = 60 * 60 * 1_000;
const liveScoreFetchAttempts = 4;
const liveScoreFetchTimeoutMs = 30_000;
const liveScoreFetchRetryDelayMs = 2_000;

let schedulerTimer: NodeJS.Timeout | null = null;
let syncRunning = false;
const scheduledNextRunAtByCompetitionId = new Map<number, string | null>();

export interface LiveScoreRunReport {
  readonly runId: number | null;
  readonly competitionId: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly enabled: boolean;
  readonly status: 'success' | 'skipped' | 'failed';
  readonly checkedMatches: number;
  readonly updatedMatches: number;
  readonly liveMatches: number;
  readonly finishedMatches: number;
  readonly nextRunAt: string | null;
  readonly errorMessage: string | null;
}

export async function getLiveScoreJobSnapshot(competitionId: number) {
  const competition = findCompetitionForAdmin(competitionId);
  const enabled = isLiveScoreSyncEnabled(competition);
  const matches = findLiveScoreMatchesForCompetition(competitionId);
  const now = new Date();
  const latestSnapshotsByMatchId = new Map(
    findLatestLiveScoreSnapshotsForCompetition(competitionId).map((snapshot) => [snapshot.match_id, snapshot])
  );
  const activeMatches = getActiveMatches(matches, now, latestSnapshotsByMatchId);
  const calculatedNextRunAt = enabled
    ? await calculateNextRunAt(competitionId, matches, now, activeMatches.length > 0, latestSnapshotsByMatchId)
    : null;
  const scheduledNextRunAt = scheduledNextRunAtByCompetitionId.get(competitionId) ?? null;
  const nextRunAt = enabled ? scheduledNextRunAt ?? calculatedNextRunAt : null;

  return {
    enabled,
    intervalMs: config.liveScorePollIntervalMs,
    status: getSchedulerStatus(enabled, activeMatches.length),
    nextRunAt,
    activeMatches: activeMatches.map((match) => {
      const snapshot = latestSnapshotsByMatchId.get(match.id);

      return {
        matchId: match.id,
        matchNumber: match.match_number,
        homeTeamName: getResolvedHomeTeamName(match),
        awayTeamName: getResolvedAwayTeamName(match),
        kickoffAt: match.kickoff_at,
        currentScore:
          snapshot?.home_score === null || snapshot?.away_score === null || !snapshot
            ? null
            : {
                home: snapshot.home_score,
                away: snapshot.away_score
              },
        providerStatus: snapshot?.status ?? null,
        syncedAt: snapshot ? toUtcIsoString(snapshot.fetched_at) : null
      };
    }),
    lastRun: toRunReport(findLastLiveScoreJobRunForCompetition(competitionId)),
    recentRuns: findRecentLiveScoreJobRunsForCompetition(competitionId, recentRunLimit).map(toRunReportFromRow),
    recentUpdates: findRecentLiveScoreUpdatesForCompetition(competitionId, recentUpdateLimit).map((update) => ({
      runId: update.run_id,
      matchId: update.match_id,
      matchNumber: update.match_number,
      homeTeamName: update.home_team_name,
      awayTeamName: update.away_team_name,
      previousScore:
        update.previous_home_score === null || update.previous_away_score === null
          ? null
          : {
              home: update.previous_home_score,
              away: update.previous_away_score
            },
      newScore: {
        home: update.new_home_score,
        away: update.new_away_score
      },
      providerStatus: update.provider_status,
      appliedToFinalScore: update.applied_to_final_score === 1,
      createdAt: toUtcIsoString(update.created_at)
    }))
  };
}

export function startLiveScoreScheduler(): void {
  scheduleNextLiveScoreSync(0);
}

export function rescheduleLiveScoreScheduler(competitionId?: number): void {
  if (competitionId !== undefined) {
    scheduledNextRunAtByCompetitionId.set(competitionId, null);
  } else {
    scheduledNextRunAtByCompetitionId.clear();
  }

  if (findCompetitionsWithLiveScoreSyncEnabled().length > 0) {
    scheduleNextLiveScoreSync(0);
  }
}

export async function runLiveScoreSyncNow(competitionId: number): Promise<LiveScoreRunReport> {
  return runLiveScoreSync(competitionId, { force: true });
}

export function setLiveScoreSyncEnabled(competitionId: number, enabled: boolean): void {
  const competition = findCompetitionForAdmin(competitionId);
  const nextEnabled = enabled && competition?.is_finished === 0;

  setCompetitionJobSettings(competitionId, { liveScoreSyncEnabled: nextEnabled });

  if (nextEnabled) {
    scheduleNextLiveScoreSync(0);
    return;
  }

  if (findCompetitionsWithLiveScoreSyncEnabled().length === 0 && schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }

  scheduledNextRunAtByCompetitionId.set(competitionId, null);
}

async function runLiveScoreSync(competitionId: number, options: { readonly force: boolean }): Promise<LiveScoreRunReport> {
  if (syncRunning) {
    const now = new Date();
    const report = {
      runId: null,
      competitionId,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      enabled: isLiveScoreSyncEnabled(findCompetitionForAdmin(competitionId)),
      status: 'skipped' as const,
      checkedMatches: 0,
      updatedMatches: 0,
      liveMatches: 0,
      finishedMatches: 0,
      nextRunAt: scheduledNextRunAtByCompetitionId.get(competitionId) ?? null,
      errorMessage: 'Live score sync is already running.'
    };
    const runId = addLiveScoreJobRun(toRunInput(report));

    return {
      ...report,
      runId
    };
  }

  syncRunning = true;
  const startedAt = new Date();
  const competition = findCompetitionForAdmin(competitionId);
  const enabled = isLiveScoreSyncEnabled(competition);
  let checkedMatches = 0;
  let updatedMatches = 0;
  let liveMatches = 0;
  let finishedMatches = 0;
  let status: LiveScoreRunReport['status'] = 'success';
  let errorMessage: string | null = null;
  const pendingUpdates: Array<{
    readonly matchId: number;
    readonly previousHomeScore: number | null;
    readonly previousAwayScore: number | null;
    readonly newHomeScore: number;
    readonly newAwayScore: number;
    readonly providerStatus: ProviderLiveScore['status'];
  }> = [];

  try {
    const matches = findLiveScoreMatchesForCompetition(competitionId);
    const latestSnapshotsByMatchId = new Map(
      findLatestLiveScoreSnapshotsForCompetition(competitionId).map((snapshot) => [snapshot.match_id, snapshot])
    );
    const activeMatches = getActiveMatches(matches, startedAt, latestSnapshotsByMatchId);

    if (!enabled || (!options.force && activeMatches.length === 0)) {
      status = 'skipped';
    } else {
      const providerScores = await fetchLiveScoresWithRetry(competition?.odds_source_url ?? '');
      const matchesByProviderScore = mapProviderScoresToMatches(activeMatches, providerScores);
      const fetchedAt = new Date().toISOString();

      checkedMatches = matchesByProviderScore.length;

      for (const { match, providerScore } of matchesByProviderScore) {
        setLiveScoreSnapshot({
          matchId: match.id,
          provider,
          providerEventId: providerScore.providerEventId,
          status: providerScore.status,
          rawStatus: providerScore.rawStatus,
          homeScore: providerScore.homeScore,
          awayScore: providerScore.awayScore,
          rawPayloadJson: JSON.stringify(providerScore.rawPayload),
          fetchedAt
        });

        if (providerScore.status === 'live') {
          liveMatches += 1;
        }

        if (providerScore.status === 'finished') {
          finishedMatches += 1;
        }

        if (providerScore.homeScore === null || providerScore.awayScore === null) {
          continue;
        }

        if (!shouldApplyProviderScore(providerScore, latestSnapshotsByMatchId.get(match.id))) {
          continue;
        }

        const applied = applyLiveScoreToFinalScore(competitionId, match.id, providerScore.homeScore, providerScore.awayScore);

        if (!applied) {
          continue;
        }

        updatedMatches += 1;
        pendingUpdates.push({
          matchId: match.id,
          previousHomeScore: match.final_home_score,
          previousAwayScore: match.final_away_score,
          newHomeScore: providerScore.homeScore,
          newAwayScore: providerScore.awayScore,
          providerStatus: providerScore.status
        });
      }
    }
  } catch (error) {
    status = 'failed';
    errorMessage = error instanceof Error ? error.message : 'Live score sync failed.';
  } finally {
    syncRunning = false;
  }

  const finishedAt = new Date();
  const matches = findLiveScoreMatchesForCompetition(competitionId);
  const latestSnapshotsByMatchId = new Map(
    findLatestLiveScoreSnapshotsForCompetition(competitionId).map((snapshot) => [snapshot.match_id, snapshot])
  );
  const nextRunAt = enabled
    ? await calculateNextRunAt(competitionId, matches, finishedAt, liveMatches > 0, latestSnapshotsByMatchId)
    : null;
  scheduledNextRunAtByCompetitionId.set(competitionId, nextRunAt);
  const report: LiveScoreRunReport = {
    runId: null,
    competitionId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    enabled,
    status,
    checkedMatches,
    updatedMatches,
    liveMatches,
    finishedMatches,
    nextRunAt,
    errorMessage
  };
  const runId = addLiveScoreJobRun(toRunInput(report));

  for (const update of pendingUpdates) {
    addLiveScoreUpdate({
      ...update,
      runId,
      appliedToFinalScore: true,
      createdAt: report.finishedAt
    });
  }

  return {
    ...report,
    runId
  };
}

function scheduleNextLiveScoreSync(delayMs: number): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
  }

  schedulerTimer = setTimeout(() => {
    void runEnabledCompetitionLiveScoreSyncs().then((nextRunAt) => {
      scheduleNextLiveScoreSync(Math.max(nextRunAt - Date.now(), schedulerMinimumDelayMs));
    });
  }, Math.max(delayMs, schedulerMinimumDelayMs));
}

async function runEnabledCompetitionLiveScoreSyncs(): Promise<number> {
  let nextRunAt: number | null = null;

  for (const competition of findCompetitionsWithLiveScoreSyncEnabled()) {
    const report = await runLiveScoreSync(competition.id, { force: false });

    if (report.nextRunAt) {
      const reportNextRunAt = Date.parse(report.nextRunAt);

      if (Number.isFinite(reportNextRunAt) && (nextRunAt === null || reportNextRunAt < nextRunAt)) {
        nextRunAt = reportNextRunAt;
      }
    }
  }

  return nextRunAt ?? Date.now() + config.liveScorePollIntervalMs;
}

function getActiveMatches(
  matches: readonly MatchRow[],
  now: Date,
  latestSnapshotsByMatchId: ReadonlyMap<number, LatestLiveScoreSnapshotRow>
): MatchRow[] {
  const nowTime = now.getTime();

  return matches.filter((match) => {
    if (match.is_postponed === 1) {
      return false;
    }

    if (match.released_for_predictions !== 1) {
      return false;
    }

    if (hasFinalScore(match) && !isLiveByProvider(latestSnapshotsByMatchId.get(match.id))) {
      return false;
    }

    if (isFinishedByProvider(latestSnapshotsByMatchId.get(match.id))) {
      return false;
    }

    const kickoffTime = Date.parse(match.kickoff_at);

    return kickoffTime <= nowTime + config.liveScoreKickoffBufferMs;
  });
}

async function calculateNextRunAt(
  competitionId: number,
  matches: readonly MatchRow[],
  now: Date,
  hasLiveMatches: boolean,
  latestSnapshotsByMatchId: ReadonlyMap<number, LatestLiveScoreSnapshotRow>
): Promise<string | null> {
  if (hasLiveMatches) {
    return new Date(now.getTime() + config.liveScorePollIntervalMs).toISOString();
  }

  const nextKickoff = matches
    .filter((match) => {
      const latestSnapshot = latestSnapshotsByMatchId.get(match.id);

      return (
        match.is_postponed !== 1 &&
        match.released_for_predictions === 1 &&
        (!hasFinalScore(match) || isLiveByProvider(latestSnapshot)) &&
        !isFinishedByProvider(latestSnapshot)
      );
    })
    .map((match) => Date.parse(match.kickoff_at))
    .filter((kickoffTime) => Number.isFinite(kickoffTime))
    .sort((first, second) => first - second)[0];

  if (!nextKickoff) {
    return calculateNoReleasedMatchNextRunAt(competitionId, now);
  }

  const bufferedKickoffTime = nextKickoff - config.liveScoreKickoffBufferMs;
  const nextRunTime =
    bufferedKickoffTime > now.getTime()
      ? bufferedKickoffTime
      : now.getTime() + config.liveScorePollIntervalMs;

  return new Date(nextRunTime).toISOString();
}

async function calculateNoReleasedMatchNextRunAt(competitionId: number, now: Date): Promise<string> {
  const autoImportSnapshot = await getAutoMatchImportJobSnapshot(competitionId);
  const fallbackRetryAt = now.getTime() + noReleasedMatchRetryMs;

  if (!autoImportSnapshot.enabled || !autoImportSnapshot.nextRunAt) {
    return new Date(fallbackRetryAt).toISOString();
  }

  if (shouldRetryAfterUnreleasedAutoImport(autoImportSnapshot, now)) {
    return new Date(fallbackRetryAt).toISOString();
  }

  const autoImportNextRunAt = Date.parse(autoImportSnapshot.nextRunAt);

  if (!Number.isFinite(autoImportNextRunAt)) {
    return new Date(fallbackRetryAt).toISOString();
  }

  return new Date(Math.max(autoImportNextRunAt + autoImportLiveScoreDelayMs, now.getTime() + schedulerMinimumDelayMs)).toISOString();
}

function shouldRetryAfterUnreleasedAutoImport(
  autoImportSnapshot: Awaited<ReturnType<typeof getAutoMatchImportJobSnapshot>>,
  now: Date
): boolean {
  const lastRun = autoImportSnapshot.lastRun;

  if (!lastRun || lastRun.released) {
    return false;
  }

  const lastFinishedAt = Date.parse(lastRun.finishedAt);
  const autoImportNextRunAt = autoImportSnapshot.nextRunAt ? Date.parse(autoImportSnapshot.nextRunAt) : null;

  return (
    Number.isFinite(lastFinishedAt) &&
    lastFinishedAt <= now.getTime() &&
    (typeof autoImportNextRunAt !== 'number' ||
      !Number.isFinite(autoImportNextRunAt) ||
      autoImportNextRunAt > now.getTime() + noReleasedMatchRetryMs)
  );
}

function isFinishedByProvider(snapshot: LatestLiveScoreSnapshotRow | undefined): boolean {
  return snapshot?.status === 'finished' && snapshot.home_score !== null && snapshot.away_score !== null;
}

function isLiveByProvider(snapshot: LatestLiveScoreSnapshotRow | undefined): boolean {
  return snapshot?.status === 'live';
}

function hasFinalScore(match: Pick<MatchRow, 'final_home_score' | 'final_away_score'>): boolean {
  return match.final_home_score !== null && match.final_away_score !== null;
}

function shouldApplyProviderScore(
  providerScore: ProviderLiveScore,
  latestSnapshot: LatestLiveScoreSnapshotRow | undefined
): boolean {
  if (providerScore.status === 'finished') {
    return true;
  }

  return (
    latestSnapshot?.home_score === providerScore.homeScore &&
    latestSnapshot.away_score === providerScore.awayScore &&
    latestSnapshot.status === providerScore.status
  );
}

function mapProviderScoresToMatches(matches: readonly MatchRow[], scores: readonly ProviderLiveScore[]) {
  const mapped: Array<{ readonly match: MatchRow; readonly providerScore: ProviderLiveScore }> = [];
  const scoresByTeamKey = new Map<string, ProviderLiveScore[]>();

  for (const score of scores) {
    const key = toTeamKey(score.homeTeamName, score.awayTeamName);
    scoresByTeamKey.set(key, [...(scoresByTeamKey.get(key) ?? []), score]);
  }

  for (const match of matches) {
    const candidates = scoresByTeamKey.get(toTeamKey(getResolvedHomeTeamName(match), getResolvedAwayTeamName(match))) ?? [];
    const matchKickoffTime = Date.parse(match.kickoff_at);
    const providerScore =
      candidates.find((score) => {
        if (!score.kickoffAt) {
          return true;
        }

        return Math.abs(Date.parse(score.kickoffAt) - matchKickoffTime) <= 3 * 60 * 60 * 1000;
      }) ?? null;

    if (providerScore) {
      mapped.push({ match, providerScore });
    }
  }

  return mapped;
}

async function fetchLiveScoresWithRetry(sourceUrl: string): Promise<ProviderLiveScore[]> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= liveScoreFetchAttempts; attempt += 1) {
    try {
      return await withTimeout(fetchOddsPortalLiveScores(sourceUrl), liveScoreFetchTimeoutMs);
    } catch (error) {
      lastError = error;

      if (attempt < liveScoreFetchAttempts) {
        await delay(liveScoreFetchRetryDelayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Live score fetch failed after all retry attempts.');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Live score fetch timed out after ${timeoutMs / 1000} seconds.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function getSchedulerStatus(enabled: boolean, activeMatchCount: number): 'disabled' | 'polling_live_match' | 'waiting_for_next_match' {
  if (!enabled) {
    return 'disabled';
  }

  return activeMatchCount > 0 ? 'polling_live_match' : 'waiting_for_next_match';
}

function isLiveScoreSyncEnabled(
  competition: ReturnType<typeof findCompetitionForAdmin>
): boolean {
  return competition?.live_score_sync_enabled === 1 && competition.is_finished === 0;
}

function toRunInput(report: LiveScoreRunReport) {
  return {
    competitionId: report.competitionId,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    status: report.status,
    checkedMatches: report.checkedMatches,
    updatedMatches: report.updatedMatches,
    liveMatches: report.liveMatches,
    finishedMatches: report.finishedMatches,
    nextRunAt: report.nextRunAt,
    errorMessage: report.errorMessage
  };
}

function toRunReport(row: ReturnType<typeof findLastLiveScoreJobRunForCompetition>): LiveScoreRunReport | null {
  return row ? toRunReportFromRow(row) : null;
}

function toRunReportFromRow(row: NonNullable<ReturnType<typeof findLastLiveScoreJobRunForCompetition>>): LiveScoreRunReport {
  return {
    runId: row.id,
    competitionId: row.competition_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    enabled: true,
    status: row.status,
    checkedMatches: row.checked_matches,
    updatedMatches: row.updated_matches,
    liveMatches: row.live_matches,
    finishedMatches: row.finished_matches,
    nextRunAt: row.next_run_at,
    errorMessage: row.error_message
  };
}

function toUtcIsoString(value: string): string {
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  return `${value.replace(' ', 'T')}Z`;
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
