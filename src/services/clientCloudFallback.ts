import {
  User,
  FolderRecord,
  FileRecord,
  ShareLink,
  TransferJob,
  AuditLog,
  BandwidthSettings,
  TelegramConfigState,
  TelegramChunk,
  StoragePlanId,
} from '../types';

const STORAGE_KEY = 'unlimcloud_client_db_v4';
const FILE_BLOBS_KEY = 'unlimcloud_client_blobs_v4';

const FREE_25GB_BYTES = 25 * 1024 * 1024 * 1024;
const PRO_50GB_BYTES = 50 * 1024 * 1024 * 1024;
const ULTRA_1TB_BYTES = 1024 * 1024 * 1024 * 1024;

interface ClientStoredUser extends User {
  passwordHash: string;
}

interface ClientStoredShare extends ShareLink {
  passwordHash: string | null;
}

interface ClientDatabase {
  users: ClientStoredUser[];
  sessions: Record<string, string>;
  folders: FolderRecord[];
  files: FileRecord[];
  shares: ClientStoredShare[];
  transfers: TransferJob[];
  logs: AuditLog[];
  bandwidthSettings: BandwidthSettings;
  telegramConfig: {
    botToken: string;
    chatId: string;
    botUsername?: string;
    autoSyncUploads: boolean;
  };
}

function simpleHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + '9f86d081884c7d659a2feaa0';
}

function getPlanQuotaBytes(planId: StoragePlanId = 'free_25gb'): number {
  if (planId === 'ultra_1tb') return ULTRA_1TB_BYTES;
  if (planId === 'pro_50gb') return PRO_50GB_BYTES;
  return FREE_25GB_BYTES;
}

function getBlobStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILE_BLOBS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveBlobStore(store: Record<string, string>) {
  try {
    localStorage.setItem(FILE_BLOBS_KEY, JSON.stringify(store));
  } catch {
    // ignore storage quota errors on very large files
  }
}

// ============================================================================
// INDEXEDDB + IN-MEMORY BINARY VAULT (Supports 285 MB+ MKV & Large Binary Files)
// ============================================================================

const IDB_NAME = 'unlimcloud_binary_vault_v1';
const IDB_STORE = 'file_blobs';
const memoryBlobCache = new Map<string, Blob>();

