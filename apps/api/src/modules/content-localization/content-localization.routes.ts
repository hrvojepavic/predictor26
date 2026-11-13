import { Router } from 'express';
import { requireRoles } from '../../shared/middleware/require-auth.middleware.js';
import { createContentRuleController } from './content-localization.controller.js';
import { getAdminContentLocalizationController, getContentLocalizationController, updateApplicationLanguageController, updateContentTranslationController } from './content-localization.controller.js';

export const contentLocalizationRoutes = Router();
contentLocalizationRoutes.get('/content-localization', getContentLocalizationController);
contentLocalizationRoutes.post('/admin/content-rules', requireRoles(['super_admin']), createContentRuleController);
contentLocalizationRoutes.get('/admin/content-localization', requireRoles(['super_admin']), getAdminContentLocalizationController);
contentLocalizationRoutes.put('/admin/languages', requireRoles(['super_admin']), updateApplicationLanguageController);
contentLocalizationRoutes.put('/admin/content-translations', requireRoles(['super_admin']), updateContentTranslationController);
