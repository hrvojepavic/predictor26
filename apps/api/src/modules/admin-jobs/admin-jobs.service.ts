import {
  getNotificationReminderJobSnapshot,
  sendDuePredictionRemindersForCompetition
} from '../notifications/notifications.service.js';
import {
  getLiveScoreJobSnapshot,
  rescheduleLiveScoreScheduler,
  runLiveScoreSyncNow,
  setLiveScoreSyncEnabled
} from '../live-scores/live-scores.service.js';
import {
  getAutoMatchImportJobSnapshot,
  runAutoMatchImportNow,
  updateAutoMatchImportJobSettings
} from '../admin-matches/admin-matches.service.js';
import { getSuperAdminUser } from '../../database/queries/users.queries.js';
import { verifyPassword } from '../../shared/utils/password.js';
import {
  AdminJobDetailsResponse,
  AdminJobsResponse,
  AdminAutoMatchImportJobDetailsResponse,
  AdminNotificationReminderJobDetailsResponse,
  RunAdminJobResponse,
  UpdateAutoMatchImportJobSettingsRequest
} from './admin-jobs.interfaces.js';

const notificationReminderJobId = 'prediction-reminders';
const liveScoreSyncJobId = 'live-score-sync';
const autoMatchImportJobId = 'auto-match-import';
const secretCodeMaxLength = 128;

