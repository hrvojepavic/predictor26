import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { defaultOddsPortalSourceUrl } from '../../shared/constants/default-competition.constants.js';

export interface ImportedMatchOdds {
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly homeWinOdds: number;
  readonly drawOdds: number;
  readonly awayWinOdds: number;
}

export interface OddsPortalSportData {
  readonly d?: {
    readonly rows?: OddsPortalEventRow[] | Record<string, OddsPortalEventRow>;
  };
  readonly oddsRequest?: {
    readonly url?: string;
  };
  readonly initialOddsMap?: Record<string, OddsPortalOddsData>;
}

export interface OddsPortalEventRow {
  readonly [key: string]: unknown;
  readonly id?: number;
  readonly encodeEventId?: string;
  readonly 'home-name'?: string;
  readonly 'away-name'?: string;
  readonly 'date-start-timestamp'?: number;
  readonly 'date-start-base'?: number;
  readonly 'status-id'?: number;
  readonly 'event-stage-name'?: string;
  readonly 'tournament-name'?: string;
  readonly venue?: string;
  readonly venueTown?: string;
  readonly 'country-name'?: string;
}

interface OddsPortalPageFetchOptions {
  readonly bypassCache?: boolean;
}

interface OddsPortalOddsResponse {
  readonly d?: {
    readonly oddsData?: Record<string, OddsPortalOddsData>;
  };
}

interface OddsPortalOddsData {
  readonly event?: number;
  readonly odds?: OddsPortalOutcomeOdds[];
}

interface OddsPortalOutcomeOdds {
  readonly maxOdds?: number;
}

export const worldCupOddsPortalUrl = defaultOddsPortalSourceUrl;
export const friendlyInternationalOddsPortalUrl = 'https://www.oddsportal.com/football/world/friendly-international/';
const productionKey = 'J*8sQ!p$7aD_fR2yW@gHn*3bVp#sAdLd_k';
const productionSalt = '5b9a8f2c3e6d1a4b7c8e9d0f1a2b3c4d';

const browserHeaders = {
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
};

export async function importOddsPortalOdds(sourceUrl = worldCupOddsPortalUrl): Promise<ImportedMatchOdds[]> {
  const sportData = await fetchOddsPortalSportData(sourceUrl);
  const events = toArray(sportData.d?.rows);
  const oddsRequestUrl = sportData.oddsRequest?.url;

  if (!oddsRequestUrl) {
    const embeddedOdds = importEmbeddedOdds(events, sportData.initialOddsMap);

    if (embeddedOdds.length > 0) {
      return embeddedOdds;
    }

    throw new Error('OddsPortal odds request URL was not found.');
  }

  const oddsResponse = await fetch(new URL(oddsRequestUrl, sourceUrl), {
    headers: {
      ...browserHeaders,
      accept: 'application/json,text/plain,*/*',
      referer: sourceUrl
    }
  });

  if (!oddsResponse.ok) {
    throw new Error(`OddsPortal odds fetch failed with status ${oddsResponse.status}.`);
  }

  const oddsPayload = await parseOddsPayload(await oddsResponse.text());
  const oddsByEventId = oddsPayload.d?.oddsData ?? {};
  const importedOdds: ImportedMatchOdds[] = [];

  for (const event of events.filter((event) => isUpcomingScheduledEvent(event))) {
    const encodeEventId = event.encodeEventId;
    const homeTeamName = event['home-name'];
    const awayTeamName = event['away-name'];

    if (!encodeEventId || !homeTeamName || !awayTeamName) {
      continue;
    }

    const odds = oddsByEventId[encodeEventId]?.odds;

    if (!odds || odds.length < 3) {
      continue;
    }

    const homeWinOdds = normalizeOdds(odds[0]?.maxOdds);
    const drawOdds = normalizeOdds(odds[1]?.maxOdds);
    const awayWinOdds = normalizeOdds(odds[2]?.maxOdds);

    if (!homeWinOdds || !drawOdds || !awayWinOdds) {
      continue;
    }

    importedOdds.push({
      homeTeamName,
      awayTeamName,
      homeWinOdds,
      drawOdds,
      awayWinOdds
    });
  }

  return importedOdds;
}

