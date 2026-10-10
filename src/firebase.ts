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
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { FileRecord, FolderRecord, StorageDriver, StoragePlanId, TelegramChunk } from './types';

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

  if (isUpdate) {
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
        updatedAt: serverTimestamp(),
      });
      return;
    } catch {
      // If the document wasn't created yet on Firestore, fall through to setDoc
    }
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudFileFromFirestore(fileId: string): Promise<void> {
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

/**
 * Fetches all cloud files and folders belonging to the authenticated user from Firestore
 * so that logging in from any browser or device immediately restores the user's drive.
 */
export async function fetchUserCloudDriveFromFirestore(
  fbUser: FirebaseUser
): Promise<{
  profile: FirestoreUserProfileData | null;
  files: FileRecord[];
  folders: FolderRecord[];
}> {
  if (!fbUser || !fbUser.emailVerified) {
    return { profile: null, files: [], folders: [] };
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

  // Sort newest files first
  files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { profile, files, folders };
}

export interface CloudStorageNodeCredentials {
  botToken: string;
  chatId: string;
  botUsername: string;
  autoSyncUploads: boolean;
}

export async function saveStorageNodeConfigToFirestore(config: {
  botToken?: string;
  chatId?: string;
  botUsername?: string;
  autoSyncUploads?: boolean;
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

    await setDoc(ref, {
      id: 'global',
      botToken: nextBotToken.slice(0, 256),
      chatId: nextChatId.slice(0, 64),
      botUsername: nextBotUsername.slice(0, 120),
      autoSyncUploads: Boolean(nextAutoSync),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'storageNodeConfig/global');
  }
}

export async function fetchStorageNodeConfigFromFirestore(): Promise<CloudStorageNodeCredentials | null> {
  const fbUser = auth.currentUser;
  if (!fbUser) return null;

  try {
    const ref = doc(db, 'storageNodeConfig', 'global');
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      botToken: String(d.botToken || ''),
      chatId: String(d.chatId || ''),
      botUsername: String(d.botUsername || ''),
      autoSyncUploads: d.autoSyncUploads !== false,
    };
  } catch {
    return null;
  }
}

export const loadStorageNodeConfigFromFirestore = fetchStorageNodeConfigFromFirestore;

