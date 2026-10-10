import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  getDocFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  FileRecord,
  FolderRecord,
  ShareLink,
  StorageDriver,
  StoragePlanId,
  TelegramChunk,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Validate Connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Defensive sanitization matching firebase-blueprint.json & firestore.rules
function sanitizeId(raw: string): string {
  const cleaned = (raw || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'default_id';
}

function truncateString(val: string, maxLen: number, fallback = 'Item'): string {
  const trimmed = (val || '').trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
}

function toIsoDateString(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'object' && val !== null && 'seconds' in val) {
    const sec = Number((val as { seconds: number }).seconds);
    if (Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  }
  if (typeof val === 'string') return val;
  return new Date().toISOString();
}

function sanitizeFileTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawTags) {
    const cleaned = String(item || '').trim().slice(0, 32);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function parseTagsJson(raw: unknown): string[] {
  if (Array.isArray(raw)) return sanitizeFileTags(raw);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return sanitizeFileTags(parsed);
    } catch {
      return sanitizeFileTags(raw.split(','));
    }
  }
  return [];
}

export async function signInWithGooglePopup(): Promise<FirebaseUser> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutFirebaseUser(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged };
export type { FirebaseUser };

export interface FirestoreUserProfileData {
  uid: string;
  displayName: string;
  planId: StoragePlanId;
  tokenBalance: number;
  planExpiresAt: string;
  graceEndsAt: string;
  usedPromoCodes: string;
}

const inFlightProfilePromises = new Map<string, Promise<FirestoreUserProfileData | null>>();