export async function fetchOddsPortalSportData(
  sourceUrl: string,
  options: OddsPortalPageFetchOptions = {}
): Promise<OddsPortalSportData> {
  return parseSportData(await fetchOddsPortalPageHtml(sourceUrl, options));
}

export async function fetchOddsPortalPageHtml(
  sourceUrl: string,
  options: OddsPortalPageFetchOptions = {}
): Promise<string> {
  const candidateUrls = options.bypassCache ? cacheBustedUrls(sourceUrl) : [sourceUrl];
  let lastError: Error | null = null;

  for (const candidateUrl of candidateUrls) {
    try {
      const pageResponse = await fetch(candidateUrl, {
        cache: options.bypassCache ? 'no-store' : 'default',
        headers: {
          ...browserHeaders,
          ...(options.bypassCache
            ? {
                'cache-control': 'no-cache, no-store, max-age=0',
                pragma: 'no-cache'
              }
            : {})
        }
      });

      if (!pageResponse.ok) {
        lastError = new Error(`OddsPortal page fetch failed with status ${pageResponse.status}.`);
        continue;
      }

      return pageResponse.text();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OddsPortal page fetch failed.');
    }
  }

  throw lastError ?? new Error('OddsPortal page fetch failed.');
}

function cacheBustedUrls(sourceUrl: string): string[] {
  return ['_', '_t', '_r', '_predictor26_live'].map((key) => withCacheBuster(sourceUrl, key));
}

function withCacheBuster(sourceUrl: string, key: string): string {
  const url = new URL(sourceUrl);
  url.searchParams.set(key, String(Date.now()));
  url.searchParams.set('_predictor26_nonce', Math.random().toString(36).slice(2));
  return url.toString();
}

export function oddsPortalRows(sportData: OddsPortalSportData): OddsPortalEventRow[] {
  return toArray(sportData.d?.rows);
}

function parseSportData(html: string): OddsPortalSportData {
  const sportDataMatches = html.matchAll(/<star-component\b[^>]*:sport-data="([^"]+)"/g);

  for (const match of sportDataMatches) {
    const value = decodeHtmlEntities(match[1] ?? '');

    if (!value.includes('oddsRequest')) {
      continue;
    }

    return JSON.parse(value) as OddsPortalSportData;
  }

  const nextFlightSportData = parseNextFlightSportData(html);

  if (nextFlightSportData) {
    return nextFlightSportData;
  }

  throw new Error('OddsPortal sport data was not found.');
}

function parseNextFlightSportData(html: string): OddsPortalSportData | null {
  const rowsCandidates: OddsPortalEventRow[][] = [];
  const oddsMapCandidates: Array<Record<string, OddsPortalOddsData>> = [];
  const chunkMatches = html.matchAll(/self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)<\/script>/g);

  for (const match of chunkMatches) {
    const chunk = parseJsonString(match[1] ?? '');

    if (!chunk || (!chunk.includes('"rows"') && !chunk.includes('"initialOddsMap"'))) {
      continue;
    }

    const payload = parseNextFlightChunkPayload(chunk);

    if (!payload) {
      continue;
    }

    collectNextFlightValues(payload, 'rows', rowsCandidates);
    collectNextFlightValues(payload, 'initialOddsMap', oddsMapCandidates);
  }

  const rows = rowsCandidates.find((candidate) => candidate.some(isOddsPortalEventRow)) ?? [];
  const initialOddsMap = oddsMapCandidates.find(isOddsPortalInitialOddsMap);

  if (rows.length === 0 && !initialOddsMap) {
    return null;
  }

  return {
    d: { rows },
    initialOddsMap
  };
}

function parseNextFlightChunkPayload(chunk: string): unknown {
  const separatorIndex = chunk.indexOf(':');
  const payload = separatorIndex >= 0 ? chunk.slice(separatorIndex + 1).trim() : chunk.trim();

  if (!payload.startsWith('[') && !payload.startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

function parseJsonString(value: string): string | null {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return null;
  }
}

function collectNextFlightValues<T>(value: unknown, key: string, matches: T[]): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    matches.push((value as Record<string, T>)[key]);
  }

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectNextFlightValues(child, key, matches);
  }
}

