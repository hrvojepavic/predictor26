import { getContentLocalization } from '../content-localization/content-localization.service.js';
import type { LocalizedString } from '../content-localization/content-localization.interfaces.js';
import {
  AdminCompetitionSettingsResponse,
  AdminRuleTemplatesResponse,
  CompetitionTeamsResponse,
  CompetitionRulesResponse,
  DefaultCompetitionRulesResponse,
  CompetitionResponse,
  CompetitionsResponse,
  CreateAdminCompetitionRequest,
  JoinCompetitionRequest,
  JoinCompetitionResponse,
  UpdateAdminCompetitionSettingsRequest,
  UpdateCompetitionTiebreakerRequest,
  UpdateCompetitionTiebreakerResponse
} from './competitions.interfaces.js';
import { getSuperAdminUser, UserRole } from '../../database/queries/users.queries.js';
import { verifyPassword } from '../../shared/utils/password.js';
import { hashPassword } from '../../shared/utils/password.js';
import {
  addCompetition,
  findCompetitionBySlug,
  findCompetitionForUser,
  findCompetitionForAdmin,
  findCompetitionForAdminUser,
  findCompetitionRules,
  findCompetitionTeams,
  findCompetitionsForUser,
  findCompetitionsForAdmin,
  findCompetitionsForAdminUser,
  findDefaultCompetition,
  findDefaultCompetitionForUser,
  joinCompetitionForUser,
  findRuleTemplates,
  setCompetitionManagementSettings,
  setCompetitionTiebreaker
} from './competitions.repository.js';
import { rescheduleAutoMatchImportScheduler } from '../admin-matches/admin-matches.service.js';

export type UpdateCompetitionTiebreakerResult =
  | {
      readonly status: 'updated';
      readonly response: UpdateCompetitionTiebreakerResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'not_found';
    };

export type UpdateAdminCompetitionSettingsResult =
  | {
      readonly status: 'updated';
      readonly settings: AdminCompetitionSettingsResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    }
  | {
      readonly status: 'not_found';
    };

export type CreateAdminCompetitionResult =
  | {
      readonly status: 'created';
      readonly competition: CompetitionResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_secret';
    };

export type JoinCompetitionResult =
  | {
      readonly status: 'joined';
      readonly response: JoinCompetitionResponse;
    }
  | {
      readonly status: 'invalid';
    }
  | {
      readonly status: 'invalid_passcode';
    }
  | {
      readonly status: 'not_found';
    }
  | {
      readonly status: 'finished';
    }
  | {
      readonly status: 'forbidden';
    };

export async function getCompetitionsForUser(userId: number, role: UserRole): Promise<CompetitionsResponse> {
  if (role === 'super_admin') {
    return {
      competitions: findCompetitionsForAdmin().map(toCompetitionResponse)
    };
  }

  return {
    competitions: findCompetitionsForUser(userId).map(toCompetitionResponse)
  };
}

export async function getCompetitionsForAdmin(userId: number, role: UserRole): Promise<CompetitionsResponse> {
  if (role !== 'super_admin') {
    return {
      competitions: findCompetitionsForAdminUser(userId).map(toCompetitionResponse)
    };
  }

  return {
    competitions: findCompetitionsForAdmin().map(toCompetitionResponse)
  };
}

export async function resolveCompetitionIdForUser(userId: number, competitionId: number | null): Promise<number | null> {
  if (competitionId !== null) {
    return findCompetitionForUser(userId, competitionId)?.id ?? null;
  }

  return findDefaultCompetitionForUser(userId)?.id ?? null;
}

export async function joinCompetition(
  userId: number,
  role: UserRole,
  competitionId: number,
  input: Partial<JoinCompetitionRequest> | undefined
): Promise<JoinCompetitionResult> {
  if (role === 'super_admin') {
    return { status: 'forbidden' };
  }

  if (
    !Number.isInteger(competitionId) ||
    competitionId < 1 ||
    typeof input?.passcode !== 'string' ||
    input.passcode.trim().length < 1 ||
    input.passcode.length > 120
  ) {
    return { status: 'invalid' };
  }

  const competition = findCompetitionForAdmin(competitionId);

  if (!competition) {
    return { status: 'not_found' };
  }

  if (competition.is_finished === 1) {
    return { status: 'finished' };
  }

  if (!competition.passcode_hash || !verifyPassword(input.passcode.trim(), competition.passcode_hash)) {
    return { status: 'invalid_passcode' };
  }

  const joinedCompetition = joinCompetitionForUser(userId, competitionId);

  if (!joinedCompetition) {
    return { status: 'not_found' };
  }

  return {
    status: 'joined',
    response: {
      competition: toCompetitionResponse(joinedCompetition)
    }
  };
}