async function ensureFirestoreUserProfileInternal(
  fbUser: FirebaseUser
): Promise<FirestoreUserProfileData | null> {
  if (!fbUser.emailVerified) return null;
  const safeUid = sanitizeId(fbUser.uid);
  const path = `userProfiles/${safeUid}`;
  const ref = doc(db, 'userProfiles', safeUid);
  const isAdminEmail = fbUser.email?.toLowerCase() === 'titumamma2425@gmail.com';
  const isLegacySeededMember = fbUser.email?.toLowerCase() === 'dev@unlim.cloud';

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      const effectivePlanId: StoragePlanId = isAdminEmail
        ? 'unlimited_admin'
        : (d.planId as StoragePlanId) || 'free_25gb';

      if (isAdminEmail && d.planId !== 'unlimited_admin') {
        updateDoc(ref, {
          planId: 'unlimited_admin',
          planExpiresAt: '',
          graceEndsAt: '',
          updatedAt: serverTimestamp(),
        }).catch(() => null);
      }

      return {
        uid: String(d.uid || safeUid),
        displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
        planId: effectivePlanId,
        tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
        planExpiresAt: isAdminEmail ? '' : String(d.planExpiresAt || ''),
        graceEndsAt: isAdminEmail ? '' : String(d.graceEndsAt || ''),
        usedPromoCodes: String(d.usedPromoCodes || ''),
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  // Registration is currently closed for brand-new accounts:
  // Only the Administrator (titumamma2425@gmail.com) or users who already have existing files/accounts can proceed.
  if (!isAdminEmail && !isLegacySeededMember) {
    let hasExistingFiles = false;
    try {
      const existingFilesSnap = await getDocs(
        query(collection(db, 'cloudFiles'), where('ownerId', '==', safeUid))
      );
      hasExistingFiles = !existingFilesSnap.empty;
    } catch {
      hasExistingFiles = false;
    }

    if (!hasExistingFiles) {
      throw new Error(
        'REGISTRATION_CLOSED: New account registration is currently closed. Only existing accounts can sign in.'
      );
    }

    return {
      uid: safeUid,
      displayName: truncateString(fbUser.displayName || fbUser.email?.split('@')[0] || 'User', 120),
      planId: 'free_25gb',
      tokenBalance: 0,
      planExpiresAt: '',
      graceEndsAt: '',
      usedPromoCodes: '',
    };
  }

  const initial: FirestoreUserProfileData = {
    uid: safeUid,
    displayName: truncateString(fbUser.displayName || fbUser.email?.split('@')[0] || 'User', 120),
    planId: isAdminEmail ? 'unlimited_admin' : 'free_25gb',
    tokenBalance: isAdminEmail ? 999999 : 0,
    planExpiresAt: '',
    graceEndsAt: '',
    usedPromoCodes: '',
  };

  if (!isAdminEmail) {
    return initial;
  }

  try {
    await setDoc(ref, {
      ...initial,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return initial;
  } catch (error) {
    try {
      const retrySnap = await getDoc(ref);
      if (retrySnap.exists()) {
        const d = retrySnap.data();
        return {
          uid: String(d.uid || safeUid),
          displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
          planId: isAdminEmail ? 'unlimited_admin' : (d.planId as StoragePlanId) || 'free_25gb',
          tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
          planExpiresAt: isAdminEmail ? '' : String(d.planExpiresAt || ''),
          graceEndsAt: isAdminEmail ? '' : String(d.graceEndsAt || ''),
          usedPromoCodes: String(d.usedPromoCodes || ''),
        };
      }
    } catch {
      // ignore fallback check error
    }
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser
): Promise<FirestoreUserProfileData | null> {
  if (!fbUser.emailVerified) return null;
  const safeUid = sanitizeId(fbUser.uid);
  const existingPromise = inFlightProfilePromises.get(safeUid);
  if (existingPromise) {
    return existingPromise;
  }
  const promise = ensureFirestoreUserProfileInternal(fbUser).finally(() => {
    inFlightProfilePromises.delete(safeUid);
  });
  inFlightProfilePromises.set(safeUid, promise);
  return promise;
}

export async function updateFirestoreUserProfile(
  patch: Partial<Omit<FirestoreUserProfileData, 'uid'>>
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;
  await ensureFirestoreUserProfile(fbUser);
  const safeUid = sanitizeId(fbUser.uid);
  const path = `userProfiles/${safeUid}`;
  const ref = doc(db, 'userProfiles', safeUid);

  const sanitizedPatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (patch.displayName !== undefined) {
    sanitizedPatch.displayName = truncateString(patch.displayName, 120);
  }
  if (patch.planId !== undefined) {
    sanitizedPatch.planId = patch.planId;
  }
  if (patch.tokenBalance !== undefined) {
    sanitizedPatch.tokenBalance = Math.max(0, Math.min(100000000, Math.floor(patch.tokenBalance)));
  }
  if (patch.planExpiresAt !== undefined) {
    sanitizedPatch.planExpiresAt = String(patch.planExpiresAt || '').slice(0, 64);
  }
  if (patch.graceEndsAt !== undefined) {
    sanitizedPatch.graceEndsAt = String(patch.graceEndsAt || '').slice(0, 64);
  }
  if (patch.usedPromoCodes !== undefined) {
    sanitizedPatch.usedPromoCodes = String(patch.usedPromoCodes || '').slice(0, 256);
  }

  try {
    await updateDoc(ref, sanitizedPatch);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

function isStarterSeedFile(fileId: string): boolean {
  return (
    fileId.startsWith('file_welcome_') ||
    fileId === 'file_spec_01' ||
    fileId === 'file_diagram_02'
  );
}

export async function syncCloudFileToFirestore(
  file: FileRecord,
  isUpdate = false
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;
  if (isStarterSeedFile(file.id)) return;

  await ensureFirestoreUserProfile(fbUser);
  const safeUid = sanitizeId(fbUser.uid);
  const safeFileId = sanitizeId(file.id);
  const path = `cloudFiles/${safeFileId}`;
  const ref = doc(db, 'cloudFiles', safeFileId);

  const chunksJson = JSON.stringify(file.telegramChunks || []).slice(0, 130000);
  const storageDriver: StorageDriver =
    file.storageDriver === 'telegram' ? 'telegram' : 'local_vault';
  const safeSha256 = (file.sha256 || '').slice(0, 128);
  const safeChatId = (file.telegramChatId || '').slice(0, 64);
  const safePreviewText = (file.previewText || '').slice(0, 28000);
  const safePreviewDataUrl =
    file.previewDataUrl && file.previewDataUrl.length <= 500000 ? file.previewDataUrl : '';
  const safeTagsJson = JSON.stringify(sanitizeFileTags(file.tags)).slice(0, 1024);

  try {
    await updateDoc(ref, {
      name: truncateString(file.name, 255, 'file.bin'),
      folderId: sanitizeId(file.folderId || 'root'),
      starred: Boolean(file.starred),
      downloadCount: Math.max(0, Math.min(100000000, Math.floor(file.downloadCount || 0))),
      sha256: safeSha256,
      storageDriver,
      telegramChatId: safeChatId,
      telegramChunksJson: chunksJson,
      previewText: safePreviewText,
      previewDataUrl: safePreviewDataUrl,
      tagsJson: safeTagsJson,
      updatedAt: serverTimestamp(),
    });
    return;
  } catch {
    // Document does not exist yet on Firestore; proceed to setDoc creation below
  }

  try {
    await setDoc(ref, {
      id: safeFileId,
      ownerId: safeUid,
      ownerName: truncateString(file.ownerName || fbUser.displayName || 'User', 120),
      folderId: sanitizeId(file.folderId || 'root'),
      name: truncateString(file.name, 255, 'file.bin'),
      sizeBytes: Math.max(0, Math.min(54975581388800, Math.floor(file.sizeBytes))),
      mimeType: truncateString(file.mimeType || 'application/octet-stream', 128),
      starred: Boolean(file.starred),
      downloadCount: Math.max(0, Math.min(100000000, Math.floor(file.downloadCount || 0))),
      sha256: safeSha256,
      storageDriver,
      telegramChatId: safeChatId,
      telegramChunksJson: chunksJson,
      previewText: safePreviewText,
      previewDataUrl: safePreviewDataUrl,
      tagsJson: safeTagsJson,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudFileFromFirestore(fileId: string): Promise<void> {
  markCloudFileDeletedTombstone(fileId);
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;
  if (isStarterSeedFile(fileId)) return;

  const safeFileId = sanitizeId(fileId);
  const path = `cloudFiles/${safeFileId}`;
  const ref = doc(db, 'cloudFiles', safeFileId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncCloudFolderToFirestore(folder: FolderRecord): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  await ensureFirestoreUserProfile(fbUser);
  const safeUid = sanitizeId(fbUser.uid);
  const safeFolderId = sanitizeId(folder.id);
  const path = `cloudFolders/${safeFolderId}`;
  const ref = doc(db, 'cloudFolders', safeFolderId);

  try {
    await updateDoc(ref, {
      name: truncateString(folder.name, 255, 'Folder'),
      parentId: sanitizeId(folder.parentId || 'root'),
      updatedAt: serverTimestamp(),
    });
    return;
  } catch {
    // Proceed to create if document does not exist
  }

  try {
    await setDoc(ref, {
      id: safeFolderId,
      ownerId: safeUid,
      ownerName: truncateString(folder.ownerName || fbUser.displayName || 'User', 120),
      parentId: sanitizeId(folder.parentId || 'root'),
      name: truncateString(folder.name, 255, 'Folder'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudFolderFromFirestore(folderId: string): Promise<void> {
  markCloudFolderDeletedTombstone(folderId);
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const safeFolderId = sanitizeId(folderId);
  const path = `cloudFolders/${safeFolderId}`;
  const ref = doc(db, 'cloudFolders', safeFolderId);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface PublicShareCloudRecord extends ShareLink {
  passwordHash: string | null;
  storageDriver: StorageDriver;
  telegramChatId?: string;
  telegramChunks: TelegramChunk[];
  cloudChunkCount: number;
  previewText?: string;
  previewDataUrl?: string;
}

/**
 * Fetches all cloud files, folders, and share links belonging to the authenticated user from Firestore
 * so that logging in from any browser or device immediately restores the user's drive & shared links.
 */
export async function fetchUserCloudDriveFromFirestore(
  fbUser: FirebaseUser
): Promise<{
  profile: FirestoreUserProfileData | null;
  files: FileRecord[];
  folders: FolderRecord[];
  shares: PublicShareCloudRecord[];
}> {
  if (!fbUser || !fbUser.emailVerified) {
    return { profile: null, files: [], folders: [], shares: [] };
  }

  const profile = await ensureFirestoreUserProfile(fbUser).catch((err) => {
    if (err instanceof Error && err.message.includes('REGISTRATION_CLOSED')) {
      throw err;
    }
    return null;
  });
  const safeUid = sanitizeId(fbUser.uid);

  const files: FileRecord[] = [];
  const folders: FolderRecord[] = [];
  const shares: PublicShareCloudRecord[] = [];

  try {
    const filesQuery = query(collection(db, 'cloudFiles'), where('ownerId', '==', safeUid));
    const filesSnap = await getDocs(filesQuery);
    filesSnap.forEach((docSnap) => {
      const d = docSnap.data();
      let parsedChunks: TelegramChunk[] = [];
      if (typeof d.telegramChunksJson === 'string' && d.telegramChunksJson.trim()) {
        try {
          const arr = JSON.parse(d.telegramChunksJson);
          if (Array.isArray(arr)) parsedChunks = arr;
        } catch {
          parsedChunks = [];
        }
      }
      const rawFolderId = String(d.folderId || 'root');
      files.push({
        id: String(d.id || docSnap.id),
        name: String(d.name || 'file.bin'),
        folderId: rawFolderId === 'root' ? null : rawFolderId,
        ownerId: String(d.ownerId || safeUid),
        ownerName: String(d.ownerName || fbUser.displayName || 'Cloud User'),
        sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : 0,
        mimeType: String(d.mimeType || 'application/octet-stream'),
        sha256: String(d.sha256 || 'e3b0c44298fc1c149afbf4c8996fb924'),
        storageDriver:
          d.storageDriver === 'telegram' || parsedChunks.length > 0 ? 'telegram' : 'local_vault',
        telegramChatId: d.telegramChatId ? String(d.telegramChatId) : undefined,
        telegramChunks: parsedChunks,
        starred: Boolean(d.starred),
        downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
        createdAt: toIsoDateString(d.createdAt),
        updatedAt: toIsoDateString(d.updatedAt),
        previewText: d.previewText ? String(d.previewText) : undefined,
        previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
        lockedOverQuota: false,
        tags: parseTagsJson(d.tagsJson),
      });
    });
  } catch (err) {
    console.warn('Could not query cloudFiles from Firestore:', err);
  }

  try {
    const foldersQuery = query(collection(db, 'cloudFolders'), where('ownerId', '==', safeUid));
    const foldersSnap = await getDocs(foldersQuery);
    foldersSnap.forEach((docSnap) => {
      const d = docSnap.data();
      const rawParentId = String(d.parentId || 'root');
      folders.push({
        id: String(d.id || docSnap.id),
        name: String(d.name || 'Folder'),
        parentId: rawParentId === 'root' ? null : rawParentId,
        ownerId: String(d.ownerId || safeUid),
        ownerName: String(d.ownerName || fbUser.displayName || 'Cloud User'),
        createdAt: toIsoDateString(d.createdAt),
      });
    });
  } catch (err) {
    console.warn('Could not query cloudFolders from Firestore:', err);
  }

  try {
    const sharesQuery = query(collection(db, 'publicShares'), where('creatorId', '==', safeUid));
    const sharesSnap = await getDocs(sharesQuery);
    sharesSnap.forEach((docSnap) => {
      const d = docSnap.data();
      let parsedChunks: TelegramChunk[] = [];
      if (typeof d.telegramChunksJson === 'string' && d.telegramChunksJson.trim()) {
        try {
          const arr = JSON.parse(d.telegramChunksJson);
          if (Array.isArray(arr)) parsedChunks = arr;
        } catch {
          parsedChunks = [];
        }
      }
      shares.push({
        id: String(d.id || `shr_${docSnap.id}`),
        token: String(d.token || docSnap.id),
        fileId: String(d.fileId || ''),
        fileName: String(d.fileName || 'Shared-File.bin'),
        fileSizeBytes: typeof d.fileSizeBytes === 'number' ? d.fileSizeBytes : 0,
        fileMimeType: String(d.fileMimeType || 'application/octet-stream'),
        fileSha256: String(d.fileSha256 || ''),
        creatorId: String(d.creatorId || safeUid),
        creatorName: String(d.creatorName || fbUser.displayName || 'Cloud User'),
        hasPassword: Boolean(d.hasPassword),
        passwordHash: d.passwordHash ? String(d.passwordHash) : null,
        expiresAt: null,
        maxDownloads: null,
        downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
        throttleKbps:
          typeof d.throttleKbps === 'number' && d.throttleKbps > 0 ? d.throttleKbps : null,
        bandwidthCapBytes: null,
        bandwidthUsedBytes: 0,
        active: d.active !== false,
        createdAt: toIsoDateString(d.createdAt),
        lastAccessedAt: null,
        storageDriver:
          d.storageDriver === 'telegram' || parsedChunks.length > 0 ? 'telegram' : 'local_vault',
        telegramChatId: d.telegramChatId ? String(d.telegramChatId) : undefined,
        telegramChunks: parsedChunks,
        cloudChunkCount: typeof d.cloudChunkCount === 'number' ? d.cloudChunkCount : 0,
        previewText: d.previewText ? String(d.previewText) : undefined,
        previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
      });
    });
  } catch (err) {
    console.warn('Could not query publicShares from Firestore:', err);
  }

  // Sort newest files & shares first
  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  shares.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { profile, files, folders, shares };
}

/**
 * Syncs a share link and its associated file download metadata (Telegram chunks, preview, passwordHash)
 * to `/publicShares/{shareToken}` in Firestore so anyone with the public link can open & download it on any device.
 */
export async function syncPublicShareToFirestore(params: {
  share: ShareLink;
  file?: FileRecord | null;
  passwordHash?: string | null;
  cloudChunkCount?: number;
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  await ensureFirestoreUserProfile(fbUser);
  const safeUid = sanitizeId(fbUser.uid);
  const safeToken = sanitizeId(params.share.token);
  const safeShareId = sanitizeId(params.share.id || `shr_${safeToken}`);
  const safeFileId = sanitizeId(params.share.fileId || params.file?.id || 'file_shared');
  const path = `publicShares/${safeToken}`;
  const ref = doc(db, 'publicShares', safeToken);

  const tgChunks = params.file?.telegramChunks || [];
  const chunksJson = JSON.stringify(tgChunks).slice(0, 130000);
  const storageDriver: StorageDriver =
    params.file?.storageDriver === 'telegram' || tgChunks.length > 0 ? 'telegram' : 'local_vault';
  const safeChatId = String(params.file?.telegramChatId || '').slice(0, 64);
  const safePreviewText = String(params.file?.previewText || '').slice(0, 28000);
  const safePreviewDataUrl =
    params.file?.previewDataUrl && params.file.previewDataUrl.length <= 500000
      ? params.file.previewDataUrl
      : '';
  const safePasswordHash = String(params.passwordHash || '').slice(0, 128);
  const safeThrottle =
    typeof params.share.throttleKbps === 'number' && params.share.throttleKbps > 0
      ? Math.min(10000000, Math.floor(params.share.throttleKbps))
      : 0;
  const safeCloudChunkCount = Math.max(
    0,
    Math.min(100, Math.floor(params.cloudChunkCount || 0))
  );

  // Try updateDoc first in case the share document already exists
  try {
    const updatePayload: Record<string, unknown> = {
      fileName: truncateString(params.share.fileName || params.file?.name || 'file.bin', 255),
      hasPassword: Boolean(params.share.hasPassword),
      passwordHash: safePasswordHash,
      active: params.share.active !== false,
      downloadCount: Math.max(
        0,
        Math.min(100000000, Math.floor(params.share.downloadCount || 0))
      ),
      throttleKbps: safeThrottle,
      storageDriver,
      telegramChatId: safeChatId,
      telegramChunksJson: chunksJson,
      cloudChunkCount: safeCloudChunkCount,
      previewText: safePreviewText,
      previewDataUrl: safePreviewDataUrl,
      updatedAt: serverTimestamp(),
    };
    await updateDoc(ref, updatePayload);
    return;
  } catch {
    // Document does not exist yet; create it below
  }

  try {
    await setDoc(ref, {
      id: safeShareId,
      token: safeToken,
      fileId: safeFileId,
      fileName: truncateString(params.share.fileName || params.file?.name || 'file.bin', 255),
      fileSizeBytes: Math.max(
        0,
        Math.min(
          54975581388800,
          Math.floor(params.share.fileSizeBytes || params.file?.sizeBytes || 0)
        )
      ),
      fileMimeType: truncateString(
        params.share.fileMimeType || params.file?.mimeType || 'application/octet-stream',
        128
      ),
      fileSha256: String(params.share.fileSha256 || params.file?.sha256 || '').slice(0, 128),
      creatorId: safeUid,
      creatorName: truncateString(
        params.share.creatorName || fbUser.displayName || 'Cloud User',
        120
      ),
      hasPassword: Boolean(params.share.hasPassword),
      passwordHash: safePasswordHash,
      active: params.share.active !== false,
      downloadCount: Math.max(
        0,
        Math.min(100000000, Math.floor(params.share.downloadCount || 0))
      ),
      throttleKbps: safeThrottle,
      storageDriver,
      telegramChatId: safeChatId,
      telegramChunksJson: chunksJson,
      cloudChunkCount: safeCloudChunkCount,
      previewText: safePreviewText,
      previewDataUrl: safePreviewDataUrl,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deletePublicShareFromFirestore(token: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;

  const safeToken = sanitizeId(token);
  const path = `publicShares/${safeToken}`;
  const ref = doc(db, 'publicShares', safeToken);

  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Publicly resolves a share link by its capability token from Firestore (`/publicShares/{shareToken}`).
 * Works without authentication so anyone who receives a `/?share=dl-...` link can open and download it.
 */
export async function fetchPublicShareByTokenFromFirestore(
  token: string
): Promise<PublicShareCloudRecord | null> {
  const safeToken = sanitizeId(token);
  const ref = doc(db, 'publicShares', safeToken);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    let parsedChunks: TelegramChunk[] = [];
    if (typeof d.telegramChunksJson === 'string' && d.telegramChunksJson.trim()) {
      try {
        const arr = JSON.parse(d.telegramChunksJson);
        if (Array.isArray(arr)) parsedChunks = arr;
      } catch {
        parsedChunks = [];
      }
    }

    return {
      id: String(d.id || `shr_${safeToken}`),
      token: String(d.token || safeToken),
      fileId: String(d.fileId || ''),
      fileName: String(d.fileName || 'Shared-File.bin'),
      fileSizeBytes: typeof d.fileSizeBytes === 'number' ? d.fileSizeBytes : 0,
      fileMimeType: String(d.fileMimeType || 'application/octet-stream'),
      fileSha256: String(d.fileSha256 || ''),
      creatorId: String(d.creatorId || ''),
      creatorName: String(d.creatorName || 'UnlimStorage User'),
      hasPassword: Boolean(d.hasPassword),
      passwordHash: d.passwordHash ? String(d.passwordHash) : null,
      expiresAt: null,
      maxDownloads: null,
      downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
      throttleKbps:
        typeof d.throttleKbps === 'number' && d.throttleKbps > 0 ? d.throttleKbps : null,
      bandwidthCapBytes: null,
      bandwidthUsedBytes: 0,
      active: d.active !== false,
      createdAt: toIsoDateString(d.createdAt),
      lastAccessedAt: null,
      storageDriver:
        d.storageDriver === 'telegram' || parsedChunks.length > 0 ? 'telegram' : 'local_vault',
      telegramChatId: d.telegramChatId ? String(d.telegramChatId) : undefined,
      telegramChunks: parsedChunks,
      cloudChunkCount: typeof d.cloudChunkCount === 'number' ? d.cloudChunkCount : 0,
      previewText: d.previewText ? String(d.previewText) : undefined,
      previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
    };
  } catch {
    return null;
  }
}

const FIRESTORE_BINARY_CHUNK_BYTES = 650 * 1024; // 650 KB raw binary (~867 KB Base64, safely under 1 MiB Firestore doc limit)
const MAX_FIRESTORE_DIRECT_FILE_BYTES = 15 * 1024 * 1024; // Up to 15 MB stored directly in Firestore chunks

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + step, bytes.length)))
    );
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Stores binary chunks of a shared file (up to 15 MB) directly in `/publicShareChunks/{chunkId}`
 * so that public share links download across any device even without Telegram configured.
 */
export async function syncPublicShareBinaryChunksToFirestore(
  fileId: string,
  blob: Blob
): Promise<number> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return 0;
  if (!blob || blob.size === 0 || blob.size > MAX_FIRESTORE_DIRECT_FILE_BYTES) return 0;

  await ensureFirestoreUserProfile(fbUser);
  const safeUid = sanitizeId(fbUser.uid);
  const safeFileId = sanitizeId(fileId);
  const totalParts = Math.ceil(blob.size / FIRESTORE_BINARY_CHUNK_BYTES);
  if (totalParts > 100) return 0;

  for (let partIdx = 0; partIdx < totalParts; partIdx++) {
    const start = partIdx * FIRESTORE_BINARY_CHUNK_BYTES;
    const end = Math.min(blob.size, start + FIRESTORE_BINARY_CHUNK_BYTES);
    const slice = blob.slice(start, end);
    const arrBuf = await slice.arrayBuffer();
    const dataBase64 = arrayBufferToBase64(arrBuf);
    const chunkId = sanitizeId(`${safeFileId}_part_${partIdx}`);
    const ref = doc(db, 'publicShareChunks', chunkId);

    try {
      await setDoc(ref, {
        id: chunkId,
        fileId: safeFileId,
        ownerId: safeUid,
        partIndex: partIdx,
        sizeBytes: slice.size,
        dataBase64,
        createdAt: serverTimestamp(),
      });
    } catch {
      return 0;
    }
  }

  return totalParts;
}

/**
 * Reassembles a shared file's binary Blob from `/publicShareChunks/{chunkId}` in Firestore.
 */
export async function fetchPublicShareBinaryChunksFromFirestore(
  fileId: string,
  chunkCount: number,
  mimeType: string
): Promise<Blob | null> {
  if (!fileId || chunkCount <= 0) return null;
  const safeFileId = sanitizeId(fileId);
  const parts: Uint8Array[] = [];

  try {
    for (let partIdx = 0; partIdx < chunkCount; partIdx++) {
      const chunkId = sanitizeId(`${safeFileId}_part_${partIdx}`);
      const snap = await getDoc(doc(db, 'publicShareChunks', chunkId));
      if (!snap.exists()) return null;
      const d = snap.data();
      if (typeof d.dataBase64 !== 'string' || !d.dataBase64) return null;
      parts.push(base64ToUint8Array(d.dataBase64));
    }
    if (parts.length === 0) return null;
    return new Blob(parts as BlobPart[], { type: mimeType || 'application/octet-stream' });
  } catch {
    return null;
  }
}

const DELETED_FILES_STORAGE_KEY = 'unlim_deleted_cloud_files_v1';
const DELETED_FOLDERS_STORAGE_KEY = 'unlim_deleted_cloud_folders_v1';
const KNOWN_CLOUD_FILES_STORAGE_KEY = 'unlim_known_cloud_files_v1';
const KNOWN_CLOUD_FOLDERS_STORAGE_KEY = 'unlim_known_cloud_folders_v1';

function readIdSetFromStorage(key: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((item) => String(item)));
    }
  } catch {
    // ignore storage errors
  }
  return new Set();
}

function writeIdSetToStorage(key: string, set: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(set).slice(-2000);
    window.localStorage.setItem(key, JSON.stringify(arr));
  } catch {
    // ignore storage errors
  }
}

export function markCloudFileDeletedTombstone(fileId: string): void {
  const safeId = sanitizeId(fileId);
  const deleted = readIdSetFromStorage(DELETED_FILES_STORAGE_KEY);
  deleted.add(safeId);
  deleted.add(fileId);
  writeIdSetToStorage(DELETED_FILES_STORAGE_KEY, deleted);

  const known = readIdSetFromStorage(KNOWN_CLOUD_FILES_STORAGE_KEY);
  known.delete(safeId);
  known.delete(fileId);
  writeIdSetToStorage(KNOWN_CLOUD_FILES_STORAGE_KEY, known);
}

export function isCloudFileDeletedTombstone(fileId: string): boolean {
  const deleted = readIdSetFromStorage(DELETED_FILES_STORAGE_KEY);
  return deleted.has(fileId) || deleted.has(sanitizeId(fileId));
}

export function markCloudFolderDeletedTombstone(folderId: string): void {
  const safeId = sanitizeId(folderId);
  const deleted = readIdSetFromStorage(DELETED_FOLDERS_STORAGE_KEY);
  deleted.add(safeId);
  deleted.add(folderId);
  writeIdSetToStorage(DELETED_FOLDERS_STORAGE_KEY, deleted);

  const known = readIdSetFromStorage(KNOWN_CLOUD_FOLDERS_STORAGE_KEY);
  known.delete(safeId);
  known.delete(folderId);
  writeIdSetToStorage(KNOWN_CLOUD_FOLDERS_STORAGE_KEY, known);
}

export function isCloudFolderDeletedTombstone(folderId: string): boolean {
  const deleted = readIdSetFromStorage(DELETED_FOLDERS_STORAGE_KEY);
  return deleted.has(folderId) || deleted.has(sanitizeId(folderId));
}

export function recordKnownCloudFileIds(fileIds: string[]): void {
  const known = readIdSetFromStorage(KNOWN_CLOUD_FILES_STORAGE_KEY);
  for (const id of fileIds) {
    known.add(id);
    known.add(sanitizeId(id));
  }
  writeIdSetToStorage(KNOWN_CLOUD_FILES_STORAGE_KEY, known);
}

export function wasCloudFilePreviouslySynced(fileId: string): boolean {
  const known = readIdSetFromStorage(KNOWN_CLOUD_FILES_STORAGE_KEY);
  return known.has(fileId) || known.has(sanitizeId(fileId));
}

export function recordKnownCloudFolderIds(folderIds: string[]): void {
  const known = readIdSetFromStorage(KNOWN_CLOUD_FOLDERS_STORAGE_KEY);
  for (const id of folderIds) {
    known.add(id);
    known.add(sanitizeId(id));
  }
  writeIdSetToStorage(KNOWN_CLOUD_FOLDERS_STORAGE_KEY, known);
}

export function wasCloudFolderPreviouslySynced(folderId: string): boolean {
  const known = readIdSetFromStorage(KNOWN_CLOUD_FOLDERS_STORAGE_KEY);
  return known.has(folderId) || known.has(sanitizeId(folderId));
}

function parseCloudFileSnapshotDoc(
  docId: string,
  d: Record<string, unknown>,
  safeUid: string,
  fallbackDisplayName: string
): FileRecord {
  let parsedChunks: TelegramChunk[] = [];
  if (typeof d.telegramChunksJson === 'string' && d.telegramChunksJson.trim()) {
    try {
      const arr = JSON.parse(d.telegramChunksJson);
      if (Array.isArray(arr)) parsedChunks = arr;
    } catch {
      parsedChunks = [];
    }
  }
  const rawFolderId = String(d.folderId || 'root');
  return {
    id: String(d.id || docId),
    name: String(d.name || 'file.bin'),
    folderId: rawFolderId === 'root' ? null : rawFolderId,
    ownerId: String(d.ownerId || safeUid),
    ownerName: String(d.ownerName || fallbackDisplayName || 'Cloud User'),
    sizeBytes: typeof d.sizeBytes === 'number' ? d.sizeBytes : 0,
    mimeType: String(d.mimeType || 'application/octet-stream'),
    sha256: String(d.sha256 || 'e3b0c44298fc1c149afbf4c8996fb924'),
    storageDriver:
      d.storageDriver === 'telegram' || parsedChunks.length > 0 ? 'telegram' : 'local_vault',
    telegramChatId: d.telegramChatId ? String(d.telegramChatId) : undefined,
    telegramChunks: parsedChunks,
    starred: Boolean(d.starred),
    downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
    createdAt: toIsoDateString(d.createdAt),
    updatedAt: toIsoDateString(d.updatedAt),
    previewText: d.previewText ? String(d.previewText) : undefined,
    previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
    lockedOverQuota: false,
    tags: parseTagsJson(d.tagsJson),
  };
}

/**
 * Real-time subscription to the user's cloud files, folders, and share links in Firestore.
 * Immediately propagates file/folder deletions, uploads, renames, and stars across all logged-in devices.
 */
export function subscribeToUserCloudDrive(
  fbUser: FirebaseUser,
  callbacks: {
    onFilesSnapshot: (files: FileRecord[], removedFileIds: string[]) => void;
    onFoldersSnapshot: (folders: FolderRecord[], removedFolderIds: string[]) => void;
    onSharesSnapshot?: (shares: PublicShareCloudRecord[], removedTokens: string[]) => void;
  }
): () => void {
  if (!fbUser || !fbUser.emailVerified) {
    return () => {};
  }

  const safeUid = sanitizeId(fbUser.uid);
  const fallbackName = fbUser.displayName || fbUser.email?.split('@')[0] || 'Cloud User';

  const filesQuery = query(collection(db, 'cloudFiles'), where('ownerId', '==', safeUid));
  const unsubFiles = onSnapshot(
    filesQuery,
    (snapshot) => {
      const removedFileIds: string[] = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          const data = change.doc.data();
          const removedId = String(data?.id || change.doc.id);
          removedFileIds.push(removedId);
          markCloudFileDeletedTombstone(removedId);
        }
      });

      const files: FileRecord[] = [];
      snapshot.forEach((docSnap) => {
        const fileRec = parseCloudFileSnapshotDoc(
          docSnap.id,
          docSnap.data() as Record<string, unknown>,
          safeUid,
          fallbackName
        );
        files.push(fileRec);
      });

      files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      recordKnownCloudFileIds(files.map((f) => f.id));
      callbacks.onFilesSnapshot(files, removedFileIds);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'cloudFiles');
    }
  );

  const foldersQuery = query(collection(db, 'cloudFolders'), where('ownerId', '==', safeUid));
  const unsubFolders = onSnapshot(
    foldersQuery,
    (snapshot) => {
      const removedFolderIds: string[] = [];
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'removed') {
          const data = change.doc.data();
          const removedId = String(data?.id || change.doc.id);
          removedFolderIds.push(removedId);
          markCloudFolderDeletedTombstone(removedId);
        }
      });

      const folders: FolderRecord[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const rawParentId = String(d.parentId || 'root');
        folders.push({
          id: String(d.id || docSnap.id),
          name: String(d.name || 'Folder'),
          parentId: rawParentId === 'root' ? null : rawParentId,
          ownerId: String(d.ownerId || safeUid),
          ownerName: String(d.ownerName || fallbackName),
          createdAt: toIsoDateString(d.createdAt),
        });
      });

      recordKnownCloudFolderIds(folders.map((f) => f.id));
      callbacks.onFoldersSnapshot(folders, removedFolderIds);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, 'cloudFolders');
    }
  );

  let unsubShares = () => {};
  if (callbacks.onSharesSnapshot) {
    const sharesQuery = query(collection(db, 'publicShares'), where('creatorId', '==', safeUid));
    unsubShares = onSnapshot(
      sharesQuery,
      (snapshot) => {
        const removedTokens: string[] = [];
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'removed') {
            const data = change.doc.data();
            removedTokens.push(String(data?.token || change.doc.id));
          }
        });

        const shares: PublicShareCloudRecord[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          let parsedChunks: TelegramChunk[] = [];
          if (typeof d.telegramChunksJson === 'string' && d.telegramChunksJson.trim()) {
            try {
              const arr = JSON.parse(d.telegramChunksJson);
              if (Array.isArray(arr)) parsedChunks = arr;
            } catch {
              parsedChunks = [];
            }
          }
          shares.push({
            id: String(d.id || `shr_${docSnap.id}`),
            token: String(d.token || docSnap.id),
            fileId: String(d.fileId || ''),
            fileName: String(d.fileName || 'Shared-File.bin'),
            fileSizeBytes: typeof d.fileSizeBytes === 'number' ? d.fileSizeBytes : 0,
            fileMimeType: String(d.fileMimeType || 'application/octet-stream'),
            fileSha256: String(d.fileSha256 || ''),
            creatorId: String(d.creatorId || safeUid),
            creatorName: String(d.creatorName || fallbackName),
            hasPassword: Boolean(d.hasPassword),
            passwordHash: d.passwordHash ? String(d.passwordHash) : null,
            expiresAt: null,
            maxDownloads: null,
            downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
            throttleKbps:
              typeof d.throttleKbps === 'number' && d.throttleKbps > 0 ? d.throttleKbps : null,
            bandwidthCapBytes: null,
            bandwidthUsedBytes: 0,
            active: d.active !== false,
            createdAt: toIsoDateString(d.createdAt),
            lastAccessedAt: null,
            storageDriver:
              d.storageDriver === 'telegram' || parsedChunks.length > 0 ? 'telegram' : 'local_vault',
            telegramChatId: d.telegramChatId ? String(d.telegramChatId) : undefined,
            telegramChunks: parsedChunks,
            cloudChunkCount: typeof d.cloudChunkCount === 'number' ? d.cloudChunkCount : 0,
            previewText: d.previewText ? String(d.previewText) : undefined,
            previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
          });
        });

        shares.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        callbacks.onSharesSnapshot?.(shares, removedTokens);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, 'publicShares');
      }
    );
  }

  return () => {
    unsubFiles();
    unsubFolders();
    unsubShares();
  };
}