export type RunAdminJobResult =
  | {
      readonly status: 'ran';
      readonly response: RunAdminJobResponse;
    }
  | {
      readonly status: 'not_found';
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export type UpdateAdminJobEnabledResult =
  | {
      readonly status: 'updated';
      readonly response: AdminJobDetailsResponse;
    }
  | {
      readonly status: 'not_found';
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export type UpdateAutoMatchImportJobSettingsResult =
  | {
      readonly status: 'updated';
      readonly response: AdminJobDetailsResponse;
    }
  | {
      readonly status: 'not_found';
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export async function getAdminJobs(competitionId: number): Promise<AdminJobsResponse> {
  const notificationJob = await getNotificationReminderJobDetails(competitionId);
  const liveScoreJob = await getLiveScoreJobDetails(competitionId);
  const autoMatchImportJob = await getAutoMatchImportJobDetails(competitionId);

  return {
    jobs: [
      {
        id: notificationJob.id,
        name: notificationJob.name,
        description: notificationJob.description,
        enabled: notificationJob.enabled,
        intervalMs: notificationJob.intervalMs,
        lastRun: notificationJob.lastRun
      },
      {
        id: liveScoreJob.id,
        name: liveScoreJob.name,
        description: liveScoreJob.description,
        enabled: liveScoreJob.enabled,
        intervalMs: liveScoreJob.intervalMs,
        lastRun: liveScoreJob.lastRun
      },
      {
        id: autoMatchImportJob.id,
        name: autoMatchImportJob.name,
        description: autoMatchImportJob.description,
        enabled: autoMatchImportJob.enabled,
        intervalMs: autoMatchImportJob.intervalMs,
        lastRun: autoMatchImportJob.lastRun
      }
    ]
  };
}

export async function getAdminJob(competitionId: number, jobId: string): Promise<AdminJobDetailsResponse | null> {
  if (jobId === notificationReminderJobId) {
    return {
      job: await getNotificationReminderJobDetails(competitionId)
    };
  }

  if (jobId === liveScoreSyncJobId) {
    return {
      job: await getLiveScoreJobDetails(competitionId)
    };
  }

  if (jobId === autoMatchImportJobId) {
    return {
      job: await getAutoMatchImportJobDetails(competitionId)
    };
  }

  return null;
}

export async function runAdminJob(
  competitionId: number,
  jobId: string,
  input: { readonly secretCode?: unknown } | undefined
): Promise<RunAdminJobResult> {
  if (jobId !== notificationReminderJobId && jobId !== liveScoreSyncJobId && jobId !== autoMatchImportJobId) {
    return { status: 'not_found' };
  }

  if (
    typeof input?.secretCode !== 'string' ||
    input.secretCode.length < 1 ||
    input.secretCode.length > secretCodeMaxLength
  ) {
    return { status: 'invalid' };
  }

  if (!(await isValidSecretCode(input.secretCode))) {
    return { status: 'invalid_secret' };
  }

  if (jobId === notificationReminderJobId) {
    const run = await sendDuePredictionRemindersForCompetition(competitionId);

    return {
      status: 'ran',
      response: {
        run,
        job: await getNotificationReminderJobDetails(competitionId)
      }
    };
  }

  if (jobId === autoMatchImportJobId) {
    const autoRun = await runAutoMatchImportNow(competitionId);
    rescheduleLiveScoreScheduler(competitionId);

    return {
      status: 'ran',
      response: {
        run: autoRun,
        job: await getAutoMatchImportJobDetails(competitionId)
      }
    };
  }

  const run = await runLiveScoreSyncNow(competitionId);

  return {
    status: 'ran',
    response: {
      run,
      job: await getLiveScoreJobDetails(competitionId)
    }
  };
}

export async function updateAdminJobEnabled(
  competitionId: number,
  jobId: string,
  input: { readonly enabled?: unknown; readonly secretCode?: unknown } | undefined
): Promise<UpdateAdminJobEnabledResult> {
  if (jobId !== liveScoreSyncJobId && jobId !== autoMatchImportJobId) {
    return { status: 'not_found' };
  }

  if (
    typeof input?.enabled !== 'boolean' ||
    typeof input.secretCode !== 'string' ||
    input.secretCode.length < 1 ||
    input.secretCode.length > secretCodeMaxLength
  ) {
    return { status: 'invalid' };
  }

  if (!(await isValidSecretCode(input.secretCode))) {
    return { status: 'invalid_secret' };
  }

  if (jobId === autoMatchImportJobId) {
    const current = await getAutoMatchImportJobSnapshot(competitionId);
    const snapshot = await updateAutoMatchImportJobSettings(competitionId, {
      enabled: input.enabled,
      weekday: current.weekday,
      time: current.time,
      timeZone: current.timeZone
    });

    if (!snapshot) {
      return { status: 'invalid' };
    }

    rescheduleLiveScoreScheduler(competitionId);

    return {
      status: 'updated',
      response: {
        job: await getAutoMatchImportJobDetails(competitionId)
      }
    };
  }

  setLiveScoreSyncEnabled(competitionId, input.enabled);

  return {
    status: 'updated',
    response: {
      job: await getLiveScoreJobDetails(competitionId)
    }
  };
}

export async function updateAutoMatchImportJob(
  competitionId: number,
  jobId: string,
  input: Partial<UpdateAutoMatchImportJobSettingsRequest> | undefined
): Promise<UpdateAutoMatchImportJobSettingsResult> {
  if (jobId !== autoMatchImportJobId) {
    return { status: 'not_found' };
  }

  if (
    typeof input?.enabled !== 'boolean' ||
    typeof input.weekday !== 'number' ||
    typeof input.time !== 'string' ||
    typeof input.timeZone !== 'string' ||
    typeof input.secretCode !== 'string' ||
    input.secretCode.length < 1 ||
    input.secretCode.length > secretCodeMaxLength
  ) {
    return { status: 'invalid' };
  }

  if (!(await isValidSecretCode(input.secretCode))) {
    return { status: 'invalid_secret' };
  }

  const snapshot = await updateAutoMatchImportJobSettings(competitionId, {
    enabled: input.enabled,
    weekday: input.weekday,
    time: input.time,
    timeZone: input.timeZone
  });

  if (!snapshot) {
    return { status: 'invalid' };
  }

  rescheduleLiveScoreScheduler(competitionId);

  return {
    status: 'updated',
    response: {
      job: await getAutoMatchImportJobDetails(competitionId)
    }
  };
}

async function getNotificationReminderJobDetails(competitionId: number): Promise<AdminNotificationReminderJobDetailsResponse> {
  const snapshot = await getNotificationReminderJobSnapshot(competitionId);

  return {
    id: notificationReminderJobId,
    name: 'Prediction reminders',
    description: 'Checks for users who still need predictions and sends 9h and 1h web push reminders.',
    enabled: snapshot.enabled,
    intervalMs: snapshot.intervalMs,
    lastRun: snapshot.lastRun,
    usersToNotifyNowCount: snapshot.usersToNotifyNowCount,
    dueUsers: snapshot.dueUsers,
    recentDeliveries: snapshot.recentDeliveries,
    recentAttempts: snapshot.recentAttempts
  };
}

async function getLiveScoreJobDetails(competitionId: number) {
  const snapshot = await getLiveScoreJobSnapshot(competitionId);

  return {
    id: liveScoreSyncJobId,
    name: 'Live score sync',
    description: 'Checks OddsPortal near live matches, records score history, and applies fetched scores to match final scores.',
    enabled: snapshot.enabled,
    intervalMs: snapshot.intervalMs,
    lastRun: snapshot.lastRun,
    status: snapshot.status,
    nextRunAt: snapshot.nextRunAt,
    activeMatches: snapshot.activeMatches,
    recentRuns: snapshot.recentRuns,
    recentUpdates: snapshot.recentUpdates
  };
}

async function getAutoMatchImportJobDetails(competitionId: number): Promise<AdminAutoMatchImportJobDetailsResponse> {
  const snapshot = await getAutoMatchImportJobSnapshot(competitionId);

  return {
    id: autoMatchImportJobId,
    name: 'Match and odds import',
    description: 'Imports upcoming fixtures and odds on the configured weekly local schedule, then releases complete weeks for predictions.',
    enabled: snapshot.enabled,
    intervalMs: 7 * 24 * 60 * 60 * 1_000,
    lastRun: snapshot.lastRun,
    weekday: snapshot.weekday,
    time: snapshot.time,
    timeZone: snapshot.timeZone,
    nextRunAt: snapshot.nextRunAt
  };
}

async function isValidSecretCode(secretCode: string): Promise<boolean> {
  const superAdmin = await getSuperAdminUser();

  return Boolean(superAdmin && verifyPassword(secretCode, superAdmin.password_hash));
}
