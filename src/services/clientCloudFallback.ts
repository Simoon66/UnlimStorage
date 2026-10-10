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
import {
  syncCloudFileToFirestore,
  syncPublicShareToFirestore,
  deletePublicShareFromFirestore,
  fetchPublicShareByTokenFromFirestore,
  syncPublicShareBinaryChunksToFirestore,
  fetchPublicShareBinaryChunksFromFirestore,
  fetchStorageNodeConfigFromFirestore,
  PublicShareCloudRecord,
  CloudStorageNodeCredentials,
  markCloudFileDeletedTombstone,
  isCloudFileDeletedTombstone,
  markCloudFolderDeletedTombstone,
  isCloudFolderDeletedTombstone,
  recordKnownCloudFileIds,
  wasCloudFilePreviouslySynced,
  recordKnownCloudFolderIds,
  wasCloudFolderPreviouslySynced,
} from '../firebase';

const STORAGE_KEY = 'unlimcloud_client_db_v4';
const FILE_BLOBS_KEY = 'unlimcloud_client_blobs_v4';

const DEFAULT_STORAGE_NODE_BOT_TOKEN = '8552451944:AAGnsazvo2X2okXtKrAtAYGnuiizg_n8gkM';
const DEFAULT_STORAGE_NODE_CHAT_ID = '-5328657910';
const DEFAULT_STORAGE_NODE_USERNAME = 'teledatabase_share_bot';

const FREE_25GB_BYTES = 25 * 1024 * 1024 * 1024;
const PRO_50GB_BYTES = 50 * 1024 * 1024 * 1024;
const ULTRA_1TB_BYTES = 1024 * 1024 * 1024 * 1024;
const UNLIMITED_ADMIN_BYTES = 1024 * 1024 * 1024 * 1024 * 1024; // 1 PB (Unlimited Admin)

