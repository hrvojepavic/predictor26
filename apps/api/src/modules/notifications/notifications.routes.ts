import { Router } from 'express';

import { requireAuth } from '../../shared/middleware/require-auth.middleware.js';
import {
  getNotificationConfigController,
  addNotificationBrowserController,
  removeNotificationBrowserController,
  getNotificationSettingsController,
  getNotificationPreferencesController,
  updateNotificationPreferencesController,
  savePushSubscriptionController,
  sendTestNotificationController,
  updateNotificationSettingsController
} from './notifications.controller.js';

export const notificationsRoutes = Router();

notificationsRoutes.get('/notifications/config', requireAuth, getNotificationConfigController);
notificationsRoutes.post('/notifications/subscriptions', requireAuth, savePushSubscriptionController);
notificationsRoutes.get('/admin/notifications/settings', requireAuth, getNotificationSettingsController);
notificationsRoutes.patch('/admin/notifications/settings', requireAuth, updateNotificationSettingsController);
notificationsRoutes.post('/admin/notifications/test', requireAuth, sendTestNotificationController);

notificationsRoutes.get('/competitions/:competitionId/notification-preferences', requireAuth, getNotificationPreferencesController);
notificationsRoutes.put('/competitions/:competitionId/notification-preferences', requireAuth, updateNotificationPreferencesController);

notificationsRoutes.post('/competitions/:competitionId/notification-browsers', requireAuth, addNotificationBrowserController);
notificationsRoutes.delete('/competitions/:competitionId/notification-browsers/:browserId', requireAuth, removeNotificationBrowserController);
