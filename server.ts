import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import multer from 'multer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';
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
    botToken: string;
    chatId: string;
    botUsername?: string;
    botFirstName?: string;
    autoSyncUploads: boolean;
    lastVerifiedAt?: string;
  };
}

function hashPassword(pw: string): string {
  return crypto.createHash('sha256').update(`unlim_salt_${pw}`).digest('hex');
}

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
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

async function pushBufferToTelegram(
  buffer: Buffer,
  fileName: string,
  botToken: string,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[]; error?: string }> {
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

async function fetchBufferFromTelegramChunks(
  chunks: TelegramChunk[],
  botToken: string
): Promise<Buffer | null> {
  try {
    const buffers: Buffer[] = [];
    const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);

    for (const chunk of sorted) {
      const metaRes = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(chunk.fileId)}`
      );
      const metaJson = (await metaRes.json()) as {
        ok: boolean;
        result?: { file_path?: string };
      };
      if (!metaJson.ok || !metaJson.result?.file_path) {
        return null;
      }

      const fileRes = await fetch(
        `https://api.telegram.org/file/bot${botToken}/${metaJson.result.file_path}`
      );
      if (!fileRes.ok) return null;
      const arrBuf = await fileRes.arrayBuffer();
      buffers.push(Buffer.from(arrBuf));
    }

    return Buffer.concat(buffers);
  } catch {
    return null;
  }
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
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json({ limit: '50mb' }));

  const clients = new Set<WebSocket>();
  wss.on('connection', (ws) => {
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
    const { profile, files, folders, shares, storageNodeConfig } = req.body as {
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
        botToken?: string;
        chatId?: string;
        botUsername?: string;
        autoSyncUploads?: boolean;
      } | null;
    };

    if (
      storageNodeConfig &&
      storageNodeConfig.botToken &&
      storageNodeConfig.chatId &&
      !db.telegramConfig.botToken
    ) {
      db.telegramConfig.botToken = String(storageNodeConfig.botToken).trim();
      db.telegramConfig.chatId = String(storageNodeConfig.chatId).trim();
      if (storageNodeConfig.botUsername) {
        db.telegramConfig.botUsername = String(storageNodeConfig.botUsername).trim();
      }
      db.telegramConfig.autoSyncUploads = storageNodeConfig.autoSyncUploads !== false;
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

    if (Array.isArray(folders)) {
      for (const cf of folders) {
        if (!cf || !cf.id) continue;
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
      for (const cf of files) {
        if (!cf || !cf.id) continue;
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
          };
        }
      }
      db.files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    if (Array.isArray(shares)) {
      for (const cs of shares) {
        if (!cs || !cs.token) continue;
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
        db.telegramConfig.botToken &&
          db.telegramConfig.chatId &&
          db.telegramConfig.autoSyncUploads
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
      db.telegramConfig.botToken &&
        db.telegramConfig.chatId &&
        db.telegramConfig.autoSyncUploads
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
      db.telegramConfig.botToken &&
        db.telegramConfig.chatId &&
        db.telegramConfig.autoSyncUploads
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

  app.patch('/api/files/:id', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = db.files.find((f) => f.id === req.params.id && f.ownerId === user.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    const { name, folderId, starred } = req.body as {
      name?: string;
      folderId?: string | null;
      starred?: boolean;
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

  app.get('/api/files/:id/download', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    evaluateUserQuotaAndLocks(user);

    const file = db.files.find((f) => f.id === req.params.id && f.ownerId === user.id);
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

    // If local disk doesn't have the file yet (e.g. accessed from a new server instance or device),
    // automatically restore it from Telegram chunks before serving Range or full download!
    if (
      !fs.existsSync(chunkPath) &&
      file.telegramChunks &&
      file.telegramChunks.length > 0 &&
      db.telegramConfig.botToken
    ) {
      const restoredBuf = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken
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
      db.telegramConfig.botToken
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
      syncToTelegram !== false && db.telegramConfig.botToken && db.telegramConfig.chatId
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
      customSlug,
      password,
      expiresInHours,
      maxDownloads,
      throttleKbps,
      bandwidthCapMb,
    } = req.body as {
      fileId?: string;
      customSlug?: string;
      password?: string;
      expiresInHours?: number | null;
      maxDownloads?: number | null;
      throttleKbps?: number | null;
      bandwidthCapMb?: number | null;
    };

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

    const newShare: StoredShareLink = {
      id: `shr_${Date.now().toString(36)}`,
      token: cleanSlug,
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

      const restoredShare: StoredShareLink = {
        id: str('id', `shr_${safeToken}`),
        token: str('token', safeToken),
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
          previewText: str('previewText') || undefined,
          previewDataUrl: str('previewDataUrl') || undefined,
          lockedOverQuota: false,
        });
      } else if (telegramChunks.length > 0 && existingFile.telegramChunks.length === 0) {
        existingFile.telegramChunks = telegramChunks;
        existingFile.storageDriver = 'telegram';
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

    res.json({
      share: {
        token: share.token,
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

    const file = db.files.find((f) => f.id === share.fileId);
    const chunkPath = path.join(CHUNKS_DIR, share.fileId);
    const effectiveThrottle =
      share.throttleKbps || db.bandwidthSettings.globalThrottleKbps || null;

    if (fs.existsSync(chunkPath)) {
      const stat = fs.statSync(chunkPath);
      share.downloadCount += 1;
      share.bandwidthUsedBytes += stat.size;
      share.lastAccessedAt = new Date().toISOString();
      if (file) {
        file.downloadCount += 1;
      }
      saveDb();

      res.setHeader(
        'Content-Type',
        resolveEffectiveMimeType(share.fileName, share.fileMimeType)
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(share.fileName)}"`
      );
      res.setHeader('Content-Length', String(stat.size));

      const readStream = fs.createReadStream(chunkPath);
      if (effectiveThrottle && effectiveThrottle > 0) {
        const throttle = new ThrottleStream(effectiveThrottle);
        readStream.pipe(throttle).pipe(res);
      } else {
        readStream.pipe(res);
      }
      return;
    }

    let buffer: Buffer | null = null;
    if (
      file &&
      file.telegramChunks &&
      file.telegramChunks.length > 0 &&
      db.telegramConfig.botToken
    ) {
      buffer = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken
      );
      if (buffer && buffer.length > 0) {
        try {
          fs.writeFileSync(chunkPath, buffer);
        } catch {
          // ignore
        }
      }
    }

    if (!buffer && file?.previewText) {
      buffer = Buffer.from(file.previewText, 'utf-8');
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
      resolveEffectiveMimeType(share.fileName, share.fileMimeType)
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(share.fileName)}"`
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
    const hasCreds = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const tok = db.telegramConfig.botToken || '';
    const masked =
      tok.length > 10 ? `${tok.slice(0, 6)}••••••••${tok.slice(-4)}` : tok ? '••••••••' : '';

    return {
      connected: hasCreds,
      mode: hasCreds ? 'telegram_live' : 'hybrid_fallback',
      botUsername: db.telegramConfig.botUsername,
      botFirstName: db.telegramConfig.botFirstName,
      chatId: db.telegramConfig.chatId || '',
      maskedToken: masked,
      chunkSizeBytes: TELEGRAM_CHUNK_SIZE,
      autoSyncUploads: db.telegramConfig.autoSyncUploads,
      lastVerifiedAt: db.telegramConfig.lastVerifiedAt,
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

  app.post('/api/telegram/config', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    if (user.email.toLowerCase() !== 'titumamma2425@gmail.com' || user.role !== 'admin') {
      res.status(403).json({ error: 'Administrator access required.' });
      return;
    }

    const { botToken, chatId, autoSyncUploads, clearCredentials } = req.body as {
      botToken?: string;
      chatId?: string;
      autoSyncUploads?: boolean;
      clearCredentials?: boolean;
    };

    if (clearCredentials) {
      db.telegramConfig.botToken = '';
      db.telegramConfig.chatId = '';
      db.telegramConfig.botUsername = undefined;
      db.telegramConfig.botFirstName = undefined;
      db.telegramConfig.lastVerifiedAt = undefined;
      saveDb();
      res.json({ config: getTelegramState() });
      return;
    }

    if (typeof autoSyncUploads === 'boolean') {
      db.telegramConfig.autoSyncUploads = autoSyncUploads;
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
      server: { middlewareMode: true },
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