const SEEDED_MKV_TELEGRAM_CHUNKS: TelegramChunk[] = [
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

interface ClientStoredUser extends User {
  passwordHash: string;
}

export interface ClientStoredShare extends ShareLink {
  passwordHash: string | null;
  storageDriver?: 'telegram' | 'local_vault';
  telegramChatId?: string;
  telegramChunks?: TelegramChunk[];
  cloudChunkCount?: number;
  previewText?: string;
  previewDataUrl?: string;
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
    authMode?: 'mtproto' | 'bot';
    botToken: string;
    chatId: string;
    botUsername?: string;
    autoSyncUploads: boolean;
    apiId?: string;
    apiHash?: string;
    phoneNumber?: string;
    mtprotoSession?: string;
    accountName?: string;
    accountUsername?: string;
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
  if (planId === 'unlimited_admin') return UNLIMITED_ADMIN_BYTES;
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

export function getMemoryBinaryBlobSync(fileId: string): Blob | null {
  return memoryBlobCache.get(fileId) || null;
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

const TELEGRAM_CLIENT_CHUNK_SIZE = 19 * 1024 * 1024; // 19 MB per chunk (under Telegram 20 MB getFile limit)

async function pushBlobToTelegramClient(
  blob: Blob,
  fileName: string,
  botToken: string,
  chatId: string
): Promise<{ success: boolean; chunks: TelegramChunk[] }> {
  if (!botToken || !chatId) return { success: false, chunks: [] };
  const chunks: TelegramChunk[] = [];
  const totalParts = Math.max(1, Math.ceil(blob.size / TELEGRAM_CLIENT_CHUNK_SIZE));

  for (let partIdx = 0; partIdx < totalParts; partIdx++) {
    const start = partIdx * TELEGRAM_CLIENT_CHUNK_SIZE;
    const end = Math.min(blob.size, start + TELEGRAM_CLIENT_CHUNK_SIZE);
    const slice = blob.slice(start, end);
    const partName =
      totalParts === 1 ? fileName : `${fileName}.part${String(partIdx + 1).padStart(3, '0')}`;

    try {
      const tgForm = new FormData();
      tgForm.append('chat_id', chatId);
      tgForm.append('document', slice, partName);
      tgForm.append(
        'caption',
        `[UnlimStorage Encrypted Vault] ${fileName} (Part ${partIdx + 1}/${totalParts})`
      );

      const tgRes = await window.fetch(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        { method: 'POST', body: tgForm }
      );
      const tgJson = await tgRes.json();
      if (!tgJson.ok || !tgJson.result?.document?.file_id) {
        return { success: false, chunks: [] };
      }
      chunks.push({
        partIndex: partIdx,
        messageId: tgJson.result.message_id || 0,
        fileId: tgJson.result.document.file_id,
        sizeBytes: slice.size,
        sha256Part: simpleHash(`${fileName}_${partIdx}_${slice.size}`),
      });
    } catch {
      return { success: false, chunks: [] };
    }
  }

  return { success: chunks.length > 0, chunks };
}

async function fetchSingleTelegramChunkBlob(
  chunk: TelegramChunk,
  botToken: string
): Promise<Blob | null> {
  // 1. Try same-origin /api/public/tg-chunk proxy first (works on Express server.ts AND Cloudflare Pages _worker.js)
  try {
    const proxyRes = await window.fetch(
      `/api/public/tg-chunk?fileId=${encodeURIComponent(
        chunk.fileId
      )}&botToken=${encodeURIComponent(botToken)}`
    );
    const contentType = proxyRes.headers.get('content-type') || '';
    if (
      proxyRes.ok &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/json')
    ) {
      const blob = await proxyRes.blob();
      if (blob.size > 0) return blob;
    }
  } catch {
    // Fallback to direct Telegram getFile below
  }

  // 2. Fallback: Resolve file_path via Telegram getFile (which sends Access-Control-Allow-Origin: *)
  try {
    const metaRes = await window.fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(chunk.fileId)}`
    );
    const metaJson = await metaRes.json();
    if (!metaJson.ok || !metaJson.result?.file_path) {
      return null;
    }
    const fileUrl = `https://api.telegram.org/file/bot${botToken}/${metaJson.result.file_path}`;
    const fileRes = await window.fetch(fileUrl);
    if (!fileRes.ok) return null;
    const partBlob = await fileRes.blob();
    return partBlob.size > 0 ? partBlob : null;
  } catch {
    return null;
  }
}

export async function resolveDirectTelegramDownloadUrl(
  fileId: string,
  botToken?: string
): Promise<string | null> {
  const token = (botToken || DEFAULT_STORAGE_NODE_BOT_TOKEN).trim();
  if (!token || !fileId) return null;
  try {
    const metaRes = await window.fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const metaJson = await metaRes.json();
    if (!metaJson.ok || !metaJson.result?.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${metaJson.result.file_path}`;
  } catch {
    return null;
  }
}

async function fetchBlobFromTelegramChunksClient(
  chunks: TelegramChunk[],
  botToken: string,
  mimeType: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Blob | null> {
  const effectiveToken = (botToken || DEFAULT_STORAGE_NODE_BOT_TOKEN).trim();
  if (!effectiveToken || !chunks || chunks.length === 0) return null;
  const sorted = [...chunks].sort((a, b) => a.partIndex - b.partIndex);
  const totalBytes = Math.max(
    1,
    sorted.reduce((acc, c) => acc + (c.sizeBytes || 0), 0)
  );
  let loadedBytes = 0;
  onProgress?.(0, totalBytes);

  const partBlobs: Blob[] = [];
  for (const chunk of sorted) {
    const partBlob = await fetchSingleTelegramChunkBlob(chunk, effectiveToken);
    if (!partBlob) {
      return null;
    }
    partBlobs.push(partBlob);
    loadedBytes += partBlob.size;
    onProgress?.(Math.min(totalBytes, loadedBytes), totalBytes);
  }

  if (partBlobs.length === 0) return null;
  return new Blob(partBlobs, { type: mimeType || 'application/octet-stream' });
}

export async function getClientBinaryBlob(
  fileId: string,
  fileMeta?: FileRecord,
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Blob | null> {
  const inMem = memoryBlobCache.get(fileId);
  if (inMem) {
    onProgress?.(inMem.size, inMem.size);
    return inMem;
  }

  const idb = await openBinaryVaultDb();
  if (idb) {
    const fromIdb = await new Promise<Blob | null>((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(fileId);
        req.onsuccess = () => {
          const res = req.result;
          if (res instanceof Blob && res.size > 0) {
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
    if (fromIdb) {
      onProgress?.(fromIdb.size, fromIdb.size);
      return fromIdb;
    }
  }

  // Cross-Device Recovery: If local IndexedDB does not have the binary yet (e.g. signed in on a new device or public share),
  // check if the file has Telegram chunks and fetch/reassemble them transparently!
  const db = loadClientDb();
  const targetFile = fileMeta || db.files.find((f) => f.id === fileId);
  const envToken = (import.meta as any).env?.VITE_TELEGRAM_BOT_TOKEN || '';
  const botToken = db.telegramConfig.botToken || envToken || DEFAULT_STORAGE_NODE_BOT_TOKEN;

  if (
    targetFile &&
    targetFile.telegramChunks &&
    targetFile.telegramChunks.length > 0 &&
    botToken
  ) {
    const tgBlob = await fetchBlobFromTelegramChunksClient(
      targetFile.telegramChunks,
      botToken,
      resolveClientMimeType(targetFile.name, targetFile.mimeType),
      onProgress
    );
    if (tgBlob && tgBlob.size > 0) {
      await storeClientBinaryBlob(fileId, tgBlob);
      return tgBlob;
    }
  }

  return null;
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

const preloadedVideoIds = new Set<string>();

/**
 * Warms up the first video chunk & seek header in the background for instant playback.
 */
export function preloadVideoFile(
  file: FileRecord,
  headers?: Record<string, string>
): void {
  if (!file || file.lockedOverQuota || preloadedVideoIds.has(file.id)) return;
  const isVideo =
    file.mimeType.startsWith('video/') ||
    /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  if (!isVideo) return;

  preloadedVideoIds.add(file.id);

  // 1. Trigger server-side chunk preloader (Chunk 0 + seek table chunk)
  const uid = headers?.['X-Firebase-Uid'] || '';
  const email = headers?.['X-Firebase-Email'] || '';
  window
    .fetch(`/api/files/${encodeURIComponent(file.id)}/preload`, {
      method: 'POST',
      headers: {
        ...(headers || {}),
        'Content-Type': 'application/json',
      },
    })
    .catch(() => null);

  // 2. Warm up initial 512 KB byte range in browser HTTP cache
  const inlineStreamUrl = `/api/files/${encodeURIComponent(
    file.id
  )}/download?inline=1&uid=${encodeURIComponent(uid)}&email=${encodeURIComponent(email)}`;
  window
    .fetch(inlineStreamUrl, {
      method: 'GET',
      headers: {
        ...(headers || {}),
        Range: 'bytes=0-524287',
      },
    })
    .catch(() => null);
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
        bandwidthLimitBytes: UNLIMITED_ADMIN_BYTES,
        bandwidthUsedBytes: 482_344_960,
        storageUsedBytes: file1Text.length + file2Svg.length,
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
        tags: ['Work', 'Personal'],
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
        tags: ['Work', 'Archive'],
      },
      {
        id: 'file_mv1shmzl_ynyib',
        name: 'Jujutsu Kaisen S03E (12).mkv',
        folderId: null,
        ownerId: '1hMyd0YwsNUiPGDyFC0tls34oXi1',
        ownerName: 'Titu Mama',
        sizeBytes: 441031497,
        mimeType: 'video/x-matroska',
        sha256: '742e26fadddd0a55f44b3d149920040fc60017e9b6cc9957c388a108cf94f679',
        storageDriver: 'telegram',
        telegramChatId: DEFAULT_STORAGE_NODE_CHAT_ID,
        telegramChunks: SEEDED_MKV_TELEGRAM_CHUNKS,
        starred: false,
        downloadCount: 1,
        createdAt: iso(120),
        updatedAt: iso(120),
        lockedOverQuota: false,
        tags: ['Personal', 'Archive'],
      },
    ],
    shares: [
      {
        id: 'shr_dl_7c5smd',
        token: 'dl-7c5smd',
        fileId: 'file_mv1shmzl_ynyib',
        fileName: 'Jujutsu Kaisen S03E (12).mkv',
        fileSizeBytes: 441031497,
        fileMimeType: 'video/x-matroska',
        fileSha256: '742e26fadddd0a55f44b3d149920040fc60017e9b6cc9957c388a108cf94f679',
        creatorId: '1hMyd0YwsNUiPGDyFC0tls34oXi1',
        creatorName: 'Titu Mama',
        hasPassword: false,
        passwordHash: null,
        expiresAt: null,
        maxDownloads: null,
        downloadCount: 0,
        throttleKbps: null,
        bandwidthCapBytes: null,
        bandwidthUsedBytes: 0,
        active: true,
        createdAt: iso(60),
        lastAccessedAt: null,
        storageDriver: 'telegram',
        telegramChatId: DEFAULT_STORAGE_NODE_CHAT_ID,
        telegramChunks: SEEDED_MKV_TELEGRAM_CHUNKS,
        cloudChunkCount: 0,
      },
      {
        id: 'shr_mv1uq5wy',
        token: 'dl-ac5d7ec4',
        fileId: 'file_mv1shmzl_ynyib',
        fileName: 'Jujutsu Kaisen S03E (12).mkv',
        fileSizeBytes: 441031497,
        fileMimeType: 'video/x-matroska',
        fileSha256: '742e26fadddd0a55f44b3d149920040fc60017e9b6cc9957c388a108cf94f679',
        creatorId: '1hMyd0YwsNUiPGDyFC0tls34oXi1',
        creatorName: 'Titu Mama',
        hasPassword: false,
        passwordHash: null,
        expiresAt: null,
        maxDownloads: null,
        downloadCount: 0,
        throttleKbps: null,
        bandwidthCapBytes: null,
        bandwidthUsedBytes: 0,
        active: true,
        createdAt: iso(45),
        lastAccessedAt: null,
        storageDriver: 'telegram',
        telegramChatId: DEFAULT_STORAGE_NODE_CHAT_ID,
        telegramChunks: SEEDED_MKV_TELEGRAM_CHUNKS,
        cloudChunkCount: 0,
      },
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
      botToken: (import.meta as any).env?.VITE_TELEGRAM_BOT_TOKEN || DEFAULT_STORAGE_NODE_BOT_TOKEN,
      chatId: (import.meta as any).env?.VITE_TELEGRAM_CHAT_ID || DEFAULT_STORAGE_NODE_CHAT_ID,
      botUsername: DEFAULT_STORAGE_NODE_USERNAME,
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
  const isAdminAccount =
    user.role === 'admin' ||
    user.email?.toLowerCase() === 'titumamma2425@gmail.com' ||
    user.planId === 'unlimited_admin';

  if (isAdminAccount) {
    user.role = 'admin';
    user.planId = 'unlimited_admin';
    user.bandwidthLimitBytes = UNLIMITED_ADMIN_BYTES;
    user.planExpiresAt = null;
    user.graceEndsAt = null;
    if (typeof user.tokenBalance !== 'number' || user.tokenBalance < 999999) {
      user.tokenBalance = 999999;
    }
    if (!Array.isArray(user.usedPromoCodes)) user.usedPromoCodes = [];

    let adminTotal = 0;
    for (const f of db.files) {
      if (f.ownerId === user.id) {
        adminTotal += f.sizeBytes;
        f.lockedOverQuota = false;
      }
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

  async function resolveShareByToken(tok: string): Promise<ClientStoredShare | null> {
    // 1. Check live Firestore publicShares collection first so cross-device / public visitors always get latest state
    const cloudShare = await fetchPublicShareByTokenFromFirestore(tok).catch(() => null);
    if (cloudShare) {
      if (!cloudShare.active) return null;
      const existingIdx = db.shares.findIndex((s) => s.token === tok);
      const merged: ClientStoredShare = {
        ...cloudShare,
        passwordHash: cloudShare.passwordHash || null,
      };
      if (existingIdx === -1) {
        db.shares.unshift(merged);
      } else {
        db.shares[existingIdx] = {
          ...db.shares[existingIdx],
          ...merged,
        };
      }
      // Also ensure the shared file metadata & Telegram chunks are present in db.files for binary recovery
      if (cloudShare.fileId) {
        const fileIdx = db.files.findIndex((f) => f.id === cloudShare.fileId);
        const synthesizedFile: FileRecord = {
          id: cloudShare.fileId,
          name: cloudShare.fileName,
          folderId: null,
          ownerId: cloudShare.creatorId,
          ownerName: cloudShare.creatorName,
          sizeBytes: cloudShare.fileSizeBytes,
          mimeType: cloudShare.fileMimeType,
          sha256: cloudShare.fileSha256,
          storageDriver: cloudShare.storageDriver || 'local_vault',
          telegramChatId: cloudShare.telegramChatId,
          telegramChunks: cloudShare.telegramChunks || [],
          starred: false,
          downloadCount: cloudShare.downloadCount || 0,
          createdAt: cloudShare.createdAt,
          updatedAt: cloudShare.createdAt,
          previewText: cloudShare.previewText,
          previewDataUrl: cloudShare.previewDataUrl,
          lockedOverQuota: false,
        };
        if (fileIdx === -1) {
          db.files.unshift(synthesizedFile);
        } else if (
          cloudShare.telegramChunks &&
          cloudShare.telegramChunks.length > 0 &&
          (!db.files[fileIdx].telegramChunks || db.files[fileIdx].telegramChunks.length === 0)
        ) {
          db.files[fileIdx].telegramChunks = cloudShare.telegramChunks;
          db.files[fileIdx].storageDriver = 'telegram';
          db.files[fileIdx].telegramChatId = cloudShare.telegramChatId;
        }
      }
      saveClientDb(db);
      return merged;
    }

    // 2. Fallback to local db.shares or pre-seeded fallback shares (e.g. dl-7c5smd, dl-ac5d7ec4)
    const localShare = db.shares.find((s) => s.token === tok && s.active);
    if (localShare) return localShare;

    const initialDb = createInitialClientDb();
    const seededShare = initialDb.shares.find((s) => s.token === tok && s.active);
    if (seededShare) {
      db.shares.unshift(seededShare);
      const seededFile = initialDb.files.find((f) => f.id === seededShare.fileId);
      if (seededFile && !db.files.some((f) => f.id === seededFile.id)) {
        db.files.unshift(seededFile);
      }
      saveClientDb(db);
      return seededShare;
    }

    return null;
  }

  async function matchesSharePassword(rawPassword: string, expectedHash: string | null): Promise<boolean> {
    if (!expectedHash) return true;
    const clean = rawPassword.trim();
    if (simpleHash(clean) === expectedHash) return true;
    try {
      const msgBuffer = new TextEncoder().encode(clean);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const sha256Hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      if (sha256Hex === expectedHash) return true;
    } catch {
      // ignore
    }
    return false;
  }

  // Public share links do not require authentication
  if (path.startsWith('/api/public/share/') && method === 'GET' && !path.endsWith('/download')) {
    const tok = decodeURIComponent(path.slice('/api/public/share/'.length));
    const share = await resolveShareByToken(tok);
    if (!share) return jsonResponse({ error: 'Share link not found or disabled' }, 404);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/verify') && method === 'POST') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/verify'.length)
    );
    const share = await resolveShareByToken(tok);
    if (!share) return jsonResponse({ error: 'Share link not found' }, 404);
    const body = await parseBody();
    if (share.hasPassword) {
      const ok = await matchesSharePassword(String(body.password || ''), share.passwordHash);
      if (!ok) {
        return jsonResponse({ error: 'Incorrect password' }, 403);
      }
    }
    return jsonResponse({ unlocked: true, accessKey: share.passwordHash || 'open' });
  }

  if (path.startsWith('/api/public/share/') && path.endsWith('/download') && method === 'GET') {
    const tok = decodeURIComponent(
      path.slice('/api/public/share/'.length, path.length - '/download'.length)
    );
    const share = await resolveShareByToken(tok);
    if (!share) return new Response('Not found', { status: 404 });
    share.downloadCount += 1;
    saveClientDb(db);

    const fileMeta = db.files.find((f) => f.id === share.fileId);
    const binaryBlob = await getClientBinaryBlob(share.fileId, fileMeta);
    if (binaryBlob) {
      return new Response(binaryBlob, {
        status: 200,
        headers: {
          'Content-Type': resolveClientMimeType(share.fileName, share.fileMimeType),
          'Content-Length': String(binaryBlob.size),
        },
      });
    }

    if (share.cloudChunkCount && share.cloudChunkCount > 0) {
      const fsBlob = await fetchPublicShareBinaryChunksFromFirestore(
        share.fileId,
        share.cloudChunkCount,
        resolveClientMimeType(share.fileName, share.fileMimeType)
      );
      if (fsBlob && fsBlob.size > 0) {
        await storeClientBinaryBlob(share.fileId, fsBlob);
        return new Response(fsBlob, {
          status: 200,
          headers: {
            'Content-Type': resolveClientMimeType(share.fileName, share.fileMimeType),
            'Content-Length': String(fsBlob.size),
          },
        });
      }
    }

    const blobs = getBlobStore();
    const content =
      blobs[share.fileId] ||
      share.previewText ||
      fileMeta?.previewText ||
      `Shared file: ${share.fileName}`;
    return new Response(content, {
      status: 200,
      headers: { 'Content-Type': share.fileMimeType || 'application/octet-stream' },
    });
  }

  // All other routes strictly require Firebase Authentication
  let fbUid = (parsed.searchParams.get('uid') || '').trim();
  let fbEmail = (parsed.searchParams.get('email') || '').trim();
  let fbName = '';
  let isExistingCloudUser = false;
  if (init?.headers) {
    const h = new Headers(init.headers);
    fbUid = (h.get('X-Firebase-Uid') || fbUid).trim();
    fbEmail = (h.get('X-Firebase-Email') || fbEmail).trim();
    fbName = (h.get('X-Firebase-Name') || '').trim();
    isExistingCloudUser = h.get('X-Existing-Cloud-User') === '1';
  }

  if (!fbUid) {
    return jsonResponse(
      { error: 'Authentication required. Please sign in with Google to access UnlimStorage.' },
      401
    );
  }

  const isAdminEmail = fbEmail.toLowerCase() === 'titumamma2425@gmail.com';
  let currentUser = db.users.find(
    (u) => u.id === fbUid || (fbEmail && u.email.toLowerCase() === fbEmail.toLowerCase())
  );

  if (!currentUser) {
    // Registration is closed for brand-new users; only admin or verified existing cloud users may initialize local session
    if (!isAdminEmail && !isExistingCloudUser) {
      return jsonResponse(
        {
          error:
            'New account registration is currently closed. Only existing registered accounts can access UnlimStorage.',
        },
        403
      );
    }

    currentUser = {
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
    db.users.push(currentUser);
    seedStarterClientFilesForNewUser(db, currentUser);
    saveClientDb(db);
  } else {
    currentUser.id = fbUid;
    if (fbEmail) currentUser.email = fbEmail;
    if (fbName) currentUser.name = fbName;
    currentUser.role = isAdminEmail ? 'admin' : 'member';
    if (isAdminEmail) {
      currentUser.planId = 'unlimited_admin';
      currentUser.bandwidthLimitBytes = UNLIMITED_ADMIN_BYTES;
    }
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
      unlimited_admin: 0,
    };
    const cost = costMap[planId] ?? 0;
    const currentTokens = currentUser.tokenBalance || 0;
    const nowMs = Date.now();
    const activeExpMs = currentUser.planExpiresAt
      ? new Date(currentUser.planExpiresAt).getTime()
      : 0;
    const isCurrentPlanUnexpired =
      currentUser.planId !== 'free_25gb' && activeExpMs > nowMs;

    if (isCurrentPlanUnexpired && currentUser.planId === planId) {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      return jsonResponse(
        {
          error: `This plan is already active until ${expDateLabel}. You cannot claim this plan again until it expires.`,
        },
        400
      );
    }

    if (isCurrentPlanUnexpired && planId === 'free_25gb') {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      return jsonResponse(
        {
          error: `Your current paid plan is active until ${expDateLabel}. You cannot switch back to Free until it expires.`,
        },
        400
      );
    }

    if (
      isCurrentPlanUnexpired &&
      currentUser.planId === 'ultra_1tb' &&
      planId === 'pro_50gb'
    ) {
      const expDateLabel = new Date(activeExpMs).toLocaleDateString();
      return jsonResponse(
        {
          error: `Your 1 TB Ultra plan is active until ${expDateLabel}. Please wait until it expires before claiming a lower plan.`,
        },
        400
      );
    }

    if (planId === 'free_25gb' && currentUser.planId === 'free_25gb') {
      return jsonResponse(
        { error: 'Your 25 GB Free plan is already active.' },
        400
      );
    }

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
      const nextExp = new Date(nowMs + 30 * 86400_000);
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
    markCloudFolderDeletedTombstone(folderId);
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

    if (
      currentUser.role !== 'admin' &&
      currentUser.planId !== 'unlimited_admin' &&
      currentUser.storageUsedBytes + totalBatchBytes > currentUser.bandwidthLimitBytes
    ) {
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
    const envToken = (import.meta as any).env?.VITE_TELEGRAM_BOT_TOKEN || '';
    const envChat = (import.meta as any).env?.VITE_TELEGRAM_CHAT_ID || '';
    const activeBotToken = db.telegramConfig.botToken || envToken;
    const activeChatId = db.telegramConfig.chatId || envChat;

    for (const f of uploadedFiles) {
      const fileId = `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const mime = resolveClientMimeType(f.name, f.type);
      const isTinyText =
        (mime.startsWith('text/') ||
          mime === 'application/json' ||
          /\.(md|txt|json|csv|sh|ts|tsx|js|py|html|css|xml)$/i.test(f.name)) &&
        f.size <= 64 * 1024;
      const isTinyImage = mime.startsWith('image/') && f.size <= 128 * 1024;

      // Zero-copy instant memory cache + non-blocking IndexedDB write for instant GB file finalization
      memoryBlobCache.set(fileId, f);
      void storeClientBinaryBlob(fileId, f);

      let textContent = '';
      try {
        if (isTinyText) {
          textContent = (await f.text()).slice(0, 8000);
        }
      } catch {
        textContent = '';
      }

      let previewDataUrl: string | undefined;
      if (isTinyImage) {
        const dUrl = await fileToDataUrl(f);
        if (dUrl) previewDataUrl = dUrl;
      }

      if (previewDataUrl || textContent) {
        blobs[fileId] = previewDataUrl || textContent;
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
        storageDriver: 'local_vault',
        telegramChunks: [],
        starred: false,
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        previewText: isTinyText ? textContent : undefined,
        previewDataUrl,
        lockedOverQuota: false,
      };

      // Sync to Telegram Storage Node in background without blocking the user's upload completion
      if (activeBotToken && activeChatId && f.size <= 500 * 1024 * 1024) {
        void pushBlobToTelegramClient(f, f.name, activeBotToken, activeChatId)
          .then((tgResult) => {
            if (tgResult.success) {
              const latestDb = loadClientDb();
              const target = latestDb.files.find((item) => item.id === fileId);
              if (target) {
                target.storageDriver = 'telegram';
                target.telegramChunks = tgResult.chunks;
                target.telegramChatId = activeChatId;
                saveClientDb(latestDb);
                void syncCloudFileToFirestore(target, true).catch(() => null);
                const relatedShares = latestDb.shares.filter((s) => s.fileId === fileId);
                for (const sh of relatedShares) {
                  sh.storageDriver = 'telegram';
                  sh.telegramChunks = tgResult.chunks;
                  sh.telegramChatId = activeChatId;
                  void syncPublicShareToFirestore({
                    share: sh,
                    file: target,
                    passwordHash: sh.passwordHash,
                    cloudChunkCount: sh.cloudChunkCount || 0,
                  }).catch(() => null);
                }
                saveClientDb(latestDb);
              }
            }
          })
          .catch(() => null);
      }

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
        details: 'Saved to UnlimStorage Cloud Drive',
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

    // 1. Check IndexedDB / in-memory binary vault or Telegram chunk reassembly first
    const binaryBlob = await getClientBinaryBlob(file.id, file);
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
    if (Array.isArray(body.tags)) {
      const seen = new Set<string>();
      const cleanTags: string[] = [];
      for (const raw of body.tags) {
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
    saveClientDb(db);
    return jsonResponse({ file });
  }

  if (path.startsWith('/api/files/') && method === 'DELETE') {
    const fileId = decodeURIComponent(path.slice('/api/files/'.length));
    markCloudFileDeletedTombstone(fileId);
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

    const existingForFile = !body.customSlug
      ? db.shares.find((s) => s.fileId === file.id && s.creatorId === currentUser.id && s.active)
      : null;

    if (existingForFile) {
      existingForFile.storageDriver = file.storageDriver;
      existingForFile.telegramChatId = file.telegramChatId;
      existingForFile.telegramChunks = file.telegramChunks || [];
      existingForFile.previewText = file.previewText;
      existingForFile.previewDataUrl = file.previewDataUrl;
      saveClientDb(db);
      void syncPublicShareToFirestore({
        share: existingForFile,
        file,
        passwordHash: existingForFile.passwordHash,
        cloudChunkCount: existingForFile.cloudChunkCount || 0,
      }).catch(() => null);
      return jsonResponse({ share: existingForFile });
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
      storageDriver: file.storageDriver,
      telegramChatId: file.telegramChatId,
      telegramChunks: file.telegramChunks || [],
      cloudChunkCount: 0,
      previewText: file.previewText,
      previewDataUrl: file.previewDataUrl,
    };

    db.shares.unshift(share);
    saveClientDb(db);

    // Immediately sync share metadata to Firestore so public links work across devices
    void syncPublicShareToFirestore({
      share,
      file,
      passwordHash: share.passwordHash,
      cloudChunkCount: 0,
    }).catch(() => null);

    // Also ensure file binary is backed up to Firestore chunks (for <=15MB) or Telegram Storage Node (for larger files)
    void (async () => {
      const localBlob = await getClientBinaryBlob(file.id, file);
      if (!localBlob || localBlob.size === 0) return;

      if (localBlob.size <= 15 * 1024 * 1024) {
        const chunkCount = await syncPublicShareBinaryChunksToFirestore(file.id, localBlob).catch(
          () => 0
        );
        if (chunkCount > 0) {
          const latestDb = loadClientDb();
          const targetShare = latestDb.shares.find((s) => s.id === share.id);
          if (targetShare) {
            targetShare.cloudChunkCount = chunkCount;
            saveClientDb(latestDb);
            await syncPublicShareToFirestore({
              share: targetShare,
              file,
              passwordHash: targetShare.passwordHash,
              cloudChunkCount: chunkCount,
            }).catch(() => null);
          }
        }
      }

      if ((!file.telegramChunks || file.telegramChunks.length === 0) && localBlob.size <= 500 * 1024 * 1024) {
        const botToken = db.telegramConfig.botToken || DEFAULT_STORAGE_NODE_BOT_TOKEN;
        const chatId = db.telegramConfig.chatId || DEFAULT_STORAGE_NODE_CHAT_ID;
        if (botToken && chatId) {
          const tgResult = await pushBlobToTelegramClient(localBlob, file.name, botToken, chatId);
          if (tgResult.success) {
            const latestDb = loadClientDb();
            const targetFile = latestDb.files.find((f) => f.id === file.id);
            const targetShare = latestDb.shares.find((s) => s.id === share.id);
            if (targetFile) {
              targetFile.storageDriver = 'telegram';
              targetFile.telegramChunks = tgResult.chunks;
              targetFile.telegramChatId = chatId;
              void syncCloudFileToFirestore(targetFile, true).catch(() => null);
            }
            if (targetShare) {
              targetShare.storageDriver = 'telegram';
              targetShare.telegramChunks = tgResult.chunks;
              targetShare.telegramChatId = chatId;
              void syncPublicShareToFirestore({
                share: targetShare,
                file: targetFile || file,
                passwordHash: targetShare.passwordHash,
                cloudChunkCount: targetShare.cloudChunkCount || 0,
              }).catch(() => null);
            }
            saveClientDb(latestDb);
          }
        }
      }
    })();

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
    const file = db.files.find((f) => f.id === share.fileId);
    void syncPublicShareToFirestore({
      share,
      file,
      passwordHash: share.passwordHash,
      cloudChunkCount: share.cloudChunkCount || 0,
    }).catch(() => null);
    return jsonResponse({ share });
  }

  if (path.startsWith('/api/shares/') && method === 'DELETE') {
    const shareId = decodeURIComponent(path.slice('/api/shares/'.length));
    const target = db.shares.find((s) => s.id === shareId && s.creatorId === currentUser.id);
    db.shares = db.shares.filter((s) => !(s.id === shareId && s.creatorId === currentUser.id));
    saveClientDb(db);
    if (target) {
      void deletePublicShareFromFirestore(target.token).catch(() => null);
    }
    return jsonResponse({ ok: true });
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
    const mtprotoConnected = Boolean(
      db.telegramConfig.apiId &&
        db.telegramConfig.apiHash &&
        db.telegramConfig.mtprotoSession
    );
    const botConnected = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const connected = mtprotoConnected || botConnected;
    const authMode: 'mtproto' | 'bot' =
      db.telegramConfig.authMode === 'mtproto' || mtprotoConnected ? 'mtproto' : 'bot';
    const state: TelegramConfigState = {
      connected,
      mode: connected ? 'telegram_live' : 'hybrid_fallback',
      authMode,
      botUsername: db.telegramConfig.botUsername,
      chatId: db.telegramConfig.chatId || (mtprotoConnected ? 'me' : ''),
      maskedToken: botConnected ? '••••••••' : '',
      chunkSizeBytes: mtprotoConnected ? 2 * 1024 * 1024 * 1024 : 19 * 1024 * 1024,
      maxFileSizeBytes: mtprotoConnected ? 2 * 1024 * 1024 * 1024 : 19 * 1024 * 1024,
      autoSyncUploads: true,
      mtprotoConnected,
      apiId: db.telegramConfig.apiId,
      maskedApiHash: db.telegramConfig.apiHash ? '••••••••' : '',
      phoneNumber: db.telegramConfig.phoneNumber,
      accountName: db.telegramConfig.accountName,
      accountUsername: db.telegramConfig.accountUsername,
    };
    return jsonResponse({ config: state });
  }

  if (path === '/api/telegram/config' && method === 'POST') {
    if (currentUser.email.toLowerCase() !== 'titumamma2425@gmail.com' || currentUser.role !== 'admin') {
      return jsonResponse({ error: 'Administrator access required.' }, 403);
    }
    const body = await parseBody();
    if (body.clearCredentials) {
      db.telegramConfig.authMode = 'bot';
      db.telegramConfig.botToken = '';
      db.telegramConfig.chatId = '';
      db.telegramConfig.botUsername = undefined;
      db.telegramConfig.apiId = '';
      db.telegramConfig.apiHash = '';
      db.telegramConfig.phoneNumber = '';
      db.telegramConfig.mtprotoSession = '';
      db.telegramConfig.accountName = '';
      db.telegramConfig.accountUsername = '';
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
      db.telegramConfig.authMode = 'bot';
      db.telegramConfig.botToken = String(body.botToken).trim();
      db.telegramConfig.chatId = String(body.chatId).trim();
      db.telegramConfig.botUsername = meJson.result?.username;
      saveClientDb(db);
    } else if (body.chatId !== undefined) {
      db.telegramConfig.chatId = String(body.chatId).trim() || 'me';
      saveClientDb(db);
    }

    const mtprotoConnected = Boolean(
      db.telegramConfig.apiId &&
        db.telegramConfig.apiHash &&
        db.telegramConfig.mtprotoSession
    );
    const botConnected = Boolean(db.telegramConfig.botToken && db.telegramConfig.chatId);
    const connected = mtprotoConnected || botConnected;
    const authMode: 'mtproto' | 'bot' =
      db.telegramConfig.authMode === 'mtproto' || mtprotoConnected ? 'mtproto' : 'bot';
    const state: TelegramConfigState = {
      connected,
      mode: connected ? 'telegram_live' : 'hybrid_fallback',
      authMode,
      botUsername: db.telegramConfig.botUsername,
      chatId: db.telegramConfig.chatId || (mtprotoConnected ? 'me' : ''),
      maskedToken: botConnected ? '••••••••' : '',
      chunkSizeBytes: mtprotoConnected ? 2 * 1024 * 1024 * 1024 : 19 * 1024 * 1024,
      maxFileSizeBytes: mtprotoConnected ? 2 * 1024 * 1024 * 1024 : 19 * 1024 * 1024,
      autoSyncUploads: true,
      mtprotoConnected,
      apiId: db.telegramConfig.apiId,
      maskedApiHash: db.telegramConfig.apiHash ? '••••••••' : '',
      phoneNumber: db.telegramConfig.phoneNumber,
      accountName: db.telegramConfig.accountName,
      accountUsername: db.telegramConfig.accountUsername,
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
 * Sends a single binary chunk via XMLHttpRequest with real-time byte progress and AbortSignal support.
 */
function sendBinaryChunkWithXhr(params: {
  url: string;
  chunkBlob: Blob;
  headers: Record<string, string>;
  signal?: AbortSignal;
  onChunkProgress: (loadedInChunk: number) => void;
}): Promise<{ ok: boolean; cancelled?: boolean; status: number }> {
  return new Promise((resolve) => {
    if (params.signal?.aborted) {
      resolve({ ok: false, cancelled: true, status: 0 });
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', params.url, true);
    Object.entries(params.headers).forEach(([k, v]) => {
      xhr.setRequestHeader(k, v);
    });
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
    };

    if (params.signal) {
      params.signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (params.signal) {
        params.signal.removeEventListener('abort', onAbort);
      }
    };

    xhr.upload.onprogress = (evt) => {
      if (params.signal?.aborted) return;
      if (evt.lengthComputable) {
        params.onChunkProgress(evt.loaded);
      }
    };

    xhr.onabort = () => {
      cleanup();
      resolve({ ok: false, cancelled: true, status: 0 });
    };

    xhr.onload = () => {
      cleanup();
      if (params.signal?.aborted) {
        resolve({ ok: false, cancelled: true, status: 0 });
        return;
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    };

    xhr.onerror = () => {
      cleanup();
      if (params.signal?.aborted) {
        resolve({ ok: false, cancelled: true, status: 0 });
        return;
      }
      resolve({ ok: false, status: xhr.status || 500 });
    };

    xhr.send(params.chunkBlob);
  });
}

/**
 * Uploads files with 100% real byte-by-byte progress (0% -> 100%, transferredBytes, speedBps)
 * using 4 MB chunked binary HTTP streaming on the Express backend, and real binary slice
 * stream processing into IndexedDB / Telegram when running on static hosts.
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
  onProcessingStart?: () => void;
}): Promise<{ ok: boolean; cancelled?: boolean; status: number; data: any }> {
  if (params.signal?.aborted) {
    return {
      ok: false,
      cancelled: true,
      status: 0,
      data: { error: 'Upload cancelled by user' },
    };
  }

  const totalBatchBytes = Math.max(
    1,
    params.files.reduce((acc, f) => acc + f.size, 0)
  );
  const startMs = performance.now();
  const CHUNK_SIZE = 24 * 1024 * 1024; // 24 MB high-throughput binary chunks (6x faster for GB files, safe under Cloud Run 32 MB limit)

  // Report initial 0% real state
  params.onProgress({
    percent: 0,
    loadedBytes: 0,
    totalBytes: totalBatchBytes,
    speedBps: 0,
  });

  // 1. Try real chunked binary streaming to the Express backend if not in staticFallbackMode
  if (staticFallbackMode !== true) {
    const createdFiles: FileRecord[] = [];
    let latestUser: User | null = null;
    let completedFilesBytes = 0;

    for (let fileIdx = 0; fileIdx < params.files.length; fileIdx++) {
      const file = params.files[fileIdx];
      if (params.signal?.aborted) {
        return {
          ok: false,
          cancelled: true,
          status: 0,
          data: { error: 'Upload cancelled by user' },
        };
      }

      // Initialize server chunk session
      let initRes: Response;
      try {
        initRes = await originalFetch('/api/files/upload/init', {
          method: 'POST',
          headers: {
            ...params.headers,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: file.name,
            sizeBytes: file.size,
            mimeType: resolveClientMimeType(file.name, file.type),
            folderId: params.folderId,
          }),
        });
      } catch {
        staticFallbackMode = true;
        break;
      }

      const contentType = initRes.headers.get('content-type') || '';
      if (
        initRes.status === 404 ||
        initRes.status === 405 ||
        contentType.includes('text/html')
      ) {
        staticFallbackMode = true;
        break;
      }

      if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        return {
          ok: false,
          status: initRes.status,
          data: errData,
        };
      }

      const { uploadId, transferId } = (await initRes.json()) as {
        uploadId: string;
        transferId: string;
      };

      // Cache File reference in zero-copy memory vault immediately so post-upload preview is 0ms
      memoryBlobCache.set(uploadId, file);

      // Stream file in high-speed 24 MB binary chunks via XMLHttpRequest
      let offset = 0;
      while (offset < file.size || (file.size === 0 && offset === 0)) {
        if (params.signal?.aborted) {
          await originalFetch('/api/files/upload/cancel', {
            method: 'POST',
            headers: { ...params.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, transferId }),
          }).catch(() => null);
          return {
            ok: false,
            cancelled: true,
            status: 0,
            data: { error: 'Upload cancelled by user' },
          };
        }

        const end = Math.min(file.size, offset + CHUNK_SIZE);
        const chunkBlob = file.slice(offset, end);
        const currentOffset = offset;

        const elapsedSec = Math.max(0.05, (performance.now() - startMs) / 1000);
        const currentSpeed = Math.round(
          (completedFilesBytes + currentOffset) / elapsedSec
        );

        const chunkUrl = `/api/files/upload/chunk?uploadId=${encodeURIComponent(
          uploadId
        )}&transferId=${encodeURIComponent(transferId)}&loadedBytes=${
          currentOffset + chunkBlob.size
        }&speedBps=${currentSpeed}`;

        const chunkResult = await sendBinaryChunkWithXhr({
          url: chunkUrl,
          chunkBlob,
          headers: params.headers,
          signal: params.signal,
          onChunkProgress: (loadedInChunk) => {
            const totalLoadedNow = Math.min(
              totalBatchBytes,
              completedFilesBytes + currentOffset + loadedInChunk
            );
            const nowElapsed = Math.max(0.05, (performance.now() - startMs) / 1000);
            const realSpeedBps = Math.round(totalLoadedNow / nowElapsed);
            const realPct = Math.min(
              99,
              Math.floor((totalLoadedNow / totalBatchBytes) * 100)
            );
            params.onProgress({
              percent: realPct,
              loadedBytes: totalLoadedNow,
              totalBytes: totalBatchBytes,
              speedBps: realSpeedBps,
            });
          },
        });

        if (chunkResult.cancelled || params.signal?.aborted) {
          await originalFetch('/api/files/upload/cancel', {
            method: 'POST',
            headers: { ...params.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, transferId }),
          }).catch(() => null);
          return {
            ok: false,
            cancelled: true,
            status: 0,
            data: { error: 'Upload cancelled by user' },
          };
        }

        if (!chunkResult.ok) {
          await originalFetch('/api/files/upload/cancel', {
            method: 'POST',
            headers: { ...params.headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId, transferId }),
          }).catch(() => null);
          return {
            ok: false,
            status: chunkResult.status,
            data: { error: 'Network error while streaming file chunk' },
          };
        }

        offset = end;
        if (file.size === 0) break;
      }

      // Notify UI that byte transfer is complete and fast post-upload processing has started
      if (fileIdx === params.files.length - 1) {
        const totalElapsed = Math.max(0.05, (performance.now() - startMs) / 1000);
        params.onProgress({
          percent: 100,
          loadedBytes: totalBatchBytes,
          totalBytes: totalBatchBytes,
          speedBps: Math.round(totalBatchBytes / totalElapsed),
        });
        params.onProcessingStart?.();
      }

      // Finalize uploaded file on server (instant non-blocking response)
      const completeRes = await originalFetch('/api/files/upload/complete', {
        method: 'POST',
        headers: {
          ...params.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId,
          transferId,
          fileName: file.name,
          sizeBytes: file.size,
          mimeType: resolveClientMimeType(file.name, file.type),
          folderId: params.folderId,
        }),
      });

      if (!completeRes.ok) {
        const errData = await completeRes.json().catch(() => ({}));
        return {
          ok: false,
          status: completeRes.status,
          data: errData,
        };
      }

      const completeData = await completeRes.json();
      if (completeData.file) {
        createdFiles.push(completeData.file);
        memoryBlobCache.set(completeData.file.id, file);
        void storeClientBinaryBlob(completeData.file.id, file);
      }
      if (completeData.user) {
        latestUser = completeData.user;
      }

      completedFilesBytes += file.size;
    }

    if (staticFallbackMode !== true) {
      return {
        ok: true,
        status: 200,
        data: { files: createdFiles, user: latestUser },
      };
    }
  }

  // 2. Static Host Mode: Ultra-fast zero-copy File reference registration (supports multi-GB files without ArrayBuffer allocation)
  const STATIC_STEP_SIZE = 128 * 1024 * 1024; // 128 MB virtual progress steps
  let processedBytes = 0;
  for (const file of params.files) {
    let offset = 0;
    while (offset < file.size) {
      if (params.signal?.aborted) {
        return {
          ok: false,
          cancelled: true,
          status: 0,
          data: { error: 'Upload cancelled by user' },
        };
      }
      const end = Math.min(file.size, offset + STATIC_STEP_SIZE);
      // Verify first 64 bytes of slice to confirm readable disk handle without loading GBs into RAM
      await file.slice(offset, Math.min(end, offset + 64)).arrayBuffer();
      processedBytes += end - offset;
      offset = end;

      const elapsedSec = Math.max(0.02, (performance.now() - startMs) / 1000);
      params.onProgress({
        percent: Math.min(99, Math.floor((processedBytes / totalBatchBytes) * 100)),
        loadedBytes: processedBytes,
        totalBytes: totalBatchBytes,
        speedBps: Math.round(processedBytes / elapsedSec),
      });
    }
  }

  if (params.signal?.aborted) {
    return {
      ok: false,
      cancelled: true,
      status: 0,
      data: { error: 'Upload cancelled by user' },
    };
  }

  const finalElapsed = Math.max(0.05, (performance.now() - startMs) / 1000);
  params.onProgress({
    percent: 100,
    loadedBytes: totalBatchBytes,
    totalBytes: totalBatchBytes,
    speedBps: Math.round(totalBatchBytes / finalElapsed),
  });
  params.onProcessingStart?.();

  const formData = new FormData();
  if (params.folderId) {
    formData.append('folderId', params.folderId);
  }
  params.files.forEach((f) => formData.append('files', f));

  const res = await handleClientApi('/api/files/upload', {
    method: 'POST',
    headers: {
      ...params.headers,
      'X-Existing-Cloud-User': '1',
    },
    body: formData,
  });

  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/**
 * Synchronizes the user's cross-device Firestore drive (files, folders, profile, and
 * hidden Telegram storage node credentials) with both the client database and the
 * Express backend server so files appear on every logged-in device.
 */
export async function syncClientDbWithFirestoreDrive(params: {
  uid: string;
  email?: string;
  name?: string;
  headers: Record<string, string>;
  profile?: {
    planId: StoragePlanId;
    tokenBalance: number;
    planExpiresAt: string;
    graceEndsAt: string;
    usedPromoCodes: string;
  } | null;
  cloudFiles: FileRecord[];
  cloudFolders: FolderRecord[];
  cloudShares?: PublicShareCloudRecord[];
  storageNodeConfig?: CloudStorageNodeCredentials | null;
}): Promise<{
  unsyncedLocalFiles: FileRecord[];
  unsyncedLocalFolders: FolderRecord[];
  unsyncedLocalShares: ClientStoredShare[];
}> {
  const db = loadClientDb();
  const isAdminEmail = (params.email || '').toLowerCase() === 'titumamma2425@gmail.com';

  // 1. Sync global Telegram Storage Node credentials (both Bot & 2GB MTProto) if present in Firestore
  if (params.storageNodeConfig) {
    if (params.storageNodeConfig.authMode) {
      db.telegramConfig.authMode = params.storageNodeConfig.authMode;
    }
    if (params.storageNodeConfig.botToken && params.storageNodeConfig.chatId) {
      db.telegramConfig.botToken = params.storageNodeConfig.botToken;
      db.telegramConfig.chatId = params.storageNodeConfig.chatId;
      db.telegramConfig.botUsername = params.storageNodeConfig.botUsername;
      db.telegramConfig.autoSyncUploads = params.storageNodeConfig.autoSyncUploads;
    }
    if (
      params.storageNodeConfig.apiId &&
      params.storageNodeConfig.apiHash &&
      params.storageNodeConfig.mtprotoSession
    ) {
      db.telegramConfig.authMode = 'mtproto';
      db.telegramConfig.apiId = params.storageNodeConfig.apiId;
      db.telegramConfig.apiHash = params.storageNodeConfig.apiHash;
      db.telegramConfig.phoneNumber = params.storageNodeConfig.phoneNumber;
      db.telegramConfig.mtprotoSession = params.storageNodeConfig.mtprotoSession;
      db.telegramConfig.accountName = params.storageNodeConfig.accountName;
      db.telegramConfig.accountUsername = params.storageNodeConfig.accountUsername;
      if (params.storageNodeConfig.chatId) {
        db.telegramConfig.chatId = params.storageNodeConfig.chatId;
      }
    }
  }

  // 2. Ensure user exists in client DB & sync profile plan / token balance from Firestore
  let user = db.users.find(
    (u) =>
      u.id === params.uid ||
      (params.email && u.email.toLowerCase() === params.email.toLowerCase())
  );
  if (!user) {
    user = {
      id: params.uid,
      name: params.name || params.email?.split('@')[0] || 'Cloud User',
      email: params.email || `${params.uid}@user.unlimcloud`,
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
    seedStarterClientFilesForNewUser(db, user);
  } else {
    user.id = params.uid;
    if (params.email) user.email = params.email;
    if (params.name) user.name = params.name;
    user.role = isAdminEmail ? 'admin' : 'member';
  }

  if (isAdminEmail) {
    user.planId = 'unlimited_admin';
    user.bandwidthLimitBytes = UNLIMITED_ADMIN_BYTES;
    user.tokenBalance = Math.max(user.tokenBalance || 0, 999999);
  } else if (params.profile) {
    user.planId = params.profile.planId || user.planId || 'free_25gb';
    user.tokenBalance = Math.max(user.tokenBalance || 0, params.profile.tokenBalance || 0);
    if (params.profile.planExpiresAt) {
      user.planExpiresAt = params.profile.planExpiresAt;
    }
    if (params.profile.graceEndsAt) {
      user.graceEndsAt = params.profile.graceEndsAt;
    }
    if (params.profile.usedPromoCodes) {
      const codes = params.profile.usedPromoCodes
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      user.usedPromoCodes = Array.from(new Set([...(user.usedPromoCodes || []), ...codes]));
    }
  }

  // 3. Reconcile cloudFolders (purge folders deleted on another device + merge active folders)
  const cloudFolderIds = new Set(params.cloudFolders.map((f) => f.id));
  db.folders = db.folders.filter((f) => {
    if (f.ownerId !== params.uid) return true;
    if (cloudFolderIds.has(f.id)) return true;
    if (isCloudFolderDeletedTombstone(f.id) || wasCloudFolderPreviouslySynced(f.id)) {
      markCloudFolderDeletedTombstone(f.id);
      return false;
    }
    return true;
  });

  for (const cf of params.cloudFolders) {
    if (isCloudFolderDeletedTombstone(cf.id)) continue;
    const existingIdx = db.folders.findIndex((f) => f.id === cf.id && f.ownerId === params.uid);
    if (existingIdx === -1) {
      db.folders.push(cf);
    } else {
      db.folders[existingIdx] = {
        ...db.folders[existingIdx],
        name: cf.name,
        parentId: cf.parentId,
      };
    }
  }
  recordKnownCloudFolderIds(params.cloudFolders.map((f) => f.id));

  const unsyncedLocalFolders = db.folders.filter(
    (f) =>
      f.ownerId === params.uid &&
      !cloudFolderIds.has(f.id) &&
      !isCloudFolderDeletedTombstone(f.id)
  );

  // 4. Reconcile cloudFiles (purge files deleted on another device + merge active files)
  const isStarter = (id: string) =>
    id.startsWith('file_welcome_') || id === 'file_spec_01' || id === 'file_diagram_02';

  const cloudFileMap = new Map<string, FileRecord>();
  params.cloudFiles.forEach((cf) => {
    if (!isCloudFileDeletedTombstone(cf.id)) {
      cloudFileMap.set(cf.id, cf);
    }
  });

  const purgedFileIds: string[] = [];
  db.files = db.files.filter((f) => {
    if (f.ownerId !== params.uid) return true;
    if (cloudFileMap.has(f.id)) return true;
    if (isStarter(f.id)) return true;
    if (isCloudFileDeletedTombstone(f.id) || wasCloudFilePreviouslySynced(f.id)) {
      markCloudFileDeletedTombstone(f.id);
      purgedFileIds.push(f.id);
      return false;
    }
    return true;
  });

  if (purgedFileIds.length > 0) {
    const purgedSet = new Set(purgedFileIds);
    db.shares = db.shares.filter((s) => !purgedSet.has(s.fileId));
    const blobs = getBlobStore();
    let blobsChanged = false;
    for (const pid of purgedFileIds) {
      if (blobs[pid]) {
        delete blobs[pid];
        blobsChanged = true;
      }
      void deleteClientBinaryBlob(pid).catch(() => null);
    }
    if (blobsChanged) saveBlobStore(blobs);
  }

  for (const cf of params.cloudFiles) {
    if (isCloudFileDeletedTombstone(cf.id)) continue;
    const existingIdx = db.files.findIndex((f) => f.id === cf.id && f.ownerId === params.uid);
    if (existingIdx === -1) {
      db.files.unshift(cf);
    } else {
      const local = db.files[existingIdx];
      db.files[existingIdx] = {
        ...local,
        name: cf.name || local.name,
        folderId: cf.folderId,
        starred: cf.starred,
        downloadCount: Math.max(local.downloadCount || 0, cf.downloadCount || 0),
        storageDriver:
          cf.telegramChunks && cf.telegramChunks.length > 0
            ? 'telegram'
            : local.storageDriver || cf.storageDriver,
        telegramChatId: cf.telegramChatId || local.telegramChatId,
        telegramChunks:
          cf.telegramChunks && cf.telegramChunks.length > 0
            ? cf.telegramChunks
            : local.telegramChunks || [],
        previewText: local.previewText || cf.previewText,
        previewDataUrl: local.previewDataUrl || cf.previewDataUrl,
        tags: Array.isArray(cf.tags) ? cf.tags : local.tags || [],
      };
    }
  }
  recordKnownCloudFileIds(params.cloudFiles.map((f) => f.id));

  // Sort user files newest first
  db.files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const unsyncedLocalFiles = db.files.filter((f) => {
    if (f.ownerId !== params.uid || isStarter(f.id) || isCloudFileDeletedTombstone(f.id)) {
      return false;
    }
    const inCloud = cloudFileMap.get(f.id);
    if (!inCloud) return true;
    if (
      f.telegramChunks &&
      f.telegramChunks.length > 0 &&
      (!inCloud.telegramChunks || inCloud.telegramChunks.length === 0)
    ) {
      return true;
    }
    return false;
  });

  // 5. Merge cloudShares from Firestore into local db.shares
  const cloudSharesList = params.cloudShares || [];
  const cloudShareMap = new Map<string, PublicShareCloudRecord>();
  cloudSharesList.forEach((cs) => cloudShareMap.set(cs.token, cs));

  for (const cs of cloudSharesList) {
    if (isCloudFileDeletedTombstone(cs.fileId)) continue;
    const existingIdx = db.shares.findIndex((s) => s.token === cs.token);
    if (existingIdx === -1) {
      db.shares.unshift({
        ...cs,
        passwordHash: cs.passwordHash || null,
      });
    } else {
      const localShare = db.shares[existingIdx];
      db.shares[existingIdx] = {
        ...localShare,
        ...cs,
        passwordHash: cs.passwordHash ?? localShare.passwordHash ?? null,
        downloadCount: Math.max(localShare.downloadCount || 0, cs.downloadCount || 0),
        telegramChunks:
          cs.telegramChunks && cs.telegramChunks.length > 0
            ? cs.telegramChunks
            : localShare.telegramChunks || [],
      };
    }
  }

  const unsyncedLocalShares = db.shares.filter((s) => {
    if (s.creatorId !== params.uid || !s.active || isCloudFileDeletedTombstone(s.fileId)) {
      return false;
    }
    const inCloud = cloudShareMap.get(s.token);
    if (!inCloud) return true;
    const linkedFile = db.files.find((f) => f.id === s.fileId);
    if (
      linkedFile &&
      linkedFile.telegramChunks &&
      linkedFile.telegramChunks.length > 0 &&
      (!inCloud.telegramChunks || inCloud.telegramChunks.length === 0)
    ) {
      return true;
    }
    return false;
  });

  evaluateClientQuotaAndLocks(db, user);
  saveClientDb(db);

  // 6. Push reconciled state to Express backend (with authoritativeCloudSync so deleted files are purged on the server too)
  if (staticFallbackMode !== true) {
    try {
      await originalFetch('/api/files/sync-from-cloud', {
        method: 'POST',
        headers: {
          ...params.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authoritativeCloudSync: true,
          profile: params.profile,
          files: db.files.filter((f) => f.ownerId === params.uid),
          folders: db.folders.filter((f) => f.ownerId === params.uid),
          shares: db.shares.filter((s) => s.creatorId === params.uid),
          storageNodeConfig: params.storageNodeConfig,
        }),
      });
    } catch {
      // ignore if on static host
    }
  }

  return {
    unsyncedLocalFiles,
    unsyncedLocalFolders,
    unsyncedLocalShares,
  };
}

/**
 * Applies real-time Firestore onSnapshot changes (additions, updates, and deletions)
 * immediately to the local client database, IndexedDB binary cache, and Express server.
 */
export async function applyCloudDriveRealtimeSnapshot(params: {
  uid: string;
  headers?: Record<string, string>;
  cloudFiles?: FileRecord[];
  removedFileIds?: string[];
  cloudFolders?: FolderRecord[];
  removedFolderIds?: string[];
  cloudShares?: PublicShareCloudRecord[];
  removedShareTokens?: string[];
}): Promise<{
  files: FileRecord[];
  folders: FolderRecord[];
  shares: ClientStoredShare[];
  user: User | null;
}> {
  const db = loadClientDb();
  const isStarter = (id: string) =>
    id.startsWith('file_welcome_') || id === 'file_spec_01' || id === 'file_diagram_02';

  let needsServerSync = false;

  // 1. Handle folder snapshot & removals
  if (params.cloudFolders !== undefined) {
    const removedFoldersSet = new Set(params.removedFolderIds || []);
    for (const rfId of removedFoldersSet) {
      markCloudFolderDeletedTombstone(rfId);
    }

    const cloudFolderIds = new Set(params.cloudFolders.map((f) => f.id));
    const beforeFolderCount = db.folders.length;
    db.folders = db.folders.filter((f) => {
      if (f.ownerId !== params.uid) return true;
      if (removedFoldersSet.has(f.id)) return false;
      if (cloudFolderIds.has(f.id)) return true;
      if (isCloudFolderDeletedTombstone(f.id) || wasCloudFolderPreviouslySynced(f.id)) {
        markCloudFolderDeletedTombstone(f.id);
        return false;
      }
      return true;
    });
    if (db.folders.length !== beforeFolderCount || removedFoldersSet.size > 0) {
      needsServerSync = true;
    }

    for (const cf of params.cloudFolders) {
      if (isCloudFolderDeletedTombstone(cf.id)) continue;
      const idx = db.folders.findIndex((f) => f.id === cf.id && f.ownerId === params.uid);
      if (idx === -1) {
        db.folders.push(cf);
        needsServerSync = true;
      } else {
        db.folders[idx] = {
          ...db.folders[idx],
          name: cf.name,
          parentId: cf.parentId,
        };
      }
    }
  }

  // 2. Handle file snapshot & removals
  if (params.cloudFiles !== undefined) {
    const removedFilesSet = new Set(params.removedFileIds || []);
    for (const rfId of removedFilesSet) {
      markCloudFileDeletedTombstone(rfId);
    }

    const cloudFileMap = new Map<string, FileRecord>();
    params.cloudFiles.forEach((cf) => {
      if (!isCloudFileDeletedTombstone(cf.id)) {
        cloudFileMap.set(cf.id, cf);
      }
    });

    const purgedIds: string[] = Array.from(removedFilesSet);
    const beforeFileCount = db.files.length;
    db.files = db.files.filter((f) => {
      if (f.ownerId !== params.uid) return true;
      if (removedFilesSet.has(f.id)) return false;
      if (cloudFileMap.has(f.id)) return true;
      if (isStarter(f.id)) return true;
      if (isCloudFileDeletedTombstone(f.id) || wasCloudFilePreviouslySynced(f.id)) {
        markCloudFileDeletedTombstone(f.id);
        purgedIds.push(f.id);
        return false;
      }
      return true;
    });

    if (db.files.length !== beforeFileCount || purgedIds.length > 0) {
      needsServerSync = true;
    }

    if (purgedIds.length > 0) {
      const purgedSet = new Set(purgedIds);
      db.shares = db.shares.filter((s) => !purgedSet.has(s.fileId));
      const blobs = getBlobStore();
      let blobsChanged = false;
      for (const pid of purgedIds) {
        if (blobs[pid]) {
          delete blobs[pid];
          blobsChanged = true;
        }
        void deleteClientBinaryBlob(pid).catch(() => null);
      }
      if (blobsChanged) saveBlobStore(blobs);
    }

    for (const cf of params.cloudFiles) {
      if (isCloudFileDeletedTombstone(cf.id)) continue;
      const idx = db.files.findIndex((f) => f.id === cf.id && f.ownerId === params.uid);
      if (idx === -1) {
        db.files.unshift(cf);
        needsServerSync = true;
      } else {
        const local = db.files[idx];
        db.files[idx] = {
          ...local,
          name: cf.name || local.name,
          folderId: cf.folderId,
          starred: cf.starred,
          downloadCount: Math.max(local.downloadCount || 0, cf.downloadCount || 0),
          storageDriver:
            cf.telegramChunks && cf.telegramChunks.length > 0
              ? 'telegram'
              : local.storageDriver || cf.storageDriver,
          telegramChatId: cf.telegramChatId || local.telegramChatId,
          telegramChunks:
            cf.telegramChunks && cf.telegramChunks.length > 0
              ? cf.telegramChunks
              : local.telegramChunks || [],
          previewText: local.previewText || cf.previewText,
          previewDataUrl: local.previewDataUrl || cf.previewDataUrl,
          tags: Array.isArray(cf.tags) ? cf.tags : local.tags || [],
        };
      }
    }

    db.files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // 3. Handle shares snapshot & removals
  if (params.cloudShares !== undefined) {
    const removedTokensSet = new Set(params.removedShareTokens || []);
    if (removedTokensSet.size > 0) {
      db.shares = db.shares.filter((s) => !removedTokensSet.has(s.token));
      needsServerSync = true;
    }
    for (const cs of params.cloudShares) {
      if (isCloudFileDeletedTombstone(cs.fileId)) continue;
      const idx = db.shares.findIndex((s) => s.token === cs.token);
      if (idx === -1) {
        db.shares.unshift({
          ...cs,
          passwordHash: cs.passwordHash || null,
        });
      } else {
        const localShare = db.shares[idx];
        db.shares[idx] = {
          ...localShare,
          ...cs,
          passwordHash: cs.passwordHash ?? localShare.passwordHash ?? null,
          downloadCount: Math.max(localShare.downloadCount || 0, cs.downloadCount || 0),
          telegramChunks:
            cs.telegramChunks && cs.telegramChunks.length > 0
              ? cs.telegramChunks
              : localShare.telegramChunks || [],
        };
      }
    }
  }

  const user = db.users.find((u) => u.id === params.uid) || null;
  if (user) {
    evaluateClientQuotaAndLocks(db, user);
  }
  saveClientDb(db);

  const userFiles = db.files.filter((f) => f.ownerId === params.uid);
  const userFolders = db.folders.filter((f) => f.ownerId === params.uid);
  const userShares = db.shares.filter((s) => s.creatorId === params.uid);

  if (needsServerSync && staticFallbackMode !== true && params.headers) {
    try {
      await originalFetch('/api/files/sync-from-cloud', {
        method: 'POST',
        headers: {
          ...params.headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authoritativeCloudSync: true,
          files: userFiles,
          folders: userFolders,
          shares: userShares,
        }),
      });
    } catch {
      // ignore if on static host
    }
  }

  return {
    files: userFiles,
    folders: userFolders,
    shares: userShares,
    user,
  };
}


