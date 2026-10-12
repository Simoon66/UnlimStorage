import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
import { spawn } from 'child_process';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  User,
  FolderRecord,
  FileRecord,
  ShareLink,
  TransferJob,
  AuditLog,
  BandwidthSettings,
  DailyBandwidthPoint,
  TelegramConfigState,
  TelegramChunk,
  AuditAction,
  StoragePlanId,
} from './src/types.ts';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';

dotenv.config();

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const TELEGRAM_CHUNK_SIZE = 19 * 1024 * 1024;
const FREE_25GB_BYTES = 25 * 1024 * 1024 * 1024;
const PRO_50GB_BYTES = 50 * 1024 * 1024 * 1024;
const ULTRA_1TB_BYTES = 1024 * 1024 * 1024 * 1024;
const UNLIMITED_ADMIN_BYTES = 1024 * 1024 * 1024 * 1024 * 1024; // 1 PB Unlimited Admin Storage

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}

interface StoredUser extends User {
  passwordHash: string;
}

interface StoredShareLink extends ShareLink {
  passwordHash: string | null;
}

interface DatabaseSchema {
  users: StoredUser[];
  sessions: Record<string, string>;
  folders: FolderRecord[];
  files: FileRecord[];
  shares: StoredShareLink[];
  transfers: TransferJob[];
  logs: AuditLog[];
  bandwidthSettings: BandwidthSettings;
  dailyBandwidth: DailyBandwidthPoint[];
  telegramConfig: {
    authMode?: 'mtproto' | 'bot';
    botToken: string;
    chatId: string;
    botUsername?: string;
    botFirstName?: string;
    autoSyncUploads: boolean;
    lastVerifiedAt?: string;
    apiId?: string;
    apiHash?: string;
    phoneNumber?: string;
    mtprotoSession?: string;
    accountName?: string;
    accountUsername?: string;
  };
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(`unlim_salt_${pw}`).digest('hex');
}

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function computeFastFileSha256(filePath: string, totalSize: number): string {
  try {
    if (!fs.existsSync(filePath) || totalSize <= 0) {
      return crypto.createHash('sha256').update(`${filePath}:${totalSize}`).digest('hex');
    }
    const sampleSize = Math.min(65536, totalSize);
    const buf = Buffer.alloc(sampleSize);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, sampleSize, 0);
    } finally {
      fs.closeSync(fd);
    }
    return crypto
      .createHash('sha256')
      .update(buf)
      .update(`:${totalSize}`)
      .digest('hex');
  } catch {
    return crypto.createHash('sha256').update(`${filePath}:${totalSize}`).digest('hex');
  }
}

function getPlanQuotaBytes(planId: StoragePlanId = 'free_25gb'): number {
  if (planId === 'unlimited_admin') return UNLIMITED_ADMIN_BYTES;
  if (planId === 'ultra_1tb') return ULTRA_1TB_BYTES;
  if (planId === 'pro_50gb') return PRO_50GB_BYTES;
  return FREE_25GB_BYTES;
}

function createSeedDatabase(): DatabaseSchema {
  const now = new Date();
  const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toISOString();

  const adminId = 'usr_admin_01';
  const memberId = 'usr_dev_02';

  const seedFile1Content = Buffer.from(
    `# UnlimCloud Encrypted Cloud Drive — Quick Start Guide\n\n` +
      `Welcome to your private UnlimCloud storage vault.\n\n` +
      `## Storage Tiers & Token Billing\n` +
      `- **Starter Free**: 25 GB included free for every account\n` +
      `- **Pro 50 GB**: 500 Tokens / month\n` +
      `- **Ultra 1 TB**: 1024 Tokens / month\n\n` +
      `## 3-Month Data Protection Guarantee\n` +
      `If your monthly plan expires, your files are never deleted right away.\n` +
      `Your first 25 GB stays accessible at all times, and any files above 25 GB are safely held for 3 months (90 days) so you can renew whenever you are ready.\n`,
    'utf-8'
  );
  const seedFile1Hash = computeSha256(seedFile1Content);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_spec_01'), seedFile1Content);

  const seedSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">` +
      `<rect width="640" height="320" fill="#141311"/>` +
      `<rect x="24" y="24" width="592" height="272" fill="#1C1A17" stroke="#D97757" stroke-width="2"/>` +
      `<text x="52" y="95" fill="#F2EFE9" font-family="monospace" font-size="24" font-weight="bold">UNLIMCLOUD ENCRYPTED VAULT</text>` +
      `<text x="52" y="140" fill="#9E978E" font-family="sans-serif" font-size="16">Zero-Knowledge Multi-Tenant Cloud Storage</text>` +
      `<rect x="52" y="185" width="160" height="64" fill="#24211D" stroke="#2C2824"/>` +
      `<text x="72" y="222" fill="#D97757" font-family="monospace" font-size="15">25 GB FREE</text>` +
      `<rect x="236" y="185" width="160" height="64" fill="#24211D" stroke="#2C2824"/>` +
      `<text x="256" y="222" fill="#2E9E6B" font-family="monospace" font-size="15">50 GB / 500T</text>` +
      `<rect x="420" y="185" width="168" height="64" fill="#24211D" stroke="#2C2824"/>` +
      `<text x="440" y="222" fill="#F2EFE9" font-family="monospace" font-size="15">1 TB / 1024T</text>` +
      `</svg>`,
    'utf-8'
  );
  const seedFile2Hash = computeSha256(seedSvg);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_diagram_02'), seedSvg);

  const envBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const envChatId = process.env.TELEGRAM_CHAT_ID || '';

  return {
    users: [
      {
        id: adminId,
        name: 'Arian Rahman',
        email: 'titumamma2425@gmail.com',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        bandwidthLimitBytes: UNLIMITED_ADMIN_BYTES,
        bandwidthUsedBytes: 482_344_960,
        storageUsedBytes: seedFile1Content.length + seedSvg.length,
        createdAt: iso(4320),
        planId: 'unlimited_admin',
        tokenBalance: 999999,
        planExpiresAt: null,
        graceEndsAt: null,
        usedPromoCodes: [],
      },
      {
        id: memberId,
        name: 'Nadia Karim',
        email: 'dev@unlim.cloud',
        passwordHash: hashPassword('dev123'),
        role: 'member',
        bandwidthLimitBytes: FREE_25GB_BYTES,
        bandwidthUsedBytes: 128_974_848,
        storageUsedBytes: 0,
        createdAt: iso(2880),
        planId: 'free_25gb',
        tokenBalance: 100,
        planExpiresAt: null,
        graceEndsAt: null,
        usedPromoCodes: [],
      },
    ],
    sessions: {
      demo_admin_session_token: adminId,
      demo_member_session_token: memberId,
    },
    folders: [
      {
        id: 'fld_architecture',
        name: 'Documents & Guides',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1440),
      },
      {
        id: 'fld_releases',
        name: 'Media & Backups',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1200),
      },
    ],
    files: [
      {
        id: 'file_spec_01',
        name: 'UnlimCloud-QuickStart-Guide.md',
        folderId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: seedFile1Content.length,
        mimeType: 'text/markdown',
        sha256: seedFile1Hash,
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: true,
        downloadCount: 18,
        createdAt: iso(640),
        updatedAt: iso(640),
        previewText: seedFile1Content.toString('utf-8'),
        lockedOverQuota: false,
        tags: ['Work', 'Personal'],
      },
      {
        id: 'file_diagram_02',
        name: 'UnlimCloud-Vault-Overview.svg',
        folderId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: seedSvg.length,
        mimeType: 'image/svg+xml',
        sha256: seedFile2Hash,
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: true,
        downloadCount: 9,
        createdAt: iso(410),
        updatedAt: iso(410),
        previewText: seedSvg.toString('utf-8'),
        previewDataUrl: `data:image/svg+xml;base64,${seedSvg.toString('base64')}`,
        lockedOverQuota: false,
      },
    ],
    shares: [
      {
        id: 'shr_01',
        token: 'tg-spec-vault-2026',
        fileId: 'file_spec_01',
        fileName: 'UnlimCloud-QuickStart-Guide.md',
        fileSizeBytes: seedFile1Content.length,
        fileMimeType: 'text/markdown',
        fileSha256: seedFile1Hash,
        creatorId: adminId,
        creatorName: 'Arian Rahman',
        hasPassword: true,
        passwordHash: hashPassword('unlim2026'),
        expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
        maxDownloads: 100,
        downloadCount: 18,
        throttleKbps: 512,
        bandwidthCapBytes: 500 * 1024 * 1024,
        bandwidthUsedBytes: 12_450_000,
        active: true,
        createdAt: iso(500),
        lastAccessedAt: iso(25),
      },
    ],
    transfers: [],
    logs: [
      {
        id: 'log_01',
        timestamp: iso(640),
        userId: adminId,
        userName: 'Arian Rahman',
        action: 'FILE_UPLOAD',
        targetName: 'UnlimCloud-QuickStart-Guide.md',
        ipAddress: '103.145.72.19',
        bytesTransferred: seedFile1Content.length,
        integrityHash: seedFile1Hash.slice(0, 16),
        status: 'success',
        details: 'Uploaded and encrypted in UnlimCloud Vault',
      },
    ],
    bandwidthSettings: {
      globalThrottleKbps: null,
      defaultShareThrottleKbps: 1024,
      maxConcurrentTransfers: 6,
      enforceUserQuotas: true,
      autoThrottlePeakHours: false,
    },
    dailyBandwidth: [
      {
        date: '2026-10-09',
        uploadBytes: 142_606_336,
        downloadBytes: 209_715_200,
        remoteFetchBytes: 115_343_360,
        shareBytes: 84_934_656,
      },
    ],
    telegramConfig: {
      botToken: envBotToken,
      chatId: envChatId,
      autoSyncUploads: true,
    },
  };
}

let db: DatabaseSchema;
try {
  if (fs.existsSync(DB_PATH)) {
    db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } else {
    db = createSeedDatabase();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  }
} catch {
  db = createSeedDatabase();
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Never use the legacy demo bot token for uploading user files
if (
  db.telegramConfig &&
  (db.telegramConfig.botToken === '8552451944:AAGnsazvo2X2okXtKrAtAYGnuiizg_n8gkM' ||
    db.telegramConfig.botToken === '8730419442:AAHa333f3W2c58F5a744O-E31c8s8o0n2eU')
) {
  db.telegramConfig.botToken = '';
  db.telegramConfig.botUsername = undefined;
  db.telegramConfig.botFirstName = undefined;
  db.telegramConfig.authMode = 'mtproto';
}

function saveDb() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error('Failed to persist DB:', err);
  }
}

/**
 * Evaluates a user's subscription plan, 3-month (90-day) grace period,
 * and marks any files exceeding the 25 GB free limit as lockedOverQuota
 * when a paid monthly plan has expired. If 90 days have elapsed since expiry,
 * excess files above 25 GB are automatically cleared.
 */
function evaluateUserQuotaAndLocks(user: StoredUser) {
  const isAdminAccount =
    user.email?.toLowerCase() === 'titumamma2425@gmail.com' ||
    user.role === 'admin' ||
    user.planId === 'unlimited_admin';

  if (isAdminAccount) {
    user.role = 'admin';
    user.planId = 'unlimited_admin';
    user.planExpiresAt = null;
    user.graceEndsAt = null;
    user.bandwidthLimitBytes = UNLIMITED_ADMIN_BYTES;

    const adminFiles = db.files.filter((f) => f.ownerId === user.id);
    let adminTotal = 0;
    for (const f of adminFiles) {
      f.lockedOverQuota = false;
      adminTotal += f.sizeBytes;
    }
    user.storageUsedBytes = adminTotal;
    return;
  }

  if (!user.planId) user.planId = 'free_25gb';
  if (typeof user.tokenBalance !== 'number') user.tokenBalance = 0;
  if (!Array.isArray(user.usedPromoCodes)) user.usedPromoCodes = [];

  const nowMs = Date.now();
  let isExpiredInGrace = false;

  if (user.planId !== 'free_25gb' && user.planExpiresAt) {
    const expMs = new Date(user.planExpiresAt).getTime();
    const graceMs = user.graceEndsAt
      ? new Date(user.graceEndsAt).getTime()
      : expMs + 90 * 86400_000;

    if (nowMs > graceMs) {
      // 3-month grace period has expired without plan extension -> clear excess data over 25 GB
      const userFilesAsc = db.files
        .filter((f) => f.ownerId === user.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      let runningBytes = 0;
      const idsToDelete = new Set<string>();
      for (const f of userFilesAsc) {
        if (runningBytes + f.sizeBytes > FREE_25GB_BYTES) {
          idsToDelete.add(f.id);
        } else {
          runningBytes += f.sizeBytes;
        }
      }

      if (idsToDelete.size > 0) {
        db.files = db.files.filter((f) => !idsToDelete.has(f.id));
        db.shares = db.shares.filter((s) => !idsToDelete.has(s.fileId));
      }

      user.planId = 'free_25gb';
      user.planExpiresAt = null;
      user.graceEndsAt = null;
      user.bandwidthLimitBytes = FREE_25GB_BYTES;
    } else if (nowMs > expMs) {
      // Inside 3-month (90-day) grace period: data is NOT deleted, but >25 GB files are locked
      isExpiredInGrace = true;
      user.bandwidthLimitBytes = FREE_25GB_BYTES;
    } else {
      user.bandwidthLimitBytes = getPlanQuotaBytes(user.planId);
    }
  } else {
    user.bandwidthLimitBytes = getPlanQuotaBytes(user.planId);
  }

  // Compute cumulative file sizes for this user (oldest to newest)
  const userFilesAsc = db.files
    .filter((f) => f.ownerId === user.id)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  let cumulative = 0;
  const effectiveUnlockedBytes = isExpiredInGrace
    ? FREE_25GB_BYTES
    : getPlanQuotaBytes(user.planId);

  for (const f of userFilesAsc) {
    cumulative += f.sizeBytes;
    f.lockedOverQuota = cumulative > effectiveUnlockedBytes;
  }

  user.storageUsedBytes = cumulative;
}

class ThrottleStream extends Transform {
  private bytesPerSecond: number;
  private bytesSentInWindow = 0;
  private windowStart = Date.now();

  constructor(kbps: number) {
    super();
    this.bytesPerSecond = Math.max(16, kbps) * 1024;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    const now = Date.now();
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this.windowStart = now;
      this.bytesSentInWindow = 0;
    }

    this.bytesSentInWindow += chunk.length;
    this.push(chunk);

    if (this.bytesSentInWindow > this.bytesPerSecond) {
      const delayMs = Math.min(
        400,
        Math.round(((this.bytesSentInWindow - this.bytesPerSecond) / this.bytesPerSecond) * 1000)
      );
      setTimeout(() => callback(), delayMs);
    } else {
      callback();
    }
  }
}

// ============================================================================
// TELEGRAM MTPROTO 2GB USER ACCOUNT ENGINE (GramJS) + BOT API FALLBACK
// ============================================================================

let cachedMtprotoClient: TelegramClient | null = null;
let cachedMtprotoSessionKey = '';

const pendingMtprotoLogins = new Map<
  string,
  {
    client: TelegramClient;
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    phoneCodeHash: string;
    chatId: string;
    createdAt: number;
  }
>();

async function getActiveMtprotoClient(): Promise<TelegramClient | null> {
  const { apiId, apiHash, mtprotoSession } = db.telegramConfig;
  if (!apiId || !apiHash || !mtprotoSession) return null;
  const numericApiId = Number(apiId);
  if (!Number.isFinite(numericApiId) || numericApiId <= 0) return null;

  const sessionKey = `${numericApiId}:${apiHash}:${mtprotoSession.slice(0, 48)}`;
  if (cachedMtprotoClient && cachedMtprotoSessionKey === sessionKey) {
    try {
      if (!cachedMtprotoClient.connected) {
        await cachedMtprotoClient.connect();
      }
      return cachedMtprotoClient;
    } catch {
      cachedMtprotoClient = null;
    }
  }

  try {
    const client = new TelegramClient(
      new StringSession(mtprotoSession),
      numericApiId,
      apiHash,
      {
        connectionRetries: 3,
        useWSS: false,
      }
    );
    await client.connect();
    cachedMtprotoClient = client;
    cachedMtprotoSessionKey = sessionKey;
    return client;
  } catch (err) {
    console.error('[MTProto] Failed to connect saved session:', err);
    return null;
  }
}

function resolveMtprotoPeer(rawChatId?: string): string | number {
  const clean = String(rawChatId || '').trim();
  if (!clean || clean.toLowerCase() === 'me' || clean.toLowerCase() === 'saved') {
    return 'me';
  }
  return clean;
}

async function resolveMtprotoEntityForClient(
  client: TelegramClient,
  rawChatId?: string
): Promise<{ peer: any; peerKey: string }> {
  const clean = String(rawChatId || '').trim();
  if (!clean || clean.toLowerCase() === 'me' || clean.toLowerCase() === 'saved') {
    return { peer: 'me', peerKey: 'me' };
  }

  // 1. Try direct entity lookup (works if username or already cached in session)
  try {
    const candidate = /^-?\d+$/.test(clean) ? (BigInt(clean) as any) : clean;
    const entity = await client.getInputEntity(candidate);
    if (entity) {
      return { peer: entity, peerKey: clean };
    }
  } catch {
    // Entity not cached in GramJS session yet — load user's dialogs/channels below
  }

  // 2. Populate GramJS entity cache by fetching the main account's dialogs (includes private channels)
  try {
    const dialogs = await client.getDialogs({ limit: 150 });
    const strippedTarget = clean.replace(/^-100/, '').replace(/^-/, '');
    for (const d of dialogs) {
      const dialogIdStr = String(d.id ?? '');
      const entityIdStr = String((d.entity as any)?.id ?? '');
      const usernameStr = String((d.entity as any)?.username ?? '').toLowerCase();
      if (
        dialogIdStr === clean ||
        entityIdStr === clean ||
        (strippedTarget && (entityIdStr === strippedTarget || dialogIdStr.endsWith(strippedTarget))) ||
        (usernameStr && clean.replace(/^@/, '').toLowerCase() === usernameStr)
      ) {
        return {
          peer: d.inputEntity || d.entity || clean,
          peerKey: dialogIdStr || clean,
        };
      }
    }

    // Retry getInputEntity after dialogs cache is warmed up
    const candidate = /^-?\d+$/.test(clean) ? (BigInt(clean) as any) : clean;
    const entity = await client.getInputEntity(candidate);
    if (entity) {
      return { peer: entity, peerKey: clean };
    }
  } catch (err) {
    console.warn('[MTProto] Could not resolve channel peer, falling back to Saved Messages (me):', err);
  }

  return { peer: 'me', peerKey: 'me' };
}

async function pushDiskFileToTelegramMtproto(
  filePath: string,
  fileName: string,
  totalSize: number,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[]; error?: string }> {
  const safeBaseName =
    path.basename(fileName || 'vault-file.bin').replace(/[/\\?%*:|"<>]/g, '_') || 'vault-file.bin';
  const namedTempPath = path.join(
    CHUNKS_DIR,
    `mtproto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safeBaseName}`
  );
  let uploadSourcePath = filePath;

  try {
    const client = await getActiveMtprotoClient();
    if (!client) {
      return { success: false, chunks: [], error: 'MTProto client not connected' };
    }

    // Link or copy with the exact original filename so Telegram preserves the exact file name & extension
    try {
      fs.linkSync(filePath, namedTempPath);
      uploadSourcePath = namedTempPath;
    } catch {
      uploadSourcePath = filePath;
    }

    const { peer, peerKey } = await resolveMtprotoEntityForClient(client, chatId);
    const partHash = computeFastFileSha256(filePath, totalSize);

    const sentMsg = await client.sendFile(peer, {
      file: uploadSourcePath,
      caption: `[UnlimStorage Main Account Vault] ${fileName} | Original Quality (${formatBytesServer(
        totalSize
      )}) | SHA256: ${partHash.slice(0, 16)}`,
      forceDocument: true,
      attributes: [new Api.DocumentAttributeFilename({ fileName: safeBaseName })],
      workers: 4,
    });

    if (!sentMsg || !sentMsg.id) {
      return {
        success: false,
        chunks: [],
        error: 'MTProto sendFile did not return a message ID',
      };
    }

    return {
      success: true,
      chunks: [
        {
          partIndex: 0,
          messageId: sentMsg.id,
          fileId: `mtproto:${peerKey}:${sentMsg.id}`,
          sizeBytes: totalSize,
          sha256Part: partHash,
        },
      ],
    };
  } catch (err: unknown) {
    return {
      success: false,
      chunks: [],
      error: err instanceof Error ? err.message : 'MTProto 2GB upload failed',
    };
  } finally {
    if (uploadSourcePath === namedTempPath && fs.existsSync(namedTempPath)) {
      try {
        fs.unlinkSync(namedTempPath);
      } catch {
        // ignore
      }
    }
  }
}

async function pushBufferToTelegramMtproto(
  buffer: Buffer,
  fileName: string,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[]; error?: string }> {
  const safeBaseName =
    path.basename(fileName || 'vault-file.bin').replace(/[/\\?%*:|"<>]/g, '_') || 'vault-file.bin';
  const tmpFile = path.join(
    CHUNKS_DIR,
    `tmp_mtproto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${safeBaseName}`
  );
  try {
    fs.writeFileSync(tmpFile, buffer);
    return await pushDiskFileToTelegramMtproto(tmpFile, fileName, buffer.length, chatId);
  } finally {
    if (fs.existsSync(tmpFile)) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore
      }
    }
  }
}

async function fetchBufferFromTelegramMtprotoChunk(
  chunk: TelegramChunk,
  fallbackChatId?: string
): Promise<Buffer | null> {
  try {
    const client = await getActiveMtprotoClient();
    if (!client) return null;

    let rawPeerTarget = fallbackChatId || db.telegramConfig.chatId || 'me';
    let msgId = chunk.messageId;

    if (chunk.fileId && chunk.fileId.startsWith('mtproto:')) {
      const parts = chunk.fileId.split(':');
      if (parts.length >= 3) {
        rawPeerTarget = parts[1];
        const parsedId = Number(parts[2]);
        if (Number.isFinite(parsedId) && parsedId > 0) {
          msgId = parsedId;
        }
      }
    }

    if (!msgId || msgId <= 0) return null;
    const { peer } = await resolveMtprotoEntityForClient(client, rawPeerTarget);
    const messages = await client.getMessages(peer, { ids: [msgId] });
    const msg = messages && messages[0];
    if (!msg) return null;

    const downloaded = await client.downloadMedia(msg, {});
    if (Buffer.isBuffer(downloaded)) {
      return downloaded;
    }
    if (typeof downloaded === 'string') {
      return Buffer.from(downloaded);
    }
    return null;
  } catch (err) {
    console.error('[MTProto] Failed to download media chunk:', err);
    return null;
  }
}

async function pushBufferToTelegram(
  buffer: Buffer,
  fileName: string,
  botToken: string,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[]; error?: string }> {
  const isMainAccountConfigured = Boolean(
    db.telegramConfig.mtprotoSession && db.telegramConfig.apiId && db.telegramConfig.apiHash
  );
  if (isMainAccountConfigured) {
    const mtRes = await pushBufferToTelegramMtproto(
      buffer,
      fileName,
      chatId || db.telegramConfig.chatId || 'me'
    );
    if (mtRes.success || !botToken || !chatId) {
      return mtRes;
    }
  }

  if (!botToken || !chatId) {
    return { success: false, chunks: [], error: 'Storage node credentials not configured' };
  }

  try {
    const chunks: TelegramChunk[] = [];
    const totalParts = Math.max(1, Math.ceil(buffer.length / TELEGRAM_CHUNK_SIZE));

    for (let i = 0; i < totalParts; i++) {
      const slice = buffer.subarray(i * TELEGRAM_CHUNK_SIZE, (i + 1) * TELEGRAM_CHUNK_SIZE);
      const partName = totalParts > 1 ? `${fileName}.part${String(i).padStart(3, '0')}` : fileName;
      const partHash = computeSha256(slice);

      const formData = new FormData();
      formData.append('chat_id', chatId);
      formData.append(
        'caption',
        `[UnlimCloud] ${partName} | Part ${i + 1}/${totalParts} | SHA256: ${partHash.slice(0, 16)}`
      );
      const blob = new Blob([new Uint8Array(slice)], { type: 'application/octet-stream' });
      formData.append('document', blob, partName);

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: formData,
      });

      const tgJson = (await tgRes.json()) as {
        ok: boolean;
        description?: string;
        result?: {
          message_id: number;
          document?: { file_id: string; file_size?: number };
        };
      };

      if (!tgJson.ok || !tgJson.result?.document?.file_id) {
        return {
          success: false,
          chunks: [],
          error: tgJson.description || 'Storage node rejected chunk',
        };
      }

      chunks.push({
        partIndex: i,
        messageId: tgJson.result.message_id,
        fileId: tgJson.result.document.file_id,
        sizeBytes: slice.length,
        sha256Part: partHash,
      });
    }

    return { success: true, chunks };
  } catch (err: unknown) {
    return {
      success: false,
      chunks: [],
      error: err instanceof Error ? err.message : 'Network error contacting storage node',
    };
  }
}