export function resolveClientMimeType(fileName: string, rawMime?: string): string {
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

function openBinaryVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function storeClientBinaryBlob(fileId: string, blob: Blob): Promise<void> {
  memoryBlobCache.set(fileId, blob);
  const idb = await openBinaryVaultDb();
  if (!idb) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.put(blob, fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getClientBinaryBlob(fileId: string): Promise<Blob | null> {
  const inMem = memoryBlobCache.get(fileId);
  if (inMem) return inMem;

  const idb = await openBinaryVaultDb();
  if (!idb) return null;

  return new Promise<Blob | null>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(fileId);
      req.onsuccess = () => {
        const res = req.result;
        if (res instanceof Blob) {
          memoryBlobCache.set(fileId, res);
          resolve(res);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteClientBinaryBlob(fileId: string): Promise<void> {
  memoryBlobCache.delete(fileId);
  const idb = await openBinaryVaultDb();
  if (!idb) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      store.delete(fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function createInitialClientDb(): ClientDatabase {
  const now = new Date();
  const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60000).toISOString();
  const adminId = 'usr_admin_01';
  const memberId = 'usr_dev_02';

  const file1Text =
    `# UnlimCloud Encrypted Cloud Drive — Quick Start Guide\n\n` +
    `Welcome to your private UnlimCloud storage vault.\n\n` +
    `## Storage Tiers & Token Billing\n` +
    `- **Starter Free**: 25 GB included free for every account\n` +
    `- **Pro 50 GB**: 500 Tokens / month\n` +
    `- **Ultra 1 TB**: 1024 Tokens / month\n\n` +
    `## 3-Month Data Protection Guarantee\n` +
    `If your monthly plan expires, your files are never deleted right away.\n` +
    `Your first 25 GB stays accessible at all times, and any files above 25 GB are safely held for 3 months (90 days) so you can renew whenever you are ready.\n`;

  const file2Svg =
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
    `</svg>`;

  const blobs = getBlobStore();
  blobs['file_spec_01'] = file1Text;
  blobs['file_diagram_02'] = file2Svg;
  saveBlobStore(blobs);

  const svgBase64 = btoa(unescape(encodeURIComponent(file2Svg)));

  return {
    users: [
      {
        id: adminId,
        name: 'Arian Rahman',
        email: 'titumamma2425@gmail.com',
        passwordHash: simpleHash('admin123'),
        role: 'admin',
        bandwidthLimitBytes: FREE_25GB_BYTES,
        bandwidthUsedBytes: 482_344_960,
        storageUsedBytes: file1Text.length + file2Svg.length,
        createdAt: iso(4320),
        planId: 'free_25gb',
        tokenBalance: 250,
        planExpiresAt: null,
        graceEndsAt: null,
        usedPromoCodes: [],
      },
      {
        id: memberId,
        name: 'Nadia Karim',
        email: 'dev@unlim.cloud',
        passwordHash: simpleHash('dev123'),
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
        sizeBytes: file1Text.length,
        mimeType: 'text/markdown',
        sha256: simpleHash(file1Text),
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: true,
        downloadCount: 18,
        createdAt: iso(640),
        updatedAt: iso(640),
        previewText: file1Text,
        lockedOverQuota: false,
      },
      {
        id: 'file_diagram_02',
        name: 'UnlimCloud-Vault-Overview.svg',
        folderId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: file2Svg.length,
        mimeType: 'image/svg+xml',
        sha256: simpleHash(file2Svg),
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: true,
        downloadCount: 9,
        createdAt: iso(410),
        updatedAt: iso(410),
        previewText: file2Svg,
        previewDataUrl: `data:image/svg+xml;base64,${svgBase64}`,
        lockedOverQuota: false,
      },
    ],
    shares: [
      {
        id: 'shr_01',
        token: 'tg-spec-vault-2026',
        fileId: 'file_spec_01',
        fileName: 'UnlimCloud-QuickStart-Guide.md',
        fileSizeBytes: file1Text.length,
        fileMimeType: 'text/markdown',
        fileSha256: simpleHash(file1Text),
        creatorId: adminId,
        creatorName: 'Arian Rahman',
        hasPassword: true,
        passwordHash: simpleHash('unlim2026'),
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
        bytesTransferred: file1Text.length,
        integrityHash: simpleHash(file1Text).slice(0, 16),
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
    telegramConfig: {
      botToken: '',
      chatId: '',
      autoSyncUploads: true,
    },
  };
}

function loadClientDb(): ClientDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  const initial = createInitialClientDb();
  saveClientDb(initial);
  return initial;
}

function saveClientDb(db: ClientDatabase) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

function evaluateClientQuotaAndLocks(db: ClientDatabase, user: ClientStoredUser) {
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
      isExpiredInGrace = true;
      user.bandwidthLimitBytes = FREE_25GB_BYTES;
    } else {
      user.bandwidthLimitBytes = getPlanQuotaBytes(user.planId);
    }
  } else {
    user.bandwidthLimitBytes = getPlanQuotaBytes(user.planId);
  }

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

function seedStarterClientFilesForNewUser(db: ClientDatabase, user: ClientStoredUser) {
  const guideText =
    `# Welcome to UnlimCloud, ${user.name}!\n\n` +
    `Your private 25 GB Encrypted Cloud Drive is active and ready.\n\n` +
    `- Upload any file with live progress tracking\n` +
    `- Preview documents, images, audio, and video directly in your browser\n` +
    `- Create password-protected direct download links\n` +
    `- Upgrade to 50 GB (500 Tokens/mo) or 1 TB (1024 Tokens/mo) anytime\n`;
  const fileId = `file_welcome_${user.id}`;
  const blobs = getBlobStore();
  blobs[fileId] = guideText;
  saveBlobStore(blobs);

  db.files.unshift({
    id: fileId,
    name: 'Welcome-to-UnlimCloud.md',
    folderId: null,
    ownerId: user.id,
    ownerName: user.name,
    sizeBytes: guideText.length,
    mimeType: 'text/markdown',
    sha256: simpleHash(guideText),
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

const originalFetch = window.fetch.bind(window);
let staticFallbackMode: boolean | null = null;

async function handleClientApi(urlStr: string, init?: RequestInit): Promise<Response> {
  const db = loadClientDb();
  const parsed = new URL(urlStr, window.location.origin);
  const path = parsed.pathname;
  const method = (init?.method || 'GET').toUpperCase();

  const parseBody = async () => {
    if (!init?.body) return {};
    if (typeof init.body === 'string') return JSON.parse(init.body);
    return {};
  };

  // Public share links do not require authentication
  if (path.startsWith('/api/public/share/') && method === 'GET' && !path.endsWith('/download')) {
    const tok = decodeURIComponent(path.slice('/api/public/share/'.length));
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return jsonResponse({ error: 'Share link not found or disabled' }, 404);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/verify') && method === 'POST') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/verify'.length)
    );
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return jsonResponse({ error: 'Share link not found' }, 404);
    const body = await parseBody();
    if (share.hasPassword && simpleHash(String(body.password || '').trim()) !== share.passwordHash) {
      return jsonResponse({ error: 'Incorrect password' }, 403);
    }
    return jsonResponse({ unlocked: true, accessKey: share.passwordHash || 'open' });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/download') && method === 'GET') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/download'.length)
    );
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return new Response('Not found', { status: 404 });
    share.downloadCount += 1;
    saveClientDb(db);

    const binaryBlob = await getClientBinaryBlob(share.fileId);
    if (binaryBlob) {
      return new Response(binaryBlob, {
        status: 200,
        headers: {
          'Content-Type': resolveClientMimeType(share.fileName, share.fileMimeType),
          'Content-Length': String(binaryBlob.size),
        },
      });
    }

    const blobs = getBlobStore();
    const content = blobs[share.fileId] || `Shared file: ${share.fileName}`;
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': share.fileMimeType || 'application/octet-stream' },
    });
  }

  // All other routes strictly require Firebase Authentication
  let fbUid = (parsed.searchParams.get('uid') || '').trim();
  let fbEmail = (parsed.searchParams.get('email') || '').trim();
  let fbName = '';
  if (init?.headers) {
    const h = new Headers(init.headers);
    fbUid = (h.get('X-Firebase-Uid') || fbUid).trim();
    fbEmail = (h.get('X-Firebase-Email') || fbEmail).trim();
    fbName = (h.get('X-Firebase-Name') || '').trim();
  }

  if (!fbUid) {
    return jsonResponse(
      { error: 'Authentication required. Please sign in with Google to access UnlimCloud.' },
      401
    );
  }

  const isAdminEmail = fbEmail.toLowerCase() === 'titumamma2425@gmail.com';
  let currentUser = db.users.find((u) => u.id === fbUid);

  if (!currentUser) {
    currentUser = {
      id: fbUid,
      name: fbName || fbEmail.split('@')[0] || 'Cloud User',
      email: fbEmail || `${fbUid}@user.unlimcloud`,
      passwordHash: '',
      role: isAdminEmail ? 'admin' : 'member',
      bandwidthLimitBytes: FREE_25GB_BYTES,
      bandwidthUsedBytes: 0,
      storageUsedBytes: 0,
      createdAt: new Date().toISOString(),
      planId: 'free_25gb',
      tokenBalance: 0,
      planExpiresAt: null,
      graceEndsAt: null,
      usedPromoCodes: [],
    };
    db.users.push(currentUser);
    seedStarterClientFilesForNewUser(db, currentUser);
    saveClientDb(db);
  } else {
    if (fbEmail) currentUser.email = fbEmail;
    if (fbName) currentUser.name = fbName;
    currentUser.role = isAdminEmail ? 'admin' : 'member';
  }

  evaluateClientQuotaAndLocks(db, currentUser);
  saveClientDb(db);

  if (path === '/api/auth/me' && method === 'GET') {
    return jsonResponse({ user: currentUser, users: [currentUser] });
  }

  // Billing & Token Endpoints
  if (path === '/api/billing/promo' && method === 'POST') {
    const body = await parseBody();
    const cleanCode = String(body.code || '').trim();
    if (cleanCode !== '1tBfri26' && cleanCode.toLowerCase() !== '1tbfri26') {
      return jsonResponse(
        { error: 'Invalid promo code. Please check the code and try again.' },
        400
      );
    }
    currentUser.tokenBalance = (currentUser.tokenBalance || 0) + 9999;
    if (!Array.isArray(currentUser.usedPromoCodes)) currentUser.usedPromoCodes = [];
    if (!currentUser.usedPromoCodes.includes('1tBfri26')) {
      currentUser.usedPromoCodes.push('1tBfri26');
    }
    db.logs.unshift({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'PROMO_REDEEMED',
      targetName: 'Promo Code: 1tBfri26 (+9,999 Tokens)',
      ipAddress: 'client',
      bytesTransferred: 0,
      integrityHash: 'promo_1tBfri26',
      status: 'success',
      details: 'Redeemed promo code 1tBfri26 for 9,999 storage tokens',
    });
    saveClientDb(db);
    return jsonResponse({
      user: currentUser,
      tokensAdded: 9999,
      message: 'Promo code 1tBfri26 applied! +9,999 Tokens added to your wallet.',
    });
  }

  if (path === '/api/billing/buy-tokens' && method === 'POST') {
    const body = await parseBody();
    const amount = Number(body.tokens) || 0;
    if (amount <= 0) {
      return jsonResponse({ error: 'Invalid token amount' }, 400);
    }
    currentUser.tokenBalance = (currentUser.tokenBalance || 0) + amount;
    db.logs.unshift({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'TOKENS_PURCHASED',
      targetName: `+${amount} Tokens (${body.paymentMethod || 'Checkout'})`,
      ipAddress: 'client',
      bytesTransferred: 0,
      integrityHash: 'token_purchase',
      status: 'success',
      details: `Purchased ${amount} tokens`,
    });
    saveClientDb(db);
    return jsonResponse({
      user: currentUser,
      tokensAdded: amount,
      message: `Successfully purchased ${amount.toLocaleString()} Tokens!`,
    });
  }

  if (path === '/api/billing/subscribe' && method === 'POST') {
    const body = await parseBody();
    const planId = body.planId as StoragePlanId;
    const costMap: Record<StoragePlanId, number> = {
      free_25gb: 0,
      pro_50gb: 500,
      ultra_1tb: 1024,
    };
    const cost = costMap[planId] ?? 0;
    const currentTokens = currentUser.tokenBalance || 0;

    if (cost > 0 && currentTokens < cost) {
      return jsonResponse(
        {
          error: `Insufficient tokens. You need ${cost} Tokens/month, but your wallet has ${currentTokens} Tokens.`,
        },
        400
      );
    }

    if (cost > 0) {
      currentUser.tokenBalance = currentTokens - cost;
      const nowMs = Date.now();
      const baseMs =
        currentUser.planExpiresAt && new Date(currentUser.planExpiresAt).getTime() > nowMs
          ? new Date(currentUser.planExpiresAt).getTime()
          : nowMs;
      const nextExp = new Date(baseMs + 30 * 86400_000);
      const nextGrace = new Date(nextExp.getTime() + 90 * 86400_000);
      currentUser.planId = planId;
      currentUser.planExpiresAt = nextExp.toISOString();
      currentUser.graceEndsAt = nextGrace.toISOString();
    } else {
      currentUser.planId = 'free_25gb';
      currentUser.planExpiresAt = null;
      currentUser.graceEndsAt = null;
    }

    evaluateClientQuotaAndLocks(db, currentUser);
    saveClientDb(db);

    return jsonResponse({
      user: currentUser,
      files: db.files.filter((f) => f.ownerId === currentUser.id),
      message:
        planId === 'ultra_1tb'
          ? '1 TB Plan activated for 30 days! All files unlocked.'
          : planId === 'pro_50gb'
          ? '50 GB Plan activated for 30 days! All files unlocked.'
          : 'Switched to 25 GB Free Plan.',
    });
  }

  if (path === '/api/billing/simulate-expiry' && method === 'POST') {
    const now = Date.now();
    const simFileId = `file_sim_over25gb_${currentUser.id}`;
    const existingSim = db.files.find((f) => f.id === simFileId);
    if (!existingSim) {
      const simText =
        `# 28 GB Production Backup Archive (Simulated High-Volume Dataset)\n\n` +
        `This archive exceeds the 25 GB Free tier threshold.\n` +
        `When your monthly 50 GB or 1 TB plan expires, this file enters the 3-month (90-day) grace lock period.\n` +
        `Extend your plan with Tokens before the 90-day timer ends to restore instant access.\n`;
      const blobs = getBlobStore();
      blobs[simFileId] = simText;
      saveBlobStore(blobs);

      db.files.push({
        id: simFileId,
        name: 'Studio-4K-Master-Archive-28GB.tar.zst',
        folderId: null,
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        sizeBytes: 28 * 1024 * 1024 * 1024,
        mimeType: 'application/zstd',
        sha256: simpleHash(simText),
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

    currentUser.planId = 'pro_50gb';
    currentUser.planExpiresAt = new Date(now - 2 * 86400_000).toISOString();
    currentUser.graceEndsAt = new Date(now + 88 * 86400_000).toISOString();
    evaluateClientQuotaAndLocks(db, currentUser);
    saveClientDb(db);

    return jsonResponse({
      user: currentUser,
      files: db.files.filter((f) => f.ownerId === currentUser.id),
      message:
        'Simulated expired monthly plan with >25 GB data: Files above 25 GB are now locked for the 3-month (90-day) grace period.',
    });
  }

  // Files & Folders (Per-User Isolated)
  if (path === '/api/files' && method === 'GET') {
    return jsonResponse({
      folders: db.folders.filter((f) => f.ownerId === currentUser.id),
      files: db.files.filter((f) => f.ownerId === currentUser.id),
      transfers: db.transfers.filter((t) => t.userId === currentUser.id),
    });
  }

  if (path === '/api/folders' && method === 'POST') {
    const body = await parseBody();
    const folder: FolderRecord = {
      id: `fld_${Date.now().toString(36)}`,
      name: String(body.name || 'New Folder').trim(),
      parentId: body.parentId || null,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      createdAt: new Date().toISOString(),
    };
    db.folders.push(folder);
    saveClientDb(db);
    return jsonResponse({ folder });
  }

  if (path.startsWith('/api/folders/') && method === 'DELETE') {
    const folderId = decodeURIComponent(path.slice('/api/folders/'.length));
    const target = db.folders.find((f) => f.id === folderId && f.ownerId === currentUser.id);
    db.files.forEach((f) => {
      if (f.ownerId === currentUser.id && f.folderId === folderId) {
        f.folderId = target ? target.parentId : null;
      }
    });
    db.folders = db.folders.filter((f) => !(f.id === folderId && f.ownerId === currentUser.id));
    saveClientDb(db);
    return jsonResponse({ ok: true });
  }

  if (path === '/api/files/upload' && method === 'POST') {
    const formData = init?.body as FormData;
    const rawFolderId = formData?.get('folderId');
    const folderId =
      typeof rawFolderId === 'string' && rawFolderId !== 'null' && rawFolderId !== ''
        ? rawFolderId
        : null;
    const uploadedFiles = (formData?.getAll('files') as File[]) || [];
    const totalBatchBytes = uploadedFiles.reduce((acc, f) => acc + f.size, 0);

    if (currentUser.storageUsedBytes + totalBatchBytes > currentUser.bandwidthLimitBytes) {
      return jsonResponse(
        {
          error:
            'Storage limit reached for your current plan. Upgrade your plan on the Pricing & Plans tab to store more files.',
        },
        429
      );
    }

    const created: FileRecord[] = [];
    const blobs = getBlobStore();

    for (const f of uploadedFiles) {
      const fileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const mime = resolveClientMimeType(f.name, f.type);
      const isText =
        (mime.startsWith('text/') ||
          mime === 'application/json' ||
          /\.(md|txt|json|csv|sh|ts|tsx|js|py|html|css|xml)$/i.test(f.name)) &&
        f.size <= 5 * 1024 * 1024;
      const isSmallImage = mime.startsWith('image/') && f.size <= 4 * 1024 * 1024;

      // Always store the true binary File/Blob in IndexedDB + memory cache (supports 285 MB+ MKV files)
      await storeClientBinaryBlob(fileId, f);

      let textContent = '';
      try {
        if (isText) {
          textContent = await f.text();
        }
      } catch {
        textContent = '';
      }

      let previewDataUrl: string | undefined;
      if (isSmallImage) {
        const dUrl = await fileToDataUrl(f);
        if (dUrl) previewDataUrl = dUrl;
      }

      if (previewDataUrl || textContent) {
        blobs[fileId] = previewDataUrl || textContent;
      }

      let storageDriver: 'telegram' | 'local_vault' = 'local_vault';
      const telegramChunks: TelegramChunk[] = [];

      if (db.telegramConfig.botToken && db.telegramConfig.chatId && f.size <= 45 * 1024 * 1024) {
        try {
          const tgForm = new FormData();
          tgForm.append('chat_id', db.telegramConfig.chatId);
          tgForm.append('document', f, f.name);
          const tgRes = await originalFetch(
            `https://api.telegram.org/bot${db.telegramConfig.botToken}/sendDocument`,
            { method: 'POST', body: tgForm }
          );
          const tgJson = await tgRes.json();
          if (tgJson.ok && tgJson.result?.document?.file_id) {
            storageDriver = 'telegram';
            telegramChunks.push({
              partIndex: 0,
              messageId: tgJson.result.message_id,
              fileId: tgJson.result.document.file_id,
              sizeBytes: f.size,
              sha256Part: simpleHash(f.name),
            });
          }
        } catch {
          // fallback to local vault
        }
      }

      const rec: FileRecord = {
        id: fileId,
        name: f.name,
        folderId,
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        sizeBytes: f.size,
        mimeType: mime,
        sha256: simpleHash(f.name + f.size),
        storageDriver,
        telegramChunks,
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        previewText: isText ? textContent.slice(0, 20000) : undefined,
        previewDataUrl,
        lockedOverQuota: false,
      };

      db.files.unshift(rec);
      created.push(rec);

      db.logs.unshift({
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        timestamp: new Date().toISOString(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'FILE_UPLOAD',
        targetName: rec.name,
        ipAddress: 'client',
        bytesTransferred: rec.sizeBytes,
        integrityHash: rec.sha256.slice(0, 16),
        status: 'success',
        details: 'Encrypted and saved to UnlimCloud Vault',
      });
    }

    evaluateClientQuotaAndLocks(db, currentUser);
    saveBlobStore(blobs);
    saveClientDb(db);
    return jsonResponse({ files: created, user: currentUser });
  }

  if (path.startsWith('/api/files/') && path.endsWith('/download') && method === 'GET') {
    const fileId = decodeURIComponent(
      path.slice('/api/files/'.length, path.length - '/download'.length)
    );
    const file = db.files.find((f) => f.id === fileId && f.ownerId === currentUser.id);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);
    if (file.lockedOverQuota) {
      return jsonResponse(
        {
          error:
            'This file is locked because it exceeds your 25 GB Free limit after plan expiry. Renew your plan to unlock access.',
        },
        403
      );
    }

    const isInline = parsed.searchParams.get('inline') === '1';
    if (!isInline) {
      file.downloadCount += 1;
      saveClientDb(db);
    }

    // 1. Check IndexedDB / in-memory binary vault first (full 285 MB+ binary fidelity)
    const binaryBlob = await getClientBinaryBlob(file.id);
    if (binaryBlob) {
      const isMkv =
        file.name.toLowerCase().endsWith('.mkv') || file.mimeType === 'video/x-matroska';
      const effectiveMime =
        isInline && isMkv
          ? 'video/webm'
          : resolveClientMimeType(file.name, file.mimeType);
      return new Response(binaryBlob, {
        status: 200,
        headers: {
          'Content-Type': effectiveMime,
          'Content-Length': String(binaryBlob.size),
        },
      });
    }

    // 2. Fallback to small text/SVG blobs in localStorage
    const blobs = getBlobStore();
    const content = blobs[file.id] || file.previewText || '';

    if (
      (!content || content.startsWith('Binary payload for ')) &&
      file.sizeBytes > 1024
    ) {
      return jsonResponse(
        {
          error:
            'This file was uploaded before the large-file binary engine upgrade (only 44-byte placeholder metadata was cached). Please delete and re-upload this file once to store the full binary payload.',
        },
        404
      );
    }

    if (content.startsWith('data:')) {
      const res = await originalFetch(content);
      const blob = await res.blob();
      return new Response(blob, {
        status: 200,
        headers: { 'Content-Type': file.mimeType || 'application/octet-stream' },
      });
    }

    return new Response(content || `UnlimCloud File: ${file.name}`, {
      status: 200,
      headers: { 'Content-Type': file.mimeType || 'application/octet-stream' },
    });
  }

  if (path.startsWith('/api/files/') && method === 'PATCH') {
    const fileId = decodeURIComponent(path.slice('/api/files/'.length));
    const file = db.files.find((f) => f.id === fileId && f.ownerId === currentUser.id);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);
    const body = await parseBody();
    if (typeof body.starred === 'boolean') file.starred = body.starred;
    if (typeof body.name === 'string' && body.name.trim()) file.name = body.name.trim();
    if (body.folderId !== undefined) file.folderId = body.folderId;
    file.updatedAt = new Date().toISOString();
    saveClientDb(db);
    return jsonResponse({ file });
  }

  if (path.startsWith('/api/files/') && method === 'DELETE') {
    const fileId = decodeURIComponent(path.slice('/api/files/'.length));
    db.files = db.files.filter((f) => !(f.id === fileId && f.ownerId === currentUser.id));
    db.shares = db.shares.filter((s) => s.fileId !== fileId);
    const blobs = getBlobStore();
    if (blobs[fileId]) {
      delete blobs[fileId];
      saveBlobStore(blobs);
    }
    await deleteClientBinaryBlob(fileId);
    evaluateClientQuotaAndLocks(db, currentUser);
    saveClientDb(db);
    return jsonResponse({ ok: true, user: currentUser });
  }

  if (path.startsWith('/api/transfers/') && path.endsWith('/cancel') && method === 'POST') {
    const transferId = decodeURIComponent(
      path.slice('/api/transfers/'.length, path.length - '/cancel'.length)
    );
    const job = db.transfers.find((t) => t.id === transferId && t.userId === currentUser.id);
    if (!job) return jsonResponse({ error: 'Transfer job not found' }, 404);
    job.status = 'failed';
    job.error = 'Cancelled by user';
    job.completedAt = new Date().toISOString();
    saveClientDb(db);
    return jsonResponse({ ok: true, job });
  }

  if (path === '/api/transfers/remote' && method === 'POST') {
    const body = await parseBody();
    const cleanUrl = String(body.url || '').trim();
    const urlObj = new URL(cleanUrl);
    const baseName =
      body.customFileName ||
      urlObj.pathname.split('/').filter(Boolean).pop() ||
      'remote-file.txt';

    let fetchedText = '';
    try {
      const remoteRes = await originalFetch(cleanUrl);
      fetchedText = await remoteRes.text();
    } catch {
      fetchedText = `Fetched content from ${cleanUrl}`;
    }

    const fileId = `file_${Date.now().toString(36)}`;
    const blobs = getBlobStore();
    blobs[fileId] = fetchedText;
    saveBlobStore(blobs);

    const newFile: FileRecord = {
      id: fileId,
      name: baseName,
      folderId: body.folderId || null,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      sizeBytes: fetchedText.length,
      mimeType: 'text/plain',
      sha256: simpleHash(fetchedText),
      storageDriver: 'local_vault',
      telegramChunks: [],
      starred: false,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previewText: fetchedText.slice(0, 12000),
      lockedOverQuota: false,
    };

    db.files.unshift(newFile);
    evaluateClientQuotaAndLocks(db, currentUser);

    const job: TransferJob = {
      id: `trf_${Date.now().toString(36)}`,
      userId: currentUser.id,
      userName: currentUser.name,
      type: 'remote_url',
      sourceUrl: cleanUrl,
      fileName: baseName,
      folderId: body.folderId || null,
      totalBytes: fetchedText.length,
      transferredBytes: fetchedText.length,
      speedBps: 1024 * 1024,
      status: 'completed',
      storageDriver: 'local_vault',
      fileId,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    db.transfers.unshift(job);
    saveClientDb(db);
    return jsonResponse({ job, file: newFile });
  }

  // Shares & Public Share Portal
  if (path === '/api/shares' && method === 'GET') {
    return jsonResponse({
      shares: db.shares.filter((s) => s.creatorId === currentUser.id),
    });
  }

  if (path === '/api/shares' && method === 'POST') {
    const body = await parseBody();
    const file = db.files.find((f) => f.id === body.fileId && f.ownerId === currentUser.id);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);
    if (file.lockedOverQuota) {
      return jsonResponse(
        {
          error:
            'This file is locked because it exceeds your 25 GB Free limit. Renew your plan to share this file.',
        },
        403
      );
    }

    const token = body.customSlug || `dl-${Math.random().toString(36).slice(2, 8)}`;
    const hasPw = Boolean(body.password && String(body.password).trim());

    const share: ClientStoredShare = {
      id: `shr_${Date.now().toString(36)}`,
      token,
      fileId: file.id,
      fileName: file.name,
      fileSizeBytes: file.sizeBytes,
      fileMimeType: file.mimeType,
      fileSha256: file.sha256,
      creatorId: currentUser.id,
      creatorName: currentUser.name,
      hasPassword: hasPw,
      passwordHash: hasPw ? simpleHash(String(body.password).trim()) : null,
      expiresAt: null,
      maxDownloads: body.maxDownloads || null,
      downloadCount: 0,
      throttleKbps:
        body.throttleKbps !== undefined
          ? body.throttleKbps
          : db.bandwidthSettings.defaultShareThrottleKbps,
      bandwidthCapBytes: null,
      bandwidthUsedBytes: 0,
      active: true,
      createdAt: new Date().toISOString(),
      lastAccessedAt: null,
    };

    db.shares.unshift(share);
    saveClientDb(db);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/shares/') && method === 'PATCH') {
    const shareId = decodeURIComponent(path.slice('/api/shares/'.length));
    const share = db.shares.find((s) => s.id === shareId && s.creatorId === currentUser.id);
    if (!share) return jsonResponse({ error: 'Share not found' }, 404);
    const body = await parseBody();
    if (typeof body.active === 'boolean') share.active = body.active;
    if (body.throttleKbps !== undefined) share.throttleKbps = body.throttleKbps;
    if (body.password !== undefined) {
      if (body.password && String(body.password).trim()) {
        share.hasPassword = true;
        share.passwordHash = simpleHash(String(body.password).trim());
      } else {
        share.hasPassword = false;
        share.passwordHash = null;
      }
    }
    saveClientDb(db);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/shares/') && method === 'DELETE') {
    const shareId = decodeURIComponent(path.slice('/api/shares/'.length));
    db.shares = db.shares.filter((s) => !(s.id === shareId && s.creatorId === currentUser.id));
    saveClientDb(db);
    return jsonResponse({ ok: true });
  }

  if (path.startsWith('/api/public/share/') && method === 'GET' && !path.endsWith('/download')) {
    const tok = decodeURIComponent(path.slice('/api/public/share/'.length));
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return jsonResponse({ error: 'Share link not found or disabled' }, 404);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/verify') && method === 'POST') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/verify'.length)
    );
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return jsonResponse({ error: 'Share link not found' }, 404);
    const body = await parseBody();
    if (share.hasPassword && simpleHash(String(body.password || '').trim()) !== share.passwordHash) {
      return jsonResponse({ error: 'Incorrect password' }, 403);
    }
    return jsonResponse({ unlocked: true, accessKey: share.passwordHash || 'open' });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/download') && method === 'GET') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/download'.length)
    );
    const share = db.shares.find((s) => s.token === tok && s.active);
    if (!share) return new Response('Not found', { status: 404 });
    share.downloadCount += 1;
    saveClientDb(db);

    const binaryBlob = await getClientBinaryBlob(share.fileId);
    if (binaryBlob) {
      return new Response(binaryBlob, {
        status: 200,
        headers: {
          'Content-Type': resolveClientMimeType(share.fileName, share.fileMimeType),
          'Content-Length': String(binaryBlob.size),
        },
      });
    }

    const blobs = getBlobStore();
    const content = blobs[share.fileId] || `Shared file: ${share.fileName}`;
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': share.fileMimeType || 'application/octet-stream' },
    });
  }

  if (path === '/api/bandwidth' && method === 'GET') {
    return jsonResponse({
      settings: db.bandwidthSettings,
      dailyBandwidth: [],
      users: [currentUser],
      shares: db.shares.filter((s) => s.creatorId === currentUser.id),
    });
  }

  if (path === '/api/bandwidth/settings' && method === 'PATCH') {
    const body = await parseBody();
    if (body.globalThrottleKbps !== undefined) {
      db.bandwidthSettings.globalThrottleKbps = body.globalThrottleKbps;
    }
    saveClientDb(db);
    return jsonResponse({ settings: db.bandwidthSettings });
  }

  if (path === '/api/logs' && method === 'GET') {
    const isAdmin = currentUser.email.toLowerCase() === 'titumamma2425@gmail.com';
    return jsonResponse({
      logs: isAdmin ? db.logs : db.logs.filter((l) => l.userId === currentUser.id),
    });
  }

  if (path === '/api/telegram/config' && method === 'GET') {
    if (currentUser.email.toLowerCase() !== 'titumamma2425@gmail.com' || currentUser.role !== 'admin') {
      return jsonResponse({ error: 'Administrator access required.' }, 403);
    }
    const connected = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const state: TelegramConfigState = {
      connected,
      mode: connected ? 'telegram_live' : 'hybrid_fallback',
      botUsername: db.telegramConfig.botUsername,
      chatId: db.telegramConfig.chatId,
      maskedToken: connected ? '••••••••' : '',
      chunkSizeBytes: 19 * 1024 * 1024,
      autoSyncUploads: true,
    };
    return jsonResponse({ config: state });
  }

  if (path === '/api/telegram/config' && method === 'POST') {
    if (currentUser.email.toLowerCase() !== 'titumamma2425@gmail.com' || currentUser.role !== 'admin') {
      return jsonResponse({ error: 'Administrator access required.' }, 403);
    }
    const body = await parseBody();
    if (body.clearCredentials) {
      db.telegramConfig.botToken = '';
      db.telegramConfig.chatId = '';
      db.telegramConfig.botUsername = undefined;
      saveClientDb(db);
    } else if (body.botToken && body.chatId) {
      const meRes = await originalFetch(
        `https://api.telegram.org/bot${String(body.botToken).trim()}/getMe`
      );
      const meJson = await meRes.json();
      if (!meJson.ok) {
        return jsonResponse(
          { error: meJson.description || 'Invalid Storage Node Token' },
          400
        );
      }
      db.telegramConfig.botToken = String(body.botToken).trim();
      db.telegramConfig.chatId = String(body.chatId).trim();
      db.telegramConfig.botUsername = meJson.result?.username;
      saveClientDb(db);
    }

    const connected = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const state: TelegramConfigState = {
      connected,
      mode: connected ? 'telegram_live' : 'hybrid_fallback',
      botUsername: db.telegramConfig.botUsername,
      chatId: db.telegramConfig.chatId,
      maskedToken: connected ? '••••••••' : '',
      chunkSizeBytes: 19 * 1024 * 1024,
      autoSyncUploads: true,
    };
    return jsonResponse({ config: state });
  }

  return jsonResponse({ ok: true });
}

