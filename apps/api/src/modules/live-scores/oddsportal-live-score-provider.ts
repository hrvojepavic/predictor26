import {
  fetchOddsPortalSportData,
  oddsPortalRows,
  OddsPortalEventRow
} from '../admin-matches/oddsportal-odds-importer.js';
import { defaultOddsPortalSourceUrl } from '../../shared/constants/default-competition.constants.js';
import { randomBytes, createHash } from 'node:crypto';
import { connect as connectTls, TLSSocket } from 'node:tls';
import { inflateSync, unzipSync } from 'node:zlib';

export type ProviderLiveScoreStatus = 'scheduled' | 'live' | 'finished' | 'unknown';

export interface ProviderLiveScore {
  readonly provider: 'oddsportal';
  readonly providerEventId: string | null;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly kickoffAt: string | null;
  readonly status: ProviderLiveScoreStatus;
  readonly rawStatus: string | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly rawPayload: OddsPortalEventRow;
}

interface OddsPortalSocketScoreUpdate {
  readonly status: string | null;
  readonly shortStatus: string | null;
  readonly score: string | null;
  readonly partialScore: string | null;
  readonly stageId: number | null;
  readonly stageTypeId: number | null;
  readonly liveIcon: boolean;
}

const liveScoreSocketHost = 'oppush-tt2.livesport.eu';
const liveScoreSocketPath = '/WebSocketConnection-Secure';
const liveScoreSocketWaitMs = 4_000;
const liveScoreSocketMaxPayloadBytes = 2 * 1024 * 1024;

export async function fetchOddsPortalLiveScores(sourceUrl = defaultOddsPortalSourceUrl): Promise<ProviderLiveScore[]> {
  const sportData = await fetchOddsPortalSportData(sourceUrl, { bypassCache: true });
  const scores = oddsPortalRows(sportData).flatMap(toProviderLiveScore);

  return overlayLiveSocketScores(scores);
}

function toProviderLiveScore(row: OddsPortalEventRow): ProviderLiveScore[] {
  const homeTeamName = row['home-name'];
  const awayTeamName = row['away-name'];

  if (typeof homeTeamName !== 'string' || typeof awayTeamName !== 'string') {
    return [];
  }

  const kickoffTimestamp = readNumber(row['date-start-timestamp']) ?? readNumber(row['date-start-base']);
  const rawStatus = readRawStatus(row);
  const homeScore = readScore(row, ['home-score', 'homeScore', 'homeResult', 'home-result', 'home-result-current', 'homeResultCurrent']);
  const awayScore = readScore(row, ['away-score', 'awayScore', 'awayResult', 'away-result', 'away-result-current', 'awayResultCurrent']);
  const status = readStatus(row, rawStatus, homeScore, awayScore);

  return [
    {
      provider: 'oddsportal',
      providerEventId: typeof row.encodeEventId === 'string' ? row.encodeEventId : null,
      homeTeamName,
      awayTeamName,
      kickoffAt: kickoffTimestamp ? new Date(kickoffTimestamp * 1000).toISOString() : null,
      status,
      rawStatus,
      homeScore,
      awayScore,
      rawPayload: row
    }
  ];
}

async function overlayLiveSocketScores(scores: readonly ProviderLiveScore[]): Promise<ProviderLiveScore[]> {
  const liveEventIds = scores
    .filter((score) => score.providerEventId && score.status === 'live')
    .map((score) => score.providerEventId as string);

  if (liveEventIds.length === 0) {
    return [...scores];
  }

  let socketScores: Map<string, OddsPortalSocketScoreUpdate>;

  try {
    socketScores = await fetchOddsPortalSocketScores(liveEventIds);
  } catch {
    return [...scores];
  }

  if (socketScores.size === 0) {
    return [...scores];
  }

  return scores.map((score) => {
    if (!score.providerEventId) {
      return score;
    }

    const socketScore = socketScores.get(score.providerEventId);

    if (!socketScore) {
      return score;
    }

    const [homeScore, awayScore] = parseScoreText(socketScore.score);

    if (homeScore === null || awayScore === null) {
      return score;
    }

    const rawStatus = socketScore.status ?? socketScore.shortStatus ?? score.rawStatus;

    return {
      ...score,
      status: readSocketStatus(rawStatus, socketScore, homeScore, awayScore),
      rawStatus,
      homeScore,
      awayScore,
      rawPayload: {
        ...score.rawPayload,
        socketScore: socketScore.score,
        socketStatus: socketScore.status,
        socketShortStatus: socketScore.shortStatus,
        socketPartialScore: socketScore.partialScore,
        socketStageId: socketScore.stageId,
        socketStageTypeId: socketScore.stageTypeId
      }
    };
  });
}