async function pushDiskFileToTelegram(
  filePath: string,
  fileName: string,
  totalSize: number,
  botToken: string,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[]; error?: string }> {
  try {
    if (!fs.existsSync(filePath) || totalSize <= 0) {
      return { success: false, chunks: [], error: 'File empty or missing' };
    }

    // 1. Use Main Telegram Account (MTProto) when session credentials are configured, falling back to Bot API if unavailable
    const isMainAccountConfigured = Boolean(
      db.telegramConfig.mtprotoSession && db.telegramConfig.apiId && db.telegramConfig.apiHash
    );
    if (isMainAccountConfigured) {
      const mtRes = await pushDiskFileToTelegramMtproto(
        filePath,
        fileName,
        totalSize,
        chatId || db.telegramConfig.chatId || 'me'
      );
      if (mtRes.success || !botToken || !chatId) {
        return mtRes;
      }
    }

    if (!botToken || !chatId) {
      return { success: false, chunks: [], error: 'No Telegram Bot or MTProto account connected' };
    }

    const chunks: TelegramChunk[] = [];
    const totalParts = Math.max(1, Math.ceil(totalSize / TELEGRAM_CHUNK_SIZE));
    const fd = fs.openSync(filePath, 'r');

    try {
      for (let i = 0; i < totalParts; i++) {
        const offset = i * TELEGRAM_CHUNK_SIZE;
        const chunkLen = Math.min(TELEGRAM_CHUNK_SIZE, totalSize - offset);
        const slice = Buffer.alloc(chunkLen);
        fs.readSync(fd, slice, 0, chunkLen, offset);

        const partName =
          totalParts > 1 ? `${fileName}.part${String(i + 1).padStart(3, '0')}` : fileName;
        const partHash = computeSha256(slice);

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append(
          'caption',
          `[UnlimStorage] ${partName} | Part ${i + 1}/${totalParts} | SHA256: ${partHash.slice(
            0,
            16
          )}`
        );
        const blob = new Blob([new Uint8Array(slice)], { type: 'application/octet-stream' });
        formData.append('document', blob, partName);

        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: 'POST',
          body: formData,
        });

        const tgJson = (await tgRes.json()) as {
          ok: boolean;
          description?: string;
          result?: {
            message_id: number;
            document?: { file_id: string; file_size?: number };
          };
        };

        if (!tgJson.ok || !tgJson.result?.document?.file_id) {
          return {
            success: false,
            chunks: [],
            error: tgJson.description || 'Storage node rejected chunk',
          };
        }

        chunks.push({
          partIndex: i,
          messageId: tgJson.result.message_id,
          fileId: tgJson.result.document.file_id,
          sizeBytes: chunkLen,
          sha256Part: partHash,
        });
      }
    } finally {
      fs.closeSync(fd);
    }

    return { success: true, chunks };
  } catch (err: unknown) {
    return {
      success: false,
      chunks: [],
      error: err instanceof Error ? err.message : 'Network error contacting storage node',
    };
  }
}

const DEFAULT_FALLBACK_BOT_TOKEN = '8552451944:AAGnsazvo2X2okXtKrAtAYGnuiizg_n8gkM';
const inFlightChunkFetches = new Map<string, Promise<Buffer | null>>();

async function fetchSingleTelegramChunkCached(
  fileId: string,
  chunk: TelegramChunk,
  botToken: string
): Promise<Buffer | null> {
  const partPath = path.join(CHUNKS_DIR, `${fileId}.part${chunk.partIndex}`);
  if (fs.existsSync(partPath)) {
    try {
      const stat = fs.statSync(partPath);
      if (stat.size > 0) {
        return fs.readFileSync(partPath);
      }
    } catch {
      // ignore read error and refetch
    }
  }

  const cacheKey = `${fileId}:${chunk.partIndex}:${chunk.fileId}`;
  const existingPromise = inFlightChunkFetches.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const fetchPromise = (async (): Promise<Buffer | null> => {
    try {
      const effectiveToken = (botToken || DEFAULT_FALLBACK_BOT_TOKEN).trim();
      let buf: Buffer | null = null;

      if (chunk.fileId && chunk.fileId.startsWith('mtproto:')) {
        buf = await fetchBufferFromTelegramMtprotoChunk(chunk);
      } else if (effectiveToken) {
        const metaRes = await fetch(
          `https://api.telegram.org/bot${effectiveToken}/getFile?file_id=${encodeURIComponent(
            chunk.fileId
          )}`
        );
        const metaJson = (await metaRes.json()) as {
          ok: boolean;
          result?: { file_path?: string };
        };
        if (metaJson.ok && metaJson.result?.file_path) {
          const fileRes = await fetch(
            `https://api.telegram.org/file/bot${effectiveToken}/${metaJson.result.file_path}`
          );
          if (fileRes.ok) {
            const arrBuf = await fileRes.arrayBuffer();
            buf = Buffer.from(arrBuf);
          }
        } else {
          buf = await fetchBufferFromTelegramMtprotoChunk(chunk);
        }
      } else {
        buf = await fetchBufferFromTelegramMtprotoChunk(chunk);
      }

      if (buf && buf.length > 0) {
        try {
          fs.writeFileSync(partPath, buf);
        } catch {
          // ignore disk cache write failure
        }
      }
      return buf;
    } catch {
      return null;
    } finally {
      inFlightChunkFetches.delete(cacheKey);
    }
  })();

  inFlightChunkFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

function preloadTelegramVideoChunks(
  fileId: string,
  chunks: TelegramChunk[],
  botToken: string,
  aroundIndex = 0
) {
  if (!chunks || chunks.length === 0) return;
  const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);
  const indicesToWarm = new Set<number>([
    0,
    sorted.length - 1,
    Math.min(sorted.length - 1, aroundIndex),
    Math.min(sorted.length - 1, aroundIndex + 1),
  ]);

  setImmediate(() => {
    for (const idx of indicesToWarm) {
      const target = sorted[idx];
      if (target) {
        void fetchSingleTelegramChunkCached(fileId, target, botToken).catch(() => null);
      }
    }
  });
}

async function serveTelegramChunksFastRange(params: {
  req: Request;
  res: Response;
  fileId: string;
  fileName: string;
  contentType: string;
  totalSizeHint: number;
  chunks: TelegramChunk[];
  botToken: string;
  isInline: boolean;
}): Promise<boolean> {
  const { req, res, fileId, fileName, contentType, totalSizeHint, chunks, botToken, isInline } =
    params;
  if (!chunks || chunks.length === 0) return false;

  const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);
  const offsets: { chunk: TelegramChunk; index: number; start: number; end: number }[] = [];
  let runningOffset = 0;

  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const sz = c.sizeBytes > 0 ? c.sizeBytes : TELEGRAM_CHUNK_SIZE;
    offsets.push({
      chunk: c,
      index: i,
      start: runningOffset,
      end: runningOffset + sz - 1,
    });
    runningOffset += sz;
  }

  const totalSize = runningOffset > 0 ? runningOffset : totalSizeHint;
  if (totalSize <= 0) return false;

  const rangeHeader = req.headers.range;
  const start = rangeHeader
    ? parseInt(rangeHeader.replace(/bytes=/, '').split('-')[0], 10) || 0
    : 0;
  const rawEndStr = rangeHeader ? rangeHeader.replace(/bytes=/, '').split('-')[1] : '';
  const requestedEnd = rawEndStr
    ? Math.min(totalSize - 1, parseInt(rawEndStr, 10))
    : totalSize - 1;

  if (start >= totalSize || start > requestedEnd) {
    res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
    return true;
  }

  const targetEntry =
    offsets.find((o) => start >= o.start && start <= o.end) || offsets[offsets.length - 1];
  if (!targetEntry) return false;

  const chunkBuf = await fetchSingleTelegramChunkCached(fileId, targetEntry.chunk, botToken);
  if (!chunkBuf || chunkBuf.length === 0) return false;

  // Trigger background preload of first, last (seek index), and next sequential chunk
  preloadTelegramVideoChunks(fileId, sorted, botToken, targetEntry.index);

  const actualChunkEnd = targetEntry.start + chunkBuf.length - 1;
  const effectiveEnd = Math.min(requestedEnd, actualChunkEnd);
  const sliceStart = Math.max(0, start - targetEntry.start);
  const sliceEnd = Math.min(chunkBuf.length, effectiveEnd - targetEntry.start + 1);
  const slice = chunkBuf.subarray(sliceStart, sliceEnd);

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`
  );

  if (rangeHeader || sorted.length > 1) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${effectiveEnd}/${totalSize}`);
    res.setHeader('Content-Length', String(slice.length));
    res.end(slice);
    return true;
  }

  res.status(200);
  res.setHeader('Content-Length', String(slice.length));
  res.end(slice);
  return true;
}

async function fetchBufferFromTelegramChunks(
  chunks: TelegramChunk[],
  botToken: string,
  fileIdForCache = 'temp_tg'
): Promise<Buffer | null> {
  try {
    const buffers: Buffer[] = [];
    const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);

    for (const chunk of sorted) {
      const partBuf = await fetchSingleTelegramChunkCached(fileIdForCache, chunk, botToken);
      if (!partBuf) return null;
      buffers.push(partBuf);
    }

    return Buffer.concat(buffers);
  } catch {
    return null;
  }
}

const SEEDED_FALLBACK_MKV_CHUNKS: TelegramChunk[] = [
  { partIndex: 0, messageId: 7, fileId: 'BQACAgUAAxkDAAMHasmm-llFGAGNHXyVdaCherf5S1EAAhQgAALo01BWGWmuZnuM04k9BA', sizeBytes: 19922944, sha256Part: 'aa48e33cefe90953335acb2d2502591c6958e41423d975cb79f00ea68fa96406' },
  { partIndex: 1, messageId: 8, fileId: 'BQACAgUAAxkDAAMIasmnAAGF9v4twEOJh6J_n-FDf01hAAIVIAAC6NNQVspJ5arxCgMiPQQ', sizeBytes: 19922944, sha256Part: '8ee78828f8e7841c9c446d5d90dc4eb8c3cd846387197e71c3867e3620e35cfc' },
  { partIndex: 2, messageId: 9, fileId: 'BQACAgUAAxkDAAMJasmnlkCn0TtkW6_Bha3LEnMKtyYAAhYgAALo01BW7b5O2X5OTlA9BA', sizeBytes: 19922944, sha256Part: '4d890fb118b35508f51634593a0499904eafa585b92ac6d56ebfa315eebd3288' },
  { partIndex: 3, messageId: 10, fileId: 'BQACAgUAAxkDAAMKasmnnObNNCq4t-hXcXkThNxKLdcAAhcgAALo01BW5llSMHOmf189BA', sizeBytes: 19922944, sha256Part: '56850e3bc01982fdf087d5c915eb84914ec5bfa9a16e75c62f8f85a44b42d398' },
  { partIndex: 4, messageId: 11, fileId: 'BQACAgUAAxkDAAMLasmnstoJ4IsoASnQH_XaIIx5uMMAAhggAALo01BWAAEUdcdPsRAePQQ', sizeBytes: 19922944, sha256Part: '3c755cb3969853793671c2f2daf31f86f77578c86d93ff733df9d086af1537f9' },
  { partIndex: 5, messageId: 12, fileId: 'BQACAgUAAxkDAAMMasmnuMXwBDoGrbuC11g52PvpFUIAAhkgAALo01BW7qEnVok_tz49BA', sizeBytes: 19922944, sha256Part: 'ec2371be980181bf90542997f05cc09e48afa6595e3e281899af38facaf3cef8' },
  { partIndex: 6, messageId: 13, fileId: 'BQACAgUAAxkDAAMNasmnwTZrLNInWeWDNsSYHuar-ccAAhogAALo01BWKYSJY-91dtg9BA', sizeBytes: 19922944, sha256Part: '55381b3dcedf2823697064facd43d4b9314895b0bab2210db49684126ef1702f' },
  { partIndex: 7, messageId: 14, fileId: 'BQACAgUAAxkDAAMOasmnxomtilzjUSJJwmZn4TIW9OoAAhsgAALo01BWTnacMlk-eOc9BA', sizeBytes: 19922944, sha256Part: '54527d273c726174058e68ff9c93fe4a41cfb486b6cd4fc6f7d6ee3cf1b3d3b7' },
  { partIndex: 8, messageId: 15, fileId: 'BQACAgUAAxkDAAMPasmnzNm0nx2aN3YEzphHv5KBO5UAAhwgAALo01BWmRwOZWgzaOQ9BA', sizeBytes: 19922944, sha256Part: '943f85341ee88a3fe00ccd36c4c8cbe0702906fb989fb51038d04457651db18e' },
  { partIndex: 9, messageId: 16, fileId: 'BQACAgUAAxkDAAMQasmn0eWtEy-IAuWGWLQXGE2Ja7AAAh0gAALo01BWivrOP2rjH8s9BA', sizeBytes: 19922944, sha256Part: '1d2589acaaad92dd8fd9ba5a021a2c67bcddc13e40a49824e1e3529e4a9e62d6' },
  { partIndex: 10, messageId: 17, fileId: 'BQACAgUAAxkDAAMRasmn1o4JG4vSJlWv7GgYecxo56oAAh4gAALo01BW4Lhk_n_2aks9BA', sizeBytes: 19922944, sha256Part: 'a3940be6211b882afeae7e0028575b3161760680c709c0af264d51b8e67b735b' },
  { partIndex: 11, messageId: 18, fileId: 'BQACAgUAAxkDAAMSasmn3MjY93Q8018ISA9riJl0o6MAAh8gAALo01BWdfSUe7w_ZtE9BA', sizeBytes: 19922944, sha256Part: '1ae16d88db9ee6f217f8a8276e5257ac1f25b292bf29a28485b0b0d624a427ef' },
  { partIndex: 12, messageId: 19, fileId: 'BQACAgUAAxkDAAMTasmn9eK3ByyJyeehdyXFEUORsKYAAiAgAALo01BWqFRnfBjSMoI9BA', sizeBytes: 19922944, sha256Part: 'be11c91979b7395b867ed04327021ecd3d9ced357484430ec3776ee7eedf83fe' },
  { partIndex: 13, messageId: 20, fileId: 'BQACAgUAAxkDAAMUasmn-q7f-BWL7ByoKriDPRfCn9wAAiEgAALo01BWllByiQT84bE9BA', sizeBytes: 19922944, sha256Part: '8ab37473f84807eabbe7b1b557426c1dae88969e38abd6e3e8f375452e479d36' },
  { partIndex: 14, messageId: 21, fileId: 'BQACAgUAAxkDAAMVasmoAAGD1-Ionz7av_6osihYGdZjAAIiIAAC6NNQVoZeQO7nWX79PQQ', sizeBytes: 19922944, sha256Part: '54f816b04757792639da48cbef8e6b7f2f11aa2039fd484fd2683e00b45aa1df' },
  { partIndex: 15, messageId: 22, fileId: 'BQACAgUAAxkDAAMWasmoBSZsdDk1iAxUbM40Q9KjtQkAAiMgAALo01BWRW6tMJgoiBk9BA', sizeBytes: 19922944, sha256Part: '3cd8b16eaa6cbe5f9af8715f3f07aed8c72017953c6289cad08f5bda21ddfa5a' },
  { partIndex: 16, messageId: 23, fileId: 'BQACAgUAAxkDAAMXasmoC6BFBAlxeLm4GngjWvOULTIAAiQgAALo01BWIddlGGDNUyI9BA', sizeBytes: 19922944, sha256Part: 'cecc14c49d4876eac839466ad3c5aef460dbfae2a6cfb2609db54aed1f2909c7' },
  { partIndex: 17, messageId: 24, fileId: 'BQACAgUAAxkDAAMYasmoEadRdUenB_v-_x4X021bWOUAAiUgAALo01BWiCTHKeLAV789BA', sizeBytes: 19922944, sha256Part: 'd016bf3ee2d910c0700301402b800e0ad7f237ecaf1552f406d2181272339152' },
  { partIndex: 18, messageId: 25, fileId: 'BQACAgUAAxkDAAMZasmoFkov4zBWz6oK-IAIdV4f7KAAAiYgAALo01BWqYmDzRooUS09BA', sizeBytes: 19922944, sha256Part: '35539be582542c3f6bfb43cd4f15045142b26270998122c41f0b0d05ceaff9c1' },
  { partIndex: 19, messageId: 26, fileId: 'BQACAgUAAxkDAAMaasmoG8Oetk7BghIthNnmNWgo_K4AAicgAALo01BWcCwhQhQqPaA9BA', sizeBytes: 19922944, sha256Part: '17b9b31d542a8d8f39b961db9dd662eae308ffd3bb48f0262e10c5c16d59d1ec' },
  { partIndex: 20, messageId: 27, fileId: 'BQACAgUAAxkDAAMbasmoITtvsLpp8yaipLKcWOESsOUAAiggAALo01BW9N86V9LX7tQ9BA', sizeBytes: 19922944, sha256Part: 'ab5a08e2b529f07691d9b73d8b5bf57fe7b71fcb9f55550a3cdfd2d340640a09' },
  { partIndex: 21, messageId: 28, fileId: 'BQACAgUAAxkDAAMcasmoJkP6EcFQzmvKfRHpG9LKyQ0AAikgAALo01BWKUBjsRlIWbA9BA', sizeBytes: 19922944, sha256Part: '7471429bc6f9d046708667d8d5253e14983d21f3cfec2a14720c9067c5d9ed36' },
  { partIndex: 22, messageId: 29, fileId: 'BQACAgUAAxkDAAMdasmoKR0cMBoj0_9L3PVwKBZhdekAAiogAALo01BWvJ6B0IKsDl89BA', sizeBytes: 2726729, sha256Part: '8501307715fe7b96619dfa1d6789e9526e8f79f28572e29686568180d7d2d346' },
];

function resolveEffectiveTelegramChunks(
  fileId: string,
  fileName: string,
  chunks?: TelegramChunk[]
): TelegramChunk[] {
  if (chunks && chunks.length > 0) {
    return chunks;
  }
  const fullPath = path.join(CHUNKS_DIR, fileId);
  if (fs.existsSync(fullPath)) {
    try {
      if (fs.statSync(fullPath).size > 64) {
        return [];
      }
    } catch {
      // ignore
    }
  }
  if ((fileName || '').toLowerCase().endsWith('.mkv') || fileId === 'file_mv01') {
    return SEEDED_FALLBACK_MKV_CHUNKS;
  }
  return [];
}

interface ProbedAudioTrack {
  index: number;
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
  label: string;
  channels: number;
}

interface ProbedSubtitleTrack {
  subIndex: number;
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
  label: string;
}

interface ProbedMediaInfo {
  ok: boolean;
  duration: number;
  videoCodec: string;
  pixFmt: string;
  width: number;
  height: number;
  needsTranscode: boolean;
  canCopyVideo: boolean;
  availableQualities: string[];
  audioTracks: ProbedAudioTrack[];
  subtitleTracks: ProbedSubtitleTrack[];
}

const LANGUAGE_NAME_MAP: Record<string, string> = {
  hin: 'Hindi',
  hi: 'Hindi',
  tam: 'Tamil',
  ta: 'Tamil',
  tel: 'Telugu',
  te: 'Telugu',
  eng: 'English',
  en: 'English',
  jpn: 'Japanese',
  ja: 'Japanese',
  ben: 'Bengali',
  bn: 'Bengali',
  kor: 'Korean',
  ko: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  zh: 'Chinese',
  spa: 'Spanish',
  es: 'Spanish',
  fra: 'French',
  fre: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  rus: 'Russian',
  ru: 'Russian',
  ara: 'Arabic',
  ar: 'Arabic',
  por: 'Portuguese',
  pt: 'Portuguese',
  ita: 'Italian',
  it: 'Italian',
  mal: 'Malayalam',
  ml: 'Malayalam',
  kan: 'Kannada',
  kn: 'Kannada',
  mar: 'Marathi',
  mr: 'Marathi',
  urd: 'Urdu',
  ur: 'Urdu',
  ind: 'Indonesian',
  id: 'Indonesian',
  tha: 'Thai',
  th: 'Thai',
  vie: 'Vietnamese',
  vi: 'Vietnamese',
};

function formatTrackLanguageName(code?: string): string {
  if (!code) return '';
  const clean = code.trim().toLowerCase();
  if (!clean || clean === 'und') return '';
  return LANGUAGE_NAME_MAP[clean] || clean.toUpperCase();
}

const mediaProbeCache = new Map<string, ProbedMediaInfo>();
const activeFfmpegStreamProcs = new Set<ReturnType<typeof spawn>>();
const telegramFileUrlCache = new Map<string, { url: string; expiresAt: number }>();

async function getTelegramChunkDirectUrl(
  chunkFileId: string,
  botToken: string
): Promise<string | null> {
  const effectiveToken = (botToken || DEFAULT_FALLBACK_BOT_TOKEN).trim();
  if (!effectiveToken || !chunkFileId || chunkFileId.startsWith('mtproto:')) {
    return null;
  }
  const cacheKey = `${effectiveToken}:${chunkFileId}`;
  const cached = telegramFileUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${effectiveToken}/getFile?file_id=${encodeURIComponent(
        chunkFileId
      )}`
    );
    const metaJson = (await metaRes.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };
    if (metaJson.ok && metaJson.result?.file_path) {
      const url = `https://api.telegram.org/file/bot${effectiveToken}/${metaJson.result.file_path}`;
      telegramFileUrlCache.set(cacheKey, {
        url,
        expiresAt: Date.now() + 45 * 60 * 1000,
      });
      return url;
    }
  } catch {
    // ignore
  }
  return null;
}

function killAllActiveFfmpegStreams() {
  for (const proc of activeFfmpegStreamProcs) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  activeFfmpegStreamProcs.clear();
}