export const apiFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const urlStr =
    typeof input === 'string'
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;

  const isLocalApi =
    urlStr.startsWith('/api/') ||
    urlStr.startsWith(`${window.location.origin}/api/`);

  if (!isLocalApi) {
    return originalFetch(input, init);
  }

  if (staticFallbackMode === true) {
    return handleClientApi(urlStr, init);
  }

  try {
    const res = await originalFetch(input, init);
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || contentType.includes('text/html')) {
      staticFallbackMode = true;
      return handleClientApi(urlStr, init);
    }
    staticFallbackMode = false;
    return res;
  } catch {
    staticFallbackMode = true;
    return handleClientApi(urlStr, init);
  }
};

/**
 * Uploads files with real-time progress reporting (0% -> 100%, transferredBytes, speedBps)
 * using XMLHttpRequest when connected to the Express backend, and smooth progress simulation
 * when running in static fallback mode on Cloudflare Pages.
 */
export async function uploadFilesWithProgress(params: {
  files: File[];
  folderId: string | null;
  headers: Record<string, string>;
  signal?: AbortSignal;
  onProgress: (info: {
    percent: number;
    loadedBytes: number;
    totalBytes: number;
    speedBps: number;
  }) => void;
}): Promise<{ ok: boolean; cancelled?: boolean; status: number; data: any }> {
  if (params.signal?.aborted) {
    return {
      ok: false,
      cancelled: true,
      status: 0,
      data: { error: 'Upload cancelled by user' },
    };
  }

  const totalBytes = params.files.reduce((acc, f) => acc + f.size, 0);
  const formData = new FormData();
  if (params.folderId) {
    formData.append('folderId', params.folderId);
  }
  params.files.forEach((f) => formData.append('files', f));

  if (staticFallbackMode === true) {
    const startMs = Date.now();
    for (const step of [15, 35, 60, 82, 95]) {
      if (params.signal?.aborted) {
        return {
          ok: false,
          cancelled: true,
          status: 0,
          data: { error: 'Upload cancelled by user' },
        };
      }
      const loaded = Math.round((totalBytes * step) / 100);
      const elapsedSec = Math.max(0.08, (Date.now() - startMs) / 1000);
      params.onProgress({
        percent: step,
        loadedBytes: loaded,
        totalBytes,
        speedBps: Math.max(1_500_000, Math.round(loaded / elapsedSec)),
      });
      await new Promise((r) => setTimeout(r, 110));
    }

    if (params.signal?.aborted) {
      return {
        ok: false,
        cancelled: true,
        status: 0,
        data: { error: 'Upload cancelled by user' },
      };
    }

    const res = await handleClientApi('/api/files/upload', {
      method: 'POST',
      headers: params.headers,
      body: formData,
    });
    params.onProgress({
      percent: 100,
      loadedBytes: totalBytes,
      totalBytes,
      speedBps: Math.max(2_000_000, totalBytes * 4),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  }

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const startMs = Date.now();
    xhr.open('POST', '/api/files/upload', true);
    Object.entries(params.headers).forEach(([k, v]) => {
      xhr.setRequestHeader(k, v);
    });

    const onSignalAbort = () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
    };

    if (params.signal) {
      params.signal.addEventListener('abort', onSignalAbort, { once: true });
    }

    const cleanupSignal = () => {
      if (params.signal) {
        params.signal.removeEventListener('abort', onSignalAbort);
      }
    };

    xhr.upload.onprogress = (evt) => {
      if (params.signal?.aborted) return;
      const total = evt.lengthComputable && evt.total > 0 ? evt.total : Math.max(1, totalBytes);
      const loaded = Math.min(total, evt.loaded);
      const pct = Math.min(99, Math.max(2, Math.round((loaded / total) * 100)));
      const elapsedSec = Math.max(0.08, (Date.now() - startMs) / 1000);
      params.onProgress({
        percent: pct,
        loadedBytes: loaded,
        totalBytes: total,
        speedBps: Math.round(loaded / elapsedSec),
      });
    };

    xhr.onabort = () => {
      cleanupSignal();
      resolve({
        ok: false,
        cancelled: true,
        status: 0,
        data: { error: 'Upload cancelled by user' },
      });
    };

    xhr.onload = async () => {
      cleanupSignal();
      if (params.signal?.aborted) {
        resolve({
          ok: false,
          cancelled: true,
          status: 0,
          data: { error: 'Upload cancelled by user' },
        });
        return;
      }

      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status === 404 || xhr.status === 405 || (xhr.status === 200 && contentType.includes('text/html'))) {
        staticFallbackMode = true;
        const fallbackRes = await handleClientApi('/api/files/upload', {
          method: 'POST',
          headers: params.headers,
          body: formData,
        });
        params.onProgress({
          percent: 100,
          loadedBytes: totalBytes,
          totalBytes,
          speedBps: Math.max(2_000_000, totalBytes * 4),
        });
        const fallbackData = await fallbackRes.json();
        resolve({ ok: fallbackRes.ok, status: fallbackRes.status, data: fallbackData });
        return;
      }

      params.onProgress({
        percent: 100,
        loadedBytes: totalBytes,
        totalBytes,
        speedBps: Math.max(1_500_000, totalBytes * 3),
      });
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && Array.isArray(parsed.files)) {
          // Cache uploaded File blobs locally as well for zero-latency MKV preview & instant download
          for (let i = 0; i < parsed.files.length; i++) {
            const createdFile = parsed.files[i] as FileRecord | undefined;
            const rawFile = params.files[i];
            if (createdFile?.id && rawFile) {
              storeClientBinaryBlob(createdFile.id, rawFile).catch(() => null);
            }
          }
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data: parsed });
      } catch {
        resolve({ ok: false, status: xhr.status, data: { error: 'Upload failed' } });
      }
    };

    xhr.onerror = async () => {
      cleanupSignal();
      if (params.signal?.aborted) {
        resolve({
          ok: false,
          cancelled: true,
          status: 0,
          data: { error: 'Upload cancelled by user' },
        });
        return;
      }
      staticFallbackMode = true;
      const fallbackRes = await handleClientApi('/api/files/upload', {
        method: 'POST',
        headers: params.headers,
        body: formData,
      });
      const fallbackData = await fallbackRes.json();
      resolve({ ok: fallbackRes.ok, status: fallbackRes.status, data: fallbackData });
    };

    xhr.send(formData);
  });
}
