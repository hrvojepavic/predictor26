import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { config } from '../../config/index.js';
import { MatchImportInput, MatchRow, TeamImportInput } from '../../database/queries/matches.queries.js';
import { decodeHtmlEntities, fetchOddsPortalPageHtml, fetchOddsPortalSportData, isUpcomingScheduledEvent, oddsPortalRows } from './oddsportal-odds-importer.js';

const sourceTimeZone = 'Europe/Zagreb';
const croatiaTimeZone = 'Europe/Zagreb';
const weekdayByName: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6
};

export interface OddsPortalScheduleImport {
  readonly matches: MatchImportInput[];
  readonly teams: TeamImportInput[];
}

export async function importOddsPortalSchedule(sourceUrl: string, existingMatches: readonly MatchRow[]): Promise<OddsPortalScheduleImport> {
  const pageHtml = await fetchOddsPortalPageHtml(sourceUrl);
  const sportData = await fetchOddsPortalSportData(sourceUrl);
  const rows = oddsPortalRows(sportData);
  const logoByTeamName = parseTeamLogos(pageHtml, sourceUrl);
  const cutoff = nextTuesdayEndInCroatia(new Date());
  const existingKeys = new Set(existingMatches.map(matchKey));
  const nextMatchNumber = Math.max(0, ...existingMatches.map((match) => match.match_number)) + 1;
  const weekLabel = `Week ${Math.max(0, ...existingMatches.map((match) => weekNumber(match.round_label))) + 1}`;
  const matches: MatchImportInput[] = [];
  const teamsByName = new Map<string, TeamImportInput>();

  for (const row of rows.filter((event) => isUpcomingScheduledEvent(event))) {
    const homeTeamName = typeof row['home-name'] === 'string' ? row['home-name'].trim() : '';
    const awayTeamName = typeof row['away-name'] === 'string' ? row['away-name'].trim() : '';
    const timestamp = typeof row['date-start-timestamp'] === 'number' ? row['date-start-timestamp'] : row['date-start-base'];
    const homeTeamLogo = logoByTeamName.get(normalizeTeamName(homeTeamName)) ?? teamLogoUrl(row, 'home', sourceUrl);
    const awayTeamLogo = logoByTeamName.get(normalizeTeamName(awayTeamName)) ?? teamLogoUrl(row, 'away', sourceUrl);

    if (!homeTeamName || !awayTeamName || typeof timestamp !== 'number') {
      continue;
    }

    addTeam(teamsByName, homeTeamName, await localTeamLogoUrl(homeTeamName, homeTeamLogo));
    addTeam(teamsByName, awayTeamName, await localTeamLogoUrl(awayTeamName, awayTeamLogo));

    const kickoffAt = new Date(timestamp * 1000).toISOString();
    const candidate: MatchImportInput = {
      matchNumber: 0,
      stage: 'League',
      groupName: null,
      roundLabel: weekLabel,
      kickoffAt,
      sourceTimeZone,
      homeTeamName,
      awayTeamName,
      homeTeamFlag: teamsByName.get(normalizeTeamName(homeTeamName))?.logoUrl ?? null,
      awayTeamFlag: teamsByName.get(normalizeTeamName(awayTeamName))?.logoUrl ?? null,
      venue: textValue(row.venue) || textValue(row['tournament-name']) || 'TBD',
      city: textValue(row.venueTown) || textValue(row['country-name']) || 'TBD'
    };

    if (new Date(kickoffAt).getTime() > cutoff.getTime() || existingKeys.has(matchKey(candidate))) {
      continue;
    }

    matches.push(candidate);
  }

  return {
    teams: Array.from(teamsByName.values()),
    matches: matches
    .sort((firstMatch, secondMatch) => firstMatch.kickoffAt.localeCompare(secondMatch.kickoffAt))
    .map((match, index) => ({
      ...match,
      matchNumber: nextMatchNumber + index
    }))
  };
}

function matchKey(match: MatchImportInput | MatchRow): string {
  const homeTeamName = 'homeTeamName' in match ? match.homeTeamName : match.home_team_name;
  const awayTeamName = 'awayTeamName' in match ? match.awayTeamName : match.away_team_name;
  const kickoffAt = 'kickoffAt' in match ? match.kickoffAt : match.kickoff_at;

  return `${normalizeTeamName(homeTeamName)}|${normalizeTeamName(awayTeamName)}|${kickoffAt}`;
}