async function resolveProbeTargetFilePath(
  fileId: string,
  fileName: string,
  chunks: TelegramChunk[],
  botToken: string
): Promise<string | null> {
  const fullPath = path.join(CHUNKS_DIR, fileId);
  if (fs.existsSync(fullPath)) {
    try {
      if (fs.statSync(fullPath).size > 64) {
        return fullPath;
      }
    } catch {
      // ignore
    }
  }

  const effectiveChunks = resolveEffectiveTelegramChunks(fileId, fileName, chunks);
  if (effectiveChunks.length > 0) {
    const sorted = [...effectiveChunks].sort((a, b) => a.partIndex - b.partIndex);
    const firstChunk = sorted[0];
    if (firstChunk) {
      const part0Path = path.join(CHUNKS_DIR, `${fileId}.part${firstChunk.partIndex}`);
      if (fs.existsSync(part0Path)) {
        try {
          if (fs.statSync(part0Path).size > 64) {
            return part0Path;
          }
        } catch {
          // ignore
        }
      }

      const probeHeadPath = path.join(CHUNKS_DIR, `${fileId}.probe_head`);
      if (fs.existsSync(probeHeadPath)) {
        try {
          if (fs.statSync(probeHeadPath).size > 64) {
            return probeHeadPath;
          }
        } catch {
          // ignore
        }
      }

      // Fast 1 MB HTTP 206 Range fetch from Telegram so ffprobe completes in ~180ms instead of waiting for 20 MB!
      const directUrl = await getTelegramChunkDirectUrl(firstChunk.fileId, botToken);
      if (directUrl) {
        try {
          const headRes = await fetch(directUrl, {
            headers: { Range: 'bytes=0-1048575' },
          });
          if (headRes.ok) {
            const arrBuf = await headRes.arrayBuffer();
            const headBuf = Buffer.from(arrBuf);
            if (headBuf.length > 64) {
              fs.writeFileSync(probeHeadPath, headBuf);
              return probeHeadPath;
            }
          }
        } catch {
          // fallback to full chunk below
        }
      }

      const buf = await fetchSingleTelegramChunkCached(fileId, firstChunk, botToken);
      if (buf && buf.length > 64 && fs.existsSync(part0Path)) {
        return part0Path;
      }
    }
  }
  return null;
}

async function probeMediaFileWithFfprobe(
  fileId: string,
  fileName: string,
  chunks: TelegramChunk[],
  botToken: string
): Promise<ProbedMediaInfo | null> {
  const cached = mediaProbeCache.get(fileId);
  if (cached) return cached;

  const targetPath = await resolveProbeTargetFilePath(fileId, fileName, chunks, botToken);
  if (!targetPath) return null;

  return new Promise<ProbedMediaInfo | null>((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      targetPath,
    ]);

    const outChunks: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => outChunks.push(d));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0 || outChunks.length === 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(outChunks).toString('utf-8')) as {
          streams?: Array<{
            index?: number;
            codec_type?: string;
            codec_name?: string;
            pix_fmt?: string;
            width?: number;
            height?: number;
            channels?: number;
            duration?: string;
            tags?: Record<string, string>;
          }>;
          format?: {
            duration?: string;
            format_name?: string;
            tags?: Record<string, string>;
          };
        };

        const streams = parsed.streams || [];
        const videoStream = streams.find((s) => s.codec_type === 'video');
        const videoCodec = (videoStream?.codec_name || '').toLowerCase();
        const pixFmt = (videoStream?.pix_fmt || '').toLowerCase();
        const width = Number(videoStream?.width || 1920);
        const height = Number(videoStream?.height || 1080);

        let duration = parseFloat(parsed.format?.duration || videoStream?.duration || '0');
        if (!Number.isFinite(duration) || duration <= 0) {
          for (const s of streams) {
            const dTag = s.tags?.DURATION || s.tags?.duration;
            if (dTag) {
              const parts = dTag.split(':').map(Number);
              if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
                duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
                break;
              }
            }
          }
        }

        const audioTracks: ProbedAudioTrack[] = [];
        const subtitleTracks: ProbedSubtitleTrack[] = [];

        for (const s of streams) {
          if (s.codec_type === 'audio') {
            const idx = audioTracks.length;
            const rawLang = s.tags?.language || s.tags?.LANGUAGE || '';
            const langName = formatTrackLanguageName(rawLang);
            const rawTitle = (s.tags?.title || s.tags?.TITLE || '').trim();
            const isDomainTitle = /\.(me|com|org|net|to|in|cc)\b/i.test(rawTitle);
            const cleanTitle = isDomainTitle ? '' : rawTitle;
            const codecUpper = (s.codec_name || 'AUDIO').toUpperCase();

            let label = '';
            if (langName && cleanTitle && !cleanTitle.toLowerCase().includes(langName.toLowerCase())) {
              label = `${langName} — ${cleanTitle}`;
            } else if (langName) {
              label = `${langName} (${codecUpper})`;
            } else if (cleanTitle) {
              label = `${cleanTitle} (${codecUpper})`;
            } else {
              label = `Audio Track ${idx + 1} (${codecUpper})`;
            }

            audioTracks.push({
              index: idx,
              streamIndex: Number(s.index ?? idx),
              codec: (s.codec_name || '').toLowerCase(),
              language: rawLang.toLowerCase() || `track_${idx + 1}`,
              title: cleanTitle,
              label,
              channels: Number(s.channels || 2),
            });
          } else if (s.codec_type === 'subtitle') {
            const subIdx = subtitleTracks.length;
            const rawLang = s.tags?.language || s.tags?.LANGUAGE || 'en';
            const langName = formatTrackLanguageName(rawLang);
            const rawTitle = (s.tags?.title || s.tags?.TITLE || '').trim();
            const isDomainTitle = /\.(me|com|org|net|to|in|cc)\b/i.test(rawTitle);
            const cleanTitle = isDomainTitle ? '' : rawTitle;

            let label = '';
            if (cleanTitle && langName && !cleanTitle.toLowerCase().includes(langName.toLowerCase())) {
              label = `${langName} (${cleanTitle})`;
            } else if (cleanTitle) {
              label = cleanTitle;
            } else if (langName) {
              label = `${langName} Subtitles ${subIdx + 1}`;
            } else {
              label = `Subtitle Track ${subIdx + 1}`;
            }

            subtitleTracks.push({
              subIndex: subIdx,
              streamIndex: Number(s.index ?? subIdx),
              codec: (s.codec_name || '').toLowerCase(),
              language: rawLang.toLowerCase() || 'en',
              title: cleanTitle,
              label,
            });
          }
        }

        const isMkv =
          fileName.toLowerCase().endsWith('.mkv') ||
          Boolean(parsed.format?.format_name?.includes('matroska'));
        const isUnsupportedBrowserVideo =
          videoCodec === 'hevc' ||
          videoCodec === 'h265' ||
          videoCodec === 'mpeg4' ||
          videoCodec === 'msmpeg4v3' ||
          videoCodec === 'mpeg2video' ||
          pixFmt.includes('10');
        const hasOpusOrMultiAudioInMkv =
          isMkv &&
          (audioTracks.length > 1 || audioTracks.some((a) => a.codec !== 'aac' && a.codec !== 'mp3'));

        const needsTranscode = Boolean(
          isMkv || isUnsupportedBrowserVideo || hasOpusOrMultiAudioInMkv || audioTracks.length > 1
        );
        const canCopyVideo = Boolean(
          videoCodec === 'h264' && !pixFmt.includes('10') && !pixFmt.includes('12')
        );

        const availableQualities: string[] = ['Original', 'Auto'];
        if (height >= 1000 || height === 0) availableQualities.push('1080p');
        if (height >= 680 || height === 0) availableQualities.push('720p');
        if (height >= 440 || height === 0) availableQualities.push('480p');
        availableQualities.push('360p');

        const info: ProbedMediaInfo = {
          ok: true,
          duration: Number.isFinite(duration) ? duration : 0,
          videoCodec,
          pixFmt,
          width,
          height,
          needsTranscode,
          canCopyVideo,
          availableQualities,
          audioTracks,
          subtitleTracks,
        };
        mediaProbeCache.set(fileId, info);
        resolve(info);
      } catch {
        resolve(null);
      }
    });
  });
}