export async function resolveCompetitionIdForViewer(
  userId: number,
  role: UserRole,
  competitionId: number | null
): Promise<number | null> {
  if (role === 'super_admin') {
    if (competitionId !== null) {
      return findCompetitionForAdmin(competitionId)?.id ?? null;
    }

    return findCompetitionsForAdmin()[0]?.id ?? null;
  }

  return resolveCompetitionIdForUser(userId, competitionId);
}

export async function resolveCompetitionIdForAdmin(
  userId: number,
  role: UserRole,
  competitionId: number | null
): Promise<number | null> {
  if (role === 'super_admin') {
    if (competitionId !== null) {
      return findCompetitionForAdmin(competitionId)?.id ?? null;
    }

    return findCompetitionsForAdmin()[0]?.id ?? null;
  }

  if (competitionId !== null) {
    return findCompetitionForAdminUser(userId, competitionId)?.id ?? null;
  }

  return findCompetitionsForAdminUser(userId)[0]?.id ?? null;
}

export async function updateTiebreakerForUser(
  userId: number,
  competitionId: number | null,
  input: Partial<UpdateCompetitionTiebreakerRequest> | undefined
): Promise<UpdateCompetitionTiebreakerResult> {
  if (typeof input?.tiebreakerName !== 'string') {
    return { status: 'invalid' };
  }

  const resolvedCompetitionId = await resolveCompetitionIdForUser(userId, competitionId);
  const tiebreakerName = input.tiebreakerName.trim();

  if (
    resolvedCompetitionId === null ||
    tiebreakerName.length < 1 ||
    tiebreakerName.length > 80 ||
    !findCompetitionTeams(resolvedCompetitionId).some((team) => team.name === tiebreakerName)
  ) {
    return { status: 'invalid' };
  }

  const competition = setCompetitionTiebreaker(userId, resolvedCompetitionId, tiebreakerName);

  if (!competition) {
    return { status: 'not_found' };
  }

  return {
    status: 'updated',
    response: {
      competition: toCompetitionResponse(competition)
    }
  };
}

export async function getCompetitionTeamsForViewer(
  userId: number,
  role: UserRole,
  competitionId: number | null
): Promise<CompetitionTeamsResponse | null> {
  const resolvedCompetitionId = await resolveCompetitionIdForViewer(userId, role, competitionId);

  if (resolvedCompetitionId === null) {
    return null;
  }

  const teams = findCompetitionTeams(resolvedCompetitionId);

  return {
    teams: teams.map((team) => team.name),
    groupTeams: teams
      .filter((team) => team.groupName)
      .map((team) => ({
        name: team.name,
        flag: team.logoUrl,
        groupName: team.groupName!
      }))
  };
}

export async function getAdminCompetitionSettings(competitionId: number): Promise<AdminCompetitionSettingsResponse | null> {
  const competition = findCompetitionForAdmin(competitionId);

  return competition ? toAdminCompetitionSettingsResponse(competition) : null;
}

export async function getCompetitionRulesForViewer(
  userId: number,
  role: UserRole,
  competitionId: number | null
): Promise<CompetitionRulesResponse | null> {
  const resolvedCompetitionId = await resolveCompetitionIdForViewer(userId, role, competitionId);

  if (resolvedCompetitionId === null) {
    return null;
  }

  const competition = role === 'super_admin' ? findCompetitionForAdmin(resolvedCompetitionId) : findCompetitionForUser(userId, resolvedCompetitionId);

  if (!competition) {
    return null;
  }

  return {
    competition: toCompetitionResponse(competition),
    rules: renderRules(findCompetitionRules(resolvedCompetitionId))
  };
}

export async function getCompetitionRulesForVisibleCompetition(
  userId: number,
  role: UserRole,
  competitionId: number
): Promise<CompetitionRulesResponse | null> {
  if (!Number.isInteger(competitionId) || competitionId < 1) {
    return null;
  }

  const competition =
    role === 'super_admin' || role === 'admin'
      ? findCompetitionForAdmin(competitionId)
      : findCompetitionForUser(userId, competitionId) ?? findCompetitionForAdmin(competitionId);

  if (!competition || (role === 'user' && !competition.is_joined && competition.is_finished === 1)) {
    return null;
  }

  return {
    competition: toCompetitionResponse(competition),
    rules: renderRules(findCompetitionRules(competitionId))
  };
}