async function fetchOddsPortalSocketScores(eventIds: readonly string[]): Promise<Map<string, OddsPortalSocketScoreUpdate>> {
  const wantedEventIds = new Set(eventIds);
  const updates = new Map<string, OddsPortalSocketScoreUpdate>();

  await withMigratoryDataSocket((payload) => {
    for (const [eventId, update] of parseSocketScorePayload(payload)) {
      if (wantedEventIds.has(eventId)) {
        updates.set(eventId, update);
      }
    }
  });

  return updates;
}

function withMigratoryDataSocket(onMessage: (payload: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host: liveScoreSocketHost,
      port: 443,
      servername: liveScoreSocketHost
    });
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let handshakeComplete = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }

      socket.destroy();

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    timer = setTimeout(() => finish(), liveScoreSocketWaitMs);
    socket.setTimeout(liveScoreSocketWaitMs + 1_000, () => finish());

    socket.on('secureConnect', () => {
      socket.write(
        [
          `GET ${liveScoreSocketPath} HTTP/1.1`,
          `Host: ${liveScoreSocketHost}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          'Origin: https://www.oddsportal.com',
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Pragma: no-cache',
          'Cache-Control: no-cache',
          '',
          ''
        ].join('\r\n')
      );
    });

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeComplete) {
        const headerEnd = buffer.indexOf('\r\n\r\n');

        if (headerEnd < 0) {
          return;
        }

        const header = buffer.subarray(0, headerEnd).toString('utf8');

        if (!/^HTTP\/1\.1 101\b/.test(header) || !header.toLowerCase().includes(`sec-websocket-accept: ${expectedAccept.toLowerCase()}`)) {
          finish(new Error('OddsPortal live score socket handshake failed.'));
          return;
        }

        handshakeComplete = true;
        buffer = buffer.subarray(headerEnd + 4);
        socket.write(createMaskedTextFrame(createMigratoryDataSubscribePayload()));
      }

      try {
        buffer = readWebSocketFrames(buffer, (frame) => {
          if (frame.opcode === 1 || frame.opcode === 2) {
            onMessage(frame.payload.toString('utf8'));
          }
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error('OddsPortal live score socket read failed.'));
      }
    });

    socket.on('error', (error) => finish(error));
    socket.on('close', () => finish());
  });
}

function createMigratoryDataSubscribePayload(): string {
  const sessionId = 'ohmiep2P';

  return `\x01\x01/op/oddsportal/score\x1e\x05\x08\x1e\x13${sessionId}\x1e#MigratoryDataClient WebSocket Client v5.1.3\x1e$\x01\x1e-\x02\x1e\x7f`;
}

function createMaskedTextFrame(payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload, 'utf8');
  const mask = randomBytes(4);
  const headerLength = payloadBuffer.length < 126 ? 2 : payloadBuffer.length <= 65_535 ? 4 : 10;
  const frame = Buffer.alloc(headerLength + 4 + payloadBuffer.length);

  frame[0] = 0x81;

  if (payloadBuffer.length < 126) {
    frame[1] = 0x80 | payloadBuffer.length;
  } else if (payloadBuffer.length <= 65_535) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payloadBuffer.length, 2);
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(payloadBuffer.length), 2);
  }

  mask.copy(frame, headerLength);

  for (let index = 0; index < payloadBuffer.length; index += 1) {
    frame[headerLength + 4 + index] = payloadBuffer[index] ^ mask[index % 4];
  }

  return frame;
}

function readWebSocketFrames(
  buffer: Buffer,
  onFrame: (frame: { readonly opcode: number; readonly payload: Buffer }) => void
): Buffer {
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) {
        break;
      }

      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) {
        break;
      }

      const longLength = buffer.readBigUInt64BE(offset + 2);

      if (longLength > BigInt(liveScoreSocketMaxPayloadBytes)) {
        throw new Error('OddsPortal live score socket payload is too large.');
      }

      payloadLength = Number(longLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;

    if (buffer.length - offset < frameLength) {
      break;
    }

    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);

    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    if (opcode === 8) {
      return Buffer.alloc(0);
    }

    onFrame({ opcode, payload });
    offset += frameLength;
  }

  return buffer.subarray(offset);
}