export interface CloudStorageNodeCredentials {
  authMode?: 'mtproto' | 'bot';
  botToken: string;
  chatId: string;
  botUsername: string;
  autoSyncUploads: boolean;
  apiId?: string;
  apiHash?: string;
  phoneNumber?: string;
  mtprotoSession?: string;
  accountName?: string;
  accountUsername?: string;
}

export async function saveStorageNodeConfigToFirestore(config: {
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
  clearCredentials?: boolean;
}): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.email?.toLowerCase() !== 'titumamma2425@gmail.com') return;

  const ref = doc(db, 'storageNodeConfig', 'global');
  try {
    const existingSnap = await getDoc(ref);
    const existing = existingSnap.exists() ? existingSnap.data() : {};

    const nextBotToken = config.clearCredentials
      ? ''
      : config.botToken !== undefined
      ? String(config.botToken).trim()
      : String(existing.botToken || '');
    const nextChatId = config.clearCredentials
      ? ''
      : config.chatId !== undefined
      ? String(config.chatId).trim()
      : String(existing.chatId || '');
    const nextBotUsername = config.clearCredentials
      ? ''
      : config.botUsername !== undefined
      ? String(config.botUsername).trim()
      : String(existing.botUsername || '');
    const nextAutoSync =
      typeof config.autoSyncUploads === 'boolean'
        ? config.autoSyncUploads
        : existing.autoSyncUploads !== false;

    const nextAuthMode = config.clearCredentials
      ? 'bot'
      : config.authMode || (existing.authMode === 'mtproto' ? 'mtproto' : 'bot');
    const nextApiId = config.clearCredentials
      ? ''
      : config.apiId !== undefined
      ? String(config.apiId).trim()
      : String(existing.apiId || '');
    const nextApiHash = config.clearCredentials
      ? ''
      : config.apiHash !== undefined
      ? String(config.apiHash).trim()
      : String(existing.apiHash || '');
    const nextPhone = config.clearCredentials
      ? ''
      : config.phoneNumber !== undefined
      ? String(config.phoneNumber).trim()
      : String(existing.phoneNumber || '');
    const nextSession = config.clearCredentials
      ? ''
      : config.mtprotoSession !== undefined
      ? String(config.mtprotoSession).trim()
      : String(existing.mtprotoSession || '');
    const nextAccountName = config.clearCredentials
      ? ''
      : config.accountName !== undefined
      ? String(config.accountName).trim()
      : String(existing.accountName || '');
    const nextAccountUsername = config.clearCredentials
      ? ''
      : config.accountUsername !== undefined
      ? String(config.accountUsername).trim()
      : String(existing.accountUsername || '');

    await setDoc(ref, {
      id: 'global',
      authMode: nextAuthMode === 'mtproto' ? 'mtproto' : 'bot',
      botToken: nextBotToken.slice(0, 256),
      chatId: nextChatId.slice(0, 64),
      botUsername: nextBotUsername.slice(0, 120),
      autoSyncUploads: Boolean(nextAutoSync),
      apiId: nextApiId.slice(0, 32),
      apiHash: nextApiHash.slice(0, 128),
      phoneNumber: nextPhone.slice(0, 64),
      mtprotoSession: nextSession.slice(0, 2048),
      accountName: nextAccountName.slice(0, 120),
      accountUsername: nextAccountUsername.slice(0, 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'storageNodeConfig/global');
  }
}

export async function fetchStorageNodeConfigFromFirestore(): Promise<CloudStorageNodeCredentials | null> {
  try {
    const ref = doc(db, 'storageNodeConfig', 'global');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      authMode: d.authMode === 'mtproto' ? 'mtproto' : 'bot',
      botToken: String(d.botToken || ''),
      chatId: String(d.chatId || ''),
      botUsername: String(d.botUsername || ''),
      autoSyncUploads: d.autoSyncUploads !== false,
      apiId: d.apiId ? String(d.apiId) : '',
      apiHash: d.apiHash ? String(d.apiHash) : '',
      phoneNumber: d.phoneNumber ? String(d.phoneNumber) : '',
      mtprotoSession: d.mtprotoSession ? String(d.mtprotoSession) : '',
      accountName: d.accountName ? String(d.accountName) : '',
      accountUsername: d.accountUsername ? String(d.accountUsername) : '',
    };
  } catch {
    return null;
  }
}

export const loadStorageNodeConfigFromFirestore = fetchStorageNodeConfigFromFirestore;
