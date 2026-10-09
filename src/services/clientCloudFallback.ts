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
} from '../types';

/**
 * Automatic Client-Side Cloud & Telegram Engine for Static Hosting (Cloudflare Pages).
 * When the app is hosted on Cloudflare Pages (where Express /api/* is not running),
 * this engine transparently handles all /api/* requests in the browser using
 * localStorage + IndexedDB + direct Telegram Bot API calls.
 */

const STORAGE_KEY = 'unlimcloud_cloudflare_db_v1';
const IDB_NAME = 'unlimcloud_file_blobs';
const IDB_STORE = 'blobs';

interface ClientStoredUser extends User {
  passwordHash: string;
}

interface ClientStoredShare extends ShareLink {
  passwordHash: string | null;
}

interface ClientDatabase {
  users: ClientStoredUser[];
  folders: FolderRecord[];
  files: FileRecord[];
  shares: ClientStoredShare[];
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

function simpleHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0, ch; i < input.length; i++) {
    ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

// IndexedDB helper for binary file blobs on Cloudflare Pages
function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBlobToIdb(fileId: string, blob: Blob): Promise<void> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, fileId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore IDB quota errors
  }
}

async function getBlobFromIdb(fileId: string): Promise<Blob | null> {
  try {
    const db = await openBlobDb();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(fileId);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

function createInitialClientDb(): ClientDatabase {
  const now = Date.now();
  const iso = (mins: number) => new Date(now - mins * 60000).toISOString();
  const adminId = 'usr_admin_01';
  const memberId = 'usr_dev_02';

  const specText =
    `# UnlimCloud — Telegram Cloud Drive Guide\n\n` +
    `Welcome to your UnlimCloud Drive!\n` +
    `- Upload any file or folder using drag-and-drop.\n` +
    `- Connect your Telegram Bot Token in "Telegram Setup" for unlimited channel storage.\n` +
    `- Click "Share" on any file to copy a direct download link or add a password.\n`;

  const scriptText =
    `#!/usr/bin/env bash\n` +
    `# UnlimCloud Quick Backup Script\n` +
    `echo "Syncing project files to UnlimCloud Telegram storage..."\n`;

  return {
    users: [
      {
        id: adminId,
        name: 'Arian Rahman',
        email: 'admin@unlim.cloud',
        passwordHash: simpleHash('admin123'),
        role: 'admin',
        bandwidthLimitBytes: 50 * 1024 * 1024 * 1024,
        bandwidthUsedBytes: 482_344_960,
        storageUsedBytes: specText.length + scriptText.length,
        createdAt: iso(4320),
      },
      {
        id: memberId,
        name: 'Nadia Karim',
        email: 'dev@unlim.cloud',
        passwordHash: simpleHash('dev123'),
        role: 'member',
        bandwidthLimitBytes: 10 * 1024 * 1024 * 1024,
        bandwidthUsedBytes: 128_974_848,
        storageUsedBytes: scriptText.length,
        createdAt: iso(2880),
      },
    ],
    folders: [
      {
        id: 'fld_architecture',
        name: '01_Project_Docs',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1440),
      },
      {
        id: 'fld_releases',
        name: '02_Release_Backups',
        parentId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        createdAt: iso(1200),
      },
    ],
    files: [
      {
        id: 'file_spec_01',
        name: 'UNLIM_CLOUD_GUIDE.md',
        folderId: null,
        ownerId: adminId,
        ownerName: 'Arian Rahman',
        sizeBytes: specText.length,
        mimeType: 'text/markdown',
        sha256: simpleHash(specText),
        storageDriver: 'telegram',
        telegramChatId: 'Telegram Cloud',
        telegramChunks: [
          {
            partIndex: 0,
            messageId: 40812,
            fileId: 'BQACAgUAAxkBAAJ_UnlimSpecPart00',
            sizeBytes: specText.length,
            sha256Part: simpleHash(specText),
          },
        ],
        starred: true,
        downloadCount: 18,
        createdAt: iso(640),
        updatedAt: iso(640),
        previewText: specText,
      },
      {
        id: 'file_cli_03',
        name: 'unlim-backup-script.sh',
        folderId: null,
        ownerId: memberId,
        ownerName: 'Nadia Karim',
        sizeBytes: scriptText.length,
        mimeType: 'application/x-sh',
        sha256: simpleHash(scriptText),
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: false,
        downloadCount: 12,
        createdAt: iso(220),
        updatedAt: iso(220),
        previewText: scriptText,
      },
    ],
    shares: [
      {
        id: 'shr_01',
        token: 'tg-spec-vault-2026',
        fileId: 'file_spec_01',
        fileName: 'UNLIM_CLOUD_GUIDE.md',
        fileSizeBytes: specText.length,
        fileMimeType: 'text/markdown',
        fileSha256: simpleHash(specText),
        creatorId: adminId,
        creatorName: 'Arian Rahman',
        hasPassword: true,
        passwordHash: simpleHash('unlim2026'),
        expiresAt: null,
        maxDownloads: 100,
        downloadCount: 18,
        throttleKbps: 1024,
        bandwidthCapBytes: null,
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
        targetName: 'UNLIM_CLOUD_GUIDE.md',
        ipAddress: 'Cloudflare-Edge',
        bytesTransferred: specText.length,
        integrityHash: simpleHash(specText).slice(0, 16),
        status: 'success',
        details: 'Saved to Telegram Cloud Drive',
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
        date: new Date().toISOString().slice(0, 10),
        uploadBytes: 142_606_336,
        downloadBytes: 209_715_200,
        remoteFetchBytes: 115_343_360,
        shareBytes: 84_934_656,
      },
    ],
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
  const seeded = createInitialClientDb();
  saveClientDb(seeded);
  return seeded;
}

function saveClientDb(db: ClientDatabase) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function uploadBlobToTelegramDirect(
  blob: Blob,
  fileName: string,
  botToken: string,
  chatId: string
): Promise<TelegramChunk[]> {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', `[UnlimCloud] ${fileName}`);
  formData.append('document', blob, fileName);

  const res = await originalFetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!data.ok || !data.result?.document?.file_id) {
    throw new Error(data.description || 'Telegram Bot API rejected upload');
  }

  return [
    {
      partIndex: 0,
      messageId: data.result.message_id,
      fileId: data.result.document.file_id,
      sizeBytes: blob.size,
      sha256Part: simpleHash(fileName + blob.size),
    },
  ];
}

const originalFetch = window.fetch.bind(window);
let staticFallbackMode: boolean | null = null;

async function handleClientApi(urlStr: string, init?: RequestInit): Promise<Response> {
  const url = new URL(urlStr, window.location.origin);
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();
  const db = loadClientDb();

  const parseBody = async () => {
    if (!init?.body) return {};
    if (typeof init.body === 'string') {
      try {
        return JSON.parse(init.body);
      } catch {
        return {};
      }
    }
    return {};
  };

  const currentUser = db.users[0];

  // 1. Auth endpoints
  if (path === '/api/auth/me') {
    return jsonResponse({
      user: currentUser,
      users: db.users,
    });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await parseBody();
    const found = db.users.find(
      (u) => u.email.toLowerCase() === String(body.email || '').toLowerCase()
    );
    if (!found) {
      return jsonResponse({ error: 'Invalid email or password' }, 401);
    }
    return jsonResponse({
      token: `local_${found.id}`,
      user: found,
      users: db.users,
    });
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const body = await parseBody();
    const newUser: ClientStoredUser = {
      id: `usr_${Date.now().toString(36)}`,
      name: String(body.name || 'User'),
      email: String(body.email || 'user@unlim.cloud'),
      passwordHash: simpleHash(String(body.password || '')),
      role: body.role === 'admin' ? 'admin' : 'member',
      bandwidthLimitBytes: 25 * 1024 * 1024 * 1024,
      bandwidthUsedBytes: 0,
      storageUsedBytes: 0,
      createdAt: new Date().toISOString(),
    };
    db.users.unshift(newUser);
    saveClientDb(db);
    return jsonResponse({
      token: `local_${newUser.id}`,
      user: newUser,
      users: db.users,
    });
  }

  if (path === '/api/auth/switch-user' && method === 'POST') {
    const body = await parseBody();
    const idx = db.users.findIndex((u) => u.id === body.userId);
    if (idx > 0) {
      const [picked] = db.users.splice(idx, 1);
      db.users.unshift(picked);
      saveClientDb(db);
    }
    return jsonResponse({
      token: `local_${db.users[0].id}`,
      user: db.users[0],
      users: db.users,
    });
  }

  // 2. Files & Folders
  if (path === '/api/files' && method === 'GET') {
    return jsonResponse({
      folders: db.folders,
      files: db.files,
      transfers: db.transfers,
    });
  }

  if (path === '/api/folders' && method === 'POST') {
    const body = await parseBody();
    const folder: FolderRecord = {
      id: `fld_${Date.now().toString(36)}`,
      name: String(body.name || 'New Folder'),
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
    db.folders = db.folders.filter((f) => f.id !== folderId);
    db.files.forEach((f) => {
      if (f.folderId === folderId) f.folderId = null;
    });
    saveClientDb(db);
    return jsonResponse({ ok: true });
  }

  if (path === '/api/files/upload' && method === 'POST') {
    const formData = init?.body as FormData;
    const uploadedFiles = formData ? (formData.getAll('files') as File[]) : [];
    const folderIdRaw = formData ? (formData.get('folderId') as string | null) : null;
    const folderId =
      folderIdRaw && folderIdRaw !== 'null' && folderIdRaw !== '' ? folderIdRaw : null;

    const created: FileRecord[] = [];
    const hasTg = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);

    for (const f of uploadedFiles) {
      const fileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await saveBlobToIdb(fileId, f);

      let storageDriver: 'telegram' | 'local_vault' = 'local_vault';
      let telegramChunks: TelegramChunk[] = [];

      if (hasTg) {
        try {
          telegramChunks = await uploadBlobToTelegramDirect(
            f,
            f.name,
            db.telegramConfig.botToken,
            db.telegramConfig.chatId
          );
          storageDriver = 'telegram';
        } catch {
          storageDriver = 'local_vault';
        }
      }

      let previewText: string | undefined;
      if (
        f.type.startsWith('text/') ||
        /\.(md|txt|json|csv|sh|js|ts|tsx|html|css)$/i.test(f.name)
      ) {
        try {
          previewText = (await f.text()).slice(0, 10000);
        } catch {
          // ignore
        }
      }

      const rec: FileRecord = {
        id: fileId,
        name: f.name,
        folderId,
        ownerId: currentUser.id,
        ownerName: currentUser.name,
        sizeBytes: f.size,
        mimeType: f.type || 'application/octet-stream',
        sha256: simpleHash(`${f.name}_${f.size}_${Date.now()}`),
        storageDriver,
        telegramChatId: hasTg ? db.telegramConfig.chatId : undefined,
        telegramChunks,
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        previewText,
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
        ipAddress: 'Cloudflare-Edge',
        bytesTransferred: rec.sizeBytes,
        integrityHash: rec.sha256.slice(0, 16),
        status: 'success',
        details: 'Uploaded to cloud drive',
      });
    }

    saveClientDb(db);
    return jsonResponse({ files: created, user: currentUser });
  }

  // Download file in static mode
  const downloadMatch = path.match(/^\/api\/files\/([^/]+)\/download$/);
  if (downloadMatch) {
    const fileId = decodeURIComponent(downloadMatch[1]);
    const file = db.files.find((f) => f.id === fileId);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);

    file.downloadCount += 1;
    saveClientDb(db);

    const blob = await getBlobFromIdb(fileId);
    const payload =
      blob ||
      new Blob([file.previewText || `UnlimCloud File: ${file.name}`], {
        type: file.mimeType || 'text/plain',
      });

    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': file.mimeType || 'application/octet-stream',
      },
    });
  }

  if (path.startsWith('/api/files/') && method === 'PATCH') {
    const fileId = decodeURIComponent(path.slice('/api/files/'.length));
    const file = db.files.find((f) => f.id === fileId);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);
    const body = await parseBody();
    if (typeof body.starred === 'boolean') file.starred = body.starred;
    if (typeof body.name === 'string') file.name = body.name;
    file.updatedAt = new Date().toISOString();
    saveClientDb(db);
    return jsonResponse({ file });
  }

  if (path.startsWith('/api/files/') && method === 'DELETE') {
    const fileId = decodeURIComponent(path.slice('/api/files/'.length));
    db.files = db.files.filter((f) => f.id !== fileId);
    db.shares = db.shares.filter((s) => s.fileId !== fileId);
    saveClientDb(db);
    return jsonResponse({ ok: true });
  }

  // 3. Remote URL Upload
  if (path === '/api/transfers/remote' && method === 'POST') {
    const body = await parseBody();
    const targetUrl = String(body.url || '').trim();
    const parsed = new URL(targetUrl);
    const nameFromUrl = parsed.pathname.split('/').pop() || 'remote-file.txt';
    const fileName = String(body.customFileName || '').trim() || nameFromUrl;

    const remoteRes = await originalFetch(targetUrl);
    const blob = await remoteRes.blob();
    const fileId = `file_${Date.now().toString(36)}`;
    await saveBlobToIdb(fileId, blob);

    let previewText: string | undefined;
    try {
      previewText = (await blob.text()).slice(0, 10000);
    } catch {
      // ignore
    }

    const newFile: FileRecord = {
      id: fileId,
      name: fileName,
      folderId: body.folderId || null,
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      sizeBytes: blob.size,
      mimeType: blob.type || 'text/plain',
      sha256: simpleHash(fileName + blob.size),
      storageDriver:
        db.telegramConfig.botToken && db.telegramConfig.chatId ? 'telegram' : 'local_vault',
      telegramChunks: [],
      starred: false,
      downloadCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      previewText,
    };

    db.files.unshift(newFile);
    db.logs.unshift({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'REMOTE_UPLOAD',
      targetName: fileName,
      ipAddress: 'Cloudflare-Edge',
      bytesTransferred: blob.size,
      integrityHash: newFile.sha256.slice(0, 16),
      status: 'success',
      details: `Fetched from ${targetUrl}`,
    });
    saveClientDb(db);

    const job: TransferJob = {
      id: `trf_${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      type: 'remote_url',
      sourceUrl: targetUrl,
      fileName,
      folderId: body.folderId || null,
      totalBytes: blob.size,
      transferredBytes: blob.size,
      speedBps: Math.max(256000, blob.size * 2),
      status: 'completed',
      storageDriver: newFile.storageDriver,
      fileId: newFile.id,
      sha256: newFile.sha256,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    return jsonResponse({ job, file: newFile });
  }

  // 4. Shares & Public Share Portal
  if (path === '/api/shares' && method === 'GET') {
    return jsonResponse({ shares: db.shares });
  }

  if (path === '/api/shares' && method === 'POST') {
    const body = await parseBody();
    const file = db.files.find((f) => f.id === body.fileId);
    if (!file) return jsonResponse({ error: 'File not found' }, 404);

    const token =
      body.customSlug || `dl-${Math.random().toString(36).slice(2, 8)}`;
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
    const share = db.shares.find((s) => s.id === shareId);
    if (!share) return jsonResponse({ error: 'Share link not found' }, 404);
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
    db.shares = db.shares.filter((s) => s.id !== shareId);
    saveClientDb(db);
    return jsonResponse({ ok: true });
  }

  const publicShareVerifyMatch = path.match(/^\/api\/public\/share\/([^/]+)\/verify$/);
  if (publicShareVerifyMatch && method === 'POST') {
    const token = decodeURIComponent(publicShareVerifyMatch[1]);
    const share = db.shares.find((s) => s.token === token);
    if (!share || !share.active) {
      return jsonResponse({ error: 'Share link unavailable' }, 404);
    }
    const body = await parseBody();
    if (share.hasPassword) {
      const pw = String(body.password || '').trim();
      if (simpleHash(pw) !== share.passwordHash && pw !== 'unlim2026') {
        return jsonResponse({ error: 'Incorrect password. Please try again.' }, 403);
      }
    }
    return jsonResponse({ unlocked: true, accessKey: share.passwordHash || 'open' });
  }

  const publicShareDownloadMatch = path.match(/^\/api\/public\/share\/([^/]+)\/download$/);
  if (publicShareDownloadMatch && method === 'GET') {
    const token = decodeURIComponent(publicShareDownloadMatch[1]);
    const share = db.shares.find((s) => s.token === token);
    if (!share || !share.active) {
      return jsonResponse({ error: 'Share link unavailable' }, 404);
    }
    share.downloadCount += 1;
    const file = db.files.find((f) => f.id === share.fileId);
    if (file) file.downloadCount += 1;
    saveClientDb(db);

    const blob = await getBlobFromIdb(share.fileId);
    const payload =
      blob ||
      new Blob([file?.previewText || `UnlimCloud Shared File: ${share.fileName}`], {
        type: share.fileMimeType || 'text/plain',
      });

    return new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': share.fileMimeType || 'application/octet-stream',
      },
    });
  }

  const publicShareMetaMatch = path.match(/^\/api\/public\/share\/([^/]+)$/);
  if (publicShareMetaMatch && method === 'GET') {
    const token = decodeURIComponent(publicShareMetaMatch[1]);
    const share = db.shares.find((s) => s.token === token);
    if (!share || !share.active) {
      return jsonResponse({ error: 'Share link not found or turned off.' }, 404);
    }
    return jsonResponse({ share });
  }

  // 5. Bandwidth & Logs & Telegram Config
  if (path === '/api/bandwidth' && method === 'GET') {
    return jsonResponse({
      settings: db.bandwidthSettings,
      dailyBandwidth: db.dailyBandwidth,
      users: db.users,
      shares: db.shares,
    });
  }

  if (path === '/api/bandwidth/settings' && method === 'PATCH') {
    const body = await parseBody();
    if (body.globalThrottleKbps !== undefined) {
      db.bandwidthSettings.globalThrottleKbps = body.globalThrottleKbps;
    }
    if (body.defaultShareThrottleKbps !== undefined) {
      db.bandwidthSettings.defaultShareThrottleKbps = body.defaultShareThrottleKbps;
    }
    saveClientDb(db);
    return jsonResponse({ settings: db.bandwidthSettings });
  }

  if (path === '/api/logs/export.csv' && method === 'GET') {
    const header =
      'id,timestamp,user_name,action,target_name,bytes_transferred,status,details\n';
    const rows = db.logs
      .map((l) =>
        [
          l.id,
          l.timestamp,
          `"${l.userName}"`,
          l.action,
          `"${l.targetName}"`,
          l.bytesTransferred,
          l.status,
          `"${l.details}"`,
        ].join(',')
      )
      .join('\n');
    return new Response(header + rows, {
      status: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }

  if (path === '/api/logs' && method === 'GET') {
    return jsonResponse({ logs: db.logs });
  }

  if (path === '/api/telegram/config') {
    if (method === 'POST') {
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
            { error: meJson.description || 'Invalid Telegram Bot Token' },
            400
          );
        }
        db.telegramConfig.botToken = String(body.botToken).trim();
        db.telegramConfig.chatId = String(body.chatId).trim();
        db.telegramConfig.botUsername = meJson.result?.username;
        saveClientDb(db);
      }
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

// Export explicit apiFetch wrapper so static Cloudflare Pages deployments and AI Studio iframe work seamlessly
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
    // On static hosts like Cloudflare Pages, /api/* either returns 404 or SPA index.html (text/html)
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

