// ============================================================================
// VIDEO PLAYBACK RESUME STORE, FOLDER PIN HELPERS, & STREAMING ZIP BUILDER
// ============================================================================

const VIDEO_PROGRESS_STORAGE_KEY = 'unlim_video_progress_v1';
const UNLOCKED_FOLDERS_SESSION_KEY = 'unlim_unlocked_pin_folders_v1';

export interface VideoProgressEntry {
  currentTime: number;
  duration: number;
  updatedAt: number;
}

function loadProgressMap(): Record<string, VideoProgressEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VIDEO_PROGRESS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveProgressMap(map: Record<string, VideoProgressEntry>): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep most recent 300 entries
    const entries = Object.entries(map);
    if (entries.length > 300) {
      entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
      const trimmed: Record<string, VideoProgressEntry> = {};
      for (const [k, v] of entries.slice(0, 300)) {
        trimmed[k] = v;
      }
      window.localStorage.setItem(VIDEO_PROGRESS_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    window.localStorage.setItem(VIDEO_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function getVideoProgress(key?: string | null): VideoProgressEntry | null {
  if (!key) return null;
  const map = loadProgressMap();
  const entry = map[key];
  if (!entry || typeof entry.currentTime !== 'number' || entry.currentTime <= 0) {
    return null;
  }
  return entry;
}

export function saveVideoProgress(
  key: string | undefined | null,
  currentTime: number,
  duration: number
): void {
  if (!key || !Number.isFinite(currentTime) || currentTime < 0) return;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const map = loadProgressMap();

  // If user reached >= 97% of the video, clear saved progress so next play starts from 0:00
  if (safeDuration > 20 && currentTime >= safeDuration * 0.97) {
    if (map[key]) {
      delete map[key];
      saveProgressMap(map);
    }
    return;
  }

  // Only persist once user has watched at least 4 seconds
  if (currentTime < 4) return;

  map[key] = {
    currentTime: Math.floor(currentTime),
    duration: Math.floor(safeDuration),
    updatedAt: Date.now(),
  };
  saveProgressMap(map);
}

export function clearVideoProgress(key?: string | null): void {
  if (!key) return;
  const map = loadProgressMap();
  if (map[key]) {
    delete map[key];
    saveProgressMap(map);
  }
}

export function getWatchPercentage(key?: string | null): number | null {
  const entry = getVideoProgress(key);
  if (!entry || !entry.duration || entry.duration <= 0) return null;
  const pct = Math.round((entry.currentTime / entry.duration) * 100);
  if (pct < 2 || pct > 97) return null;
  return pct;
}

// ============================================================================
// FOLDER PIN LOCK HASHING & SESSION VERIFICATION
// ============================================================================

export function hashFolderPin(pin: string): string {
  const clean = String(pin || '').trim();
  if (!clean) return '';
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i * 31;
    h2 = Math.imul(h2, 0x5bd1e995);
  }
  return `pin_${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function verifyFolderPin(inputPin: string, expectedPinHash?: string | null): boolean {
  if (!expectedPinHash) return true;
  const clean = String(inputPin || '').trim();
  if (!clean) return false;
  if (expectedPinHash === clean) return true;
  return hashFolderPin(clean) === expectedPinHash;
}

export function isFolderUnlockedInSession(folderId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(UNLOCKED_FOLDERS_SESSION_KEY);
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.includes(folderId);
  } catch {
    return false;
  }
}

export function markFolderUnlockedInSession(folderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(UNLOCKED_FOLDERS_SESSION_KEY);
    const set = new Set<string>(raw ? JSON.parse(raw) : []);
    set.add(folderId);
    window.sessionStorage.setItem(UNLOCKED_FOLDERS_SESSION_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

export function lockFolderInSession(folderId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(UNLOCKED_FOLDERS_SESSION_KEY);
    if (!raw) return;
    const set = new Set<string>(JSON.parse(raw));
    set.delete(folderId);
    window.sessionStorage.setItem(UNLOCKED_FOLDERS_SESSION_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

// ============================================================================
// STANDARDS-COMPLIANT PKZIP (.ZIP) ARCHIVE BUILDER (STORE / ZERO-COMPRESSION)
// ============================================================================

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Uint8(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInputEntry {
  name: string;
  data: Uint8Array;
}

/**
 * Packages multiple files into a standard PKZIP (.zip) Blob using STORE mode.
 */
export function buildZipBlob(entries: ZipInputEntry[]): Blob {
  const encoder = new TextEncoder();
  const fileParts: BlobPart[] = [];
  const centralDirParts: Uint8Array[] = [];
  const usedNames = new Map<string, number>();

  let offset = 0;

  for (const rawEntry of entries) {
    let safeName = (rawEntry.name || 'file.bin').replace(/[\\/]+/g, '_').trim();
    if (!safeName) safeName = 'file.bin';
    const count = usedNames.get(safeName) || 0;
    usedNames.set(safeName, count + 1);
    if (count > 0) {
      const dotIdx = safeName.lastIndexOf('.');
      if (dotIdx > 0) {
        safeName = `${safeName.slice(0, dotIdx)} (${count})${safeName.slice(dotIdx)}`;
      } else {
        safeName = `${safeName} (${count})`;
      }
    }

    const nameBytes = encoder.encode(safeName);
    const data = rawEntry.data;
    const crc = crc32Uint8(data);
    const size = data.byteLength;

    // Local file header (30 bytes + file name)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8 filename)
    lv.setUint16(8, 0, true); // Compression method (0 = STORE)
    lv.setUint16(10, 0, true); // Last mod file time
    lv.setUint16(12, 0x21, true); // Last mod file date
    lv.setUint32(14, crc, true); // CRC-32
    lv.setUint32(18, size, true); // Compressed size
    lv.setUint32(22, size, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // File name length
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    // Central directory header (46 bytes + file name)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central file header signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed to extract
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Compression method (0 = STORE)
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // File comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    fileParts.push(localHeader, data as unknown as BlobPart);
    centralDirParts.push(centralHeader);

    offset += localHeader.byteLength + size;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const part of centralDirParts) {
    fileParts.push(part as unknown as BlobPart);
    centralDirSize += part.byteLength;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Number of this disk
  ev.setUint16(6, 0, true); // Disk where central directory starts
  ev.setUint16(8, entries.length, true); // Number of central directory records on this disk
  ev.setUint16(10, entries.length, true); // Total number of central directory records
  ev.setUint32(12, centralDirSize, true); // Size of central directory
  ev.setUint32(16, centralDirOffset, true); // Offset of start of central directory
  ev.setUint16(20, 0, true); // Comment length

  fileParts.push(eocd as unknown as BlobPart);
  return new Blob(fileParts, { type: 'application/zip' });
}

export async function downloadFilesAsZip(
  files: Array<{ name: string; fetchBlob: () => Promise<Blob> }>,
  archiveName = `UnlimCloud-Archive-${new Date().toISOString().slice(0, 10)}.zip`,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!files || files.length === 0) return;
  const entries: ZipInputEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    onProgress?.(Math.round((i / files.length) * 85));
    const blob = await item.fetchBlob();
    const buf = await blob.arrayBuffer();
    entries.push({
      name: item.name,
      data: new Uint8Array(buf),
    });
  }

  onProgress?.(92);
  const zipBlob = buildZipBlob(entries);
  onProgress?.(100);

  const objectUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = archiveName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15_000);
}