export async function getDefaultCompetitionRules(): Promise<DefaultCompetitionRulesResponse> {
  const competition = findDefaultCompetition();
  const rules = competition
    ? renderRules(findCompetitionRules(competition.id))
    : renderRules(findRuleTemplates().map(template => ({ ...template, value: template.default_value })));

  return {
    rules
  };
}

export async function getAdminRuleTemplates(): Promise<AdminRuleTemplatesResponse> {
  return {
    templates: findRuleTemplates().map((template) => ({
      key: template.key,
      textTemplate: template.text_template,
      valueLabel: template.value_label,
      defaultValue: template.default_value
    }))
  };
}

export async function createAdminCompetition(
  input: Partial<CreateAdminCompetitionRequest> | undefined
): Promise<CreateAdminCompetitionResult> {
  const parsed = await parseAdminCompetitionInput(input, true);

  if (parsed.status !== 'valid') {
    return parsed;
  }

  const slug = createUniqueSlug(parsed.name);
  const competition = addCompetition({
    name: parsed.name,
    slug,
    logoUrl: parsed.logoUrl,
    passcodeHash: hashPassword(parsed.passcode!),
    isFinished: parsed.isFinished,
    playoffsEnabled: parsed.playoffsEnabled,
    scheduleSourceUrl: parsed.scheduleSourceUrl,
    oddsSourceUrl: parsed.oddsSourceUrl,
    importMatchesWithOddsEnabled: parsed.importMatchesWithOddsEnabled,
    autoImportMatchesEnabled: parsed.autoImportMatchesEnabled,
    autoImportMatchesWeekday: parsed.autoImportMatchesWeekday,
    autoImportMatchesTime: parsed.autoImportMatchesTime,
    autoImportMatchesTimeZone: parsed.autoImportMatchesTimeZone,
    rules: parsed.rules
  });
  rescheduleAutoMatchImportScheduler();

  return {
    status: 'created',
    competition: toCompetitionResponse(competition)
  };
}

export async function updateAdminCompetitionSettings(
  competitionId: number,
  input: Partial<UpdateAdminCompetitionSettingsRequest> | undefined
): Promise<UpdateAdminCompetitionSettingsResult> {
  const existing = findCompetitionForAdmin(competitionId);

  if (!existing) {
    return { status: 'not_found' };
  }

  const parsed = await parseAdminCompetitionInput(input, false);

  if (parsed.status !== 'valid') {
    return parsed;
  }

  const slug = createUniqueSlug(parsed.name, competitionId);
  const competition = setCompetitionManagementSettings(competitionId, {
    name: parsed.name,
    slug,
    logoUrl: parsed.logoUrl,
    passcodeHash: parsed.passcode ? hashPassword(parsed.passcode) : undefined,
    isFinished: parsed.isFinished,
    playoffsEnabled: parsed.playoffsEnabled,
    scheduleSourceUrl: parsed.scheduleSourceUrl,
    oddsSourceUrl: parsed.oddsSourceUrl,
    importMatchesWithOddsEnabled: parsed.importMatchesWithOddsEnabled,
    autoImportMatchesEnabled: existing.auto_import_matches_enabled === 1,
    autoImportMatchesWeekday: existing.auto_import_matches_weekday,
    autoImportMatchesTime: existing.auto_import_matches_time,
    autoImportMatchesTimeZone: existing.auto_import_matches_time_zone,
    rules: parsed.rules
  });
  rescheduleAutoMatchImportScheduler();

  return {
    status: 'updated',
    settings: toAdminCompetitionSettingsResponse(competition!)
  };
}

function toCompetitionResponse(competition: {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly logo_url: string;
  readonly is_finished: 0 | 1;
  readonly playoffs_enabled: 0 | 1;
  readonly is_joined: 0 | 1;
  readonly tiebreaker_name: string | null;
}): CompetitionResponse {
  return {
    id: competition.id,
    name: competition.name,
    slug: competition.slug,
    logoUrl: competition.logo_url || null,
    isFinished: competition.is_finished === 1,
    playoffsEnabled: competition.playoffs_enabled === 1,
    buyInEur: getCompetitionBuyInEur(competition.id),
    isJoined: competition.is_joined === 1,
    tiebreakerName: competition.tiebreaker_name ?? null
  };
}

function getCompetitionBuyInEur(competitionId: number): number {
  const buyInRule = findCompetitionRules(competitionId).find((rule) => rule.key === 'buy-in');
  const parsedBuyIn = parseMoneyAmount(buyInRule?.value ?? buyInRule?.default_value ?? null);

  return parsedBuyIn ?? 0;
}

