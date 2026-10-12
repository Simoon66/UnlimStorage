import { FileRecord, FolderRecord, ShareLink, RealtimeNotification } from '../types';
import {
  apiFetch,
  getClientBinaryBlob,
  storeClientBinaryBlob,
  deleteClientBinaryBlob,
} from '../services/clientCloudFallback';

// ============================================================================
// 1. USER-CONFIGURABLE REAL-TIME PUSH & TOAST NOTIFICATION PREFERENCES
// ============================================================================

export interface NotificationPreferences {
  enableToastNotifications: boolean;
  enableBrowserPush: boolean;
  enableSoundAlert: boolean;
  largeTransferThresholdMb: number; // 0 = all transfers, or 10 / 50 / 100 / 500 MB
  toastDurationSeconds: number; // 3 / 4 / 6 / 10 seconds
  notifyOnCopyAndOffline: boolean;
}

const NOTIF_PREFS_STORAGE_KEY = 'unlim_notification_prefs_v1';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  enableToastNotifications: true,
  enableBrowserPush: false,
  enableSoundAlert: true,
  largeTransferThresholdMb: 0,
  toastDurationSeconds: 4,
  notifyOnCopyAndOffline: true,
};

export function getNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(NOTIF_PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw);
    return {
      enableToastNotifications:
        typeof parsed.enableToastNotifications === 'boolean'
          ? parsed.enableToastNotifications
          : DEFAULT_NOTIFICATION_PREFS.enableToastNotifications,
      enableBrowserPush:
        typeof parsed.enableBrowserPush === 'boolean'
          ? parsed.enableBrowserPush
          : DEFAULT_NOTIFICATION_PREFS.enableBrowserPush,
      enableSoundAlert:
        typeof parsed.enableSoundAlert === 'boolean'
          ? parsed.enableSoundAlert
          : DEFAULT_NOTIFICATION_PREFS.enableSoundAlert,
      largeTransferThresholdMb:
        typeof parsed.largeTransferThresholdMb === 'number'
          ? parsed.largeTransferThresholdMb
          : DEFAULT_NOTIFICATION_PREFS.largeTransferThresholdMb,
      toastDurationSeconds:
        typeof parsed.toastDurationSeconds === 'number' && parsed.toastDurationSeconds >= 2
          ? parsed.toastDurationSeconds
          : DEFAULT_NOTIFICATION_PREFS.toastDurationSeconds,
      notifyOnCopyAndOffline:
        typeof parsed.notifyOnCopyAndOffline === 'boolean'
          ? parsed.notifyOnCopyAndOffline
          : DEFAULT_NOTIFICATION_PREFS.notifyOnCopyAndOffline,
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  try {
    localStorage.setItem(NOTIF_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('unlim:notification-prefs-changed', { detail: prefs }));
  } catch {
    // ignore storage errors
  }
}

export function shouldNotifyForEvent(
  notif: RealtimeNotification,
  prefs: NotificationPreferences
): { showToast: boolean; sendPush: boolean; playSound: boolean } {
  // Always show errors and warnings
  if (notif.type === 'error' || notif.type === 'warning') {
    return {
      showToast: true,
      sendPush: prefs.enableBrowserPush && notif.type === 'error',
      playSound: false,
    };
  }

  const thresholdBytes = prefs.largeTransferThresholdMb * 1024 * 1024;
  const isTransferWithBytes = typeof notif.bytes === 'number' && notif.bytes > 0;

  if (isTransferWithBytes && thresholdBytes > 0 && (notif.bytes || 0) < thresholdBytes) {
    return { showToast: false, sendPush: false, playSound: false };
  }

  return {
    showToast: prefs.enableToastNotifications,
    sendPush: prefs.enableBrowserPush && (isTransferWithBytes || notif.type === 'completed'),
    playSound: prefs.enableSoundAlert && notif.type === 'completed',
  };
}

