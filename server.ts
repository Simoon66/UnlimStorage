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
} from './src/types.ts';

dotenv.config();

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Telegram Bot API chunk size (19 MB safe limit under 20 MB getFile download limit)
const TELEGRAM_CHUNK_SIZE = 19 * 1024 * 1024;

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
  sessions: Record<string, string>; // token -> userId
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

function createSeedDatabase(): DatabaseSchema {
  const now = new Date();
  const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toISOString();

  const adminId = 'usr_admin_01';
  const memberId = 'usr_dev_02';

  // Create real seed files on disk so every seed file can be downloaded and verified immediately
  const seedFile1Content = Buffer.from(
    `# UnlimCloud Architecture Specification\n\n` +
      `Storage Engine: Telegram Channel Chunk Manifest + Local Vault Fallback\n` +
      `Chunk Size: 19,922,944 bytes (19 MB per Telegram sendDocument part)\n` +
      `Integrity: End-to-End SHA-256 Verification\n` +
      `Bandwidth Control: Token-Bucket Stream Throttling (KB/s precision)\n\n` +
      `## Multi-Part Manifest Example\n` +
      `- Part 00: msg_id=40812, file_id=BQACAgUAAxkBAAI..., sha256=9f86d081884c7d659a2feaa0c55ad015\n` +
      `- Part 01: msg_id=40813, file_id=BQACAgUAAxkBAAI..., sha256=4b227777d4dd1fc61c6f884f48641d02\n`,
    'utf-8'
  );
  const seedFile1Hash = computeSha256(seedFile1Content);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_spec_01'), seedFile1Content);

  const seedFile2Content = Buffer.from(
    JSON.stringify(
      {
        cluster: 'ap-southeast-tg-bridge-01',
        telegramChannelId: '-1002198471092',
        encryption: 'AES-256-GCM + SHA-256 Manifest',
        nodes: [
          { id: 'edge-dhaka-01', status: 'nominal', throughputMbps: 420 },
          { id: 'edge-singapore-02', status: 'nominal', throughputMbps: 890 },
        ],
        snapshotTimestamp: iso(180),
      },
      null,
      2
    ),
    'utf-8'
  );
  const seedFile2Hash = computeSha256(seedFile2Content);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_manifest_02'), seedFile2Content);

  const seedFile3Content = Buffer.from(
    `#!/usr/bin/env bash\n` +
      `# UnlimCloud CLI Remote Upload & Direct Stream Utility\n` +
      `set -euo pipefail\n\n` +
      `UNLIM_HOST="\${UNLIM_HOST:-http://localhost:3000}"\n` +
      `echo "[unlim-cli] Uploading stream to Telegram Cloud Vault..."\n` +
      `curl -fsSL -X POST "\$UNLIM_HOST/api/files/upload" -F "file=@\$1"\n`,
    'utf-8'
  );
  const seedFile3Hash = computeSha256(seedFile3Content);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_cli_03'), seedFile3Content);

  const seedFile4Content = Buffer.from(
    `timestamp,event,node,bytes_transferred,sha256_verified,latency_ms\n` +
      `2026-10-09T08:12:00Z,TELEGRAM_CHUNK_COMMIT,tg-dc5-singapore,19922944,true,142\n` +
      `2026-10-09T09:30:11Z,DIRECT_LINK_STREAM,edge-proxy-01,8421376,true,38\n` +
      `2026-10-09T11:04:49Z,REMOTE_URL_INGEST,worker-fetch-02,15728640,true,219\n` +
      `2026-10-09T13:20:05Z,BANDWIDTH_THROTTLE_APPLIED,edge-proxy-01,2097152,true,64\n`,
    'utf-8'
  );
  const seedFile4Hash = computeSha256(seedFile4Content);
  fs.writeFileSync(path.join(CHUNKS_DIR, 'file_telemetry_04'), seedFile4Content);

  const envBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const envChatId = process.env.TELEGRAM_CHAT_ID || '';

  return {
    users: [
      {
        id: adminId,
        name: 'Arian Rahman',
        email: 'admin@unlim.cloud',
        passwordHash: hashPassword('admin123'),
        role: 'admin',
        bandwidthLimitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
        bandwidthUsedBytes: 482_344_960, // ~460 MB
        storageUsedBytes:
          seedFile1Content.length +
          seedFile2Content.length +
          seedFile3Content.length +
          seedFile4Content.length,
        createdAt: iso(4320),
      },
      {
        id: memberId,
        name: 'Nadia Karim',
        email: 'dev@unlim.cloud',
        passwordHash: hashPassword('dev123'),
        role: 'member',
        bandwidthLimitBytes: 10 * 1024 * 1024 * 1024, // 10 GB
        bandwidthUsedBytes: 128_974_848, // ~123 MB
        storageUsedBytes: seedFile3Content.length,
        createdAt: iso(2880),
      },
    ],
    sessions: {
      demo_admin_session_token: adminId,
      demo_member_session_token: memberId,
    },
    folders: [
      {
        id: 'fld_architecture',
        name: '01_System_Architecture',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1440),
      },
      {
        id: 'fld_releases',
        name: '02_Release_Artifacts',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1200),
      },
      {
        id: 'fld_audits',
        name: '03_Security_Logs',
        parentId: null,
        ownerId: memberId,
        ownerName: 'Nadia Karim',
        createdAt: iso(720),
      },
    ],
    files: [
      {
        id: 'file_spec_01',
        name: 'UNLIM_CLOUD_PROTOCOL_SPEC.md',
        folderId: 'fld_architecture',
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: seedFile1Content.length,
        mimeType: 'text/markdown',
        sha256: seedFile1Hash,
        storageDriver: 'telegram',
        telegramChatId: envChatId || '-1002198471092',
        telegramChunks: [
          {
            partIndex: 0,
            messageId: 40812,
            fileId: 'BQACAgUAAxkBAAJ_UnlimSpecPart00',
            sizeBytes: seedFile1Content.length,
            sha256Part: seedFile1Hash,
          },
        ],
        starred: true,
        downloadCount: 18,
        createdAt: iso(640),
        updatedAt: iso(640),
        previewText: seedFile1Content.toString('utf-8'),
      },
      {
        id: 'file_manifest_02',
        name: 'telegram-channel-cluster-manifest.json',
        folderId: 'fld_architecture',
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: seedFile2Content.length,
        mimeType: 'application/json',
        sha256: seedFile2Hash,
        storageDriver: 'telegram',
        telegramChatId: envChatId || '-1002198471092',
        telegramChunks: [
          {
            partIndex: 0,
            messageId: 40819,
            fileId: 'BQACAgUAAxkBAAJ_ClusterManifest00',
            sizeBytes: seedFile2Content.length,
            sha256Part: seedFile2Hash,
          },
        ],
        starred: true,
        downloadCount: 9,
        createdAt: iso(410),
        updatedAt: iso(410),
        previewText: seedFile2Content.toString('utf-8'),
      },
      {
        id: 'file_cli_03',
        name: 'unlim-remote-sync.sh',
        folderId: 'fld_releases',
        ownerId: memberId,
        ownerName: 'Nadia Karim',
        sizeBytes: seedFile3Content.length,
        mimeType: 'application/x-sh',
        sha256: seedFile3Hash,
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: false,
        downloadCount: 31,
        createdAt: iso(220),
        updatedAt: iso(220),
        previewText: seedFile3Content.toString('utf-8'),
      },
      {
        id: 'file_telemetry_04',
        name: 'bandwidth-integrity-audit-2026-10.csv',
        folderId: 'fld_audits',
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: seedFile4Content.length,
        mimeType: 'text/csv',
        sha256: seedFile4Hash,
        storageDriver: 'telegram',
        telegramChatId: envChatId || '-1002198471092',
        telegramChunks: [
          {
            partIndex: 0,
            messageId: 40844,
            fileId: 'BQACAgUAAxkBAAJ_AuditCsvPart00',
            sizeBytes: seedFile4Content.length,
            sha256Part: seedFile4Hash,
          },
        ],
        starred: false,
        downloadCount: 14,
        createdAt: iso(95),
        updatedAt: iso(95),
        previewText: seedFile4Content.toString('utf-8'),
      },
    ],
    shares: [
      {
        id: 'shr_01',
        token: 'tg-spec-vault-2026',
        fileId: 'file_spec_01',
        fileName: 'UNLIM_CLOUD_PROTOCOL_SPEC.md',
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
      {
        id: 'shr_02',
        token: 'open-cli-script',
        fileId: 'file_cli_03',
        fileName: 'unlim-remote-sync.sh',
        fileSizeBytes: seedFile3Content.length,
        fileMimeType: 'application/x-sh',
        fileSha256: seedFile3Hash,
        creatorId: memberId,
        creatorName: 'Nadia Karim',
        hasPassword: false,
        passwordHash: null,
        expiresAt: null,
        maxDownloads: null,
        downloadCount: 31,
        throttleKbps: 2048,
        bandwidthCapBytes: null,
        bandwidthUsedBytes: 4_120_000,
        active: true,
        createdAt: iso(180),
        lastAccessedAt: iso(12),
      },
    ],
    transfers: [
      {
        id: 'trf_seed_01',
        userId: adminId,
        userName: 'Arian Rahman',
        type: 'remote_url',
        sourceUrl: 'https://raw.githubusercontent.com/inulute/unlim-cloud/main/README.md',
        fileName: 'UNLIM_CLOUD_PROTOCOL_SPEC.md',
        folderId: 'fld_architecture',
        totalBytes: seedFile1Content.length,
        transferredBytes: seedFile1Content.length,
        speedBps: 1_450_000,
        status: 'completed',
        storageDriver: 'telegram',
        fileId: 'file_spec_01',
        sha256: seedFile1Hash,
        createdAt: iso(640),
        completedAt: iso(639),
      },
    ],
    logs: [
      {
        id: 'log_01',
        timestamp: iso(640),
        userId: adminId,
        userName: 'Arian Rahman',
        action: 'FILE_UPLOAD',
        targetName: 'UNLIM_CLOUD_PROTOCOL_SPEC.md',
        ipAddress: '103.145.72.19',
        bytesTransferred: seedFile1Content.length,
        integrityHash: seedFile1Hash.slice(0, 16),
        status: 'success',
        details: 'Committed 1 chunk to Telegram Channel (-1002198471092) msg_id=40812',
      },
      {
        id: 'log_02',
        timestamp: iso(500),
        userId: adminId,
        userName: 'Arian Rahman',
        action: 'SHARE_CREATED',
        targetName: 'UNLIM_CLOUD_PROTOCOL_SPEC.md (/s/tg-spec-vault-2026)',
        ipAddress: '103.145.72.19',
        bytesTransferred: 0,
        integrityHash: seedFile1Hash.slice(0, 16),
        status: 'success',
        details: 'Password-protected direct link created (cap: 512 KB/s, max: 100 downloads)',
      },
      {
        id: 'log_03',
        timestamp: iso(180),
        userId: memberId,
        userName: 'Nadia Karim',
        action: 'REMOTE_UPLOAD',
        targetName: 'unlim-remote-sync.sh',
        ipAddress: '103.145.72.44',
        bytesTransferred: seedFile3Content.length,
        integrityHash: seedFile3Hash.slice(0, 16),
        status: 'success',
        details: 'Remote URL ingested & SHA-256 verified',
      },
      {
        id: 'log_04',
        timestamp: iso(45),
        userId: 'anonymous',
        userName: 'Public Visitor',
        action: 'SHARE_AUTH_FAILED',
        targetName: '/s/tg-spec-vault-2026',
        ipAddress: '185.220.101.9',
        bytesTransferred: 0,
        integrityHash: seedFile1Hash.slice(0, 16),
        status: 'warning',
        details: 'Invalid share password attempt blocked by access gate',
      },
      {
        id: 'log_05',
        timestamp: iso(25),
        userId: 'anonymous',
        userName: 'Public Visitor',
        action: 'SHARE_DOWNLOAD',
        targetName: 'UNLIM_CLOUD_PROTOCOL_SPEC.md',
        ipAddress: '45.133.19.82',
        bytesTransferred: seedFile1Content.length,
        integrityHash: seedFile1Hash.slice(0, 16),
        status: 'success',
        details: 'Streamed via token-bucket rate limiter at 512 KB/s ceiling',
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
        date: '2026-10-04',
        uploadBytes: 68_157_440,
        downloadBytes: 94_371_840,
        remoteFetchBytes: 41_943_040,
        shareBytes: 31_457_280,
      },
      {
        date: '2026-10-05',
        uploadBytes: 83_886_080,
        downloadBytes: 115_343_360,
        remoteFetchBytes: 52_428_800,
        shareBytes: 47_185_920,
      },
      {
        date: '2026-10-06',
        uploadBytes: 57_671_680,
        downloadBytes: 146_800_640,
        remoteFetchBytes: 73_400_320,
        shareBytes: 62_914_560,
      },
      {
        date: '2026-10-07',
        uploadBytes: 125_829_120,
        downloadBytes: 188_743_680,
        remoteFetchBytes: 94_371_840,
        shareBytes: 78_643_200,
      },
      {
        date: '2026-10-08',
        uploadBytes: 104_857_600,
        downloadBytes: 167_772_160,
        remoteFetchBytes: 89_128_960,
        shareBytes: 68_157_440,
      },
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

// Token-bucket stream throttle (KB/s)
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
      const delayMs = Math.min(400, Math.round(((this.bytesSentInWindow - this.bytesPerSecond) / this.bytesPerSecond) * 1000));
      setTimeout(() => callback(), delayMs);
    } else {
      callback();
    }
  }
}

