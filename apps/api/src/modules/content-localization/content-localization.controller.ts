import type { Request, Response } from 'express';
import { createContentRule, getContentLocalization, updateApplicationLanguage, updateContentTranslation } from './content-localization.service.js';

export function createContentRuleController(req: Request, res: Response): void {
  if (!createContentRule(req.body)) {
    res.status(400).json({ message: 'Provide English rule text and matching translations. Only {{value}} is supported; it requires a value label.' }); return;
  }
  res.status(201).json(getContentLocalization(true));
}

export function getContentLocalizationController(_req: Request, res: Response): void {
  res.json(getContentLocalization());
}
export function getAdminContentLocalizationController(_req: Request, res: Response): void {
  res.json(getContentLocalization(true));
}
export function updateApplicationLanguageController(req: Request, res: Response): void {
  if (!updateApplicationLanguage(req.body)) { res.status(400).json({ message: 'Invalid language. English must remain enabled.' }); return; }
  res.json(getContentLocalization(true));
}
export function updateContentTranslationController(req: Request, res: Response): void {
  if (!updateContentTranslation(req.body)) { res.status(400).json({ message: 'Invalid translation. Keep the original placeholders and an English fallback.' }); return; }
  res.json(getContentLocalization(true));
}