export function playTransferCompletionChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.setValueAtTime(880, now + 0.11); // A5
    osc2.frequency.setValueAtTime(293.66, now); // D4
    osc2.frequency.setValueAtTime(440, now + 0.11); // A4

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.38);
    osc2.stop(now + 0.38);
    setTimeout(() => {
      void ctx.close().catch(() => null);
    }, 500);
  } catch {
    // ignore audio context restrictions
  }
}

export async function requestBrowserPushPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  if (Notification.permission === 'granted') {
    return 'granted';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function triggerBrowserPushNotification(title: string, body: string): void {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, {
      body,
      icon: '/pwa-192x192.svg',
      badge: '/pwa-192x192.svg',
      tag: `unlim_${Date.now()}`,
    });
  } catch {
    // ignore push errors
  }
}

// ============================================================================
// 2. OFFLINE DEVICE STORAGE MANAGER (IndexedDB Binary Vault + localStorage Index)
// ============================================================================

export interface OfflineSavedFileMeta {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  savedAt: string;
  folderId: string | null;
  previewDataUrl?: string;
}

const OFFLINE_INDEX_KEY = 'unlim_offline_files_v1';

export function getOfflineSavedFilesMap(): Record<string, OfflineSavedFileMeta> {
  try {
    const raw = localStorage.getItem(OFFLINE_INDEX_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveOfflineFilesMap(map: Record<string, OfflineSavedFileMeta>): void {
  try {
    localStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('unlim:offline-files-changed', { detail: map }));
  } catch {
    // ignore
  }
}

export function isFileSavedOffline(fileId: string): boolean {
  const map = getOfflineSavedFilesMap();
  return Boolean(map[fileId]);
}

export async function saveFileOfflineToDevice(
  file: FileRecord,
  authHeaders: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<boolean> {
  onProgress?.(2);

  // 1. Check if binary blob is already in local IndexedDB
  let blob = await getClientBinaryBlob(file.id, file, (loaded, total) => {
    if (total > 0) {
      onProgress?.(Math.min(98, Math.max(5, Math.round((loaded / total) * 100))));
    }
  });

  // 2. Otherwise stream from server with progress tracking
  if (!blob || blob.size <= 64) {
    const uid = authHeaders['X-Firebase-Uid'] || '';
    const email = authHeaders['X-Firebase-Email'] || '';
    const url = `/api/files/${encodeURIComponent(file.id)}/download?uid=${encodeURIComponent(
      uid
    )}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(file.name)}`;

    const res = await apiFetch(url, { headers: authHeaders });
    if (!res.ok) {
      throw new Error('Could not fetch file binary for offline storage');
    }

    const totalBytes = Number(res.headers.get('Content-Length')) || file.sizeBytes || 1;
    const contentType = res.headers.get('Content-Type') || file.mimeType || 'application/octet-stream';

    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          parts.push(value);
          received += value.byteLength;
          onProgress?.(Math.min(98, Math.max(5, Math.round((received / totalBytes) * 100))));
        }
      }
      blob = new Blob(parts as BlobPart[], { type: contentType });
    } else {
      blob = await res.blob();
    }
  }

  if (!blob || blob.size === 0) {
    throw new Error('Empty binary received when saving offline');
  }

  // Persist into IndexedDB Binary Vault + localStorage offline index
  await storeClientBinaryBlob(file.id, blob);

  // Also cache small text/image preview in localStorage if applicable
  let previewDataUrl = file.previewDataUrl;
  if (!previewDataUrl && file.mimeType.startsWith('image/') && blob.size <= 1.5 * 1024 * 1024) {
    try {
      previewDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(blob!);
      });
    } catch {
      // ignore
    }
  }

  const map = getOfflineSavedFilesMap();
  map[file.id] = {
    id: file.id,
    name: file.name,
    sizeBytes: blob.size || file.sizeBytes,
    mimeType: file.mimeType,
    savedAt: new Date().toISOString(),
    folderId: file.folderId,
    previewDataUrl,
  };
  saveOfflineFilesMap(map);
  onProgress?.(100);
  return true;
}