function normalizeTeamName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function weekNumber(roundLabel: string): number {
  const match = /^Week (\d+)$/.exec(roundLabel);

  return match ? Number(match[1]) : 0;
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function addTeam(teamsByName: Map<string, TeamImportInput>, name: string, logoUrl: string | null): void {
  const normalizedName = normalizeTeamName(name);
  const existing = teamsByName.get(normalizedName);

  if (!existing || (!existing.logoUrl && logoUrl)) {
    teamsByName.set(normalizedName, { name, logoUrl });
  }
}

function parseTeamLogos(html: string, sourceUrl: string): Map<string, string> {
  const logos = new Map<string, string>();
  const imageMatches = html.matchAll(/<img\b[^>]*>/gi);

  for (const match of imageMatches) {
    const tag = match[0];

    if (!tag.includes('team-logo')) {
      continue;
    }

    const alt = attributeValue(tag, 'alt');
    const src = attributeValue(tag, 'src');

    if (!alt || !src) {
      continue;
    }

    const logoUrl = normalizeLogoUrl(src, sourceUrl);

    if (logoUrl) {
      logos.set(normalizeTeamName(alt), logoUrl);
    }
  }

  return logos;
}

function attributeValue(tag: string, attributeName: string): string | null {
  const match = new RegExp(`\\b${attributeName}=(["'])(.*?)\\1`, 'i').exec(tag);

  return match ? decodeHtmlEntities(match[2] ?? '').trim() : null;
}

async function localTeamLogoUrl(teamName: string, remoteLogoUrl: string | null): Promise<string | null> {
  if (!remoteLogoUrl) {
    return null;
  }

  const extension = logoExtension(remoteLogoUrl);
  const fileName = `${slugify(teamName)}-${createHash('sha256').update(remoteLogoUrl).digest('hex').slice(0, 16)}${extension}`;
  const filePath = join(config.teamLogoAssetsPath, fileName);

  if (!existsSync(filePath)) {
    const response = await fetch(remoteLogoUrl, {
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        referer: new URL(remoteLogoUrl).origin,
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return null;
    }

    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.length === 0 || bytes.length > 300000) {
      return null;
    }

    mkdirSync(config.teamLogoAssetsPath, { recursive: true });
    writeFileSync(filePath, bytes);
  }

  return `/api/assets/team-logos/${fileName}`;
}

function logoExtension(logoUrl: string): string {
  const extension = extname(new URL(logoUrl).pathname).toLowerCase();

  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension) ? extension : '.png';
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'team'
  );
}

function teamLogoUrl(row: Record<string, unknown>, side: 'home' | 'away', sourceUrl: string): string | null {
  const keys = [
    `${side}-logo`,
    `${side}-image`,
    `${side}-img`,
    `${side}-participant-images`,
    `${side}-participant-logo`,
    `${side}-participant-image`,
    `${side}Logo`,
    `${side}Image`,
    `${side}ParticipantLogo`,
    `${side}ParticipantImage`
  ];

  for (const key of keys) {
    const url = normalizeLogoUrl(row[key], sourceUrl);

    if (url) {
      return url;
    }
  }

  return findNestedLogoUrl(row, side, sourceUrl);
}

function findNestedLogoUrl(value: unknown, side: 'home' | 'away', sourceUrl: string): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    const keyMatchesSide = lowerKey.includes(side);
    const keyMatchesImage = lowerKey.includes('logo') || lowerKey.includes('image') || lowerKey.includes('img');

    if (keyMatchesSide && keyMatchesImage) {
      const url = normalizeLogoUrl(nestedValue, sourceUrl);

      if (url) {
        return url;
      }
    }

    if (keyMatchesSide || !lowerKey.includes(side === 'home' ? 'away' : 'home')) {
      const nestedUrl = findNestedLogoUrl(nestedValue, side, sourceUrl);

      if (nestedUrl) {
        return nestedUrl;
      }
    }
  }

  return null;
}

function normalizeLogoUrl(value: unknown, sourceUrl: string): string | null {
  if (Array.isArray(value)) {
    return normalizeLogoUrl(value[0], sourceUrl);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const candidate = value.trim();

  if (!/\.(?:png|jpe?g|webp|gif|svg)(?:[?#].*)?$/i.test(candidate) && !candidate.includes('/res/')) {
    return null;
  }

  try {
    const url = new URL(candidate, sourceUrl);

    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function nextTuesdayEndInCroatia(now: Date): Date {
  const parts = zonedDateParts(now, croatiaTimeZone);
  const calendarDaysUntilTuesday = (2 - weekdayByName[parts.weekday] + 7) % 7 || 7;
  const daysUntilTuesday = calendarDaysUntilTuesday <= 1 ? calendarDaysUntilTuesday + 7 : calendarDaysUntilTuesday;
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day + daysUntilTuesday, 23, 59, 59, 999);

  return zonedLocalTimeToUtc(localAsUtc, croatiaTimeZone);
}

function zonedDateParts(date: Date, timeZone: string): { readonly year: number; readonly month: number; readonly day: number; readonly weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    weekday: values.get('weekday') ?? 'Tuesday'
  };
}

function zonedLocalTimeToUtc(localAsUtcMs: number, timeZone: string): Date {
  let utcMs = localAsUtcMs;

  for (let index = 0; index < 2; index += 1) {
    utcMs = localAsUtcMs - timeZoneOffsetMs(new Date(utcMs), timeZone);
  }

  return new Date(utcMs);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.get('year')),
    Number(values.get('month')) - 1,
    Number(values.get('day')),
    Number(values.get('hour')),
    Number(values.get('minute')),
    Number(values.get('second'))
  );

  return zonedAsUtc - date.getTime();
}
