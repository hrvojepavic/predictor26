import 'dotenv/config';

import cors from 'cors';
import express from 'express';

import { config } from './config/index.js';
import { adminJobsRoutes } from './modules/admin-jobs/admin-jobs.routes.js';
import { adminMatchesRoutes } from './modules/admin-matches/admin-matches.routes.js';
import { adminPaymentsRoutes } from './modules/admin-payments/admin-payments.routes.js';
import { adminTeamsRoutes } from './modules/admin-teams/admin-teams.routes.js';
import { adminUsersRoutes } from './modules/admin-users/admin-users.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { competitionsRoutes } from './modules/competitions/competitions.routes.js';
import { competitionSettingsRoutes } from './modules/competition-settings/competition-settings.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { contentLocalizationRoutes } from './modules/content-localization/content-localization.routes.js';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes.js';
import { matchesRoutes } from './modules/matches/matches.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { sendRoundOpeningNotifications, startNotificationReminderScheduler } from './modules/notifications/notifications.service.js';
import { startLiveScoreScheduler } from './modules/live-scores/live-scores.service.js';
import { startAutoMatchImportScheduler } from './modules/admin-matches/admin-matches.service.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/assets/team-logos', express.static(config.teamLogoAssetsPath));

app.use('/api', authRoutes);
app.use('/api', competitionsRoutes);
app.use('/api', competitionSettingsRoutes);
app.use('/api', matchesRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', paymentsRoutes);
app.use('/api', leaderboardRoutes);
app.use('/api', adminJobsRoutes);
app.use('/api', adminMatchesRoutes);
app.use('/api', adminPaymentsRoutes);
app.use('/api', adminTeamsRoutes);
app.use('/api', adminUsersRoutes);
app.use('/api', healthRoutes);
app.use('/api', contentLocalizationRoutes);

app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});

startNotificationReminderScheduler();
void sendRoundOpeningNotifications();
startLiveScoreScheduler();
startAutoMatchImportScheduler();
