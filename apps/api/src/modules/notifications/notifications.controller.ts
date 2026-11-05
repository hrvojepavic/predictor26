import { NextFunction, Request, Response } from 'express';

import { SavePushSubscriptionRequest, UpdateNotificationSettingsRequest } from './notifications.interfaces.js';
import {
  getNotificationConfig,
  getNotificationSettings,
  getUserNotificationPreferences,
  removeUserNotificationBrowser,
  updateUserNotificationPreferences,
  savePushSubscription,
  sendTestNotification,
  updateNotificationSettings
} from './notifications.service.js';
import { resolveCompetitionIdForAdmin, resolveCompetitionIdForViewer } from '../competitions/competitions.service.js';

export async function getNotificationConfigController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitionId = await resolveRequestedCompetitionIdForUser(req);

    if (competitionId === null) {
      res.status(403).json({ message: 'Competition access is required.' });
      return;
    }

    res.json(await getNotificationConfig(competitionId));
  } catch (error) {
    next(error);
  }
}

export async function savePushSubscriptionController(
  req: Request<object, object, SavePushSubscriptionRequest>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const saved = await savePushSubscription(req.authUser!.id, req.body, req.get('user-agent') ?? null);

    if (!saved) {
      res.status(400).json({ message: 'Invalid push subscription.' });
      return;
    }

    res.status(201).json({ subscribed: true });
  } catch (error) {
    next(error);
  }
}

export async function getNotificationSettingsController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitionId = await resolveRequestedCompetitionIdForAdmin(req);

    if (competitionId === null) {
      res.status(403).json({ message: 'Competition access is required.' });
      return;
    }

    res.json(await getNotificationSettings(competitionId));
  } catch (error) {
    next(error);
  }
}

export async function updateNotificationSettingsController(
  req: Request<object, object, UpdateNotificationSettingsRequest>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const competitionId = await resolveRequestedCompetitionIdForAdmin(req);

    if (competitionId === null) {
      res.status(403).json({ message: 'Competition access is required.' });
      return;
    }

    const result = await updateNotificationSettings(competitionId, req.body);

    if (result.status === 'invalid') {
      res.status(400).json({ message: 'Please enter valid notification settings.' });
      return;
    }

    if (result.status === 'invalid_secret') {
      res.status(403).json({ message: 'Secret code is incorrect.' });
      return;
    }

    res.json(result.settings);
  } catch (error) {
    next(error);
  }
}

async function resolveRequestedCompetitionIdForUser(req: Pick<Request, 'header' | 'authUser'>): Promise<number | null> {
  const requestedCompetitionId = readCompetitionHeader(req);

  if (requestedCompetitionId === undefined) {
    return null;
  }

  return resolveCompetitionIdForViewer(req.authUser!.id, req.authUser!.role, requestedCompetitionId);
}

async function resolveRequestedCompetitionIdForAdmin(req: Pick<Request, 'header' | 'authUser'>): Promise<number | null> {
  const requestedCompetitionId = readCompetitionHeader(req);

  if (requestedCompetitionId === undefined) {
    return null;
  }

  return resolveCompetitionIdForAdmin(req.authUser!.id, req.authUser!.role, requestedCompetitionId);
}

function readCompetitionHeader(req: Pick<Request, 'header'>): number | null | undefined {
  const headerValue = req.header('x-competition-id');

  if (!headerValue) {
    return null;
  }

  const competitionId = Number(headerValue);
  return Number.isInteger(competitionId) && competitionId > 0 ? competitionId : undefined;
}

export async function sendTestNotificationController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const competitionId = await resolveRequestedCompetitionIdForAdmin(req);
    if (competitionId === null) {
      res.status(403).json({ message: 'Competition admin access is required.' });
      return;
    }
    res.json(await sendTestNotification(req.authUser!.id, competitionId));
  } catch (error) {
    next(error);
  }
}

// Preferences always require an explicit competition; never fall back to another league.
async function resolvePreferenceCompetition(req: Request): Promise<number | null> {
  const id = Number(req.params.competitionId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return resolveCompetitionIdForViewer(req.authUser!.id, req.authUser!.role, id);
}

export async function getNotificationPreferencesController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = await resolvePreferenceCompetition(req);
    if (id === null) { res.status(403).json({ message: 'Competition access is required.' }); return; }
    res.json(getUserNotificationPreferences(req.authUser!.id, id));
  } catch (error) { next(error); }
}

export async function updateNotificationPreferencesController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = await resolvePreferenceCompetition(req);
    if (id === null) { res.status(403).json({ message: 'Competition access is required.' }); return; }
    const result = updateUserNotificationPreferences(req.authUser!.id, id, req.body);
    if (!result) { res.status(400).json({ message: 'Notification preferences must be boolean values.' }); return; }
    res.json(result);
  } catch (error) { next(error); }
}

export async function addNotificationBrowserController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = await resolvePreferenceCompetition(req);
    if (id === null) { res.status(403).json({ message: 'Competition access is required.' }); return; }
    const saved = await savePushSubscription(req.authUser!.id, req.body, req.get('user-agent') ?? null, id);
    if (!saved) { res.status(400).json({ message: 'Invalid push subscription.' }); return; }
    res.status(201).json(getUserNotificationPreferences(req.authUser!.id, id));
  } catch (error) { next(error); }
}

export async function removeNotificationBrowserController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = await resolvePreferenceCompetition(req);
    if (id === null) { res.status(403).json({ message: 'Competition access is required.' }); return; }
    const browserId = Number(req.params.browserId);
    if (!Number.isSafeInteger(browserId) || browserId <= 0) { res.status(400).json({ message: 'Invalid browser.' }); return; }
    const result = removeUserNotificationBrowser(req.authUser!.id, id, browserId);
    if (result !== 'removed') {
      res.status(result === 'last_browser' ? 409 : 404).json({ message: result === 'last_browser' ? 'Keep at least one browser.' : 'Browser not found.' });
      return;
    }
    res.json(getUserNotificationPreferences(req.authUser!.id, id));
  } catch (error) { next(error); }
}