function isOddsPortalEventRow(value: unknown): value is OddsPortalEventRow {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as OddsPortalEventRow)['home-name'] === 'string' &&
    typeof (value as OddsPortalEventRow)['away-name'] === 'string'
  );
}

function isOddsPortalInitialOddsMap(value: unknown): value is Record<string, OddsPortalOddsData> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).some(
      (oddsData) =>
        !!oddsData &&
        typeof oddsData === 'object' &&
        typeof (oddsData as OddsPortalOddsData).event === 'number' &&
        Array.isArray((oddsData as OddsPortalOddsData).odds)
    )
  );
}

function importEmbeddedOdds(
  events: readonly OddsPortalEventRow[],
  initialOddsMap: Record<string, OddsPortalOddsData> | undefined
): ImportedMatchOdds[] {
  if (!initialOddsMap) {
    return [];
  }

  const oddsByNumericEventId = new Map<number, OddsPortalOddsData>();

  for (const oddsData of Object.values(initialOddsMap)) {
    if (typeof oddsData.event === 'number') {
      oddsByNumericEventId.set(oddsData.event, oddsData);
    }
  }

  return events.filter((event) => isUpcomingScheduledEvent(event)).flatMap((event) => {
    const homeTeamName = event['home-name'];
    const awayTeamName = event['away-name'];
    const odds = (typeof event.id === 'number' ? oddsByNumericEventId.get(event.id)?.odds : null) ?? [];

    if (!homeTeamName || !awayTeamName || odds.length < 3) {
      return [];
    }

    const homeWinOdds = normalizeOdds(odds[0]?.maxOdds);
    const drawOdds = normalizeOdds(odds[1]?.maxOdds);
    const awayWinOdds = normalizeOdds(odds[2]?.maxOdds);

    if (!homeWinOdds || !drawOdds || !awayWinOdds) {
      return [];
    }

    return [
      {
        homeTeamName,
        awayTeamName,
        homeWinOdds,
        drawOdds,
        awayWinOdds
      }
    ];
  });
}

async function parseOddsPayload(payload: string): Promise<OddsPortalOddsResponse> {
  const trimmed = payload.trim();

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as OddsPortalOddsResponse;
  }

  return JSON.parse(decryptOddsPayload(trimmed)) as OddsPortalOddsResponse;
}

function decryptOddsPayload(payload: string): string {
  const decodedPayload = Buffer.from(payload, 'base64').toString('utf8');
  const [encryptedBase64, ivHex] = decodedPayload.split(':');

  if (!encryptedBase64 || !ivHex) {
    throw new Error('OddsPortal odds payload format is invalid.');
  }

  const key = pbkdf2Sync(productionKey, productionSalt, 1000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedBase64, 'base64')), decipher.final()]);
  const uncompressed = decrypted.length >= 2 && decrypted[0] === 31 && decrypted[1] === 139 ? gunzipSync(decrypted) : decrypted;

  return uncompressed.toString('utf8');
}

function normalizeOdds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) {
    return null;
  }

  return Number(value.toFixed(2));
}

export function isUpcomingScheduledEvent(event: OddsPortalEventRow, now = new Date()): boolean {
  const statusId = event['status-id'];
  const stageName = event['event-stage-name'];
  const timestamp = typeof event['date-start-timestamp'] === 'number' ? event['date-start-timestamp'] : event['date-start-base'];

  if (statusId !== undefined && statusId !== 1) {
    return false;
  }

  if (typeof stageName === 'string' && stageName.trim().toLowerCase() !== 'scheduled') {
    return false;
  }

  return typeof timestamp === 'number' && timestamp * 1000 > now.getTime();
}

function toArray<T>(value: readonly T[] | Record<string, T> | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? [...value] : Object.values(value);
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_entity, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_entity, codePoint: string) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}