function parseMoneyAmount(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);

  if (!match) {
    return null;
  }

  const amount = Number(match[0]);

  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function toAdminCompetitionSettingsResponse(competition: {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly logo_url: string;
  readonly passcode_hash: string | null;
  readonly schedule_source_url: string;
  readonly odds_source_url: string;
  readonly import_matches_with_odds_enabled: 0 | 1;
  readonly auto_import_matches_enabled: 0 | 1;
  readonly auto_import_matches_weekday: number;
  readonly auto_import_matches_time: string;
  readonly auto_import_matches_time_zone: string;
  readonly notification_reminders_enabled: 0 | 1;
  readonly live_score_sync_enabled: 0 | 1;
  readonly is_finished: 0 | 1;
  readonly playoffs_enabled: 0 | 1;
}): AdminCompetitionSettingsResponse {
  return {
    id: competition.id,
    name: competition.name,
    slug: competition.slug,
    logoUrl: competition.logo_url || null,
    isFinished: competition.is_finished === 1,
    playoffsEnabled: competition.playoffs_enabled === 1,
    buyInEur: getCompetitionBuyInEur(competition.id),
    passcodeSet: competition.passcode_hash !== null,
    scheduleSourceUrl: competition.schedule_source_url,
    oddsSourceUrl: competition.odds_source_url,
    importMatchesWithOddsEnabled: competition.import_matches_with_odds_enabled === 1,
    autoImportMatchesEnabled: competition.auto_import_matches_enabled === 1,
    autoImportMatchesWeekday: competition.auto_import_matches_weekday,
    autoImportMatchesTime: competition.auto_import_matches_time,
    autoImportMatchesTimeZone: competition.auto_import_matches_time_zone,
    notificationRemindersEnabled: competition.notification_reminders_enabled === 1,
    liveScoreSyncEnabled: competition.live_score_sync_enabled === 1,
    rules: findCompetitionRules(competition.id).map((rule) => ({
      key: rule.key,
      textTemplate: rule.text_template,
      valueLabel: rule.value_label,
      defaultValue: rule.default_value,
      value: rule.value
    }))
  };
}