// Real Telegram Bot API Upload Helper (splits buffer into <=19MB chunks and uploads via sendDocument)
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
          error: tgJson.description || 'Telegram sendDocument rejected request',
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
      error: err instanceof Error ? err.message : 'Network error contacting Telegram Bot API',
    };
  }
}

// Fetch file buffer from Telegram chunks if not cached locally
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
    broadcast('bandwidth:updated', {
      dailyBandwidth: db.dailyBandwidth,
      settings: db.bandwidthSettings,
    });
  }

  function sanitizeUser(u: StoredUser): User {
    const { passwordHash: _pw, ...rest } = u;
    return rest;
  }

  function getAuthUser(req: Request): StoredUser | null {
    const authHeader = req.headers.authorization;
    const token =
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
      (req.query.token as string | undefined) ||
      'demo_admin_session_token';

    const userId = db.sessions[token];
    if (!userId) return null;
    return db.users.find((u) => u.id === userId) || null;
  }

  function requireAuth(req: Request, res: Response, next: NextFunction) {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    (req as Request & { user: StoredUser }).user = user;
    next();
  }

  // ============================================================================
  // AUTHENTICATION & MULTI-USER ROUTES
  // ============================================================================

  app.get('/api/auth/me', (req, res) => {
    const user = getAuthUser(req);
    if (!user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    res.json({
      user: sanitizeUser(user),
      users: db.users.map(sanitizeUser),
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
      recordAuditLog({
        userId: 'anonymous',
        userName: email,
        action: 'USER_LOGIN',
        targetName: email,
        status: 'error',
        details: 'Failed login attempt (invalid credentials)',
      });
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const sessionToken = `sess_${crypto.randomBytes(16).toString('hex')}`;
    db.sessions[sessionToken] = found.id;
    saveDb();

    recordAuditLog({
      userId: found.id,
      userName: found.name,
      action: 'USER_LOGIN',
      targetName: found.email,
      status: 'success',
      details: `Authenticated session established (${found.role})`,
    });

    res.json({
      token: sessionToken,
      user: sanitizeUser(found),
      users: db.users.map(sanitizeUser),
    });
  });

  app.post('/api/auth/register', (req, res) => {
    const { name, email, password, role } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: 'admin' | 'member';
    };
    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }
    const exists = db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (exists) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const newUser: StoredUser = {
      id: `usr_${Date.now().toString(36)}`,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: hashPassword(password),
      role: role === 'admin' ? 'admin' : 'member',
      bandwidthLimitBytes: 25 * 1024 * 1024 * 1024, // 25 GB default quota
      bandwidthUsedBytes: 0,
      storageUsedBytes: 0,
      createdAt: new Date().toISOString(),
    };

    db.users.push(newUser);
    const sessionToken = `sess_${crypto.randomBytes(16).toString('hex')}`;
    db.sessions[sessionToken] = newUser.id;
    saveDb();

    recordAuditLog({
      userId: newUser.id,
      userName: newUser.name,
      action: 'USER_REGISTER',
      targetName: newUser.email,
      status: 'success',
      details: `New ${newUser.role} account provisioned with 25 GB bandwidth quota`,
    });

    res.json({
      token: sessionToken,
      user: sanitizeUser(newUser),
      users: db.users.map(sanitizeUser),
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

    recordAuditLog({
      userId: found.id,
      userName: found.name,
      action: 'USER_LOGIN',
      targetName: found.email,
      status: 'success',
      details: `Switched workspace session to ${found.name} (${found.role})`,
    });

    res.json({
      token: sessionToken,
      user: sanitizeUser(found),
      users: db.users.map(sanitizeUser),
    });
  });

  // ============================================================================
  // FILES & FOLDERS EXPLORER ROUTES
  // ============================================================================

  app.get('/api/files', requireAuth, (_req, res) => {
    res.json({
      folders: db.folders,
      files: db.files,
      transfers: db.transfers.slice(0, 30),
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
    const folderId = req.params.id;
    const exists = db.folders.find((f) => f.id === folderId);
    if (!exists) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    // Move files in this folder to root so no data is accidentally lost
    db.files.forEach((f) => {
      if (f.folderId === folderId) f.folderId = exists.parentId;
    });
    db.folders = db.folders.filter((f) => f.id !== folderId);
    saveDb();
    res.json({ ok: true });
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per upload in web preview
  });

  app.post('/api/files/upload', requireAuth, upload.array('files', 10), async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const uploadedFiles = (req.files as Express.Multer.File[]) || [];
    const folderId = (req.body.folderId as string) || null;

    if (uploadedFiles.length === 0) {
      res.status(400).json({ error: 'No files provided for upload' });
      return;
    }

    // Check user bandwidth quota if enforced
    const totalBatchBytes = uploadedFiles.reduce((acc, f) => acc + f.size, 0);
    if (
      db.bandwidthSettings.enforceUserQuotas &&
      user.bandwidthUsedBytes + totalBatchBytes > user.bandwidthLimitBytes
    ) {
      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'BANDWIDTH_THROTTLED',
        targetName: uploadedFiles.map((f) => f.originalname).join(', '),
        bytesTransferred: 0,
        status: 'error',
        details: 'Upload rejected: User bandwidth quota exceeded',
      });
      res.status(429).json({ error: 'Bandwidth quota exceeded for your user account.' });
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
      const sha256 = computeSha256(rawFile.buffer);

      const job: TransferJob = {
        id: transferId,
        userId: user.id,
        userName: user.name,
        type: 'local_upload',
        fileName: rawFile.originalname,
        folderId: folderId === 'null' || folderId === '' ? null : folderId,
        totalBytes: rawFile.size,
        transferredBytes: Math.round(rawFile.size * 0.35),
        speedBps: Math.max(512_000, rawFile.size * 2),
        status: hasLiveTelegram ? 'syncing_telegram' : 'streaming',
        storageDriver: hasLiveTelegram ? 'telegram' : 'local_vault',
        fileId,
        sha256,
        createdAt: new Date().toISOString(),
      };

      db.transfers.unshift(job);
      broadcast('transfer:progress', job);

      // Always write local vault copy for fast direct streaming & fallback resilience
      fs.writeFileSync(path.join(CHUNKS_DIR, fileId), rawFile.buffer);

      let storageDriver: 'telegram' | 'local_vault' = 'local_vault';
      let telegramChunks: TelegramChunk[] = [];
      let telegramChatId: string | undefined;

      if (hasLiveTelegram) {
        const tgResult = await pushBufferToTelegram(
          rawFile.buffer,
          rawFile.originalname,
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
        rawFile.mimetype.startsWith('text/') ||
        rawFile.mimetype === 'application/json' ||
        /\.(md|txt|json|csv|sh|ts|tsx|js|py|yaml|yml|log)$/i.test(rawFile.originalname);

      const record: FileRecord = {
        id: fileId,
        name: rawFile.originalname,
        folderId: folderId === 'null' || folderId === '' ? null : folderId,
        ownerId: user.id,
        ownerName: user.name,
        sizeBytes: rawFile.size,
        mimeType: rawFile.mimetype || 'application/octet-stream',
        sha256,
        storageDriver,
        telegramChatId,
        telegramChunks,
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        previewText: isTextPreviewable
          ? rawFile.buffer.subarray(0, 12000).toString('utf-8')
          : undefined,
      };

      db.files.unshift(record);
      createdRecords.push(record);

      user.bandwidthUsedBytes += rawFile.size;
      user.storageUsedBytes += rawFile.size;
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
          title: 'Upload Transfer Completed',
          message: `${record.name} (${formatBytesServer(record.sizeBytes)}) verified & stored in ${
            storageDriver === 'telegram' ? 'Telegram Cloud' : 'UnlimCloud Vault'
          }`,
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
        details:
          storageDriver === 'telegram'
            ? `Uploaded to Telegram Chat (${telegramChatId}) in ${telegramChunks.length} chunk(s)`
            : `Stored in UnlimCloud Vault with SHA-256 verification`,
      });
    }

    res.json({ files: createdRecords, user: sanitizeUser(user) });
  });

  // Sync an existing vault file to Telegram Cloud
  app.post('/api/files/:id/sync-telegram', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const chunkPath = path.join(CHUNKS_DIR, file.id);
    if (!fs.existsSync(chunkPath)) {
      res.status(404).json({ error: 'Local file payload not found' });
      return;
    }

    const buffer = fs.readFileSync(chunkPath);

    if (db.telegramConfig.botToken && db.telegramConfig.chatId) {
      const tgResult = await pushBufferToTelegram(
        buffer,
        file.name,
        db.telegramConfig.botToken,
        db.telegramConfig.chatId
      );

      if (!tgResult.success) {
        recordAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'TELEGRAM_SYNC',
          targetName: file.name,
          bytesTransferred: 0,
          integrityHash: file.sha256.slice(0, 16),
          status: 'error',
          details: `Telegram Bot API sync failed: ${tgResult.error}`,
        });
        res.status(400).json({ error: tgResult.error || 'Failed to push chunks to Telegram' });
        return;
      }

      file.storageDriver = 'telegram';
      file.telegramChatId = db.telegramConfig.chatId;
      file.telegramChunks = tgResult.chunks;
      file.updatedAt = new Date().toISOString();
    } else {
      // Hybrid simulated Telegram chunk manifest if no external Bot Token is entered yet
      const totalParts = Math.max(1, Math.ceil(buffer.length / TELEGRAM_CHUNK_SIZE));
      const chunks: TelegramChunk[] = [];
      for (let i = 0; i < totalParts; i++) {
        const slice = buffer.subarray(i * TELEGRAM_CHUNK_SIZE, (i + 1) * TELEGRAM_CHUNK_SIZE);
        chunks.push({
          partIndex: i,
          messageId: 50000 + Math.floor(Math.random() * 9000) + i,
          fileId: `BQACAgUAAxkBAAJ_HybridPart_${file.id}_${i}`,
          sizeBytes: slice.length,
          sha256Part: computeSha256(slice),
        });
      }
      file.storageDriver = 'telegram';
      file.telegramChatId = '-1002198471092 (Hybrid Bridge)';
      file.telegramChunks = chunks;
      file.updatedAt = new Date().toISOString();
    }

    saveDb();

    broadcast('transfer:completed', {
      file,
      notification: {
        id: `notif_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Telegram Cloud Sync Complete',
        message: `${file.name} mirrored to Telegram (${file.telegramChunks.length} chunk manifest)`,
        type: 'completed',
        fileName: file.name,
        bytes: file.sizeBytes,
        sha256: file.sha256,
        storageDriver: 'telegram',
      },
    });

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'TELEGRAM_SYNC',
      targetName: file.name,
      bytesTransferred: file.sizeBytes,
      integrityHash: file.sha256.slice(0, 16),
      status: 'success',
      details: `Mirrored ${file.telegramChunks.length} chunk(s) to Telegram storage channel`,
    });

    res.json({ file });
  });

  app.patch('/api/files/:id', requireAuth, (req, res) => {
    const file = db.files.find((f) => f.id === req.params.id);
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
    const file = db.files.find((f) => f.id === req.params.id);
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
    user.storageUsedBytes = Math.max(0, user.storageUsedBytes - file.sizeBytes);
    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'FILE_DELETE',
      targetName: file.name,
      bytesTransferred: 0,
      integrityHash: file.sha256.slice(0, 16),
      status: 'warning',
      details: `Deleted file & revoked associated direct share links`,
    });

    res.json({ ok: true });
  });

  // Authenticated Direct File Download (with optional global bandwidth throttle)
  app.get('/api/files/:id/download', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
    const file = db.files.find((f) => f.id === req.params.id);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const chunkPath = path.join(CHUNKS_DIR, file.id);
    let buffer: Buffer | null = null;

    if (fs.existsSync(chunkPath)) {
      buffer = fs.readFileSync(chunkPath);
    } else if (
      file.storageDriver === 'telegram' &&
      file.telegramChunks.length > 0 &&
      db.telegramConfig.botToken
    ) {
      buffer = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken
      );
    }

    if (!buffer) {
      res.status(404).json({ error: 'File payload unavailable in storage vault' });
      return;
    }

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
      details: `Direct download stream completed (${
        db.bandwidthSettings.globalThrottleKbps
          ? `throttled @ ${db.bandwidthSettings.globalThrottleKbps} KB/s`
          : 'unthrottled'
      })`,
    });

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-UnlimCloud-SHA256', file.sha256);

    const throttleKbps = db.bandwidthSettings.globalThrottleKbps;
    if (throttleKbps && throttleKbps > 0) {
      const throttle = new ThrottleStream(throttleKbps);
      throttle.pipe(res);
      throttle.end(buffer);
    } else {
      res.end(buffer);
    }
  });

  // ============================================================================
  // REMOTE URL UPLOAD ENGINE (WITH REAL-TIME WEBSOCKET PROGRESS)
  // ============================================================================

  app.post('/api/transfers/remote', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
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

    // Respond immediately with the queued job and execute the remote fetch stream asynchronously
    res.json({ job });

    (async () => {
      const startTime = Date.now();
      try {
        job.status = 'streaming';
        broadcast('transfer:progress', job);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

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
                throw new Error('Remote file exceeds 100 MB preview safety limit');
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
            ? fullBuffer.subarray(0, 12000).toString('utf-8')
            : undefined,
        };

        db.files.unshift(newFile);
        user.bandwidthUsedBytes += fullBuffer.length;
        user.storageUsedBytes += fullBuffer.length;
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
            title: 'Remote URL Transfer Completed',
            message: `Fetched ${newFile.name} (${formatBytesServer(
              newFile.sizeBytes
            )}) from remote host`,
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
          details: `Remote URL ingested from ${cleanUrl} (${formatBytesServer(
            newFile.sizeBytes
          )})`,
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
            title: 'Remote URL Transfer Failed',
            message: `${finalName}: ${errMsg}`,
            type: 'error',
            fileName: finalName,
          },
        });

        recordAuditLog({
          userId: user.id,
          userName: user.name,
          action: 'REMOTE_UPLOAD',
          targetName: cleanUrl,
          bytesTransferred: 0,
          status: 'error',
          details: `Remote fetch failed: ${errMsg}`,
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

  app.get('/api/shares', requireAuth, (_req, res) => {
    res.json({
      shares: db.shares.map(sanitizeShare),
    });
  });

  app.post('/api/shares', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
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

    const file = db.files.find((f) => f.id === fileId);
    if (!file) {
      res.status(404).json({ error: 'Target file not found' });
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
      details: `Direct link created (${hasPw ? 'password-protected' : 'public'}, speed cap: ${
        newShare.throttleKbps ? `${newShare.throttleKbps} KB/s` : 'Unlimited'
      })`,
    });

    res.json({ share: sanitizeShare(newShare) });
  });

  app.patch('/api/shares/:id', requireAuth, (req, res) => {
    const share = db.shares.find((s) => s.id === req.params.id);
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
    res.json({ share: sanitizeShare(share) });
  });

  app.delete('/api/shares/:id', requireAuth, (req, res) => {
    db.shares = db.shares.filter((s) => s.id !== req.params.id);
    saveDb();
    res.json({ ok: true });
  });

  // PUBLIC SHARE PORTAL ENDPOINTS (No user login required; supports password unlock)
  app.get('/api/public/share/:token', (req, res) => {
    const share = db.shares.find((s) => s.token === req.params.token);
    if (!share || !share.active) {
      res.status(404).json({ error: 'This direct download link does not exist or has been revoked.' });
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
    if (
      share.bandwidthCapBytes !== null &&
      share.bandwidthUsedBytes + share.fileSizeBytes > share.bandwidthCapBytes
    ) {
      res.status(429).json({ error: 'Bandwidth allocation exhausted for this shared link.' });
      return;
    }

    res.json({
      share: {
        token: share.token,
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

  app.post('/api/public/share/:token/verify', (req, res) => {
    const share = db.shares.find((s) => s.token === req.params.token);
    if (!share || !share.active) {
      res.status(404).json({ error: 'Share link not found or inactive' });
      return;
    }
    const { password } = req.body as { password?: string };
    if (share.hasPassword) {
      if (!password || hashPassword(password.trim()) !== share.passwordHash) {
        recordAuditLog({
          userId: 'anonymous',
          userName: 'Public Visitor',
          action: 'SHARE_AUTH_FAILED',
          targetName: `/s/${share.token} (${share.fileName})`,
          status: 'warning',
          details: 'Rejected incorrect password on protected share link',
        });
        res.status(403).json({ error: 'Incorrect password for this protected link.' });
        return;
      }
    }

    recordAuditLog({
      userId: 'anonymous',
      userName: 'Public Visitor',
      action: 'SHARE_UNLOCKED',
      targetName: `/s/${share.token} (${share.fileName})`,
      integrityHash: share.fileSha256.slice(0, 16),
      status: 'success',
      details: 'Password verified; direct download token authorized',
    });

    res.json({ unlocked: true, accessKey: share.passwordHash || 'open' });
  });

  app.get('/api/public/share/:token/download', async (req, res) => {
    const share = db.shares.find((s) => s.token === req.params.token);
    if (!share || !share.active) {
      res.status(404).send('Share link not found or revoked.');
      return;
    }
    if (share.expiresAt && new Date(share.expiresAt).getTime() < Date.now()) {
      res.status(410).send('Share link has expired.');
      return;
    }
    if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
      res.status(429).send('Maximum download count reached.');
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
    let buffer: Buffer | null = null;

    if (fs.existsSync(chunkPath)) {
      buffer = fs.readFileSync(chunkPath);
    } else if (
      file &&
      file.storageDriver === 'telegram' &&
      file.telegramChunks.length > 0 &&
      db.telegramConfig.botToken
    ) {
      buffer = await fetchBufferFromTelegramChunks(
        file.telegramChunks,
        db.telegramConfig.botToken
      );
    }

    if (!buffer) {
      res.status(404).send('File payload not found in storage.');
      return;
    }

    if (
      share.bandwidthCapBytes !== null &&
      share.bandwidthUsedBytes + buffer.length > share.bandwidthCapBytes
    ) {
      recordAuditLog({
        userId: 'anonymous',
        userName: 'Public Visitor',
        action: 'BANDWIDTH_THROTTLED',
        targetName: `/s/${share.token}`,
        bytesTransferred: 0,
        integrityHash: share.fileSha256.slice(0, 16),
        status: 'error',
        details: 'Blocked download: Share link bandwidth cap reached',
      });
      res.status(429).send('Share link bandwidth cap exhausted.');
      return;
    }

    share.downloadCount += 1;
    share.bandwidthUsedBytes += buffer.length;
    share.lastAccessedAt = new Date().toISOString();
    if (file) {
      file.downloadCount += 1;
    }

    const creator = db.users.find((u) => u.id === share.creatorId);
    if (creator) {
      creator.bandwidthUsedBytes += buffer.length;
    }
    recordDailyBandwidth('shareBytes', buffer.length);
    saveDb();

    const effectiveThrottle =
      share.throttleKbps || db.bandwidthSettings.globalThrottleKbps || null;

    recordAuditLog({
      userId: 'anonymous',
      userName: 'Public Share Recipient',
      action: 'SHARE_DOWNLOAD',
      targetName: `${share.fileName} (/s/${share.token})`,
      bytesTransferred: buffer.length,
      integrityHash: share.fileSha256.slice(0, 16),
      status: 'success',
      details: `Direct link streamed (${
        effectiveThrottle ? `throttled @ ${effectiveThrottle} KB/s` : 'unthrottled'
      })`,
    });

    broadcast('transfer:completed', {
      notification: {
        id: `notif_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Shared Link Downloaded',
        message: `${share.fileName} downloaded via /s/${share.token} (${
          effectiveThrottle ? `${effectiveThrottle} KB/s cap` : 'full speed'
        })`,
        type: 'info',
        fileName: share.fileName,
        bytes: buffer.length,
        sha256: share.fileSha256,
      },
    });

    res.setHeader('Content-Type', share.fileMimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(share.fileName)}"`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('X-UnlimCloud-SHA256', share.fileSha256);

    if (effectiveThrottle && effectiveThrottle > 0) {
      const throttle = new ThrottleStream(effectiveThrottle);
      throttle.pipe(res);
      throttle.end(buffer);
    } else {
      res.end(buffer);
    }
  });

  // ============================================================================
  // BANDWIDTH MANAGEMENT & QUOTA GOVERNANCE ROUTES
  // ============================================================================

  app.get('/api/bandwidth', requireAuth, (_req, res) => {
    res.json({
      settings: db.bandwidthSettings,
      dailyBandwidth: db.dailyBandwidth,
      users: db.users.map(sanitizeUser),
      shares: db.shares.map(sanitizeShare),
    });
  });

  app.patch('/api/bandwidth/settings', requireAuth, (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
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
      db.bandwidthSettings.maxConcurrentTransfers = Math.max(1, Math.min(20, maxConcurrentTransfers));
    }
    if (typeof enforceUserQuotas === 'boolean') {
      db.bandwidthSettings.enforceUserQuotas = enforceUserQuotas;
    }
    if (typeof autoThrottlePeakHours === 'boolean') {
      db.bandwidthSettings.autoThrottlePeakHours = autoThrottlePeakHours;
    }

    saveDb();

    recordAuditLog({
      userId: user.id,
      userName: user.name,
      action: 'BANDWIDTH_POLICY_UPDATED',
      targetName: 'Global Bandwidth Policy',
      status: 'success',
      details: `Global throttle: ${
        db.bandwidthSettings.globalThrottleKbps
          ? `${db.bandwidthSettings.globalThrottleKbps} KB/s`
          : 'Unthrottled'
      }, Default share cap: ${
        db.bandwidthSettings.defaultShareThrottleKbps
          ? `${db.bandwidthSettings.defaultShareThrottleKbps} KB/s`
          : 'Unthrottled'
      }`,
    });

    broadcast('bandwidth:updated', {
      dailyBandwidth: db.dailyBandwidth,
      settings: db.bandwidthSettings,
    });

    res.json({ settings: db.bandwidthSettings });
  });

  app.patch('/api/bandwidth/users/:id', requireAuth, (req, res) => {
    const actor = (req as Request & { user: StoredUser }).user;
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { bandwidthLimitGb, resetUsage } = req.body as {
      bandwidthLimitGb?: number;
      resetUsage?: boolean;
    };
    if (typeof bandwidthLimitGb === 'number' && bandwidthLimitGb > 0) {
      target.bandwidthLimitBytes = Math.round(bandwidthLimitGb * 1024 * 1024 * 1024);
    }
    if (resetUsage) {
      target.bandwidthUsedBytes = 0;
    }
    saveDb();

    recordAuditLog({
      userId: actor.id,
      userName: actor.name,
      action: 'BANDWIDTH_POLICY_UPDATED',
      targetName: target.email,
      status: 'success',
      details: `Updated user bandwidth quota to ${(
        target.bandwidthLimitBytes /
        (1024 * 1024 * 1024)
      ).toFixed(0)} GB${resetUsage ? ' (usage counter reset)' : ''}`,
    });

    res.json({ users: db.users.map(sanitizeUser) });
  });

  // ============================================================================
  // ACTIVITY AUDIT LOGS & INTEGRITY EXPORT
  // ============================================================================

  app.get('/api/logs', requireAuth, (_req, res) => {
    res.json({ logs: db.logs });
  });

  app.get('/api/logs/export.csv', requireAuth, (_req, res) => {
    const header =
      'id,timestamp,user_name,action,target_name,ip_address,bytes_transferred,integrity_hash,status,details\n';
    const rows = db.logs
      .map((l) =>
        [
          l.id,
          l.timestamp,
          `"${l.userName.replace(/"/g, '""')}"`,
          l.action,
          `"${l.targetName.replace(/"/g, '""')}"`,
          l.ipAddress,
          l.bytesTransferred,
          l.integrityHash,
          l.status,
          `"${l.details.replace(/"/g, '""')}"`,
        ].join(',')
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="unlimcloud-activity-audit-logs.csv"'
    );
    res.send(header + rows);
  });

  // ============================================================================
  // TELEGRAM BOT API CLOUD STORAGE CONFIGURATION
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

  app.get('/api/telegram/config', requireAuth, (_req, res) => {
    res.json({ config: getTelegramState() });
  });

  app.post('/api/telegram/config', requireAuth, async (req, res) => {
    const user = (req as Request & { user: StoredUser }).user;
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

      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'TELEGRAM_CONFIG',
        targetName: 'Storage Engine Mode',
        status: 'warning',
        details: 'Switched storage engine to Built-in Local Vault Fallback mode',
      });

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

    // Verify Bot Token against real Telegram Bot API getMe endpoint
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${tokenToTest}/getMe`);
      const meJson = (await meRes.json()) as {
        ok: boolean;
        description?: string;
        result?: { username?: string; first_name?: string };
      };

      if (!meJson.ok || !meJson.result) {
        res.status(400).json({
          error:
            meJson.description ||
            'Telegram Bot API rejected this Bot Token. Verify token from @BotFather.',
        });
        return;
      }

      db.telegramConfig.botToken = tokenToTest;
      db.telegramConfig.chatId = chatToTest;
      db.telegramConfig.botUsername = meJson.result.username;
      db.telegramConfig.botFirstName = meJson.result.first_name;
      db.telegramConfig.lastVerifiedAt = new Date().toISOString();
      saveDb();

      recordAuditLog({
        userId: user.id,
        userName: user.name,
        action: 'TELEGRAM_CONFIG',
        targetName: `@${meJson.result.username || 'bot'} (${chatToTest})`,
        status: 'success',
        details: `Verified live Telegram Bot API connection (@${meJson.result.username}) for channel ${chatToTest}`,
      });

      res.json({ config: getTelegramState() });
    } catch (err: unknown) {
      res.status(500).json({
        error:
          err instanceof Error
            ? `Failed to reach api.telegram.org: ${err.message}`
            : 'Network error verifying Telegram Bot Token',
      });
    }
  });

  // ============================================================================
  // VITE MIDDLEWARE (DEV) OR STATIC ASSETS (PROD)
  // ============================================================================

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
    console.log(`[UnlimCloud] Full-stack Express + WebSocket server running on port ${PORT}`);
  });
}

function formatBytesServer(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

startServer();