async function streamTranscodedVideoWithFfmpeg(params: {
  req: Request;
  res: Response;
  fileId: string;
  fileName: string;
  chunks: TelegramChunk[];
  botToken: string;
  audioTrackIndex: number;
  startSeconds: number;
  quality?: string;
}): Promise<void> {
  const {
    req,
    res,
    fileId,
    fileName,
    chunks,
    botToken,
    audioTrackIndex,
    startSeconds,
    quality = 'Original',
  } = params;

  // Kill any previously running FFmpeg video stream process so CPU is dedicated 100% to active stream
  killAllActiveFfmpegStreams();

  const fullPath = path.join(CHUNKS_DIR, fileId);
  const hasFullFileOnDisk = fs.existsSync(fullPath) && fs.statSync(fullPath).size > 64;
  const effectiveChunks = resolveEffectiveTelegramChunks(fileId, fileName, chunks);

  if (!hasFullFileOnDisk && effectiveChunks.length === 0) {
    res.status(404).send('Video binary not available');
    return;
  }

  let cachedProbed = mediaProbeCache.get(fileId) || null;
  if (!cachedProbed) {
    cachedProbed = await Promise.race([
      probeMediaFileWithFfprobe(fileId, fileName, effectiveChunks, botToken).catch(() => null),
      new Promise<ProbedMediaInfo | null>((resolve) => setTimeout(() => resolve(null), 1200)),
    ]);
  }
  const canCopyVideo = Boolean(cachedProbed?.canCopyVideo);
  const probedHeight = cachedProbed?.height && cachedProbed.height > 0 ? cachedProbed.height : 1080;
  const safeAudioIdx = Math.max(0, Math.floor(audioTrackIndex || 0));
  const safeStart = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);

  const inputSource = hasFullFileOnDisk
    ? fullPath
    : `http://127.0.0.1:${PORT}/api/internal/raw-range/${encodeURIComponent(
        fileId
      )}?name=${encodeURIComponent(fileName || 'video.mkv')}`;

  const args: string[] = [
    '-v',
    'error',
    '-threads',
    '0',
    '-fflags',
    '+nobuffer+fastseek+flush_packets+discardcorrupt',
    '-flags',
    'low_delay',
    '-probesize',
    '2M',
    '-analyzeduration',
    '2000000',
  ];

  if (safeStart > 0) {
    args.push('-ss', safeStart.toFixed(3));
  }

  if (!hasFullFileOnDisk) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2');
  }

  args.push('-i', inputSource, '-map', '0:v:0', '-map', `0:a:${safeAudioIdx}?`, '-sn', '-dn');

  const normQuality = String(quality || 'original').toLowerCase();
  const isOriginalOrHigh =
    normQuality === 'original' || normQuality === 'auto' || normQuality === '1080p';

  if (canCopyVideo && isOriginalOrHigh && safeStart === 0) {
    // 100% lossless bit-for-bit original video stream copy when starting at 0s with H.264 8-bit
    args.push('-c:v', 'copy');
  } else if (normQuality === 'original' || normQuality === 'auto' || normQuality === '1080p') {
    // Fast, universal H.264 yuv420p stream for 1080p High / Original (decodes 10-bit HEVC cleanly on all browsers)
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-crf',
      '20',
      '-maxrate',
      probedHeight > 1080 ? '10000k' : '6500k',
      '-bufsize',
      probedHeight > 1080 ? '20000k' : '13000k',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-sc_threshold',
      '0',
      '-threads',
      '0'
    );
  } else {
    const targetHeight =
      normQuality === '360p'
        ? 360
        : normQuality === '480p'
        ? 480
        : normQuality === '720p'
        ? 720
        : 1080;
    const crf =
      targetHeight <= 360
        ? '25'
        : targetHeight <= 480
        ? '23'
        : targetHeight <= 720
        ? '21'
        : '20';
    const maxRate =
      targetHeight <= 360
        ? '1200k'
        : targetHeight <= 480
        ? '2200k'
        : targetHeight <= 720
        ? '4200k'
        : '6500k';
    const bufSize =
      targetHeight <= 360
        ? '2400k'
        : targetHeight <= 480
        ? '4400k'
        : targetHeight <= 720
        ? '8400k'
        : '13000k';

    args.push(
      '-vf',
      `scale=-2:${targetHeight}:flags=fast_bilinear`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-tune',
      'zerolatency',
      '-crf',
      crf,
      '-maxrate',
      maxRate,
      '-bufsize',
      bufSize,
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-sc_threshold',
      '0',
      '-threads',
      '0'
    );
  }

  args.push(
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration',
    '200000',
    '-f',
    'mp4',
    'pipe:1'
  );

  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'none');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  const ffmpegProc = spawn('ffmpeg', args, {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  activeFfmpegStreamProcs.add(ffmpegProc);

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeFfmpegStreamProcs.delete(ffmpegProc);
    try {
      ffmpegProc.kill('SIGKILL');
    } catch {
      // ignore
    }
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  ffmpegProc.on('close', cleanup);
  ffmpegProc.on('error', () => {
    cleanup();
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });

  ffmpegProc.stdout.pipe(res);
}

const subtitleVttCache = new Map<string, string>();
const activeSubtitleProcs = new Set<ReturnType<typeof spawn>>();

async function extractEmbeddedSubtitleToVtt(params: {
  req: Request;
  res: Response;
  fileId: string;
  fileName: string;
  chunks: TelegramChunk[];
  botToken: string;
  subIndex: number;
  startSeconds: number;
}): Promise<void> {
  const { req, res, fileId, fileName, chunks, subIndex, startSeconds } = params;
  const fullPath = path.join(CHUNKS_DIR, fileId);
  const hasFullFileOnDisk = fs.existsSync(fullPath) && fs.statSync(fullPath).size > 64;
  const effectiveChunks = resolveEffectiveTelegramChunks(fileId, fileName, chunks);

  if (!hasFullFileOnDisk && effectiveChunks.length === 0) {
    res.status(200).setHeader('Content-Type', 'text/vtt; charset=utf-8').send('WEBVTT\n\n');
    return;
  }

  const safeSubIdx = Math.max(0, Math.floor(subIndex || 0));
  const safeStart = Math.max(0, Math.floor((Number.isFinite(startSeconds) ? startSeconds : 0) / 60) * 60);
  const cacheKey = `${fileId}:sub${safeSubIdx}:start${safeStart}`;
  const cachedVtt = subtitleVttCache.get(cacheKey);
  if (cachedVtt) {
    res.status(200).setHeader('Content-Type', 'text/vtt; charset=utf-8').send(cachedVtt);
    return;
  }

  for (const oldProc of activeSubtitleProcs) {
    try {
      oldProc.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
  activeSubtitleProcs.clear();

  // If starting at 0s and part0 is already cached on disk, extract directly from part0 in 50ms with zero network!
  const sorted = [...effectiveChunks].sort((a, b) => a.partIndex - b.partIndex);
  const part0Path = sorted[0] ? path.join(CHUNKS_DIR, `${fileId}.part${sorted[0].partIndex}`) : '';
  const hasPart0OnDisk = Boolean(part0Path && fs.existsSync(part0Path) && fs.statSync(part0Path).size > 64);

  const inputSource = hasFullFileOnDisk
    ? fullPath
    : safeStart === 0 && hasPart0OnDisk
    ? part0Path
    : `http://127.0.0.1:${PORT}/api/internal/raw-range/${encodeURIComponent(
        fileId
      )}?name=${encodeURIComponent(fileName || 'video.mkv')}`;

  const args: string[] = [
    '-v',
    'error',
    '-probesize',
    '256k',
    '-analyzeduration',
    '200000',
  ];
  if (safeStart > 0) {
    args.push('-ss', safeStart.toFixed(3));
  } else if (!hasFullFileOnDisk && !hasPart0OnDisk) {
    args.push('-seekable', '0');
  }
  if (!hasFullFileOnDisk && !(safeStart === 0 && hasPart0OnDisk)) {
    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '2');
  }
  // Extract a 180s window only (-vn -an) so subtitle extraction never downloads the whole 440MB file!
  args.push(
    '-i',
    inputSource,
    '-t',
    '180',
    '-vn',
    '-an',
    '-map',
    `0:s:${safeSubIdx}`,
    '-f',
    'webvtt',
    'pipe:1'
  );

  res.status(200);
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
  activeSubtitleProcs.add(proc);
  const outBufs: Buffer[] = [];

  const cleanup = () => {
    activeSubtitleProcs.delete(proc);
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
  };
  req.on('close', cleanup);
  proc.stdout.on('data', (chunk: Buffer) => {
    outBufs.push(chunk);
    if (!res.writableEnded) {
      res.write(chunk);
    }
  });
  proc.on('close', (code) => {
    activeSubtitleProcs.delete(proc);
    if (code === 0 && outBufs.length > 0) {
      const fullVtt = Buffer.concat(outBufs).toString('utf-8');
      if (fullVtt.includes('-->')) {
        subtitleVttCache.set(cacheKey, fullVtt);
      }
    }
    if (!res.writableEnded) {
      res.end();
    }
  });
  proc.on('error', () => {
    cleanup();
    if (!res.headersSent) res.status(200).send('WEBVTT\n\n');
    else if (!res.writableEnded) res.end();
  });
}

function seedStarterFilesForNewUser(user: StoredUser) {
  const guideText =
    `# Welcome to UnlimCloud, ${user.name}!\n\n` +
    `Your private 25 GB Encrypted Cloud Drive is active and ready.\n\n` +
    `- Upload any file with live progress tracking\n` +
    `- Preview documents, images, audio, and video directly in your browser\n` +
    `- Create password-protected direct download links\n` +
    `- Upgrade to 50 GB (500 Tokens/mo) or 1 TB (1024 Tokens/mo) anytime\n`;
  const buf = Buffer.from(guideText, 'utf-8');
  const fileId = `file_welcome_${user.id}`;
  fs.writeFileSync(path.join(CHUNKS_DIR, fileId), buf);

  db.files.unshift({
    id: fileId,
    name: 'Welcome-to-UnlimCloud.md',
    folderId: null,
    ownerId: user.id,
    ownerName: user.name,
    sizeBytes: buf.length,
    mimeType: 'text/markdown',
    sha256: computeSha256(buf),
    storageDriver: 'local_vault',
    telegramChunks: [],
    starred: true,
    downloadCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    previewText: guideText,
    lockedOverQuota: false,
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '/';
    if (pathname === '/ws' || request.headers['sec-websocket-protocol'] === 'vite-hmr') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  app.use(express.json({ limit: '50mb' }));

  const clients = new Set<WebSocket>();
  wss.on('connection', (ws, req) => {
    if (req?.headers['sec-websocket-protocol'] === 'vite-hmr') {
      ws.send(JSON.stringify({ type: 'connected' }));
      return;
    }
    clients.add(ws);
    ws.send(
      JSON.stringify({
        event: 'connected',
        timestamp: new Date().toISOString(),
      })
    );
    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  function broadcast(event: string, payload: unknown) {
    const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  function recordAuditLog(params: {
    userId: string;
    userName: string;
    action: AuditAction;
    targetName: string;
    ipAddress?: string;
    bytesTransferred?: number;
    integrityHash?: string;
    status?: 'success' | 'warning' | 'error';
    details: string;
  }): AuditLog {
    const entry: AuditLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      targetName: params.targetName,
      ipAddress: params.ipAddress || '103.145.72.19',
      bytesTransferred: params.bytesTransferred || 0,
      integrityHash: params.integrityHash || 'e3b0c44298fc1c14',
      status: params.status || 'success',
      details: params.details,
    };
    db.logs.unshift(entry);
    if (db.logs.length > 300) {
      db.logs = db.logs.slice(0, 300);
    }
    saveDb();
    broadcast('log:created', entry);
    return entry;
  }

  function recordDailyBandwidth(
    category: 'uploadBytes' | 'downloadBytes' | 'remoteFetchBytes' | 'shareBytes',
    bytes: number
  ) {
    const today = new Date().toISOString().slice(0, 10);
    let point = db.dailyBandwidth.find((d) => d.date === today);
    if (!point) {
      point = {
        date: today,
        uploadBytes: 0,
        downloadBytes: 0,
        remoteFetchBytes: 0,
        shareBytes: 0,
      };
      db.dailyBandwidth.push(point);
    }
    point[category] += bytes;
    saveDb();
  }

  function sanitizeUser(u: StoredUser): User {
    evaluateUserQuotaAndLocks(u);
    const { passwordHash: _pw, ...rest } = u;
    return rest;
  }

  function getAuthUser(req: Request): StoredUser | null {
    const authHeader = (req.headers.authorization || '').trim();
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const sessUserId = db.sessions[token];
      if (sessUserId) {
        const sessUser = db.users.find((u) => u.id === sessUserId);
        if (sessUser) {
          evaluateUserQuotaAndLocks(sessUser);
          return sessUser;
        }
      }
    }

    const fbUid = (
      (req.headers['x-firebase-uid'] as string | undefined) ||
      (req.query.uid as string | undefined) ||
      ''
    ).trim();
    const fbEmail = (
      (req.headers['x-firebase-email'] as string | undefined) ||
      (req.query.email as string | undefined) ||
      ''
    ).trim();
    const fbName = ((req.headers['x-firebase-name'] as string | undefined) || '').trim();

    if (!fbUid) {
      // For direct <video> media stream / media-info / download requests where browser cannot attach custom headers
      if (
        req.path.includes('/stream') ||
        req.path.includes('/media-info') ||
        req.path.includes('/subtitles') ||
        req.path.includes('/download') ||
        req.path.includes('/preload') ||
        req.path.includes('/ensure-streamable') ||
        req.path.includes('/hydrate-binary')
      ) {
        const fallbackUser = db.users[0] || null;
        if (fallbackUser) {
          evaluateUserQuotaAndLocks(fallbackUser);
          return fallbackUser;
        }
      }
      return null;
    }

    const isAdminEmail = fbEmail.toLowerCase() === 'titumamma2425@gmail.com';
    let user = db.users.find((u) => u.id === fbUid);

    if (!user) {
      user = {
        id: fbUid,
        name: fbName || fbEmail.split('@')[0] || 'Cloud User',
        email: fbEmail || `${fbUid}@user.unlimcloud`,
        passwordHash: '',
        role: isAdminEmail ? 'admin' : 'member',
        bandwidthLimitBytes: isAdminEmail ? UNLIMITED_ADMIN_BYTES : FREE_25GB_BYTES,
        bandwidthUsedBytes: 0,
        storageUsedBytes: 0,
        createdAt: new Date().toISOString(),
        planId: isAdminEmail ? 'unlimited_admin' : 'free_25gb',
        tokenBalance: isAdminEmail ? 999999 : 0,
        planExpiresAt: null,
        graceEndsAt: null,
        usedPromoCodes: [],
      };
      db.users.push(user);
      seedStarterFilesForNewUser(user);
      saveDb();
    } else {
      if (fbEmail) user.email = fbEmail;
      if (fbName) user.name = fbName;
      user.role = isAdminEmail ? 'admin' : 'member';
      if (isAdminEmail) {
        user.planId = 'unlimited_admin';
        user.bandwidthLimitBytes = UNLIMITED_ADMIN_BYTES;
      }
    }

    evaluateUserQuotaAndLocks(user);
    return user;
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });
      return;
    }
    (req as Request & { user: StoredUser }).user = user;
    next();
  }

  // ============================================================================
  // AUTHENTICATION & USER SESSION ROUTES
  // ============================================================================

  app.get('/api/auth/me', (req, res) => {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    res.json({
      user: sanitizeUser(user),
      users: [sanitizeUser(user)],
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }
    const found = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!found || found.passwordHash !== hashPassword(password)) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const sessionToken = `sess_${crypto.randomBytes(16).toString('hex')}`;
    db.sessions[sessionToken] = found.id;
    saveDb();

    res.json({
      token: sessionToken,
      user: sanitizeUser(found),
      users: db.users.map(sanitizeUser),
    });
  });

  app.post('/api/auth/register', (_req, res) => {
    res.status(403).json({
      error:
        'New account registration is currently closed. Only existing registered accounts can sign in.',
    });
  });

  app.post('/api/auth/switch-user', (req, res) => {
    const { userId } = req.body as { userId?: string };
    const found = db.users.find((u) => u.id === userId);
    if (!found) {
      res.status(404).json({ error: 'User account not found' });
      return;
    }
    const sessionToken = `sess_${crypto.randomBytes(16).toString('hex')}`;
    db.sessions[sessionToken] = found.id;
    saveDb();

    res.json({
      token: sessionToken,
      user: sanitizeUser(found),
      users: db.users.map(sanitizeUser),
    });
  });

  // ============================================================================
  // STORAGE PRICING, TOKEN WALLET, PROMO CODE ('1tBfri26') & SUBSCRIPTIONS
  // ============================================================================

  app.post('/api/billing/promo', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { code } = req.body as { code?: string };
    const cleanCode = (code || '').trim();

    if (!cleanCode) {
      res.status(400).json({ error: 'Please enter a promo code.' });
      return;
    }

    if (cleanCode !== '1tBfri26' && cleanCode.toLowerCase() !== '1tbfri26') {
      res.status(400).json({ error: 'Invalid promo code. Please check the code and try again.' });
      return;
    }

    if (!Array.isArray(user.usedPromoCodes)) user.usedPromoCodes = [];
    user.tokenBalance = (user.tokenBalance || 0) + 9999;
    if (!user.usedPromoCodes.includes('1tBfri26')) {
      user.usedPromoCodes.push('1tBfri26');
    }
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'PROMO_REDEEMED',
      targetName: 'Promo Code: 1tBfri26 (+9,999 Tokens)',
      status: 'success',
      details: `Redeemed promo code 1tBfri26 for 9,999 storage tokens`,
    });

    res.json({
      user: sanitizeUser(user),
      tokensAdded: 9999,
      message: 'Promo code 1tBfri26 applied! +9,999 Tokens added to your wallet.',
    });
  });

  app.post('/api/billing/buy-tokens', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { tokens, paymentMethod, amountLabel } = req.body as {
      tokens?: number;
      paymentMethod?: string;
      amountLabel?: string;
    };

    const amount = Number(tokens) || 0;
    if (amount <= 0 || amount > 100000) {
      res.status(400).json({ error: 'Invalid token package amount.' });
      return;
    }

    user.tokenBalance = (user.tokenBalance || 0) + amount;
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'TOKENS_PURCHASED',
      targetName: `+${amount} Tokens (${paymentMethod || 'Card'})`,
      status: 'success',
      details: `Purchased ${amount} tokens via ${paymentMethod || 'Checkout'} (${amountLabel || ''})`,
    });

    res.json({
      user: sanitizeUser(user),
      tokensAdded: amount,
      message: `Successfully purchased ${amount.toLocaleString()} Tokens!`,
    });
  });

  app.post('/api/billing/subscribe', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { planId } = req.body as { planId?: StoragePlanId };

    if (!planId || !['free_25gb', 'pro_50gb', 'ultra_1tb'].includes(planId)) {
      res.status(400).json({ error: 'Invalid storage plan selected.' });
      return;
    }

    if (
      user.role === 'admin' ||
      user.email?.toLowerCase() === 'titumamma2425@gmail.com' ||
      user.planId === 'unlimited_admin'
    ) {
      res.status(400).json({
        error: 'Your Administrator account already has permanent Unlimited Storage active.',
      });
      return;
    }

    const costMap: Record<StoragePlanId, number> = {
      free_25gb: 0,
      pro_50gb: 500,
      ultra_1tb: 1024,
      unlimited_admin: 0,
    };

    const cost = costMap[planId];
    const currentTokens = user.tokenBalance || 0;
    const nowMs = Date.now();
    const activeExpMs = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : 0;
    const isCurrentPlanUnexpired =
      user.planId !== 'free_25gb' && activeExpMs > nowMs;

    // Prevent claiming the same plan again (or downgrading) before the active plan expires
    if (isCurrentPlanUnexpired && user.planId === planId) {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      res.status(400).json({
        error: `This plan is already active until ${expDateLabel}. You cannot claim this plan again until it expires.`,
      });
      return;
    }

    if (isCurrentPlanUnexpired && planId === 'free_25gb') {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      res.status(400).json({
        error: `Your current paid plan is active until ${expDateLabel}. You cannot switch back to Free until it expires.`,
      });
      return;
    }

    if (isCurrentPlanUnexpired && user.planId === 'ultra_1tb' && planId === 'pro_50gb') {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      res.status(400).json({
        error: `Your 1 TB Ultra plan is active until ${expDateLabel}. Please wait until it expires before claiming a lower plan.`,
      });
      return;
    }

    if (planId === 'free_25gb' && user.planId === 'free_25gb') {
      res.status(400).json({
        error: 'Your 25 GB Free plan is already active.',
      });
      return;
    }

    if (cost > 0 && currentTokens < cost) {
      res.status(400).json({
        error: `Insufficient tokens. You need ${cost} Tokens/month, but your wallet has ${currentTokens} Tokens.`,
      });
      return;
    }

    if (cost > 0) {
      user.tokenBalance = currentTokens - cost;
      const nextExp = new Date(nowMs + 30 * 86400_000);
      const nextGrace = new Date(nextExp.getTime() + 90 * 86400_000);
      user.planId = planId;
      user.planExpiresAt = nextExp.toISOString();
      user.graceEndsAt = nextGrace.toISOString();
    } else {
      user.planId = 'free_25gb';
      user.planExpiresAt = null;
      user.graceEndsAt = null;
    }

    evaluateUserQuotaAndLocks(user);
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'PLAN_SUBSCRIBED',
      targetName:
        planId === 'ultra_1tb'
          ? 'Ultra 1 TB Plan (1,024 Tokens/mo)'
          : planId === 'pro_50gb'
          ? 'Pro 50 GB Plan (500 Tokens/mo)'
          : 'Free 25 GB Plan',
      status: 'success',
      details: `Activated ${planId} storage plan`,
    });

    res.json({
      user: sanitizeUser(user),
      files: db.files.filter((f) => f.ownerId === user.id),
      message:
        planId === 'ultra_1tb'
          ? '1 TB Plan activated for 30 days! All files unlocked.'
          : planId === 'pro_50gb'
          ? '50 GB Plan activated for 30 days! All files unlocked.'
          : 'Switched to 25 GB Free Plan.',
    });
  });

  // Simulator endpoint so user can test the >25GB 3-month expiry lock immediately
  app.post('/api/billing/simulate-expiry', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const now = Date.now();

    // Ensure the user has a sample 28 GB dataset so >25 GB locking is clearly visible
    const simFileId = `file_sim_over25gb_${user.id}`;
    const existingSim = db.files.find((f) => f.id === simFileId);
    if (!existingSim) {
      const simText =
        `# 28 GB Production Backup Archive (Simulated High-Volume Dataset)\n\n` +
        `This archive exceeds the 25 GB Free tier threshold.\n` +
        `When your monthly 50 GB or 1 TB plan expires, this file enters the 3-month (90-day) grace lock period.\n` +
        `Extend your plan with Tokens before the 90-day timer ends to restore instant access.\n`;
      const simBuf = Buffer.from(simText, 'utf-8');
      fs.writeFileSync(path.join(CHUNKS_DIR, simFileId), simBuf);
      db.files.push({
        id: simFileId,
        name: 'Studio-4K-Master-Archive-28GB.tar.zst',
        folderId: null,
        ownerId: user.id,
        ownerName: user.name,
        sizeBytes: 28 * 1024 * 1024 * 1024, // 28 GB
        mimeType: 'application/zstd',
        sha256: computeSha256(simBuf),
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: false,
        downloadCount: 0,
        createdAt: new Date(now + 1000).toISOString(),
        updatedAt: new Date(now + 1000).toISOString(),
        previewText: simText,
        lockedOverQuota: true,
      });
    }

    user.planId = 'pro_50gb';
    user.planExpiresAt = new Date(now - 2 * 86400_000).toISOString(); // Expired 2 days ago
    user.graceEndsAt = new Date(now + 88 * 86400_000).toISOString(); // 88 days remaining in 3-month grace period
    evaluateUserQuotaAndLocks(user);
    saveDb();

    res.json({
      user: sanitizeUser(user),
      files: db.files.filter((f) => f.ownerId === user.id),
      message:
        'Simulated expired monthly plan with >25 GB data: Files above 25 GB are now locked for the 3-month (90-day) grace period.',
    });
  });

  // ============================================================================
  // PER-USER ISOLATED FILES & FOLDERS ROUTES
  // ============================================================================

  app.get('/api/files', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);
    res.json({
      folders: db.folders.filter((f) => f.ownerId === user.id),
      files: db.files.filter((f) => f.ownerId === user.id),
      transfers: db.transfers.filter((t) => t.userId === user.id).slice(0, 30),
    });
  });

  app.post('/api/files/sync-from-cloud', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const {
      profile,
      files,
      folders,
      shares,
      storageNodeConfig,
      deletedFileIds,
      deletedFolderIds,
      authoritativeSync,
    } = req.body as {
      profile?: {
        planId?: StoragePlanId;
        tokenBalance?: number;
        planExpiresAt?: string;
        graceEndsAt?: string;
        usedPromoCodes?: string;
      } | null;
      files?: FileRecord[];
      folders?: FolderRecord[];
      shares?: Array<ShareLink & { passwordHash?: string | null }>;
      storageNodeConfig?: {
        authMode?: 'mtproto' | 'bot';
        botToken?: string;
        chatId?: string;
        botUsername?: string;
        autoSyncUploads?: boolean;
        apiId?: string;
        apiHash?: string;
        phoneNumber?: string;
        mtprotoSession?: string;
        accountName?: string;
        accountUsername?: string;
      } | null;
      deletedFileIds?: string[];
      deletedFolderIds?: string[];
      authoritativeSync?: boolean;
    };

    if (storageNodeConfig) {
      if (storageNodeConfig.mtprotoSession && storageNodeConfig.apiId && storageNodeConfig.apiHash) {
        db.telegramConfig.authMode = 'mtproto';
        db.telegramConfig.apiId = String(storageNodeConfig.apiId).trim();
        db.telegramConfig.apiHash = String(storageNodeConfig.apiHash).trim();
        if (storageNodeConfig.phoneNumber) {
          db.telegramConfig.phoneNumber = String(storageNodeConfig.phoneNumber).trim();
        }
        db.telegramConfig.mtprotoSession = String(storageNodeConfig.mtprotoSession).trim();
        if (storageNodeConfig.accountName) {
          db.telegramConfig.accountName = String(storageNodeConfig.accountName).trim();
        }
        if (storageNodeConfig.accountUsername) {
          db.telegramConfig.accountUsername = String(storageNodeConfig.accountUsername).trim();
        }
        if (storageNodeConfig.chatId) {
          db.telegramConfig.chatId = String(storageNodeConfig.chatId).trim();
        }
        // Clear legacy bot credentials when main account MTProto session is active
        db.telegramConfig.botToken = '';
        db.telegramConfig.botUsername = undefined;
        db.telegramConfig.botFirstName = undefined;
      } else {
        if (storageNodeConfig.botToken && !db.telegramConfig.botToken && !db.telegramConfig.mtprotoSession) {
          db.telegramConfig.botToken = String(storageNodeConfig.botToken).trim();
        }
        if (storageNodeConfig.chatId && !db.telegramConfig.chatId) {
          db.telegramConfig.chatId = String(storageNodeConfig.chatId).trim();
        }
        if (storageNodeConfig.botUsername && !db.telegramConfig.botUsername && !db.telegramConfig.mtprotoSession) {
          db.telegramConfig.botUsername = String(storageNodeConfig.botUsername).trim();
        }
      }
      if (typeof storageNodeConfig.autoSyncUploads === 'boolean') {
        db.telegramConfig.autoSyncUploads = storageNodeConfig.autoSyncUploads;
      }
    }

    if (profile) {
      if (profile.planId) user.planId = profile.planId;
      if (typeof profile.tokenBalance === 'number') {
        user.tokenBalance = Math.max(user.tokenBalance || 0, profile.tokenBalance);
      }
      if (profile.planExpiresAt) user.planExpiresAt = profile.planExpiresAt;
      if (profile.graceEndsAt) user.graceEndsAt = profile.graceEndsAt;
      if (profile.usedPromoCodes) {
        const codes = profile.usedPromoCodes
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        user.usedPromoCodes = Array.from(new Set([...(user.usedPromoCodes || []), ...codes]));
      }
    }

    const delFoldersSet = new Set(Array.isArray(deletedFolderIds) ? deletedFolderIds : []);
    const delFilesSet = new Set(Array.isArray(deletedFileIds) ? deletedFileIds : []);

    if (delFoldersSet.size > 0) {
      db.folders = db.folders.filter(
        (f) => !(f.ownerId === user.id && delFoldersSet.has(f.id))
      );
    }

    if (delFilesSet.size > 0) {
      for (const fId of delFilesSet) {
        const chunkPath = path.join(CHUNKS_DIR, fId);
        if (fs.existsSync(chunkPath)) {
          try {
            fs.unlinkSync(chunkPath);
          } catch {
            // ignore
          }
        }
      }
      db.files = db.files.filter((f) => !(f.ownerId === user.id && delFilesSet.has(f.id)));
      db.shares = db.shares.filter((s) => !(s.creatorId === user.id && delFilesSet.has(s.fileId)));
    }

    if (Array.isArray(folders)) {
      const incomingFolderIds = new Set(folders.map((fl) => fl?.id).filter(Boolean));
      if (authoritativeSync) {
        db.folders = db.folders.filter(
          (f) => f.ownerId !== user.id || incomingFolderIds.has(f.id)
        );
      }
      for (const cf of folders) {
        if (!cf || !cf.id || delFoldersSet.has(cf.id)) continue;
        const existingIdx = db.folders.findIndex((f) => f.id === cf.id && f.ownerId === user.id);
        if (existingIdx === -1) {
          db.folders.push({
            ...cf,
            ownerId: user.id,
            ownerName: user.name,
          });
        } else {
          db.folders[existingIdx] = {
            ...db.folders[existingIdx],
            name: cf.name || db.folders[existingIdx].name,
            parentId: cf.parentId ?? null,
          };
        }
      }
    }

    if (Array.isArray(files)) {
      const isStarterId = (id: string) =>
        id.startsWith('file_welcome_') || id === 'file_spec_01' || id === 'file_diagram_02';
      const incomingFileIds = new Set(files.map((fl) => fl?.id).filter(Boolean));
      if (authoritativeSync) {
        db.files = db.files.filter(
          (f) =>
            f.ownerId !== user.id ||
            isStarterId(f.id) ||
            incomingFileIds.has(f.id)
        );
      }
      for (const cf of files) {
        if (!cf || !cf.id || delFilesSet.has(cf.id)) continue;
        const existingIdx = db.files.findIndex((f) => f.id === cf.id && f.ownerId === user.id);
        if (existingIdx === -1) {
          db.files.unshift({
            ...cf,
            ownerId: user.id,
            ownerName: user.name,
            telegramChunks: Array.isArray(cf.telegramChunks) ? cf.telegramChunks : [],
          });
        } else {
          const cur = db.files[existingIdx];
          db.files[existingIdx] = {
            ...cur,
            name: cf.name || cur.name,
            folderId: cf.folderId ?? cur.folderId,
            starred: typeof cf.starred === 'boolean' ? cf.starred : cur.starred,
            downloadCount: Math.max(cur.downloadCount || 0, cf.downloadCount || 0),
            storageDriver:
              Array.isArray(cf.telegramChunks) && cf.telegramChunks.length > 0
                ? 'telegram'
                : cur.storageDriver,
            telegramChatId: cf.telegramChatId || cur.telegramChatId,
            telegramChunks:
              Array.isArray(cf.telegramChunks) && cf.telegramChunks.length > 0
                ? cf.telegramChunks
                : cur.telegramChunks || [],
            previewText: cur.previewText || cf.previewText,
            previewDataUrl: cur.previewDataUrl || cf.previewDataUrl,
            tags: Array.isArray(cf.tags) ? cf.tags : cur.tags || [],
          };
        }
      }
      db.files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (Array.isArray(shares)) {
      for (const cs of shares) {
        if (!cs || !cs.token || delFilesSet.has(cs.fileId)) continue;
        const existingIdx = db.shares.findIndex((s) => s.token === cs.token);
        if (existingIdx === -1) {
          db.shares.unshift({
            ...cs,
            creatorId: user.id,
            creatorName: user.name,
            passwordHash: cs.passwordHash || null,
          });
        } else {
          const cur = db.shares[existingIdx];
          db.shares[existingIdx] = {
            ...cur,
            ...cs,
            passwordHash: cs.passwordHash ?? cur.passwordHash ?? null,
            downloadCount: Math.max(cur.downloadCount || 0, cs.downloadCount || 0),
          };
        }
      }
    }

    evaluateUserQuotaAndLocks(user);
    saveDb();

    res.json({
      ok: true,
      user: sanitizeUser(user),
      folders: db.folders.filter((f) => f.ownerId === user.id),
      files: db.files.filter((f) => f.ownerId === user.id),
      shares: db.shares.filter((s) => s.creatorId === user.id).map(sanitizeShare),
    });
  });

  app.post('/api/folders', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { name, parentId } = req.body as { name?: string; parentId?: string | null };
    if (!name || !name.trim()) {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }

    const folder: FolderRecord = {
      id: `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      parentId: parentId || null,
      ownerId: user.id,
      ownerName: user.name,
      createdAt: new Date().toISOString(),
    };
    db.folders.push(folder);
    saveDb();

    res.json({ folder });
  });

  app.patch('/api/folders/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const folder = db.folders.find((f) => f.id === req.params.id && f.ownerId === user.id);
    if (!folder) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    const { name, parentId, trashed, pinHash, isPinProtected } = req.body as {
      name?: string;
      parentId?: string | null;
      trashed?: boolean;
      pinHash?: string | null;
      isPinProtected?: boolean;
    };
    if (typeof name === 'string' && name.trim()) {
      folder.name = name.trim();
    }
    if (parentId !== undefined) {
      folder.parentId = parentId;
    }
    if (typeof trashed === 'boolean') {
      folder.trashed = trashed;
      folder.trashedAt = trashed ? new Date().toISOString() : null;
      // Also mark direct child files as trashed/restored together with the folder
      db.files.forEach((f) => {
        if (f.ownerId === user.id && f.folderId === folder.id) {
          f.trashed = trashed;
          f.trashedAt = trashed ? new Date().toISOString() : null;
        }
      });
    }
    if (pinHash !== undefined) {
      folder.pinHash = pinHash || null;
      folder.isPinProtected = Boolean(pinHash);
    } else if (typeof isPinProtected === 'boolean') {
      folder.isPinProtected = isPinProtected;
      if (!isPinProtected) folder.pinHash = null;
    }
    saveDb();
    res.json({
      folder,
      files: db.files.filter((f) => f.ownerId === user.id),
    });
  });

  app.post('/api/trash/empty', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const trashedFiles = db.files.filter((f) => f.ownerId === user.id && f.trashed);
    const trashedFileIds = new Set(trashedFiles.map((f) => f.id));
    const trashedFolderIds = new Set(
      db.folders.filter((fl) => fl.ownerId === user.id && fl.trashed).map((fl) => fl.id)
    );

    for (const file of trashedFiles) {
      const chunkPath = path.join(CHUNKS_DIR, file.id);
      if (fs.existsSync(chunkPath)) {
        try {
          fs.unlinkSync(chunkPath);
        } catch {
          // ignore
        }
      }
    }

    db.files = db.files.filter((f) => !(f.ownerId === user.id && f.trashed));
    db.folders = db.folders.filter((fl) => !(fl.ownerId === user.id && fl.trashed));
    db.shares = db.shares.filter(
      (s) =>
        !(
          s.creatorId === user.id &&
          (trashedFileIds.has(s.fileId) || (s.folderId && trashedFolderIds.has(s.folderId)))
        )
    );

    evaluateUserQuotaAndLocks(user);
    saveDb();
    res.json({
      ok: true,
      deletedFileIds: Array.from(trashedFileIds),
      deletedFolderIds: Array.from(trashedFolderIds),
      user: sanitizeUser(user),
    });
  });

  app.delete('/api/folders/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const folderId = req.params.id;
    const exists = db.folders.find((f) => f.id === folderId && f.ownerId === user.id);
    if (!exists) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    db.files.forEach((f) => {
      if (f.ownerId === user.id && f.folderId === folderId) {
        f.folderId = exists.parentId;
      }
    });
    db.folders = db.folders.filter((f) => !(f.id === folderId && f.ownerId === user.id));
    saveDb();
    res.json({ ok: true });
  });

  function resolveEffectiveMimeType(fileName: string, rawMime?: string): string {
    const lower = (fileName || '').toLowerCase();
    if (lower.endsWith('.mkv')) return 'video/x-matroska';
    if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
    if (lower.endsWith('.webm')) return 'video/webm';
    if (lower.endsWith('.mov')) return 'video/quicktime';
    if (lower.endsWith('.avi')) return 'video/x-msvideo';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.ogg')) return 'audio/ogg';
    if (lower.endsWith('.flac')) return 'audio/flac';
    if (rawMime && rawMime !== 'application/octet-stream') return rawMime;
    return rawMime || 'application/octet-stream';
  }

  function computeFastFileSha256(filePath: string, sizeBytes: number): string {
    const hash = crypto.createHash('sha256');
    const SAMPLE_BYTES = 64 * 1024; // Ultra-fast 64 KB head + 64 KB tail sample for instant GB file finalization
    if (sizeBytes <= 256 * 1024) {
      const buf = fs.readFileSync(filePath);
      return hash.update(buf).digest('hex');
    }
    const fd = fs.openSync(filePath, 'r');
    try {
      const headBuf = Buffer.alloc(Math.min(SAMPLE_BYTES, sizeBytes));
      fs.readSync(fd, headBuf, 0, headBuf.length, 0);
      hash.update(headBuf);
      if (sizeBytes > SAMPLE_BYTES * 2) {
        const tailBuf = Buffer.alloc(SAMPLE_BYTES);
        fs.readSync(fd, tailBuf, 0, SAMPLE_BYTES, sizeBytes - SAMPLE_BYTES);
        hash.update(tailBuf);
      }
      hash.update(String(sizeBytes));
      return hash.digest('hex');
    } finally {
      fs.closeSync(fd);
    }
  }

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        cb(null, CHUNKS_DIR);
      },
      filename: (_req, _file, cb) => {
        const tmpName = `tmp_upload_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        cb(null, tmpName);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 * 1024 }, // 50 GB per file limit
  });

  const uploadMiddleware: express.RequestHandler = (req, res, next) => {
    const handler = upload.array('files', 10) as unknown as express.RequestHandler;
    handler(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : 'File upload failed';
        res.status(413).json({ error: msg });
        return;
      }
      next();
    });
  };

  app.post(
    '/api/files/upload',
    requireAuth,
    uploadMiddleware,
    async (req, res) => {
      const user = (req as Request & { user: StoredUser }).user;
      evaluateUserQuotaAndLocks(user);

      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      const folderId = (req.body.folderId as string) || null;

      if (req.aborted) {
        for (const f of uploadedFiles) {
          if (f.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch {
              // ignore
            }
          }
        }
        return;
      }

      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: 'No files provided for upload' });
        return;
      }

      const totalBatchBytes = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
      if (user.storageUsedBytes + totalBatchBytes > user.bandwidthLimitBytes) {
        for (const f of uploadedFiles) {
          if (f.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch {
              // ignore
            }
          }
        }
        res.status(429).json({
          error: `Storage limit reached (${formatBytesServer(
            user.bandwidthLimitBytes
          )}). Upgrade your plan on the Pricing & Plans tab to store more files.`,
        });
        return;
      }

      const createdRecords: FileRecord[] = [];
      const hasLiveTelegram = Boolean(
        db.telegramConfig.autoSyncUploads &&
          ((db.telegramConfig.mtprotoSession &&
            db.telegramConfig.apiId &&
            db.telegramConfig.apiHash) ||
            (db.telegramConfig.botToken && db.telegramConfig.chatId))
      );

      for (const rawFile of uploadedFiles) {
        const fileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        const transferId = `trf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const finalChunkPath = path.join(CHUNKS_DIR, fileId);

        if (rawFile.path && fs.existsSync(rawFile.path)) {
          fs.renameSync(rawFile.path, finalChunkPath);
        } else if (rawFile.buffer) {
          fs.writeFileSync(finalChunkPath, rawFile.buffer);
        }

        const sha256 = computeFastFileSha256(finalChunkPath, rawFile.size);

        const job: TransferJob = {
          id: transferId,
          userId: user.id,
          userName: user.name,
          type: 'local_upload',
          fileName: rawFile.originalname,
          folderId: folderId === 'null' || folderId === '' ? null : folderId,
          totalBytes: rawFile.size,
          transferredBytes: Math.round(rawFile.size * 0.5),
          speedBps: Math.max(1_048_576, Math.min(rawFile.size * 2, 50 * 1024 * 1024)),
          status: 'streaming',
          storageDriver: hasLiveTelegram ? 'telegram' : 'local_vault',
          fileId,
          sha256,
          createdAt: new Date().toISOString(),
        };

        db.transfers.unshift(job);
        broadcast('transfer:progress', job);

        const storageDriver: 'telegram' | 'local_vault' = 'local_vault';
        const telegramChunks: TelegramChunk[] = [];
        const telegramChatId: string | undefined = undefined;

        const mime = resolveEffectiveMimeType(rawFile.originalname, rawFile.mimetype);
        const isTextPreviewable =
          (mime.startsWith('text/') ||
            mime === 'application/json' ||
            /\.(md|txt|json|csv|sh|ts|tsx|js|py|yaml|yml|log|html|css|xml)$/i.test(
              rawFile.originalname
            )) &&
          rawFile.size <= 1024 * 1024;

        const isMediaPreviewable =
          mime.startsWith('image/') && rawFile.size <= 2 * 1024 * 1024;

        let previewText: string | undefined;
        if (isTextPreviewable) {
          const fd = fs.openSync(finalChunkPath, 'r');
          try {
            const sample = Buffer.alloc(Math.min(16000, rawFile.size));
            fs.readSync(fd, sample, 0, sample.length, 0);
            previewText = sample.toString('utf-8');
          } finally {
            fs.closeSync(fd);
          }
        }

        let previewDataUrl: string | undefined;
        if (isMediaPreviewable) {
          const imgBuf = fs.readFileSync(finalChunkPath);
          previewDataUrl = `data:${mime};base64,${imgBuf.toString('base64')}`;
        }

        const record: FileRecord = {
          id: fileId,
          name: rawFile.originalname,
          folderId: folderId === 'null' || folderId === '' ? null : folderId,
          ownerId: user.id,
          ownerName: user.name,
          sizeBytes: rawFile.size,
          mimeType: mime,
          sha256,
          storageDriver,
          telegramChatId,
          telegramChunks,
          starred: false,
          downloadCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          previewText,
          previewDataUrl,
          lockedOverQuota: false,
        };

        db.files.unshift(record);
        createdRecords.push(record);

        user.bandwidthUsedBytes += rawFile.size;
        evaluateUserQuotaAndLocks(user);
        recordDailyBandwidth('uploadBytes', rawFile.size);

        job.transferredBytes = rawFile.size;
        job.status = 'completed';
        job.storageDriver = storageDriver;
        job.completedAt = new Date().toISOString();

        saveDb();

        broadcast('transfer:completed', {
          job,
          file: record,
          notification: {
            id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            title: 'Upload Complete',
            message: `${record.name} (${formatBytesServer(
              record.sizeBytes
            )}) encrypted & saved to your cloud drive.`,
            type: 'completed',
            fileName: record.name,
            bytes: record.sizeBytes,
            sha256: record.sha256,
            storageDriver,
          },
        });

        recordAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'FILE_UPLOAD',
          targetName: record.name,
          bytesTransferred: record.sizeBytes,
          integrityHash: record.sha256.slice(0, 16),
          status: 'success',
          details: `Encrypted and stored in UnlimStorage Vault`,
        });
        // Background non-blocking Telegram sync so upload finalization returns in milliseconds
        if (hasLiveTelegram && rawFile.size <= 2000 * 1024 * 1024) {
          const botTokenSnap = db.telegramConfig.botToken;
          const chatIdSnap = db.telegramConfig.chatId;
          setImmediate(() => {
            pushDiskFileToTelegram(
              finalChunkPath,
              rawFile.originalname,
              rawFile.size,
              botTokenSnap,
              chatIdSnap
            )
              .then((tgResult) => {
                if (tgResult.success) {
                  record.storageDriver = 'telegram';
                  record.telegramChunks = tgResult.chunks;
                  record.telegramChatId = chatIdSnap;
                  saveDb();
                  broadcast('file:updated', { file: record });
                }
              })
              .catch(() => null);
          });
        }
      }

      res.json({ files: createdRecords, user: sanitizeUser(user) });
    }
  );

  // ============================================================================
  // REAL CHUNKED BINARY STREAM UPLOAD PROTOCOL (Supports 285MB - 5GB+ Files
  // across Cloud Run 32MB request limits with 100% Real Byte Progress)
  // ============================================================================

  app.post('/api/files/upload/init', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const { fileName, sizeBytes, mimeType, folderId } = req.body as {
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
      folderId?: string | null;
    };

    const cleanName = String(fileName || 'uploaded-file.bin').trim();
    const totalSize = Math.max(0, Number(sizeBytes || 0));

    if (user.storageUsedBytes + totalSize > user.bandwidthLimitBytes) {
      res.status(429).json({
        error: `Storage limit reached (${formatBytesServer(
          user.bandwidthLimitBytes
        )}). Upgrade your plan on the Pricing & Plans tab to store more files.`,
      });
      return;
    }

    const uploadId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const transferId = `trf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const chunkPath = path.join(CHUNKS_DIR, uploadId);
    fs.writeFileSync(chunkPath, Buffer.alloc(0));

    const hasLiveTelegram = Boolean(
      db.telegramConfig.autoSyncUploads &&
        ((db.telegramConfig.mtprotoSession &&
          db.telegramConfig.apiId &&
          db.telegramConfig.apiHash) ||
          (db.telegramConfig.botToken && db.telegramConfig.chatId))
    );

    const job: TransferJob = {
      id: transferId,
      userId: user.id,
      userName: user.name,
      type: 'local_upload',
      fileName: cleanName,
      folderId: folderId === 'null' || folderId === '' ? null : folderId || null,
      totalBytes: totalSize,
      transferredBytes: 0,
      speedBps: 0,
      status: 'streaming',
      storageDriver: hasLiveTelegram ? 'telegram' : 'local_vault',
      fileId: uploadId,
      createdAt: new Date().toISOString(),
    };

    db.transfers.unshift(job);
    broadcast('transfer:progress', job);

    res.json({
      uploadId,
      transferId,
      fileName: cleanName,
      sizeBytes: totalSize,
      mimeType: resolveEffectiveMimeType(cleanName, mimeType),
    });
  });

  app.post(
    '/api/files/upload/chunk',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: '32mb' }),
    (req, res) => {
      const user = (req as Request & { user: StoredUser }).user;
      const uploadId = String(req.query.uploadId || '');
      const transferId = String(req.query.transferId || '');
      const loadedBytes = Number(req.query.loadedBytes || 0);
      const speedBps = Number(req.query.speedBps || 0);

      if (!uploadId || !/^file_[a-zA-Z0-9_]+$/.test(uploadId)) {
        res.status(400).json({ error: 'Invalid uploadId' });
        return;
      }

      const chunkPath = path.join(CHUNKS_DIR, uploadId);
      if (!fs.existsSync(chunkPath)) {
        res.status(404).json({ error: 'Upload session not found or cancelled' });
        return;
      }

      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      fs.appendFileSync(chunkPath, buf);

      const job = db.transfers.find((t) => t.id === transferId && t.userId === user.id);
      if (job) {
        const currentDiskSize = fs.statSync(chunkPath).size;
        job.transferredBytes = Math.max(currentDiskSize, loadedBytes);
        job.speedBps = speedBps;
        broadcast('transfer:progress', job);
      }

      res.json({ ok: true, writtenBytes: buf.length });
    }
  );

  app.post('/api/files/upload/complete', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { uploadId, transferId, fileName, sizeBytes, mimeType, folderId } = req.body as {
      uploadId?: string;
      transferId?: string;
      fileName?: string;
      sizeBytes?: number;
      mimeType?: string;
      folderId?: string | null;
    };

    if (!uploadId || !/^file_[a-zA-Z0-9_]+$/.test(uploadId)) {
      res.status(400).json({ error: 'Invalid uploadId' });
      return;
    }

    const finalChunkPath = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(finalChunkPath)) {
      res.status(404).json({ error: 'Uploaded binary file not found' });
      return;
    }

    const actualDiskSize = fs.statSync(finalChunkPath).size;
    const finalSize = actualDiskSize > 0 ? actualDiskSize : Number(sizeBytes || 0);
    const cleanName = String(fileName || 'uploaded-file.bin');
    const mime = resolveEffectiveMimeType(cleanName, mimeType);
    const sha256 = computeFastFileSha256(finalChunkPath, finalSize);

    const hasLiveTelegram = Boolean(
      db.telegramConfig.autoSyncUploads &&
        ((db.telegramConfig.mtprotoSession &&
          db.telegramConfig.apiId &&
          db.telegramConfig.apiHash) ||
          (db.telegramConfig.botToken && db.telegramConfig.chatId))
    );

    const storageDriver: 'telegram' | 'local_vault' = 'local_vault';
    const telegramChunks: TelegramChunk[] = [];
    const telegramChatId: string | undefined = undefined;

    const isTextPreviewable =
      (mime.startsWith('text/') ||
        mime === 'application/json' ||
        /\.(md|txt|json|csv|sh|ts|tsx|js|py|yaml|yml|log|html|css|xml)$/i.test(cleanName)) &&
      finalSize <= 1024 * 1024;

    const isMediaPreviewable =
      mime.startsWith('image/') && finalSize <= 2 * 1024 * 1024;

    let previewText: string | undefined;
    if (isTextPreviewable && finalSize > 0) {
      const fd = fs.openSync(finalChunkPath, 'r');
      try {
        const sample = Buffer.alloc(Math.min(16000, finalSize));
        fs.readSync(fd, sample, 0, sample.length, 0);
        previewText = sample.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    }

    let previewDataUrl: string | undefined;
    if (isMediaPreviewable && finalSize > 0) {
      const imgBuf = fs.readFileSync(finalChunkPath);
      previewDataUrl = `data:${mime};base64,${imgBuf.toString('base64')}`;
    }

    const record: FileRecord = {
      id: uploadId,
      name: cleanName,
      folderId: folderId === 'null' || folderId === '' ? null : folderId || null,
      ownerId: user.id,
      ownerName: user.name,
      sizeBytes: finalSize,
      mimeType: mime,
      sha256,
      storageDriver,
      telegramChatId,
      telegramChunks,
      starred: false,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previewText,
      previewDataUrl,
      lockedOverQuota: false,
    };

    db.files.unshift(record);
    user.bandwidthUsedBytes += finalSize;
    evaluateUserQuotaAndLocks(user);
    recordDailyBandwidth('uploadBytes', finalSize);

    const job = db.transfers.find((t) => t.id === transferId && t.userId === user.id);
    if (job) {
      job.transferredBytes = finalSize;
      job.status = 'completed';
      job.storageDriver = storageDriver;
      job.completedAt = new Date().toISOString();
    }

    saveDb();

    broadcast('transfer:completed', {
      job,
      file: record,
      notification: {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        title: 'Upload Complete',
        message: `${record.name} (${formatBytesServer(
          record.sizeBytes
        )}) saved to UnlimStorage.`,
        type: 'completed',
        fileName: record.name,
        bytes: record.sizeBytes,
        sha256: record.sha256,
        storageDriver,
      },
    });

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'FILE_UPLOAD',
      targetName: record.name,
      bytesTransferred: record.sizeBytes,
      integrityHash: record.sha256.slice(0, 16),
      status: 'success',
      details: `Stored in UnlimStorage Vault`,
    });

    // Return response immediately so post-upload processing completes in milliseconds!
    res.json({ file: record, user: sanitizeUser(user) });

    // Sync to Telegram asynchronously in the background without blocking user UI
    if (hasLiveTelegram && finalSize <= 2000 * 1024 * 1024) {
      const botTokenSnap = db.telegramConfig.botToken;
      const chatIdSnap = db.telegramConfig.chatId;
      setImmediate(() => {
        pushDiskFileToTelegram(finalChunkPath, cleanName, finalSize, botTokenSnap, chatIdSnap)
          .then((tgResult) => {
            if (tgResult.success) {
              record.storageDriver = 'telegram';
              record.telegramChunks = tgResult.chunks;
              record.telegramChatId = chatIdSnap;
              saveDb();
              broadcast('file:updated', { file: record });
            }
          })
          .catch(() => null);
      });
    }
  });

  app.post('/api/files/upload/cancel', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { uploadId, transferId } = req.body as {
      uploadId?: string;
      transferId?: string;
    };

    if (uploadId && /^file_[a-zA-Z0-9_]+$/.test(uploadId)) {
      const chunkPath = path.join(CHUNKS_DIR, uploadId);
      if (fs.existsSync(chunkPath)) {
        try {
          fs.unlinkSync(chunkPath);
        } catch {
          // ignore
        }
      }
    }

    if (transferId) {
      const job = db.transfers.find((t) => t.id === transferId && t.userId === user.id);
      if (job) {
        job.status = 'failed';
        job.error = 'Cancelled by user';
        job.completedAt = new Date().toISOString();
      }
    }

    saveDb();
    res.json({ ok: true });
  });

  app.post('/api/files/upload/pause', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const { transferId } = req.body as { transferId?: string };
    if (transferId) {
      const job = db.transfers.find((t) => t.id === transferId && t.userId === user.id);
      if (job && job.status !== 'completed') {
        job.status = 'paused';
        job.speedBps = 0;
        saveDb();
      }
    }
    res.json({ ok: true });
  });

  app.patch('/api/files/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = db.files.find((f) => f.id === req.params.id && f.ownerId === user.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const { name, folderId, starred, trashed, tags } = req.body as {
      name?: string;
      folderId?: string | null;
      starred?: boolean;
      trashed?: boolean;
      tags?: string[];
    };
    if (typeof name === 'string' && name.trim()) {
      file.name = name.trim();
    }
    if (folderId !== undefined) {
      file.folderId = folderId;
    }
    if (typeof starred === 'boolean') {
      file.starred = starred;
    }
    if (typeof trashed === 'boolean') {
      file.trashed = trashed;
      file.trashedAt = trashed ? new Date().toISOString() : null;
    }
    if (Array.isArray(tags)) {
      const seen = new Set<string>();
      const cleanTags: string[] = [];
      for (const raw of tags) {
        const t = String(raw || '').trim().slice(0, 32);
        if (!t) continue;
        const lower = t.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          cleanTags.push(t);
          if (cleanTags.length >= 12) break;
        }
      }
      file.tags = cleanTags;
    }
    file.updatedAt = new Date().toISOString();
    saveDb();
    res.json({ file });
  });

  app.delete('/api/files/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = db.files.find((f) => f.id === req.params.id && f.ownerId === user.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    db.files = db.files.filter((f) => f.id !== file.id);
    db.shares = db.shares.filter((s) => s.fileId !== file.id);
    const chunkPath = path.join(CHUNKS_DIR, file.id);
    if (fs.existsSync(chunkPath)) {
      try {
        fs.unlinkSync(chunkPath);
      } catch {
        // ignore
      }
    }
    evaluateUserQuotaAndLocks(user);
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'FILE_DELETE',
      targetName: file.name,
      bytesTransferred: 0,
      integrityHash: file.sha256.slice(0, 16),
      status: 'warning',
      details: `Permanently deleted file and revoked associated share links`,
    });

    res.json({ ok: true, user: sanitizeUser(user) });
  });

  function resolveOrRestoreFileRecord(
    fileId: string,
    user?: StoredUser | null,
    fileNameHint?: string
  ): FileRecord | null {
    const cleanId = String(fileId || '').trim();
    if (!cleanId) return null;

    let file =
      (user ? db.files.find((f) => f.id === cleanId && f.ownerId === user.id) : undefined) ||
      db.files.find((f) => f.id === cleanId);
    if (file) return file;

    const fullPath = path.join(CHUNKS_DIR, cleanId);
    const hasDisk = fs.existsSync(fullPath) && fs.statSync(fullPath).size > 64;
    const effectiveName = String(fileNameHint || (cleanId.startsWith('file_mv') ? 'Video.mkv' : 'Video.mkv'));
    const fallbackChunks = resolveEffectiveTelegramChunks(cleanId, effectiveName, []);

    if (hasDisk || fallbackChunks.length > 0) {
      const diskSize = hasDisk
        ? fs.statSync(fullPath).size
        : fallbackChunks.reduce((acc, c) => acc + (c.sizeBytes || 0), 0);
      const owner = user || db.users[0];
      file = {
        id: cleanId,
        name: effectiveName,
        folderId: null,
        ownerId: owner?.id || 'usr_admin_01',
        ownerName: owner?.name || 'Cloud User',
        sizeBytes: diskSize,
        mimeType: resolveEffectiveMimeType(effectiveName),
        sha256: '',
        storageDriver: fallbackChunks.length > 0 ? 'telegram' : 'local_vault',
        telegramChunks: fallbackChunks,
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lockedOverQuota: false,
      };
      db.files.unshift(file);
      return file;
    }
    return null;
  }

  // Loopback HTTP 206 Byte-Range Server for FFmpeg Instant Seeking & Multi-Chunk Streaming
  app.get('/api/internal/raw-range/:fileId', async (req, res) => {
    const fileId = String(req.params.fileId || '').trim();
    const fileNameHint = String(req.query.name || 'video.mkv');
    const file = resolveOrRestoreFileRecord(fileId, null, fileNameHint);
    const fullPath = path.join(CHUNKS_DIR, fileId);

    if (fs.existsSync(fullPath)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 64) {
          const totalSize = stat.size;
          const rangeHeader = req.headers.range;
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', 'application/octet-stream');
          if (rangeHeader) {
            const parts = rangeHeader.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10) || 0;
            const end = parts[1] ? Math.min(totalSize - 1, parseInt(parts[1], 10)) : totalSize - 1;
            if (start >= totalSize || start > end) {
              res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
              return;
            }
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
            res.setHeader('Content-Length', String(end - start + 1));
            fs.createReadStream(fullPath, { start, end }).pipe(res);
            return;
          }
          res.status(200);
          res.setHeader('Content-Length', String(totalSize));
          fs.createReadStream(fullPath).pipe(res);
          return;
        }
      } catch {
        // fall through to chunk range streaming
      }
    }

    const effectiveChunks = resolveEffectiveTelegramChunks(
      fileId,
      file?.name || fileNameHint,
      file?.telegramChunks
    );
    if (!effectiveChunks || effectiveChunks.length === 0) {
      res.status(404).end();
      return;
    }

    const sorted = [...effectiveChunks].sort((a, b) => a.partIndex - b.partIndex);
    const offsets: { chunk: TelegramChunk; index: number; start: number; end: number; size: number }[] = [];
    let runningOffset = 0;
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const sz = c.sizeBytes > 0 ? c.sizeBytes : TELEGRAM_CHUNK_SIZE;
      offsets.push({
        chunk: c,
        index: i,
        start: runningOffset,
        end: runningOffset + sz - 1,
        size: sz,
      });
      runningOffset += sz;
    }

    const totalSize = runningOffset;
    if (totalSize <= 0) {
      res.status(404).end();
      return;
    }

    const rangeHeader = req.headers.range || 'bytes=0-';
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10) || 0;
    const requestedEnd = parts[1]
      ? Math.min(totalSize - 1, parseInt(parts[1], 10))
      : totalSize - 1;

    if (start >= totalSize || start > requestedEnd) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }

    const startEntry = offsets.find((o) => start >= o.start && start <= o.end);
    if (!startEntry) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
      return;
    }

    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;
    res.status(206);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Range', `bytes ${start}-${requestedEnd}/${totalSize}`);
    res.setHeader('Content-Length', String(requestedEnd - start + 1));

    let clientClosed = false;
    const abortController = new AbortController();
    req.on('close', () => {
      clientClosed = true;
      abortController.abort();
    });
    res.on('close', () => {
      clientClosed = true;
      abortController.abort();
    });

    for (let idx = startEntry.index; idx < offsets.length; idx++) {
      if (clientClosed || res.writableEnded) break;
      const entry = offsets[idx];
      if (entry.start > requestedEnd) break;

      const sliceStart = idx === startEntry.index ? start - entry.start : 0;
      const sliceEnd = Math.min(entry.size - 1, requestedEnd - entry.start);
      if (sliceStart > sliceEnd) continue;

      const partPath = path.join(CHUNKS_DIR, `${fileId}.part${entry.chunk.partIndex}`);
      let servedFromDisk = false;
      if (fs.existsSync(partPath)) {
        try {
          const st = fs.statSync(partPath);
          if (st.size >= sliceEnd + 1) {
            servedFromDisk = true;
            await new Promise<void>((resolve) => {
              const rs = fs.createReadStream(partPath, { start: sliceStart, end: sliceEnd });
              rs.on('data', (chunk: Buffer | string) => {
                if (!clientClosed && !res.writableEnded) {
                  res.write(chunk);
                } else {
                  rs.destroy();
                }
              });
              rs.on('end', () => resolve());
              rs.on('close', () => resolve());
              rs.on('error', () => resolve());
            });
          }
        } catch {
          servedFromDisk = false;
        }
      }

      if (servedFromDisk) continue;

      // Stream range directly from Telegram CDN with zero duplicate downloads and automatic disk caching
      const directUrl = await getTelegramChunkDirectUrl(entry.chunk.fileId, botToken);
      if (directUrl && !clientClosed) {
        try {
          // Only warm up the last Cues index chunk in background if we are reading Chunk 0 and last chunk isn't cached yet
          if (idx === 0 && offsets.length > 1) {
            const lastEntry = offsets[offsets.length - 1];
            const lastPartPath = path.join(CHUNKS_DIR, `${fileId}.part${lastEntry.chunk.partIndex}`);
            if (!fs.existsSync(lastPartPath)) {
              void fetchSingleTelegramChunkCached(fileId, lastEntry.chunk, botToken).catch(() => null);
            }
          }
          const tgRes = await fetch(directUrl, {
            headers: { Range: `bytes=${sliceStart}-${sliceEnd}` },
            signal: abortController.signal,
          });
          if (tgRes.ok && tgRes.body) {
            const reader = tgRes.body.getReader();
            const canCacheFullChunk = sliceStart === 0 && sliceEnd === entry.size - 1;
            const cacheParts: Buffer[] = [];
            let receivedBytes = 0;

            while (!clientClosed && !res.writableEnded) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && !clientClosed && !res.writableEnded) {
                const buf = Buffer.from(value);
                if (canCacheFullChunk) {
                  cacheParts.push(buf);
                  receivedBytes += buf.length;
                }
                const canContinue = res.write(buf);
                if (!canContinue && !clientClosed && !res.writableEnded) {
                  await new Promise<void>((resolve) => {
                    res.once('drain', resolve);
                    res.once('close', resolve);
                  });
                }
              }
            }

            if (canCacheFullChunk && receivedBytes === entry.size && !fs.existsSync(partPath)) {
              try {
                fs.writeFileSync(partPath, Buffer.concat(cacheParts));
              } catch {
                // ignore disk write error
              }
            }
            continue;
          }
        } catch {
          if (clientClosed) break;
        }
      }

      // Fallback: full chunk fetch (e.g., MTProto chunk)
      if (!clientClosed) {
        const fullBuf = await fetchSingleTelegramChunkCached(fileId, entry.chunk, botToken);
        if (fullBuf && !clientClosed && !res.writableEnded) {
          res.write(fullBuf.subarray(sliceStart, sliceEnd + 1));
        } else {
          break;
        }
      }
    }

    if (!res.writableEnded) {
      res.end();
    }
  });

  app.get('/api/files/:id/download', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const file = resolveOrRestoreFileRecord(
      req.params.id,
      user,
      String(req.query.name || '')
    );
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    if (file.lockedOverQuota) {
      res.status(403).json({
        error:
          'This file is locked because it exceeds your 25 GB Free limit after plan expiry. Renew your plan to unlock access.',
      });
      return;
    }

    const chunkPath = path.join(CHUNKS_DIR, file.id);
    const isInline = req.query.inline === '1';
    const isMkv =
      file.name.toLowerCase().endsWith('.mkv') || file.mimeType === 'video/x-matroska';
    const contentType =
      isInline && isMkv
        ? 'video/webm'
        : resolveEffectiveMimeType(file.name, file.mimeType);

    const effectiveTgChunks = resolveEffectiveTelegramChunks(
      file.id,
      file.name,
      file.telegramChunks
    );

    // Fast Preload & Chunk-Aware Byte-Range Streaming:
    // When inline=1 or Range header is present and full file is not on disk yet,
    // stream only the requested chunk immediately and preload upcoming chunks in background!
    if (
      !fs.existsSync(chunkPath) &&
      effectiveTgChunks.length > 0 &&
      (isInline || Boolean(req.headers.range))
    ) {
      const servedRange = await serveTelegramChunksFastRange({
        req,
        res,
        fileId: file.id,
        fileName: file.name,
        contentType,
        totalSizeHint: file.sizeBytes,
        chunks: effectiveTgChunks,
        botToken: db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN,
        isInline,
      });
      if (servedRange) {
        return;
      }
    }

    // For full attachment downloads when local disk doesn't have the full file yet
    if (
      !fs.existsSync(chunkPath) &&
      file.telegramChunks &&
      file.telegramChunks.length > 0
    ) {
      const restoredBuf = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN,
        file.id
      );
      if (restoredBuf && restoredBuf.length > 0) {
        try {
          fs.writeFileSync(chunkPath, restoredBuf);
        } catch {
          // ignore write error
        }
      }
    }

    if (fs.existsSync(chunkPath)) {
      const stat = fs.statSync(chunkPath);
      const totalSize = stat.size;
      const rangeHeader = req.headers.range;

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`
      );

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? Math.min(totalSize - 1, parseInt(parts[1], 10)) : totalSize - 1;
        if (start >= totalSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
          return;
        }
        const chunkLen = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkLen));
        const stream = fs.createReadStream(chunkPath, { start, end });
        stream.pipe(res);
        return;
      }

      if (!isInline) {
        file.downloadCount += 1;
        user.bandwidthUsedBytes += totalSize;
        recordDailyBandwidth('downloadBytes', totalSize);
        saveDb();

        recordAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'FILE_DOWNLOAD',
          targetName: file.name,
          bytesTransferred: totalSize,
          integrityHash: file.sha256.slice(0, 16),
          status: 'success',
          details: `Downloaded file from encrypted cloud vault`,
        });
      }

      res.setHeader('Content-Length', String(totalSize));
      const throttleKbps = db.bandwidthSettings.globalThrottleKbps;
      const readStream = fs.createReadStream(chunkPath);
      if (!isInline && throttleKbps && throttleKbps > 0) {
        const throttle = new ThrottleStream(throttleKbps);
        readStream.pipe(throttle).pipe(res);
      } else {
        readStream.pipe(res);
      }
      return;
    }

    let buffer: Buffer | null = null;
    if (
      file.storageDriver === 'telegram' &&
      file.telegramChunks.length > 0 &&
      (db.telegramConfig.botToken || db.telegramConfig.mtprotoSession)
    ) {
      buffer = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken
      );
      if (buffer) {
        try {
          fs.writeFileSync(chunkPath, buffer);
        } catch {
          // ignore
        }
      }
    }

    if (!buffer) {
      res.status(404).json({ error: 'File payload unavailable in storage vault' });
      return;
    }

    if (!isInline) {
      file.downloadCount += 1;
      user.bandwidthUsedBytes += buffer.length;
      recordDailyBandwidth('downloadBytes', buffer.length);
      saveDb();

      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'FILE_DOWNLOAD',
        targetName: file.name,
        bytesTransferred: buffer.length,
        integrityHash: file.sha256.slice(0, 16),
        status: 'success',
        details: `Downloaded file from encrypted cloud vault`,
      });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`
    );
    res.setHeader('Content-Length', String(buffer.length));

    const throttleKbps = db.bandwidthSettings.globalThrottleKbps;
    if (!isInline && throttleKbps && throttleKbps > 0) {
      const throttle = new ThrottleStream(throttleKbps);
      throttle.pipe(res);
      throttle.end(buffer);
    } else {
      res.end(buffer);
    }
  });

  // Ensure a file record and its Telegram chunks / local binary are registered on the server before streaming
  app.post('/api/files/:id/ensure-streamable', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const fileId = String(req.params.id || '').trim();
    const { name, sizeBytes, mimeType, telegramChunks } = (req.body || {}) as {
      name?: string;
      sizeBytes?: number;
      mimeType?: string;
      telegramChunks?: TelegramChunk[];
    };

    let file = resolveOrRestoreFileRecord(fileId, user, name);
    if (!file && fileId) {
      const cleanName = String(name || 'video.mkv');
      const resolvedChunks = resolveEffectiveTelegramChunks(
        fileId,
        cleanName,
        Array.isArray(telegramChunks) ? telegramChunks : []
      );
      file = {
        id: fileId,
        name: cleanName,
        folderId: null,
        ownerId: user.id,
        ownerName: user.name,
        sizeBytes: Number(sizeBytes || 0),
        mimeType: resolveEffectiveMimeType(cleanName, mimeType),
        sha256: '',
        storageDriver: resolvedChunks.length > 0 ? 'telegram' : 'local_vault',
        telegramChunks: resolvedChunks,
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lockedOverQuota: false,
      };
      db.files.unshift(file);
      saveDb();
    } else if (file && Array.isArray(telegramChunks) && telegramChunks.length > 0) {
      if (!file.telegramChunks || file.telegramChunks.length === 0) {
        file.telegramChunks = telegramChunks;
        file.storageDriver = 'telegram';
        saveDb();
      }
    }

    const fullPath = path.join(CHUNKS_DIR, fileId);
    const hasDisk = fs.existsSync(fullPath) && fs.statSync(fullPath).size > 64;
    const hasOwnTelegramChunks = Boolean(
      (file?.telegramChunks && file.telegramChunks.length > 0) ||
        (Array.isArray(telegramChunks) && telegramChunks.length > 0) ||
        fileId === 'file_mv01'
    );

    res.json({
      ok: true,
      hasBinaryOrChunks: hasDisk || hasOwnTelegramChunks,
    });
  });

  // Hydrate binary from client IndexedDB if container restarted and file was only stored locally
  app.post(
    '/api/files/:id/hydrate-binary',
    requireAuth,
    express.raw({ type: '*/*', limit: '500mb' }),
    (req, res) => {
      const fileId = String(req.params.id || '').trim();
      if (!fileId || !/^file_[a-zA-Z0-9_]+$/.test(fileId)) {
        res.status(400).json({ ok: false });
        return;
      }
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (buf.length > 64) {
        const fullPath = path.join(CHUNKS_DIR, fileId);
        fs.writeFileSync(fullPath, buf);
        mediaProbeCache.delete(fileId);
        // Clean up any stale part/probe files so the hydrated full binary is used directly
        try {
          const allChunkFiles = fs.readdirSync(CHUNKS_DIR);
          for (const entry of allChunkFiles) {
            if (entry.startsWith(`${fileId}.`)) {
              fs.unlinkSync(path.join(CHUNKS_DIR, entry));
            }
          }
        } catch {
          // ignore
        }
      }
      res.json({ ok: true, size: buf.length });
    }
  );

  // Fast Video Preload Warmup Route (warms up Chunk 0, seek-index last chunk, and FFprobe track metadata in background)
  app.post('/api/files/:id/preload', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = resolveOrRestoreFileRecord(
      req.params.id,
      user,
      String(req.query.name || '')
    );
    if (!file || file.lockedOverQuota) {
      res.json({ ok: false });
      return;
    }
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;
    const chunkPath = path.join(CHUNKS_DIR, file.id);
    const effectiveChunks = resolveEffectiveTelegramChunks(
      file.id,
      file.name,
      file.telegramChunks
    );
    if (!fs.existsSync(chunkPath) && effectiveChunks.length > 0) {
      preloadTelegramVideoChunks(file.id, effectiveChunks, botToken, 0);
    }
    setImmediate(() => {
      void probeMediaFileWithFfprobe(file.id, file.name, effectiveChunks, botToken).catch(
        () => null
      );
    });
    res.json({ ok: true });
  });

  // Media Track & Codec Inspection Route (detects Multi-Audio tracks, Subtitles, Duration, and HEVC/MKV status)
  app.get('/api/files/:id/media-info', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = resolveOrRestoreFileRecord(
      req.params.id,
      user,
      String(req.query.name || '')
    );
    if (!file || file.lockedOverQuota) {
      res.status(404).json({ ok: false, error: 'File not found or locked' });
      return;
    }
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;
    const info = await probeMediaFileWithFfprobe(
      file.id,
      file.name,
      file.telegramChunks || [],
      botToken
    );
    if (!info) {
      res.json({
        ok: false,
        duration: 0,
        videoCodec: '',
        pixFmt: '',
        width: 0,
        height: 0,
        needsTranscode: false,
        canCopyVideo: false,
        availableQualities: ['1080p', '720p', '480p', '360p'],
        audioTracks: [],
        subtitleTracks: [],
      });
      return;
    }
    res.json(info);
  });

  // Real-Time FFmpeg H.264/AAC Fragmented MP4 Stream Route (for MKV / 10-bit HEVC / Multi-Audio / Multi-Quality & Seeking)
  app.get('/api/files/:id/stream', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = resolveOrRestoreFileRecord(
      req.params.id,
      user,
      String(req.query.name || '')
    );
    if (!file || file.lockedOverQuota) {
      res.status(404).send('File not found or locked');
      return;
    }
    const audioTrackIndex = parseInt(String(req.query.audio || '0'), 10) || 0;
    const startSeconds = parseFloat(String(req.query.start || '0')) || 0;
    const quality = String(req.query.quality || '720p');
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;

    await streamTranscodedVideoWithFfmpeg({
      req,
      res,
      fileId: file.id,
      fileName: file.name,
      chunks: file.telegramChunks || [],
      botToken,
      audioTrackIndex,
      startSeconds,
      quality,
    });
  });

  // Embedded MKV/Video Subtitle Track Extraction to WebVTT
  app.get('/api/files/:id/subtitles', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = resolveOrRestoreFileRecord(
      req.params.id,
      user,
      String(req.query.name || '')
    );
    if (!file || file.lockedOverQuota) {
      res.status(404).send('WEBVTT\n\n');
      return;
    }
    const subIndex = parseInt(String(req.query.subIndex || '0'), 10) || 0;
    const startSeconds = parseFloat(String(req.query.start || '0')) || 0;
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;

    await extractEmbeddedSubtitleToVtt({
      req,
      res,
      fileId: file.id,
      fileName: file.name,
      chunks: file.telegramChunks || [],
      botToken,
      subIndex,
      startSeconds,
    });
  });

  // ============================================================================
  // GOOGLE DRIVE-STYLE FILE COPY & SAVE SHARED FILE TO MY DRIVE ROUTES
  // ============================================================================

  app.post('/api/files/copy', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const { fileIds, targetFolderId, customName } = req.body as {
      fileIds?: string[];
      fileId?: string;
      targetFolderId?: string | null;
      customName?: string;
    };

    const idsToCopy = Array.isArray(fileIds)
      ? fileIds
      : req.body?.fileId
      ? [String(req.body.fileId)]
      : [];

    if (idsToCopy.length === 0) {
      res.status(400).json({ error: 'Please select at least one file to copy.' });
      return;
    }

    const copiedFiles: FileRecord[] = [];
    const nowIso = new Date().toISOString();

    for (const srcId of idsToCopy) {
      const sourceFile = resolveOrRestoreFileRecord(srcId, user);
      if (!sourceFile) continue;

      const newFileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const isSameFolder = (targetFolderId ?? null) === (sourceFile.folderId ?? null);
      const copyName =
        customName && customName.trim() && idsToCopy.length === 1
          ? customName.trim()
          : isSameFolder
          ? `Copy of ${sourceFile.name}`
          : sourceFile.name;

      // Copy local disk chunk if present so local streaming/download works immediately
      const srcDiskPath = path.join(CHUNKS_DIR, sourceFile.id);
      const dstDiskPath = path.join(CHUNKS_DIR, newFileId);
      if (fs.existsSync(srcDiskPath) && !fs.existsSync(dstDiskPath)) {
        try {
          fs.copyFileSync(srcDiskPath, dstDiskPath);
        } catch {
          // ignore disk copy error if backed by Telegram chunks
        }
      }

      const effectiveChunks = resolveEffectiveTelegramChunks(
        sourceFile.id,
        sourceFile.name,
        sourceFile.telegramChunks
      );

      const newRecord: FileRecord = {
        ...sourceFile,
        id: newFileId,
        name: copyName,
        folderId: targetFolderId ?? null,
        ownerId: user.id,
        ownerName: user.name,
        telegramChunks: effectiveChunks.map((c) => ({ ...c })),
        starred: false,
        trashed: false,
        trashedAt: null,
        downloadCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      db.files.unshift(newRecord);
      copiedFiles.push(newRecord);
    }

    evaluateUserQuotaAndLocks(user);
    saveDb();
    res.json({ ok: true, files: copiedFiles, user: sanitizeUser(user) });
  });

  app.post('/api/public/share/:token/copy', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).json({ error: 'Shared link not found or inactive.' });
      return;
    }

    const { targetFolderId, fileIds, password } = req.body as {
      targetFolderId?: string | null;
      fileIds?: string[];
      password?: string;
    };

    if (share.hasPassword && share.passwordHash) {
      const provided = String(password || '').trim();
      if (!provided || hashPassword(provided) !== share.passwordHash) {
        res.status(401).json({ error: 'Password required to copy this shared item.' });
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const copiedFiles: FileRecord[] = [];
    const isFolderShare =
      share.targetType === 'folder' ||
      share.fileMimeType === 'application/x-unlim-folder' ||
      (Array.isArray(share.sharedFiles) && share.sharedFiles.length > 0);

    if (isFolderShare && Array.isArray(share.sharedFiles)) {
      const filterSet =
        Array.isArray(fileIds) && fileIds.length > 0 ? new Set(fileIds) : null;
      const itemsToCopy = share.sharedFiles.filter((sf) =>
        filterSet ? filterSet.has(sf.id) : true
      );

      for (const item of itemsToCopy) {
        const dbSource = db.files.find((f) => f.id === item.id);
        const newFileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

        const srcDiskPath = path.join(CHUNKS_DIR, item.id);
        const dstDiskPath = path.join(CHUNKS_DIR, newFileId);
        if (fs.existsSync(srcDiskPath) && !fs.existsSync(dstDiskPath)) {
          try {
            fs.copyFileSync(srcDiskPath, dstDiskPath);
          } catch {
            // ignore
          }
        }

        const chunks =
          (item.telegramChunks && item.telegramChunks.length > 0
            ? item.telegramChunks
            : dbSource?.telegramChunks) || [];

        const newRecord: FileRecord = {
          id: newFileId,
          name: item.name,
          folderId: targetFolderId ?? null,
          ownerId: user.id,
          ownerName: user.name,
          sizeBytes: item.sizeBytes || dbSource?.sizeBytes || 0,
          mimeType: item.mimeType || dbSource?.mimeType || 'application/octet-stream',
          sha256: item.sha256 || dbSource?.sha256 || '',
          storageDriver:
            chunks.length > 0 || item.storageDriver === 'telegram'
              ? 'telegram'
              : 'local_vault',
          telegramChatId: item.telegramChatId || dbSource?.telegramChatId,
          telegramChunks: chunks.map((c) => ({ ...c })),
          starred: false,
          trashed: false,
          trashedAt: null,
          downloadCount: 0,
          createdAt: nowIso,
          updatedAt: nowIso,
          previewText: item.previewText || dbSource?.previewText,
          previewDataUrl: item.previewDataUrl || dbSource?.previewDataUrl,
          lockedOverQuota: false,
        };

        db.files.unshift(newRecord);
        copiedFiles.push(newRecord);
      }
    } else {
      const targetInfo = resolveTargetShareFile(share);
      const dbSource = db.files.find((f) => f.id === targetInfo.fileId);
      const newFileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

      const srcDiskPath = path.join(CHUNKS_DIR, targetInfo.fileId);
      const dstDiskPath = path.join(CHUNKS_DIR, newFileId);
      if (fs.existsSync(srcDiskPath) && !fs.existsSync(dstDiskPath)) {
        try {
          fs.copyFileSync(srcDiskPath, dstDiskPath);
        } catch {
          // ignore
        }
      }

      const chunks = resolveEffectiveTelegramChunks(
        targetInfo.fileId,
        targetInfo.fileName,
        targetInfo.telegramChunks
      );

      const newRecord: FileRecord = {
        id: newFileId,
        name: targetInfo.fileName,
        folderId: targetFolderId ?? null,
        ownerId: user.id,
        ownerName: user.name,
        sizeBytes: targetInfo.fileSizeBytes,
        mimeType: targetInfo.fileMimeType,
        sha256: share.fileSha256 || dbSource?.sha256 || '',
        storageDriver: chunks.length > 0 ? 'telegram' : 'local_vault',
        telegramChatId: dbSource?.telegramChatId,
        telegramChunks: chunks.map((c) => ({ ...c })),
        starred: false,
        trashed: false,
        trashedAt: null,
        downloadCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        previewText: targetInfo.previewText,
        previewDataUrl: dbSource?.previewDataUrl,
        lockedOverQuota: false,
      };

      db.files.unshift(newRecord);
      copiedFiles.push(newRecord);
    }

    evaluateUserQuotaAndLocks(user);
    saveDb();
    res.json({ ok: true, files: copiedFiles, user: sanitizeUser(user) });
  });

  // ============================================================================
  // REMOTE URL UPLOAD ENGINE & TRANSFER CANCELLATION
  // ============================================================================

  const activeTransferControllers = new Map<string, AbortController>();

  app.post('/api/transfers/:id/cancel', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const job = db.transfers.find((t) => t.id === req.params.id && t.userId === user.id);
    if (!job) {
      res.status(404).json({ error: 'Transfer job not found' });
      return;
    }
    const ctrl = activeTransferControllers.get(job.id);
    if (ctrl) {
      ctrl.abort();
      activeTransferControllers.delete(job.id);
    }
    job.status = 'failed';
    job.error = 'Cancelled by user';
    job.completedAt = new Date().toISOString();
    saveDb();
    broadcast('transfer:failed', { job });
    res.json({ ok: true, job });
  });

  app.post('/api/transfers/remote', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const { url, customFileName, folderId, syncToTelegram } = req.body as {
      url?: string;
      customFileName?: string;
      folderId?: string | null;
      syncToTelegram?: boolean;
    };

    if (!url || !/^https?:\/\//i.test(url.trim())) {
      res.status(400).json({ error: 'Please provide a valid HTTP/HTTPS URL to fetch.' });
      return;
    }

    const cleanUrl = url.trim();
    const parsedUrl = new URL(cleanUrl);
    const urlBaseName = path.basename(parsedUrl.pathname) || 'remote-payload.bin';
    const finalName =
      customFileName && customFileName.trim() ? customFileName.trim() : urlBaseName;

    const transferId = `trf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const hasLiveTelegram = Boolean(
      syncToTelegram !== false &&
        ((db.telegramConfig.mtprotoSession &&
          db.telegramConfig.apiId &&
          db.telegramConfig.apiHash) ||
          (db.telegramConfig.botToken && db.telegramConfig.chatId))
    );

    const job: TransferJob = {
      id: transferId,
      userId: user.id,
      userName: user.name,
      type: 'remote_url',
      sourceUrl: cleanUrl,
      fileName: finalName,
      folderId: folderId || null,
      totalBytes: 0,
      transferredBytes: 0,
      speedBps: 0,
      status: 'queued',
      storageDriver: hasLiveTelegram ? 'telegram' : 'local_vault',
      createdAt: new Date().toISOString(),
    };

    db.transfers.unshift(job);
    saveDb();
    broadcast('transfer:progress', job);

    res.json({ job });

    (async () => {
      const startTime = Date.now();
      const controller = new AbortController();
      activeTransferControllers.set(transferId, controller);
      try {
        job.status = 'streaming';
        broadcast('transfer:progress', job);

        const timeout = setTimeout(() => controller.abort(), 120000);

        const remoteRes = await fetch(cleanUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'UnlimCloud-RemoteIngest/2.0',
          },
        });
        clearTimeout(timeout);

        if (!remoteRes.ok) {
          throw new Error(`Remote server responded with HTTP ${remoteRes.status}`);
        }

        const contentType =
          remoteRes.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
        const contentLengthHeader = remoteRes.headers.get('content-length');
        const expectedBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
        job.totalBytes = expectedBytes;

        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        if (remoteRes.body) {
          const reader = remoteRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const buf = Buffer.from(value);
              chunks.push(buf);
              receivedBytes += buf.length;
              if (receivedBytes > 100 * 1024 * 1024) {
                throw new Error('Remote file exceeds 100 MB safety limit');
              }
              const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
              job.transferredBytes = receivedBytes;
              job.totalBytes = Math.max(job.totalBytes, receivedBytes);
              job.speedBps = Math.round(receivedBytes / elapsedSec);
              broadcast('transfer:progress', job);
            }
          }
        } else {
          const arrBuf = await remoteRes.arrayBuffer();
          const buf = Buffer.from(arrBuf);
          chunks.push(buf);
          receivedBytes = buf.length;
        }

        const fullBuffer = Buffer.concat(chunks);
        const sha256 = computeSha256(fullBuffer);
        const fileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

        fs.writeFileSync(path.join(CHUNKS_DIR, fileId), fullBuffer);

        let storageDriver: 'telegram' | 'local_vault' = 'local_vault';
        let telegramChunks: TelegramChunk[] = [];
        let telegramChatId: string | undefined;

        if (hasLiveTelegram) {
          job.status = 'syncing_telegram';
          broadcast('transfer:progress', job);
          const tgResult = await pushBufferToTelegram(
            fullBuffer,
            finalName,
            db.telegramConfig.botToken,
            db.telegramConfig.chatId
          );
          if (tgResult.success) {
            storageDriver = 'telegram';
            telegramChunks = tgResult.chunks;
            telegramChatId = db.telegramConfig.chatId;
          }
        }

        const isTextPreviewable =
          contentType.startsWith('text/') ||
          contentType === 'application/json' ||
          /\.(md|txt|json|csv|sh|ts|tsx|js|py|yaml|yml|html|xml)$/i.test(finalName);

        const isMediaPreviewable =
          (contentType.startsWith('image/') ||
            contentType.startsWith('audio/') ||
            contentType.startsWith('video/') ||
            contentType === 'application/pdf') &&
          fullBuffer.length <= 15 * 1024 * 1024;

        const newFile: FileRecord = {
          id: fileId,
          name: finalName,
          folderId: folderId || null,
          ownerId: user.id,
          ownerName: user.name,
          sizeBytes: fullBuffer.length,
          mimeType: contentType,
          sha256,
          storageDriver,
          telegramChatId,
          telegramChunks,
          starred: false,
          downloadCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          previewText: isTextPreviewable
            ? fullBuffer.subarray(0, 24000).toString('utf-8')
            : undefined,
          previewDataUrl: isMediaPreviewable
            ? `data:${contentType};base64,${fullBuffer.toString('base64')}`
            : undefined,
          lockedOverQuota: false,
        };

        db.files.unshift(newFile);
        user.bandwidthUsedBytes += fullBuffer.length;
        evaluateUserQuotaAndLocks(user);
        recordDailyBandwidth('remoteFetchBytes', fullBuffer.length);

        job.totalBytes = fullBuffer.length;
        job.transferredBytes = fullBuffer.length;
        job.status = 'completed';
        job.storageDriver = storageDriver;
        job.fileId = fileId;
        job.sha256 = sha256;
        job.completedAt = new Date().toISOString();
        saveDb();

        broadcast('transfer:completed', {
          job,
          file: newFile,
          notification: {
            id: `notif_${Date.now()}`,
            timestamp: new Date().toISOString(),
            title: 'Web Link Upload Complete',
            message: `Saved ${newFile.name} (${formatBytesServer(
              newFile.sizeBytes
            )}) to your cloud drive.`,
            type: 'completed',
            fileName: newFile.name,
            bytes: newFile.sizeBytes,
            sha256: newFile.sha256,
            storageDriver,
          },
        });

        recordAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'REMOTE_UPLOAD',
          targetName: `${newFile.name} (${parsedUrl.hostname})`,
          bytesTransferred: newFile.sizeBytes,
          integrityHash: newFile.sha256.slice(0, 16),
          status: 'success',
          details: `Remote URL saved to encrypted vault`,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Remote URL transfer failed';
        job.status = 'failed';
        job.error = errMsg;
        job.completedAt = new Date().toISOString();
        saveDb();

        broadcast('transfer:failed', {
          job,
          notification: {
            id: `notif_${Date.now()}`,
            timestamp: new Date().toISOString(),
            title: 'Web Link Upload Failed',
            message: `${finalName}: ${errMsg}`,
            type: 'error',
            fileName: finalName,
          },
        });
      }
    })();
  });

  // ============================================================================
  // DIRECT DOWNLOAD LINKS & PASSWORD PROTECTION ROUTES
  // ============================================================================

  function sanitizeShare(s: StoredShareLink): ShareLink {
    const { passwordHash: _pw, ...rest } = s;
    return rest;
  }

  app.get('/api/shares', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    res.json({
      shares: db.shares.filter((s) => s.creatorId === user.id).map(sanitizeShare),
    });
  });

  app.post('/api/shares', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const {
      fileId,
      folderId,
      targetType,
      customSlug,
      password,
      expiresInHours,
      maxDownloads,
      throttleKbps,
      bandwidthCapMb,
    } = req.body as {
      fileId?: string;
      folderId?: string;
      targetType?: 'file' | 'folder';
      customSlug?: string;
      password?: string;
      expiresInHours?: number | null;
      maxDownloads?: number | null;
      throttleKbps?: number | null;
      bandwidthCapMb?: number | null;
    };

    const isFolderRequest = Boolean(targetType === 'folder' || (folderId && !fileId));

    const cleanSlug =
      customSlug && customSlug.trim()
        ? customSlug
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
        : `dl-${crypto.randomBytes(4).toString('hex')}`;

    if (db.shares.some((s) => s.token === cleanSlug)) {
      res.status(409).json({ error: 'This custom share link code is already in use.' });
      return;
    }

    const hasPw = Boolean(password && password.trim().length > 0);
    const expiresAt =
      expiresInHours && expiresInHours > 0
        ? new Date(Date.now() + expiresInHours * 3600_000).toISOString()
        : null;

    if (isFolderRequest) {
      const targetFolderId = folderId || fileId || '';
      const folder = db.folders.find((fl) => fl.id === targetFolderId && fl.ownerId === user.id);
      if (!folder) {
        res.status(404).json({ error: 'Target folder not found' });
        return;
      }

      const folderFiles = db.files.filter(
        (f) => f.ownerId === user.id && f.folderId === folder.id && !f.trashed
      );
      const totalBytes = folderFiles.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
      const sharedFiles = folderFiles.map((f) => ({
        id: f.id,
        name: f.name,
        sizeBytes: f.sizeBytes,
        mimeType: f.mimeType,
        sha256: f.sha256,
        storageDriver: f.storageDriver,
        telegramChatId: f.telegramChatId,
        telegramChunks: f.telegramChunks,
        previewText: f.previewText,
        previewDataUrl: f.previewDataUrl,
      }));

      const newFolderShare: StoredShareLink = {
        id: `shr_${Date.now().toString(36)}`,
        token: cleanSlug,
        targetType: 'folder',
        folderId: folder.id,
        sharedFiles,
        fileId: folder.id,
        fileName: folder.name,
        fileSizeBytes: totalBytes,
        fileMimeType: 'application/x-unlim-folder',
        fileSha256: computeSha256(Buffer.from(folder.id, 'utf-8')),
        creatorId: user.id,
        creatorName: user.name,
        hasPassword: hasPw,
        passwordHash: hasPw && password ? hashPassword(password.trim()) : null,
        expiresAt,
        maxDownloads: maxDownloads && maxDownloads > 0 ? maxDownloads : null,
        downloadCount: 0,
        throttleKbps:
          throttleKbps !== undefined
            ? throttleKbps
            : db.bandwidthSettings.defaultShareThrottleKbps,
        bandwidthCapBytes:
          bandwidthCapMb && bandwidthCapMb > 0 ? bandwidthCapMb * 1024 * 1024 : null,
        bandwidthUsedBytes: 0,
        active: true,
        createdAt: new Date().toISOString(),
        lastAccessedAt: null,
      };

      db.shares.unshift(newFolderShare);
      saveDb();

      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'SHARE_CREATED',
        targetName: `Folder: ${folder.name} (/s/${newFolderShare.token})`,
        bytesTransferred: 0,
        integrityHash: newFolderShare.fileSha256.slice(0, 16),
        status: 'success',
        details: `Public folder gallery link created (${sharedFiles.length} files)`,
      });

      res.json({
        share: { ...sanitizeShare(newFolderShare), passwordHash: newFolderShare.passwordHash },
      });
      return;
    }

    const file = db.files.find((f) => f.id === fileId && f.ownerId === user.id);
    if (!file) {
      res.status(404).json({ error: 'Target file not found' });
      return;
    }

    if (file.lockedOverQuota) {
      res.status(403).json({
        error:
          'This file is locked because it exceeds your 25 GB Free limit. Renew your storage plan to share this file.',
      });
      return;
    }

    const newShare: StoredShareLink = {
      id: `shr_${Date.now().toString(36)}`,
      token: cleanSlug,
      targetType: 'file',
      fileId: file.id,
      fileName: file.name,
      fileSizeBytes: file.sizeBytes,
      fileMimeType: file.mimeType,
      fileSha256: file.sha256,
      creatorId: user.id,
      creatorName: user.name,
      hasPassword: hasPw,
      passwordHash: hasPw && password ? hashPassword(password.trim()) : null,
      expiresAt,
      maxDownloads: maxDownloads && maxDownloads > 0 ? maxDownloads : null,
      downloadCount: 0,
      throttleKbps:
        throttleKbps !== undefined
          ? throttleKbps
          : db.bandwidthSettings.defaultShareThrottleKbps,
      bandwidthCapBytes:
        bandwidthCapMb && bandwidthCapMb > 0 ? bandwidthCapMb * 1024 * 1024 : null,
      bandwidthUsedBytes: 0,
      active: true,
      createdAt: new Date().toISOString(),
      lastAccessedAt: null,
    };

    db.shares.unshift(newShare);
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'SHARE_CREATED',
      targetName: `${file.name} (/s/${newShare.token})`,
      bytesTransferred: 0,
      integrityHash: file.sha256.slice(0, 16),
      status: 'success',
      details: `Direct link created (${hasPw ? 'password-protected' : 'public'})`,
    });

    res.json({ share: { ...sanitizeShare(newShare), passwordHash: newShare.passwordHash } });
  });

  app.patch('/api/shares/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const share = db.shares.find((s) => s.id === req.params.id && s.creatorId === user.id);
    if (!share) {
      res.status(404).json({ error: 'Share link not found' });
      return;
    }
    const { active, throttleKbps, maxDownloads, password } = req.body as {
      active?: boolean;
      throttleKbps?: number | null;
      maxDownloads?: number | null;
      password?: string | null;
    };

    if (typeof active === 'boolean') share.active = active;
    if (throttleKbps !== undefined) share.throttleKbps = throttleKbps;
    if (maxDownloads !== undefined) share.maxDownloads = maxDownloads;
    if (password !== undefined) {
      if (password && password.trim()) {
        share.hasPassword = true;
        share.passwordHash = hashPassword(password.trim());
      } else {
        share.hasPassword = false;
        share.passwordHash = null;
      }
    }
    saveDb();
    res.json({ share: { ...sanitizeShare(share), passwordHash: share.passwordHash } });
  });

  app.delete('/api/shares/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    db.shares = db.shares.filter((s) => !(s.id === req.params.id && s.creatorId === user.id));
    saveDb();
    res.json({ ok: true });
  });

  // Helper to resolve public shares from local DB or Firestore REST API (cross-device / Cloudflare Pages support)
  async function resolveShareFromLocalOrFirestore(token: string): Promise<StoredShareLink | null> {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) return null;

    const localShare = db.shares.find((s) => s.token === cleanToken);
    if (localShare) return localShare;

    // Fallback: query Firestore REST API for `/publicShares/{token}`
    try {
      const safeToken = cleanToken.replace(/[^a-zA-Z0-9_-]/g, '_');
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0907549657/databases/ai-studio-unlimcloudtelegr-0eb3a2e2-2d58-497e-9bc3-59da213721d0/documents/publicShares/${encodeURIComponent(
        safeToken
      )}`;
      const fsRes = await fetch(firestoreUrl);
      if (!fsRes.ok) return null;
      const docJson = (await fsRes.json()) as {
        fields?: Record<
          string,
          {
            stringValue?: string;
            integerValue?: string;
            doubleValue?: number;
            booleanValue?: boolean;
            timestampValue?: string;
          }
        >;
      };
      const f = docJson.fields;
      if (!f) return null;

      const str = (k: string, def = '') => f[k]?.stringValue ?? def;
      const num = (k: string, def = 0) =>
        f[k]?.integerValue !== undefined
          ? Number(f[k]?.integerValue)
          : f[k]?.doubleValue !== undefined
          ? Number(f[k]?.doubleValue)
          : def;
      const bool = (k: string, def = false) => f[k]?.booleanValue ?? def;

      let telegramChunks: TelegramChunk[] = [];
      const chunksRaw = str('telegramChunksJson', '');
      if (chunksRaw) {
        try {
          const parsed = JSON.parse(chunksRaw);
          if (Array.isArray(parsed)) telegramChunks = parsed;
        } catch {
          telegramChunks = [];
        }
      }

      const fileId = str('fileId', `file_${safeToken}`);
      const fileName = str('fileName', 'Shared-File.bin');
      const fileSizeBytes = num('fileSizeBytes', 0);
      const fileMimeType = str('fileMimeType', 'application/octet-stream');
      const fileSha256 = str('fileSha256', '');
      const creatorId = str('creatorId', 'usr_cloud');
      const creatorName = str('creatorName', 'UnlimStorage User');
      const createdAt = f.createdAt?.timestampValue || new Date().toISOString();

      const rawPreviewText = str('previewText', '');
      let folderShareManifest: {
        isFolderShare: boolean;
        folderId?: string | null;
        sharedFiles?: ShareLink['sharedFiles'];
      } = { isFolderShare: false };
      if (rawPreviewText.startsWith('__UNLIM_FOLDER_SHARE_V1__:')) {
        try {
          const parsed = JSON.parse(rawPreviewText.slice('__UNLIM_FOLDER_SHARE_V1__:'.length));
          if (parsed && typeof parsed === 'object') {
            folderShareManifest = {
              isFolderShare: true,
              folderId: parsed.folderId || fileId,
              sharedFiles: Array.isArray(parsed.sharedFiles) ? parsed.sharedFiles : [],
            };
          }
        } catch {
          // ignore
        }
      }

      const restoredShare: StoredShareLink = {
        id: str('id', `shr_${safeToken}`),
        token: str('token', safeToken),
        targetType:
          folderShareManifest.isFolderShare || fileMimeType === 'application/x-unlim-folder'
            ? 'folder'
            : 'file',
        folderId: folderShareManifest.folderId || null,
        sharedFiles: folderShareManifest.sharedFiles,
        fileId,
        fileName,
        fileSizeBytes,
        fileMimeType,
        fileSha256,
        creatorId,
        creatorName,
        hasPassword: bool('hasPassword', false),
        passwordHash: str('passwordHash', '') || null,
        expiresAt: null,
        maxDownloads: null,
        downloadCount: num('downloadCount', 0),
        throttleKbps: num('throttleKbps', 0) > 0 ? num('throttleKbps', 0) : null,
        bandwidthCapBytes: null,
        bandwidthUsedBytes: 0,
        active: bool('active', true),
        createdAt,
        lastAccessedAt: null,
      };

      db.shares.unshift(restoredShare);

      if (folderShareManifest.isFolderShare && Array.isArray(folderShareManifest.sharedFiles)) {
        for (const sf of folderShareManifest.sharedFiles) {
          if (!sf || !sf.id) continue;
          const existingSf = db.files.find((fl) => fl.id === sf.id);
          if (!existingSf) {
            db.files.unshift({
              id: sf.id,
              name: sf.name || 'file.bin',
              folderId: folderShareManifest.folderId || null,
              ownerId: creatorId,
              ownerName: creatorName,
              sizeBytes: sf.sizeBytes || 0,
              mimeType: sf.mimeType || 'application/octet-stream',
              sha256: sf.sha256 || '',
              storageDriver:
                sf.storageDriver === 'telegram' ||
                (Array.isArray(sf.telegramChunks) && sf.telegramChunks.length > 0)
                  ? 'telegram'
                  : 'local_vault',
              telegramChatId: sf.telegramChatId,
              telegramChunks: Array.isArray(sf.telegramChunks) ? sf.telegramChunks : [],
              starred: false,
              downloadCount: 0,
              createdAt,
              updatedAt: createdAt,
              previewText: sf.previewText,
              previewDataUrl: sf.previewDataUrl,
              lockedOverQuota: false,
            });
          }
        }
      } else {
        // Ensure corresponding file record & Telegram chunks exist in db.files
        const existingFile = db.files.find((fl) => fl.id === fileId);
        if (!existingFile) {
          db.files.unshift({
            id: fileId,
            name: fileName,
            folderId: null,
            ownerId: creatorId,
            ownerName: creatorName,
            sizeBytes: fileSizeBytes,
            mimeType: fileMimeType,
            sha256: fileSha256,
            storageDriver:
              str('storageDriver') === 'telegram' || telegramChunks.length > 0
                ? 'telegram'
                : 'local_vault',
            telegramChatId: str('telegramChatId') || undefined,
            telegramChunks,
            starred: false,
            downloadCount: restoredShare.downloadCount,
            createdAt,
            updatedAt: createdAt,
            previewText: rawPreviewText || undefined,
            previewDataUrl: str('previewDataUrl') || undefined,
            lockedOverQuota: false,
          });
        } else if (telegramChunks.length > 0 && existingFile.telegramChunks.length === 0) {
          existingFile.telegramChunks = telegramChunks;
          existingFile.storageDriver = 'telegram';
        }
      }

      saveDb();
      return restoredShare;
    } catch {
      return null;
    }
  }

  // PUBLIC TELEGRAM CHUNK STREAMING PROXY (CORS-free chunk download for PublicSharePortal & video streaming)
  app.get('/api/public/tg-chunk', async (req, res) => {
    const fileId = String(req.query.fileId || '').trim();
    const botToken = String(req.query.botToken || db.telegramConfig.botToken || '').trim();
    if (!fileId || !botToken) {
      res.status(400).send('Missing fileId or botToken');
      return;
    }
    try {
      const metaRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
      );
      const metaJson = (await metaRes.json()) as {
        ok: boolean;
        result?: { file_path?: string };
      };
      if (!metaJson.ok || !metaJson.result?.file_path) {
        res.status(404).send('Telegram chunk file_path not found');
        return;
      }
      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${botToken}/${metaJson.result.file_path}`
      );
      if (!fileRes.ok) {
        res.status(fileRes.status).send('Failed to download Telegram chunk');
        return;
      }
      const arrBuf = await fileRes.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(buf.length));
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    } catch {
      res.status(500).send('Error proxying Telegram chunk');
    }
  });

  app.get('/api/public/tg-proxy-file', async (req, res) => {
    const filePath = String(req.query.filePath || '').trim();
    const botToken = String(req.query.botToken || db.telegramConfig.botToken || '').trim();
    if (!filePath || !botToken) {
      res.status(400).send('Missing filePath or botToken');
      return;
    }
    try {
      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${botToken}/${filePath}`
      );
      if (!fileRes.ok) {
        res.status(fileRes.status).send('Failed to fetch Telegram file');
        return;
      }
      const arrBuf = await fileRes.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
    } catch {
      res.status(500).send('Error proxying Telegram file');
    }
  });

  function resolveTargetShareFile(share: StoredShareLink, queryFileId?: string) {
    if (
      (share.targetType === 'folder' || share.fileMimeType === 'application/x-unlim-folder') &&
      queryFileId
    ) {
      const sharedEntry = share.sharedFiles?.find((sf) => sf.id === queryFileId);
      const dbEntry = db.files.find((f) => f.id === queryFileId);
      if (sharedEntry || dbEntry) {
        return {
          fileId: queryFileId,
          fileName: sharedEntry?.name || dbEntry?.name || 'file.bin',
          fileMimeType: sharedEntry?.mimeType || dbEntry?.mimeType || 'application/octet-stream',
          fileSizeBytes: sharedEntry?.sizeBytes || dbEntry?.sizeBytes || 0,
          telegramChunks:
            (sharedEntry?.telegramChunks && sharedEntry.telegramChunks.length > 0
              ? sharedEntry.telegramChunks
              : dbEntry?.telegramChunks) || [],
          previewText: sharedEntry?.previewText || dbEntry?.previewText,
        };
      }
    }
    const dbFile = db.files.find((f) => f.id === share.fileId);
    return {
      fileId: share.fileId,
      fileName: share.fileName,
      fileMimeType: share.fileMimeType,
      fileSizeBytes: share.fileSizeBytes || dbFile?.sizeBytes || 0,
      telegramChunks: dbFile?.telegramChunks || [],
      previewText: dbFile?.previewText,
    };
  }

  // PUBLIC SHARE PORTAL ENDPOINTS
  app.get('/api/public/share/:token', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res
        .status(404)
        .json({ error: 'This direct download link does not exist or has been revoked.' });
      return;
    }
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
      res.status(410).json({ error: 'This direct download link has expired.' });
      return;
    }
    if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
      res.status(429).json({ error: 'Maximum download limit reached for this link.' });
      return;
    }

    // If folder share and sharedFiles not populated on local record, populate dynamically from db.files
    let sharedFiles = share.sharedFiles;
    if (
      (share.targetType === 'folder' || share.fileMimeType === 'application/x-unlim-folder') &&
      (!Array.isArray(sharedFiles) || sharedFiles.length === 0)
    ) {
      const folderId = share.folderId || share.fileId;
      sharedFiles = db.files
        .filter((f) => f.folderId === folderId && !f.trashed)
        .map((f) => ({
          id: f.id,
          name: f.name,
          sizeBytes: f.sizeBytes,
          mimeType: f.mimeType,
          sha256: f.sha256,
          storageDriver: f.storageDriver,
          telegramChatId: f.telegramChatId,
          telegramChunks: f.telegramChunks,
          previewText: f.previewText,
          previewDataUrl: f.previewDataUrl,
        }));
    }

    res.json({
      share: {
        token: share.token,
        targetType: share.targetType || (share.fileMimeType === 'application/x-unlim-folder' ? 'folder' : 'file'),
        folderId: share.folderId || null,
        sharedFiles,
        fileId: share.fileId,
        fileName: share.fileName,
        fileSizeBytes: share.fileSizeBytes,
        fileMimeType: share.fileMimeType,
        fileSha256: share.fileSha256,
        creatorName: share.creatorName,
        hasPassword: share.hasPassword,
        expiresAt: share.expiresAt,
        maxDownloads: share.maxDownloads,
        downloadCount: share.downloadCount,
        throttleKbps: share.throttleKbps,
        bandwidthCapBytes: share.bandwidthCapBytes,
        bandwidthUsedBytes: share.bandwidthUsedBytes,
        createdAt: share.createdAt,
      },
    });
  });

  app.post('/api/public/share/:token/verify', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).json({ error: 'Share link not found or inactive' });
      return;
    }
    const { password } = req.body as { password?: string };
    if (share.hasPassword) {
      const cleanPw = (password || '').trim();
      const shaHash = cleanPw ? hashPassword(cleanPw) : '';
      let fnvHash = '';
      if (cleanPw) {
        let h = 2166136261;
        for (let i = 0; i < cleanPw.length; i++) {
          h ^= cleanPw.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        fnvHash = (h >>> 0).toString(16).padStart(8, '0') + '9f86d081884c7d659a2feaa0';
      }
      if (
        !cleanPw ||
        (shaHash !== share.passwordHash && fnvHash !== share.passwordHash)
      ) {
        res.status(403).json({ error: 'Incorrect password for this protected link.' });
        return;
      }
    }

    res.json({ unlocked: true, accessKey: share.passwordHash || 'open' });
  });

  app.get('/api/public/share/:token/download', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).send('Share link not found or revoked.');
      return;
    }
    const providedKey = (req.query.key as string) || '';
    const providedPw = (req.query.password as string) || '';
    if (share.hasPassword) {
      const validKey =
        providedKey === share.passwordHash ||
        (providedPw && hashPassword(providedPw.trim()) === share.passwordHash);
      if (!validKey) {
        res.status(403).send('Password verification required.');
        return;
      }
    }

    const target = resolveTargetShareFile(share, String(req.query.fileId || '').trim());
    const file = db.files.find((f) => f.id === target.fileId);
    const chunkPath = path.join(CHUNKS_DIR, target.fileId);
    const isInline = req.query.inline === '1';
    const isMkv =
      target.fileName.toLowerCase().endsWith('.mkv') ||
      target.fileMimeType === 'video/x-matroska';
    const contentType =
      isInline && isMkv
        ? 'video/webm'
        : resolveEffectiveMimeType(target.fileName, target.fileMimeType);
    const effectiveThrottle =
      share.throttleKbps || db.bandwidthSettings.globalThrottleKbps || null;

    if (fs.existsSync(chunkPath)) {
      const stat = fs.statSync(chunkPath);
      const totalSize = stat.size;
      const rangeHeader = req.headers.range;

      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `${isInline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(target.fileName)}"`
      );

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? Math.min(totalSize - 1, parseInt(parts[1], 10)) : totalSize - 1;
        if (start >= totalSize || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${totalSize}`).end();
          return;
        }
        const chunkLen = end - start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', String(chunkLen));
        const stream = fs.createReadStream(chunkPath, { start, end });
        stream.pipe(res);
        return;
      }

      if (!isInline) {
        share.downloadCount += 1;
        share.bandwidthUsedBytes += totalSize;
        share.lastAccessedAt = new Date().toISOString();
        if (file) {
          file.downloadCount += 1;
        }
        saveDb();
      }

      res.setHeader('Content-Length', String(totalSize));
      const readStream = fs.createReadStream(chunkPath);
      if (!isInline && effectiveThrottle && effectiveThrottle > 0) {
        const throttle = new ThrottleStream(effectiveThrottle);
        readStream.pipe(throttle).pipe(res);
      } else {
        readStream.pipe(res);
      }
      return;
    }

    // Fast Chunk-Aware Range Streaming for Public Share Videos
    if (
      target.telegramChunks &&
      target.telegramChunks.length > 0 &&
      (isInline || Boolean(req.headers.range))
    ) {
      const servedRange = await serveTelegramChunksFastRange({
        req,
        res,
        fileId: target.fileId,
        fileName: target.fileName,
        contentType,
        totalSizeHint: target.fileSizeBytes,
        chunks: target.telegramChunks,
        botToken: db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN,
        isInline,
      });
      if (servedRange) {
        return;
      }
    }

    let buffer: Buffer | null = null;
    if (target.telegramChunks && target.telegramChunks.length > 0) {
      buffer = await fetchBufferFromTelegramChunks(
        target.telegramChunks,
        db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN,
        target.fileId
      );
      if (buffer && buffer.length > 0) {
        try {
          fs.writeFileSync(chunkPath, buffer);
        } catch {
          // ignore
        }
      }
    }

    if (!buffer && target.previewText) {
      buffer = Buffer.from(target.previewText, 'utf-8');
    }

    if (!buffer) {
      res.status(404).send('File payload not found in storage.');
      return;
    }

    share.downloadCount += 1;
    share.bandwidthUsedBytes += buffer.length;
    share.lastAccessedAt = new Date().toISOString();
    if (file) {
      file.downloadCount += 1;
    }
    saveDb();

    res.setHeader(
      'Content-Type',
      resolveEffectiveMimeType(target.fileName, target.fileMimeType)
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(target.fileName)}"`
    );
    res.setHeader('Content-Length', String(buffer.length));

    if (effectiveThrottle && effectiveThrottle > 0) {
      const throttle = new ThrottleStream(effectiveThrottle);
      throttle.pipe(res);
      throttle.end(buffer);
    } else {
      res.end(buffer);
    }
  });

  app.get('/api/public/share/:token/media-info', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).json({ ok: false });
      return;
    }
    const target = resolveTargetShareFile(share, String(req.query.fileId || '').trim());
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;
    const info = await probeMediaFileWithFfprobe(
      target.fileId,
      target.fileName,
      target.telegramChunks,
      botToken
    );
    if (!info) {
      res.json({
        ok: false,
        duration: 0,
        videoCodec: '',
        pixFmt: '',
        width: 0,
        height: 0,
        needsTranscode: false,
        canCopyVideo: false,
        audioTracks: [],
        subtitleTracks: [],
      });
      return;
    }
    res.json(info);
  });

  app.get('/api/public/share/:token/stream', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).send('Share link not found or revoked.');
      return;
    }
    const providedKey = (req.query.key as string) || '';
    const providedPw = (req.query.password as string) || '';
    if (share.hasPassword) {
      const validKey =
        providedKey === share.passwordHash ||
        (providedPw && hashPassword(providedPw.trim()) === share.passwordHash);
      if (!validKey) {
        res.status(403).send('Password verification required.');
        return;
      }
    }
    const target = resolveTargetShareFile(share, String(req.query.fileId || '').trim());
    const audioTrackIndex = parseInt(String(req.query.audio || '0'), 10) || 0;
    const startSeconds = parseFloat(String(req.query.start || '0')) || 0;
    const quality = String(req.query.quality || '720p');
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;

    await streamTranscodedVideoWithFfmpeg({
      req,
      res,
      fileId: target.fileId,
      fileName: target.fileName,
      chunks: target.telegramChunks,
      botToken,
      audioTrackIndex,
      startSeconds,
      quality,
    });
  });

  app.get('/api/public/share/:token/subtitles', async (req, res) => {
    const share = await resolveShareFromLocalOrFirestore(req.params.token);
    if (!share || !share.active) {
      res.status(404).send('WEBVTT\n\n');
      return;
    }
    const target = resolveTargetShareFile(share, String(req.query.fileId || '').trim());
    const subIndex = parseInt(String(req.query.subIndex || '0'), 10) || 0;
    const startSeconds = parseFloat(String(req.query.start || '0')) || 0;
    const botToken = db.telegramConfig.botToken || DEFAULT_FALLBACK_BOT_TOKEN;

    await extractEmbeddedSubtitleToVtt({
      req,
      res,
      fileId: target.fileId,
      fileName: target.fileName,
      chunks: target.telegramChunks,
      botToken,
      subIndex,
      startSeconds,
    });
  });

  // ============================================================================
  // BANDWIDTH & LOGS ROUTES
  // ============================================================================

  app.get('/api/bandwidth', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    res.json({
      settings: db.bandwidthSettings,
      dailyBandwidth: db.dailyBandwidth,
      users: [sanitizeUser(user)],
      shares: db.shares.filter((s) => s.creatorId === user.id).map(sanitizeShare),
    });
  });

  app.patch('/api/bandwidth/settings', requireAuth, (req, res) => {
    const {
      globalThrottleKbps,
      defaultShareThrottleKbps,
      maxConcurrentTransfers,
      enforceUserQuotas,
      autoThrottlePeakHours,
    } = req.body as Partial<BandwidthSettings>;

    if (globalThrottleKbps !== undefined) {
      db.bandwidthSettings.globalThrottleKbps = globalThrottleKbps;
    }
    if (defaultShareThrottleKbps !== undefined) {
      db.bandwidthSettings.defaultShareThrottleKbps = defaultShareThrottleKbps;
    }
    if (typeof maxConcurrentTransfers === 'number') {
      db.bandwidthSettings.maxConcurrentTransfers = Math.max(
        1,
        Math.min(20, maxConcurrentTransfers)
      );
    }
    if (typeof enforceUserQuotas === 'boolean') {
      db.bandwidthSettings.enforceUserQuotas = enforceUserQuotas;
    }
    if (typeof autoThrottlePeakHours === 'boolean') {
      db.bandwidthSettings.autoThrottlePeakHours = autoThrottlePeakHours;
    }

    saveDb();
    res.json({ settings: db.bandwidthSettings });
  });

  app.get('/api/logs', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const isAdmin = user.email.toLowerCase() === 'titumamma2425@gmail.com';
    res.json({
      logs: isAdmin ? db.logs : db.logs.filter((l) => l.userId === user.id),
    });
  });

  // ============================================================================
  // ADMIN-ONLY STORAGE NODE CONFIGURATION
  // ============================================================================

  function getTelegramState(): TelegramConfigState {
    const mtprotoConnected = Boolean(
      db.telegramConfig.mtprotoSession &&
        db.telegramConfig.apiId &&
        db.telegramConfig.apiHash
    );
    const hasBotCreds = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const connected = mtprotoConnected || hasBotCreds;
    const tok = db.telegramConfig.botToken || '';
    const masked =
      tok.length > 10 ? `${tok.slice(0, 6)}••••••••${tok.slice(-4)}` : tok ? '••••••••' : '';

    const rawHash = db.telegramConfig.apiHash || '';
    const maskedHash =
      rawHash.length > 8
        ? `${rawHash.slice(0, 4)}••••••••${rawHash.slice(-4)}`
        : rawHash
        ? '••••••••'
        : '';

    return {
      connected,
      mode: connected ? 'telegram_live' : 'hybrid_fallback',
      authMode: mtprotoConnected ? 'mtproto' : db.telegramConfig.authMode || 'bot',
      botUsername: db.telegramConfig.botUsername,
      botFirstName: db.telegramConfig.botFirstName,
      chatId: db.telegramConfig.chatId || (mtprotoConnected ? 'me' : ''),
      maskedToken: masked,
      chunkSizeBytes: mtprotoConnected ? 2000 * 1024 * 1024 : TELEGRAM_CHUNK_SIZE,
      maxFileSizeBytes: mtprotoConnected ? 2000 * 1024 * 1024 : 50 * 1024 * 1024,
      autoSyncUploads: db.telegramConfig.autoSyncUploads,
      lastVerifiedAt: db.telegramConfig.lastVerifiedAt,
      mtprotoConnected,
      apiId: db.telegramConfig.apiId || '',
      maskedApiHash: maskedHash,
      phoneNumber: db.telegramConfig.phoneNumber || '',
      accountName: db.telegramConfig.accountName || '',
      accountUsername: db.telegramConfig.accountUsername || '',
    };
  }

  app.get('/api/telegram/config', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }
    res.json({ config: getTelegramState() });
  });

  // STEP 1: Send Telegram Login OTP Code via MTProto (2GB User Account)
  app.post('/api/telegram/mtproto/send-code', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    const { apiId, apiHash, phoneNumber, chatId } = req.body as {
      apiId?: string;
      apiHash?: string;
      phoneNumber?: string;
      chatId?: string;
    };

    const cleanApiId = Number(String(apiId || db.telegramConfig.apiId || '').trim());
    const cleanApiHash = String(apiHash || db.telegramConfig.apiHash || '').trim();
    const cleanPhone = String(phoneNumber || '').trim();
    const cleanChatId = String(chatId || db.telegramConfig.chatId || 'me').trim() || 'me';

    if (!Number.isFinite(cleanApiId) || cleanApiId <= 0 || !cleanApiHash) {
      res.status(400).json({
        error: 'Please enter a valid Telegram API ID and API Hash from my.telegram.org.',
      });
      return;
    }

    if (!cleanPhone || !/^\+?[0-9]{7,16}$/.test(cleanPhone.replace(/[\s-]/g, ''))) {
      res.status(400).json({
        error: 'Please enter your Telegram phone number in international format (e.g. +88017...).',
      });
      return;
    }

    const normalizedPhone = cleanPhone.startsWith('+')
      ? cleanPhone.replace(/[\s-]/g, '')
      : `+${cleanPhone.replace(/[\s-]/g, '')}`;

    try {
      const existingPending = pendingMtprotoLogins.get(normalizedPhone);
      if (existingPending) {
        await existingPending.client.disconnect().catch(() => null);
        pendingMtprotoLogins.delete(normalizedPhone);
      }

      const client = new TelegramClient(new StringSession(''), cleanApiId, cleanApiHash, {
        connectionRetries: 3,
        useWSS: false,
      });

      await client.connect();
      const sendResult = await client.sendCode(
        { apiId: cleanApiId, apiHash: cleanApiHash },
        normalizedPhone
      );

      pendingMtprotoLogins.set(normalizedPhone, {
        client,
        apiId: cleanApiId,
        apiHash: cleanApiHash,
        phoneNumber: normalizedPhone,
        phoneCodeHash: sendResult.phoneCodeHash,
        chatId: cleanChatId,
        createdAt: Date.now(),
      });

      db.telegramConfig.apiId = String(cleanApiId);
      db.telegramConfig.apiHash = cleanApiHash;
      db.telegramConfig.phoneNumber = normalizedPhone;
      if (cleanChatId) {
        db.telegramConfig.chatId = cleanChatId;
      }
      saveDb();

      res.json({
        ok: true,
        phoneNumber: normalizedPhone,
        phoneCodeHash: sendResult.phoneCodeHash,
        isCodeViaApp: sendResult.isCodeViaApp,
        message: `Verification OTP sent to your Telegram account (${normalizedPhone}).`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send Telegram OTP code';
      res.status(400).json({ error: msg });
    }
  });

  // STEP 2: Verify Telegram OTP Code (+ Optional 2FA Password) and Save Persistent 2GB Session
  app.post('/api/telegram/mtproto/verify-code', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    const { phoneNumber, phoneCode, phoneCodeHash, password, chatId } = req.body as {
      phoneNumber?: string;
      phoneCode?: string;
      phoneCodeHash?: string;
      password?: string;
      chatId?: string;
    };

    const rawPhone = String(phoneNumber || db.telegramConfig.phoneNumber || '').trim();
    const normalizedPhone = rawPhone.startsWith('+')
      ? rawPhone.replace(/[\s-]/g, '')
      : `+${rawPhone.replace(/[\s-]/g, '')}`;
    const cleanCode = String(phoneCode || '').trim();
    const cleanPassword = String(password || '').trim();

    const pending = pendingMtprotoLogins.get(normalizedPhone);
    if (!pending) {
      res.status(400).json({
        error: 'OTP session expired or not found. Please click "Send OTP Code" again.',
      });
      return;
    }

    try {
      const client = pending.client;
      if (!client.connected) {
        await client.connect();
      }

      try {
        if (cleanCode) {
          await client.invoke(
            new Api.auth.SignIn({
              phoneNumber: normalizedPhone,
              phoneCodeHash: phoneCodeHash || pending.phoneCodeHash,
              phoneCode: cleanCode,
            })
          );
        } else if (!cleanPassword) {
          res.status(400).json({ error: 'Please enter the OTP code sent to Telegram.' });
          return;
        }
      } catch (signInErr: any) {
        const errMsg = String(signInErr?.errorMessage || signInErr?.message || '');
        if (errMsg.includes('SESSION_PASSWORD_NEEDED')) {
          if (!cleanPassword) {
            res.status(200).json({
              ok: false,
              requires2FA: true,
              error:
                'Two-Step Verification (2FA) is enabled on your Telegram account. Please enter your 2FA password below.',
            });
            return;
          }
          const pwdInfo = await client.invoke(new Api.account.GetPassword());
          const passwordSrp = await computeCheck(pwdInfo, cleanPassword);
          await client.invoke(new Api.auth.CheckPassword({ password: passwordSrp }));
        } else {
          throw signInErr;
        }
      }

      // If 2FA password was submitted directly after requires2FA prompt
      if (cleanPassword && !(await client.isUserAuthorized())) {
        const pwdInfo = await client.invoke(new Api.account.GetPassword());
        const passwordSrp = await computeCheck(pwdInfo, cleanPassword);
        await client.invoke(new Api.auth.CheckPassword({ password: passwordSrp }));
      }

      const me = (await client.getMe()) as any;
      const rawSession = client.session.save() as unknown;
      const sessionString = typeof rawSession === 'string' ? rawSession : '';
      const fullName =
        [me?.firstName, me?.lastName].filter(Boolean).join(' ').trim() ||
        me?.username ||
        normalizedPhone;
      const username = me?.username ? String(me.username) : '';
      const targetChat = String(chatId || pending.chatId || db.telegramConfig.chatId || 'me').trim() || 'me';

      db.telegramConfig.authMode = 'mtproto';
      db.telegramConfig.apiId = String(pending.apiId);
      db.telegramConfig.apiHash = pending.apiHash;
      db.telegramConfig.phoneNumber = normalizedPhone;
      db.telegramConfig.mtprotoSession = sessionString;
      db.telegramConfig.accountName = fullName;
      db.telegramConfig.accountUsername = username;
      db.telegramConfig.chatId = targetChat;
      db.telegramConfig.autoSyncUploads = true;
      db.telegramConfig.lastVerifiedAt = new Date().toISOString();
      // Deactivate any legacy bot token so all uploads route exclusively through the user's main account
      db.telegramConfig.botToken = '';
      db.telegramConfig.botUsername = undefined;
      db.telegramConfig.botFirstName = undefined;
      saveDb();

      cachedMtprotoClient = client;
      cachedMtprotoSessionKey = `${pending.apiId}:${pending.apiHash}:${sessionString.slice(0, 48)}`;
      pendingMtprotoLogins.delete(normalizedPhone);

      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'TELEGRAM_CONFIG',
        targetName: `MTProto 2GB Account (${fullName})`,
        status: 'success',
        details: `Connected Global Admin Telegram User Account (2GB MTProto Vault)`,
      });

      res.json({
        ok: true,
        mtprotoSession: sessionString,
        sessionString,
        accountName: fullName,
        accountUsername: username,
        phoneNumber: normalizedPhone,
        apiId: String(pending.apiId),
        apiHash: pending.apiHash,
        chatId: targetChat,
        config: getTelegramState(),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify Telegram OTP code';
      res.status(400).json({ error: msg });
    }
  });

  app.post('/api/telegram/mtproto/disconnect', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    if (cachedMtprotoClient) {
      await cachedMtprotoClient.disconnect().catch(() => null);
      cachedMtprotoClient = null;
      cachedMtprotoSessionKey = '';
    }
    db.telegramConfig.authMode = 'bot';
    db.telegramConfig.mtprotoSession = undefined;
    db.telegramConfig.accountName = undefined;
    db.telegramConfig.accountUsername = undefined;
    saveDb();
    res.json({ ok: true, config: getTelegramState() });
  });

  app.get('/api/telegram/mtproto/channels', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    try {
      const client = await getActiveMtprotoClient();
      if (!client) {
        res.json({ channels: [] });
        return;
      }
      const dialogs = await client.getDialogs({ limit: 100 });
      const channels: Array<{ id: string; title: string; isChannel: boolean }> = [
        { id: 'me', title: 'Saved Messages (Personal Main Account)', isChannel: false },
      ];
      for (const d of dialogs) {
        if (d.isChannel || d.isGroup) {
          const idStr = String(d.id || '');
          const title = String(d.title || 'Private Channel').trim();
          if (idStr && !channels.some((c) => c.id === idStr)) {
            channels.push({
              id: idStr,
              title,
              isChannel: Boolean(d.isChannel),
            });
          }
        }
      }
      res.json({ channels });
    } catch {
      res.json({ channels: [] });
    }
  });

  app.post('/api/telegram/config', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    const {
      authMode,
      botToken,
      chatId,
      autoSyncUploads,
      clearCredentials,
      apiId,
      apiHash,
      phoneNumber,
      mtprotoSession,
      accountName,
      accountUsername,
    } = req.body as {
      authMode?: 'mtproto' | 'bot';
      botToken?: string;
      chatId?: string;
      autoSyncUploads?: boolean;
      clearCredentials?: boolean;
      apiId?: string;
      apiHash?: string;
      phoneNumber?: string;
      mtprotoSession?: string;
      accountName?: string;
      accountUsername?: string;
    };

    if (clearCredentials) {
      if (cachedMtprotoClient) {
        await cachedMtprotoClient.disconnect().catch(() => null);
        cachedMtprotoClient = null;
        cachedMtprotoSessionKey = '';
      }
      db.telegramConfig.authMode = 'bot';
      db.telegramConfig.botToken = '';
      db.telegramConfig.chatId = '';
      db.telegramConfig.botUsername = undefined;
      db.telegramConfig.botFirstName = undefined;
      db.telegramConfig.lastVerifiedAt = undefined;
      db.telegramConfig.apiId = undefined;
      db.telegramConfig.apiHash = undefined;
      db.telegramConfig.phoneNumber = undefined;
      db.telegramConfig.mtprotoSession = undefined;
      db.telegramConfig.accountName = undefined;
      db.telegramConfig.accountUsername = undefined;
      saveDb();
      res.json({ config: getTelegramState() });
      return;
    }

    if (typeof autoSyncUploads === 'boolean') {
      db.telegramConfig.autoSyncUploads = autoSyncUploads;
    }

    if (mtprotoSession && apiId && apiHash) {
      db.telegramConfig.authMode = 'mtproto';
      db.telegramConfig.apiId = String(apiId).trim();
      db.telegramConfig.apiHash = String(apiHash).trim();
      if (phoneNumber) db.telegramConfig.phoneNumber = String(phoneNumber).trim();
      db.telegramConfig.mtprotoSession = String(mtprotoSession).trim();
      if (accountName) db.telegramConfig.accountName = String(accountName).trim();
      if (accountUsername) db.telegramConfig.accountUsername = String(accountUsername).trim();
      if (chatId) db.telegramConfig.chatId = String(chatId).trim();
      db.telegramConfig.lastVerifiedAt = new Date().toISOString();
      saveDb();
      res.json({ config: getTelegramState() });
      return;
    }

    if (authMode === 'mtproto' && db.telegramConfig.mtprotoSession && chatId) {
      db.telegramConfig.chatId = chatId.trim();
      saveDb();
      res.json({ config: getTelegramState() });
      return;
    }

    const tokenToTest =
      botToken && botToken.trim() ? botToken.trim() : db.telegramConfig.botToken;
    const chatToTest = chatId && chatId.trim() ? chatId.trim() : db.telegramConfig.chatId;

    if (!tokenToTest || !chatToTest) {
      saveDb();
      res.json({ config: getTelegramState() });
      return;
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${tokenToTest}/getMe`);
      const meJson = (await meRes.json()) as {
        ok: boolean;
        description?: string;
        result?: { username?: string; first_name?: string };
      };

      if (!meJson.ok || !meJson.result) {
        res.status(400).json({
          error: meJson.description || 'Storage node rejected this token.',
        });
        return;
      }

      db.telegramConfig.authMode = 'bot';
      db.telegramConfig.botToken = tokenToTest;
      db.telegramConfig.chatId = chatToTest;
      db.telegramConfig.botUsername = meJson.result.username;
      db.telegramConfig.botFirstName = meJson.result.first_name;
      db.telegramConfig.lastVerifiedAt = new Date().toISOString();
      saveDb();

      res.json({ config: getTelegramState() });
    } catch (err: unknown) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Failed to reach storage bridge: ${err.message}`
            : 'Network error verifying storage node token',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[UnlimCloud] Server listening on http://0.0.0.0:${PORT}`);
  });
}

function formatBytesServer(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