function parseSocketScorePayload(payload: string): Map<string, OddsPortalSocketScoreUpdate> {
  const decoded = decodeMigratoryDataPayload(payload);

  if (!decoded) {
    return new Map();
  }

  const jsonStart = decoded.indexOf('{');
  const jsonEnd = decoded.lastIndexOf('}');

  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return new Map();
  }

  try {
    const data = JSON.parse(decoded.slice(jsonStart, jsonEnd + 1)) as {
      readonly d?: {
        readonly data?: Record<string, Record<string, unknown>>;
      };
    };
    const rows = data.d?.data ?? {};
    const updates = new Map<string, OddsPortalSocketScoreUpdate>();

    for (const [eventId, row] of Object.entries(rows)) {
      updates.set(eventId, {
        status: readUnknownString(row.status),
        shortStatus: readUnknownString(row['short-status']),
        score: readUnknownString(row.score),
        partialScore: readUnknownString(row['partial-score']),
        stageId: readUnknownNumber(row.stageId),
        stageTypeId: readUnknownNumber(row.stageTypeId),
        liveIcon: row.liveIcon === true
      });
    }

    return updates;
  } catch {
    return new Map();
  }
}

function readUnknownString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function readUnknownNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function decodeMigratoryDataPayload(payload: string): string | null {
  const match = /c__([A-Za-z0-9+/=]+)/.exec(payload);

  if (!match) {
    return null;
  }

  const compressed = Buffer.from(match[1], 'base64');

  for (const decode of [inflateSync, unzipSync]) {
    try {
      return decodeURIComponent(decode(compressed).toString('utf8'));
    } catch {
      // Try the next zlib container.
    }
  }

  return null;
}

function parseScoreText(score: string | null): readonly [number | null, number | null] {
  const [home, away] = score?.match(/\d+/g)?.map(Number) ?? [];

  return [
    Number.isInteger(home) && home >= 0 ? home : null,
    Number.isInteger(away) && away >= 0 ? away : null
  ];
}

function readSocketStatus(
  rawStatus: string | null,
  socketScore: OddsPortalSocketScoreUpdate,
  homeScore: number,
  awayScore: number
): ProviderLiveScoreStatus {
  const normalized = normalizeStatus(rawStatus);

  if (/\b(ft|aet|ap|finished|ended|afterpenalties|fulltime|finishedafterextratime)\b/.test(normalized)) {
    return 'finished';
  }

  if (socketScore.liveIcon || socketScore.stageTypeId === 2) {
    return 'live';
  }

  if (/\b(live|inplay|1sthalf|2ndhalf|halftime|half-time|extratime|penalties)\b/.test(normalized)) {
    return 'live';
  }

  return homeScore === null || awayScore === null ? 'scheduled' : 'unknown';
}

function readRawStatus(row: OddsPortalEventRow): string | null {
  const directStatus = readString(row, [
    'status',
    'status-name',
    'statusName',
    'event-status',
    'event-status-name',
    'eventStatusName',
    'event-stage-name',
    'eventStageName',
    'state',
    'stage'
  ]);

  if (directStatus) {
    return directStatus;
  }

  const timeValue = readString(row, ['time', 'time-status', 'timeStatus', 'minute', 'live-time', 'liveTime']);
  return timeValue;
}

function readStatus(
  row: OddsPortalEventRow,
  rawStatus: string | null,
  homeScore: number | null,
  awayScore: number | null
): ProviderLiveScoreStatus {
  const normalized = normalizeStatus(rawStatus);

  if (/\b(ft|aet|ap|finished|ended|afterpenalties|fulltime|finishedafterextratime)\b/.test(normalized)) {
    return 'finished';
  }

  if (/\b(live|inplay|1sthalf|2ndhalf|halftime|half-time|extratime|penalties)\b/.test(normalized)) {
    return 'live';
  }

  if (readBoolean(row, ['inplay', 'in-play', 'isLive', 'is-live', 'live'])) {
    return 'live';
  }

  if (homeScore !== null && awayScore !== null && rawStatus) {
    return 'live';
  }

  return homeScore === null || awayScore === null ? 'scheduled' : 'unknown';
}

function readScore(row: OddsPortalEventRow, keys: readonly string[]): number | null {
  for (const key of keys) {
    const directValue = readNumber(row[key]);

    if (directValue !== null && Number.isInteger(directValue) && directValue >= 0) {
      return directValue;
    }
  }

  const scoreText = readString(row, ['score', 'result', 'current-score', 'currentScore']);

  if (!scoreText) {
    return null;
  }

  const [home, away] = scoreText.match(/\d+/g)?.map(Number) ?? [];
  const isHomeKey = keys.some((key) => key.toLowerCase().includes('home'));
  const value = isHomeKey ? home : away;

  return Number.isInteger(value) && value >= 0 ? value : null;
}

function readString(row: OddsPortalEventRow, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBoolean(row: OddsPortalEventRow, keys: readonly string[]): boolean {
  return keys.some((key) => row[key] === true || row[key] === 1 || row[key] === '1' || row[key] === 'true');
}

function normalizeStatus(value: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}