function isValidSourceUrl(value: string): boolean {
  if (value.length > 500) {
    return false;
  }

  if (value.length === 0) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidLogoUrl(value: string): boolean {
  if (value.length === 0) {
    return true;
  }

  if (value.length > 200000) {
    return false;
  }

  if (/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(value)) {
    return true;
  }

  if (value.length > 500) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function isValidSecretCode(secretCode: string): Promise<boolean> {
  const superAdmin = await getSuperAdminUser();

  return Boolean(superAdmin && verifyPassword(secretCode, superAdmin.password_hash));
}

async function parseAdminCompetitionInput(
  input: Partial<CreateAdminCompetitionRequest | UpdateAdminCompetitionSettingsRequest> | undefined,
  requirePasscode: boolean
): Promise<
  | {
      readonly status: 'valid';
      readonly name: string;
      readonly logoUrl: string;
      readonly passcode: string | null;
      readonly isFinished: boolean;
      readonly playoffsEnabled: boolean;
      readonly scheduleSourceUrl: string;
      readonly oddsSourceUrl: string;
      readonly importMatchesWithOddsEnabled: boolean;
      readonly autoImportMatchesEnabled: boolean;
      readonly autoImportMatchesWeekday: number;
      readonly autoImportMatchesTime: string;
      readonly autoImportMatchesTimeZone: string;
      readonly rules: ReadonlyArray<{ readonly templateKey: string; readonly value: string | null; readonly sortOrder: number }>;
    }
  | { readonly status: 'invalid' }
  | { readonly status: 'invalid_secret' }
> {
  if (
    typeof input?.name !== 'string' ||
    typeof input.isFinished !== 'boolean' ||
    typeof input.oddsSourceUrl !== 'string' ||
    typeof input.secretCode !== 'string' ||
    input.secretCode.length < 1 ||
    input.secretCode.length > 128 ||
    !Array.isArray(input.rules)
  ) {
    return { status: 'invalid' };
  }

  const name = input.name.trim();
  const logoUrl = typeof input.logoUrl === 'string' ? input.logoUrl.trim() : '';
  const passcode = typeof input.passcode === 'string' ? input.passcode.trim() : null;
  const playoffsEnabled = typeof input.playoffsEnabled === 'boolean' ? input.playoffsEnabled : false;
  const importMatchesWithOddsEnabled = typeof input.importMatchesWithOddsEnabled === 'boolean' ? input.importMatchesWithOddsEnabled : false;
  const autoImportMatchesEnabled = typeof input.autoImportMatchesEnabled === 'boolean' ? input.autoImportMatchesEnabled : false;
  const autoImportMatchesWeekday = typeof input.autoImportMatchesWeekday === 'number' ? input.autoImportMatchesWeekday : 2;
  const autoImportMatchesTime = typeof input.autoImportMatchesTime === 'string' ? input.autoImportMatchesTime.trim() : '08:00';
  const autoImportMatchesTimeZone =
    typeof input.autoImportMatchesTimeZone === 'string' ? input.autoImportMatchesTimeZone.trim() : 'Europe/Zagreb';
  const scheduleSourceUrl = typeof input.scheduleSourceUrl === 'string' ? input.scheduleSourceUrl.trim() : '';
  const oddsSourceUrl = input.oddsSourceUrl.trim();

  if (
    name.length < 1 ||
    name.length > 120 ||
    !isValidLogoUrl(logoUrl) ||
    (requirePasscode && (!passcode || passcode.length < 4)) ||
    (passcode !== null && passcode.length > 120) ||
    !isValidSourceUrl(scheduleSourceUrl) ||
    oddsSourceUrl.length < 1 ||
    !isValidSourceUrl(oddsSourceUrl) ||
    !Number.isInteger(autoImportMatchesWeekday) ||
    autoImportMatchesWeekday < 0 ||
    autoImportMatchesWeekday > 6 ||
    !/^\d{2}:\d{2}$/.test(autoImportMatchesTime) ||
    Number(autoImportMatchesTime.slice(0, 2)) > 23 ||
    Number(autoImportMatchesTime.slice(3, 5)) > 59 ||
    autoImportMatchesTimeZone.length < 1 ||
    autoImportMatchesTimeZone.length > 80 ||
    !isValidTimeZone(autoImportMatchesTimeZone) ||
    (autoImportMatchesEnabled && !importMatchesWithOddsEnabled)
  ) {
    return { status: 'invalid' };
  }

  if (!(await isValidSecretCode(input.secretCode))) {
    return { status: 'invalid_secret' };
  }

  const templates = findRuleTemplates();
  const templateMap = new Map(templates.map((template) => [template.key, template]));
  const seenTemplateKeys = new Set<string>();
  const rules: Array<{ readonly templateKey: string; readonly value: string | null; readonly sortOrder: number }> = [];

  for (const rule of input.rules) {
    if (typeof rule !== 'object' || rule === null || typeof rule.templateKey !== 'string') {
      return { status: 'invalid' };
    }

    const template = templateMap.get(rule.templateKey);

    if (!template || seenTemplateKeys.has(rule.templateKey)) {
      return { status: 'invalid' };
    }

    const value = typeof rule.value === 'string' ? rule.value.trim() : null;

    if (template.value_label && (!value || value.length > 120)) {
      return { status: 'invalid' };
    }

    if (!template.value_label && value !== null) {
      return { status: 'invalid' };
    }

    seenTemplateKeys.add(rule.templateKey);
    rules.push({
      templateKey: rule.templateKey,
      value,
      sortOrder: rules.length + 1
    });
  }

  return {
    status: 'valid',
    name,
    logoUrl,
    passcode,
    isFinished: input.isFinished,
    playoffsEnabled,
    scheduleSourceUrl,
    oddsSourceUrl,
    importMatchesWithOddsEnabled,
    autoImportMatchesEnabled,
    autoImportMatchesWeekday,
    autoImportMatchesTime,
    autoImportMatchesTimeZone,
    rules
  };
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function renderRules(rules: readonly { readonly key: string; readonly text_template: string; readonly value: string | null }[]): LocalizedString[][] {
  const catalog = getContentLocalization();
  return rules.map(rule => {
    const translations = catalog.entries.find(entry => entry.kind === 'rule' && entry.id === rule.key)?.translations
      ?? [{ languageCode: 'en', value: rule.text_template }];
    return translations.map(translation => ({ ...translation, value: translation.value.replaceAll('{{value}}', () => rule.value ?? '') }));
  });
}

function createUniqueSlug(name: string, currentCompetitionId?: number): string {
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let suffix = 2;

  while (true) {
    const existing = findCompetitionBySlug(slug);

    if (!existing || existing.id === currentCompetitionId) {
      return slug;
    }

    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return slug || 'competition';
}