export async function removeFileFromOffline(fileId: string): Promise<void> {
  const map = getOfflineSavedFilesMap();
  delete map[fileId];
  saveOfflineFilesMap(map);
}

export async function clearAllOfflineFiles(): Promise<void> {
  const map = getOfflineSavedFilesMap();
  for (const id of Object.keys(map)) {
    await deleteClientBinaryBlob(id).catch(() => null);
  }
  saveOfflineFilesMap({});
}

// ============================================================================
// 3. FOLDER VISUAL INDICATOR ANALYZER
// ============================================================================

export type FolderContentCategory =
  | 'video'
  | 'image'
  | 'audio'
  | 'code'
  | 'document'
  | 'mixed'
  | 'empty';

export interface FolderVisualSummary {
  category: FolderContentCategory;
  categoryLabel: string;
  fileCount: number;
  totalBytes: number;
  hasStarred: boolean;
  starredCount: number;
  hasShared: boolean;
  hasOffline: boolean;
  videoCount: number;
  imageCount: number;
}

export function analyzeFolderVisualIndicators(
  folder: FolderRecord,
  activeFiles: FileRecord[],
  shares: ShareLink[],
  offlineMap: Record<string, OfflineSavedFileMeta>
): FolderVisualSummary {
  const folderFiles = activeFiles.filter((f) => f.folderId === folder.id);
  const fileCount = folderFiles.length;
  const totalBytes = folderFiles.reduce((acc, f) => acc + f.sizeBytes, 0);

  let videoCount = 0;
  let imageCount = 0;
  let audioCount = 0;
  let codeCount = 0;
  let docCount = 0;
  let starredCount = 0;
  let hasOffline = false;
  let hasFileShare = false;

  const sharedFileIds = new Set(shares.filter((s) => s.active).map((s) => s.fileId));
  const hasFolderShare = shares.some(
    (s) =>
      s.active &&
      (s.folderId === folder.id || (s.targetType === 'folder' && s.fileId === folder.id))
  );

  for (const f of folderFiles) {
    if (f.starred) starredCount++;
    if (offlineMap[f.id]) hasOffline = true;
    if (sharedFileIds.has(f.id)) hasFileShare = true;

    const mime = (f.mimeType || '').toLowerCase();
    const name = (f.name || '').toLowerCase();

    if (mime.startsWith('video/') || /\.(mp4|mkv|webm|mov|avi|m4v)$/.test(name)) {
      videoCount++;
    } else if (mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(name)) {
      imageCount++;
    } else if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/.test(name)) {
      audioCount++;
    } else if (/\.(json|ts|tsx|js|py|sh|html|css|sql|go|rs)$/.test(name)) {
      codeCount++;
    } else {
      docCount++;
    }
  }

  let category: FolderContentCategory = 'empty';
  let categoryLabel = 'Empty';

  if (fileCount > 0) {
    const counts: { type: FolderContentCategory; label: string; count: number }[] = [
      { type: 'video', label: 'Videos', count: videoCount },
      { type: 'image', label: 'Photos', count: imageCount },
      { type: 'audio', label: 'Audio', count: audioCount },
      { type: 'code', label: 'Code', count: codeCount },
      { type: 'document', label: 'Docs', count: docCount },
    ];
    const nonZero = counts.filter((c) => c.count > 0);
    if (nonZero.length === 1) {
      category = nonZero[0].type;
      categoryLabel = nonZero[0].label;
    } else {
      nonZero.sort((a, b) => b.count - a.count);
      if (nonZero[0].count >= fileCount * 0.6) {
        category = nonZero[0].type;
        categoryLabel = nonZero[0].label;
      } else {
        category = 'mixed';
        categoryLabel = 'Mixed Media';
      }
    }
  }

  return {
    category,
    categoryLabel,
    fileCount,
    totalBytes,
    hasStarred: starredCount > 0,
    starredCount,
    hasShared: hasFolderShare || hasFileShare,
    hasOffline,
    videoCount,
    imageCount,
  };
}
