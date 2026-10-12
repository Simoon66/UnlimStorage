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
  limit,
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
    if (!cleaned || cleaned.startsWith('__')) continue;
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cleaned);
      if (out.length >= 12) break;
    }
  }
  return out;
}

function parseTagsAndTrashFromJson(raw: unknown): { tags: string[]; trashed: boolean } {
  let rawArr: unknown[] = [];
  if (Array.isArray(raw)) {
    rawArr = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) rawArr = parsed;
    } catch {
      rawArr = raw.split(',');
    }
  }
  const trashed = rawArr.some((item) => String(item || '').trim() === '__trashed');
  return {
    tags: sanitizeFileTags(rawArr),
    trashed,
  };
}

function encodeFolderParentIdForFirestore(folder: FolderRecord): string {
  const baseParent = sanitizeId(folder.parentId || 'root').slice(0, 72);
  const isTrashed = Boolean(folder.trashed);
  const pinClean = String(folder.pinHash || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  if (!isTrashed && !pinClean) {
    return baseParent;
  }
  return sanitizeId(`m_${isTrashed ? 'T1' : 'T0'}_${pinClean || 'n'}__${baseParent}`);
}

function decodeFolderParentIdFromFirestore(rawParentId: string): {
  parentId: string | null;
  trashed: boolean;
  isPinProtected: boolean;
  pinHash: string | null;
} {
  const raw = String(rawParentId || 'root');
  if (raw.startsWith('m_T')) {
    const splitIdx = raw.indexOf('__');
    if (splitIdx > 0) {
      const header = raw.slice(2, splitIdx); // e.g. T1_pin_xxx or T0_n
      const baseParent = raw.slice(splitIdx + 2) || 'root';
      const trashed = header.startsWith('T1_');
      const pinPart = header.slice(3);
      const hasPin = Boolean(pinPart && pinPart !== 'n');
      return {
        parentId: baseParent === 'root' ? null : baseParent,
        trashed,
        isPinProtected: hasPin,
        pinHash: hasPin ? pinPart : null,
      };
    }
  }
  return {
    parentId: raw === 'root' ? null : raw,
    trashed: false,
    isPinProtected: false,
    pinHash: null,
  };
}

const FOLDER_SHARE_MANIFEST_PREFIX = '__UNLIM_FOLDER_SHARE_V1__:';

function decodeShareFolderManifest(rawPreviewText?: string): {
  isFolderShare: boolean;
  folderId?: string | null;
  sharedFiles?: ShareLink['sharedFiles'];
  cleanPreviewText?: string;
} {
  if (!rawPreviewText) return { isFolderShare: false };
  if (rawPreviewText.startsWith(FOLDER_SHARE_MANIFEST_PREFIX)) {
    try {
      const parsed = JSON.parse(rawPreviewText.slice(FOLDER_SHARE_MANIFEST_PREFIX.length));
      if (parsed && typeof parsed === 'object') {
        return {
          isFolderShare: true,
          folderId: parsed.folderId || null,
          sharedFiles: Array.isArray(parsed.sharedFiles) ? parsed.sharedFiles : [],
          cleanPreviewText: undefined,
        };
      }
    } catch {
      // ignore
    }
  }
  return { isFolderShare: false, cleanPreviewText: rawPreviewText };
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
  email?: string;
  planId: StoragePlanId;
  tokenBalance: number;
  planExpiresAt: string;
  graceEndsAt: string;
  usedPromoCodes: string;
  isRestricted?: boolean;
  uploadDisabled?: boolean;
}

export function decodeGovernanceFromPromoField(rawPromo: string): {
  isRestricted: boolean;
  uploadDisabled: boolean;
  email: string;
  cleanPromoCodes: string[];
} {
  const parts = String(rawPromo || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  let isRestricted = false;
  let uploadDisabled = false;
  let email = '';
  const cleanPromoCodes: string[] = [];
  for (const part of parts) {
    if (part === '__restricted') {
      isRestricted = true;
    } else if (part === '__upload_off') {
      uploadDisabled = true;
    } else if (part.startsWith('__email:')) {
      email = part.slice('__email:'.length);
    } else {
      cleanPromoCodes.push(part);
    }
  }
  return { isRestricted, uploadDisabled, email, cleanPromoCodes };
}

export function encodeGovernanceIntoPromoField(params: {
  existingRaw: string;
  isRestricted?: boolean;
  uploadDisabled?: boolean;
  email?: string;
  cleanPromoCodes?: string[];
}): string {
  const decoded = decodeGovernanceFromPromoField(params.existingRaw);
  const nextRestricted =
    params.isRestricted !== undefined ? params.isRestricted : decoded.isRestricted;
  const nextUploadOff =
    params.uploadDisabled !== undefined ? params.uploadDisabled : decoded.uploadDisabled;
  const nextEmail = (params.email !== undefined ? params.email : decoded.email)
    .replace(/,/g, '')
    .trim()
    .slice(0, 80);
  const codes = params.cleanPromoCodes !== undefined ? params.cleanPromoCodes : decoded.cleanPromoCodes;
  const tokens: string[] = [...codes];
  if (nextRestricted) tokens.push('__restricted');
  if (nextUploadOff) tokens.push('__upload_off');
  if (nextEmail) tokens.push(`__email:${nextEmail}`);
  return tokens.join(',').slice(0, 256);
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

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      const effectivePlanId: StoragePlanId = isAdminEmail
        ? 'unlimited_admin'
        : (d.planId as StoragePlanId) || 'free_25gb';
      const gov = decodeGovernanceFromPromoField(String(d.usedPromoCodes || ''));
      const updatedPromoWithEmail =
        fbUser.email && !gov.email
          ? encodeGovernanceIntoPromoField({
              existingRaw: String(d.usedPromoCodes || ''),
              email: fbUser.email,
            })
          : String(d.usedPromoCodes || '');

      if (
        (isAdminEmail && d.planId !== 'unlimited_admin') ||
        updatedPromoWithEmail !== String(d.usedPromoCodes || '')
      ) {
        updateDoc(ref, {
          planId: effectivePlanId,
          planExpiresAt: isAdminEmail ? '' : String(d.planExpiresAt || ''),
          graceEndsAt: isAdminEmail ? '' : String(d.graceEndsAt || ''),
          usedPromoCodes: updatedPromoWithEmail,
          updatedAt: serverTimestamp(),
        }).catch(() => null);
      }

      return {
        uid: String(d.uid || safeUid),
        displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
        email: gov.email || fbUser.email || '',
        planId: effectivePlanId,
        tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
        planExpiresAt: isAdminEmail ? '' : String(d.planExpiresAt || ''),
        graceEndsAt: isAdminEmail ? '' : String(d.graceEndsAt || ''),
        usedPromoCodes: updatedPromoWithEmail,
        isRestricted: isAdminEmail ? false : gov.isRestricted,
        uploadDisabled: isAdminEmail ? false : gov.uploadDisabled,
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const initialPromo = encodeGovernanceIntoPromoField({
    existingRaw: '',
    email: fbUser.email || '',
  });

  const initial: FirestoreUserProfileData = {
    uid: safeUid,
    displayName: truncateString(fbUser.displayName || fbUser.email?.split('@')[0] || 'User', 120),
    email: fbUser.email || '',
    planId: isAdminEmail ? 'unlimited_admin' : 'free_25gb',
    tokenBalance: isAdminEmail ? 999999 : 0,
    planExpiresAt: '',
    graceEndsAt: '',
    usedPromoCodes: initialPromo,
    isRestricted: false,
    uploadDisabled: false,
  };

  try {
    await setDoc(ref, {
      uid: initial.uid,
      displayName: initial.displayName,
      planId: initial.planId,
      tokenBalance: initial.tokenBalance,
      planExpiresAt: initial.planExpiresAt,
      graceEndsAt: initial.graceEndsAt,
      usedPromoCodes: initial.usedPromoCodes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return initial;
  } catch (error) {
    try {
      const retrySnap = await getDoc(ref);
      if (retrySnap.exists()) {
        const d = retrySnap.data();
        const gov = decodeGovernanceFromPromoField(String(d.usedPromoCodes || ''));
        return {
          uid: String(d.uid || safeUid),
          displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
          email: gov.email || fbUser.email || '',
          planId: isAdminEmail ? 'unlimited_admin' : (d.planId as StoragePlanId) || 'free_25gb',
          tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
          planExpiresAt: isAdminEmail ? '' : String(d.planExpiresAt || ''),
          graceEndsAt: isAdminEmail ? '' : String(d.graceEndsAt || ''),
          usedPromoCodes: String(d.usedPromoCodes || ''),
          isRestricted: isAdminEmail ? false : gov.isRestricted,
          uploadDisabled: isAdminEmail ? false : gov.uploadDisabled,
        };
      }
    } catch {
      // ignore fallback check error
    }
    return initial;
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

const inFlightDocSyncs = new Map<string, Promise<void>>();

function runSerializedDocSync(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = inFlightDocSyncs.get(key) || Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(fn)
    .finally(() => {
      if (inFlightDocSyncs.get(key) === next) {
        inFlightDocSyncs.delete(key);
      }
    });
  inFlightDocSyncs.set(key, next);
  return next;
}

export async function syncCloudFileToFirestore(
  file: FileRecord,
  _isUpdate = false
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || !fbUser.emailVerified) return;
  if (isStarterSeedFile(file.id)) return;

  const safeFileId = sanitizeId(file.id);
  const path = `cloudFiles/${safeFileId}`;

  return runSerializedDocSync(path, async () => {
    const currentFbUser = auth.currentUser;
    if (!currentFbUser || !currentFbUser.emailVerified) return;

    await ensureFirestoreUserProfile(currentFbUser);
    const safeUid = sanitizeId(currentFbUser.uid);
    const ref = doc(db, 'cloudFiles', safeFileId);

    const chunksJson = JSON.stringify(file.telegramChunks || []).slice(0, 130000);
    const storageDriver: StorageDriver =
      file.storageDriver === 'telegram' || (file.telegramChunks && file.telegramChunks.length > 0)
        ? 'telegram'
        : 'local_vault';
    const safeName = truncateString(file.name, 255, 'file.bin');
    const safeFolderId = sanitizeId(file.folderId || 'root');
    const safeStarred = Boolean(file.starred);
    const safeDownloadCount = Math.max(0, Math.min(100000000, Math.floor(file.downloadCount || 0)));
    const safeSha256 = (file.sha256 || '').slice(0, 128);
    const safeChatId = (file.telegramChatId || '').slice(0, 64);
    const safePreviewText = (file.previewText || '').slice(0, 28000);
    const safePreviewDataUrl =
      file.previewDataUrl && file.previewDataUrl.length <= 500000 ? file.previewDataUrl : '';
    const serializedTags = sanitizeFileTags(file.tags);
    if (file.trashed) {
      serializedTags.push('__trashed');
    }
    const safeTagsJson = JSON.stringify(serializedTags).slice(0, 1024);

    let existsOnServer = false;
    let existingData: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        existsOnServer = true;
        existingData = snap.data() as Record<string, unknown>;
      }
    } catch {
      existsOnServer = false;
    }

    if (existsOnServer && existingData) {
      // Skip write if nothing changed
      const existingChunks = String(existingData.telegramChunksJson || '[]');
      const needsChunkUpgrade = existingChunks === '[]' && chunksJson !== '[]';
      const isUnchanged =
        !needsChunkUpgrade &&
        existingData.name === safeName &&
        existingData.folderId === safeFolderId &&
        Boolean(existingData.starred) === safeStarred &&
        existingData.storageDriver === storageDriver &&
        String(existingData.tagsJson || '[]') === safeTagsJson;

      if (isUnchanged) {
        return;
      }

      try {
        await updateDoc(ref, {
          name: safeName,
          folderId: safeFolderId,
          starred: safeStarred,
          downloadCount: safeDownloadCount,
          sha256: safeSha256,
          storageDriver,
          telegramChatId: safeChatId,
          telegramChunksJson: chunksJson !== '[]' ? chunksJson : existingChunks,
          previewText: safePreviewText,
          previewDataUrl: safePreviewDataUrl,
          tagsJson: safeTagsJson,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
      return;
    }

    try {
      await setDoc(ref, {
        id: safeFileId,
        ownerId: safeUid,
        ownerName: truncateString(file.ownerName || currentFbUser.displayName || 'User', 120),
        folderId: safeFolderId,
        name: safeName,
        sizeBytes: Math.max(0, Math.min(54975581388800, Math.floor(file.sizeBytes))),
        mimeType: truncateString(file.mimeType || 'application/octet-stream', 128),
        starred: safeStarred,
        downloadCount: safeDownloadCount,
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
      // If a concurrent tab created the document milliseconds ago, treat as benign
      try {
        const checkSnap = await getDoc(ref);
        if (checkSnap.exists()) return;
      } catch {
        // ignore
      }
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  });
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

  const safeFolderId = sanitizeId(folder.id);
  const path = `cloudFolders/${safeFolderId}`;

  return runSerializedDocSync(path, async () => {
    const currentFbUser = auth.currentUser;
    if (!currentFbUser || !currentFbUser.emailVerified) return;

    await ensureFirestoreUserProfile(currentFbUser);
    const safeUid = sanitizeId(currentFbUser.uid);
    const ref = doc(db, 'cloudFolders', safeFolderId);
    const safeName = truncateString(folder.name, 255, 'Folder');
    const safeParentId = encodeFolderParentIdForFirestore(folder);

    let existsOnServer = false;
    let existingData: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        existsOnServer = true;
        existingData = snap.data() as Record<string, unknown>;
      }
    } catch {
      existsOnServer = false;
    }

    if (existsOnServer && existingData) {
      if (existingData.name === safeName && existingData.parentId === safeParentId) {
        return;
      }
      try {
        await updateDoc(ref, {
          name: safeName,
          parentId: safeParentId,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
      return;
    }

    try {
      await setDoc(ref, {
        id: safeFolderId,
        ownerId: safeUid,
        ownerName: truncateString(folder.ownerName || currentFbUser.displayName || 'User', 120),
        parentId: safeParentId,
        name: safeName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      try {
        const checkSnap = await getDoc(ref);
        if (checkSnap.exists()) return;
      } catch {
        // ignore
      }
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  });
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
      const parsedMeta = parseTagsAndTrashFromJson(d.tagsJson);
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
        trashed: parsedMeta.trashed,
        downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
        createdAt: toIsoDateString(d.createdAt),
        updatedAt: toIsoDateString(d.updatedAt),
        previewText: d.previewText ? String(d.previewText) : undefined,
        previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
        lockedOverQuota: false,
        tags: parsedMeta.tags,
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
      const decodedParent = decodeFolderParentIdFromFirestore(String(d.parentId || 'root'));
      folders.push({
        id: String(d.id || docSnap.id),
        name: String(d.name || 'Folder'),
        parentId: decodedParent.parentId,
        ownerId: String(d.ownerId || safeUid),
        ownerName: String(d.ownerName || fbUser.displayName || 'Cloud User'),
        createdAt: toIsoDateString(d.createdAt),
        trashed: decodedParent.trashed,
        isPinProtected: decodedParent.isPinProtected,
        pinHash: decodedParent.pinHash,
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
      const folderManifest = decodeShareFolderManifest(
        d.previewText ? String(d.previewText) : undefined
      );
      shares.push({
        id: String(d.id || `shr_${docSnap.id}`),
        token: String(d.token || docSnap.id),
        targetType:
          folderManifest.isFolderShare || d.fileMimeType === 'application/x-unlim-folder'
            ? 'folder'
            : 'file',
        folderId: folderManifest.folderId || null,
        sharedFiles: folderManifest.sharedFiles,
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
        previewText: folderManifest.cleanPreviewText,
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

  const safeToken = sanitizeId(params.share.token);
  const path = `publicShares/${safeToken}`;

  return runSerializedDocSync(path, async () => {
    const currentFbUser = auth.currentUser;
    if (!currentFbUser || !currentFbUser.emailVerified) return;

    await ensureFirestoreUserProfile(currentFbUser);
    const safeUid = sanitizeId(currentFbUser.uid);
    const safeShareId = sanitizeId(params.share.id || `shr_${safeToken}`);
    const safeFileId = sanitizeId(params.share.fileId || params.file?.id || 'file_shared');
    const ref = doc(db, 'publicShares', safeToken);

    const shareExt = params.share as ShareLink & {
      telegramChunks?: TelegramChunk[];
      storageDriver?: StorageDriver;
      telegramChatId?: string;
      previewText?: string;
      previewDataUrl?: string;
      passwordHash?: string | null;
      cloudChunkCount?: number;
    };

    const tgChunks =
      params.file?.telegramChunks && params.file.telegramChunks.length > 0
        ? params.file.telegramChunks
        : shareExt.telegramChunks || [];
    const chunksJson = JSON.stringify(tgChunks).slice(0, 130000);
    const storageDriver: StorageDriver =
      params.file?.storageDriver === 'telegram' ||
      shareExt.storageDriver === 'telegram' ||
      tgChunks.length > 0
        ? 'telegram'
        : 'local_vault';
    const safeChatId = String(params.file?.telegramChatId || shareExt.telegramChatId || '').slice(
      0,
      64
    );
    const rawPreviewText =
      params.share.targetType === 'folder' && Array.isArray(params.share.sharedFiles)
        ? `${FOLDER_SHARE_MANIFEST_PREFIX}${JSON.stringify({
            folderId: params.share.folderId || params.share.fileId,
            sharedFiles: params.share.sharedFiles,
          })}`
        : String(params.file?.previewText || shareExt.previewText || '');
    const safePreviewText = rawPreviewText.slice(0, 28000);
    const rawPreviewDataUrl = params.file?.previewDataUrl || shareExt.previewDataUrl || '';
    const safePreviewDataUrl = rawPreviewDataUrl.length <= 500000 ? rawPreviewDataUrl : '';
    const safePasswordHash = String(
      params.passwordHash !== undefined ? params.passwordHash || '' : shareExt.passwordHash || ''
    ).slice(0, 128);
    const safeThrottle =
      typeof params.share.throttleKbps === 'number' && params.share.throttleKbps > 0
        ? Math.min(10000000, Math.floor(params.share.throttleKbps))
        : 0;
    const safeCloudChunkCount = Math.max(
      0,
      Math.min(100, Math.floor(params.cloudChunkCount ?? shareExt.cloudChunkCount ?? 0))
    );
    const safeFileName = truncateString(
      params.share.fileName || params.file?.name || 'file.bin',
      255
    );
    const safeHasPassword = Boolean(params.share.hasPassword);
    const safeActive = params.share.active !== false;
    const safeDownloadCount = Math.max(
      0,
      Math.min(100000000, Math.floor(params.share.downloadCount || 0))
    );

    let existsOnServer = false;
    let existingData: Record<string, unknown> | null = null;
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        existsOnServer = true;
        existingData = snap.data() as Record<string, unknown>;
      }
    } catch {
      existsOnServer = false;
    }

    if (existsOnServer && existingData) {
      const existingChunks = String(existingData.telegramChunksJson || '[]');
      const effectiveChunksJson = chunksJson !== '[]' ? chunksJson : existingChunks;
      const effectiveDriver: StorageDriver =
        effectiveChunksJson !== '[]' ? 'telegram' : storageDriver;
      const effectivePasswordHash =
        safePasswordHash || String(existingData.passwordHash || '');

      const isUnchanged =
        existingData.fileName === safeFileName &&
        Boolean(existingData.hasPassword) === safeHasPassword &&
        String(existingData.passwordHash || '') === effectivePasswordHash &&
        Boolean(existingData.active) === safeActive &&
        existingData.throttleKbps === safeThrottle &&
        existingData.storageDriver === effectiveDriver &&
        existingChunks === effectiveChunksJson &&
        existingData.cloudChunkCount === safeCloudChunkCount;

      if (isUnchanged) {
        return;
      }

      try {
        await updateDoc(ref, {
          fileName: safeFileName,
          hasPassword: safeHasPassword,
          passwordHash: effectivePasswordHash,
          active: safeActive,
          downloadCount: safeDownloadCount,
          throttleKbps: safeThrottle,
          storageDriver: effectiveDriver,
          telegramChatId: safeChatId || String(existingData.telegramChatId || ''),
          telegramChunksJson: effectiveChunksJson,
          cloudChunkCount: safeCloudChunkCount,
          previewText: safePreviewText,
          previewDataUrl: safePreviewDataUrl,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
      return;
    }

    try {
      await setDoc(ref, {
        id: safeShareId,
        token: safeToken,
        fileId: safeFileId,
        fileName: safeFileName,
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
          params.share.creatorName || currentFbUser.displayName || 'Cloud User',
          120
        ),
        hasPassword: safeHasPassword,
        passwordHash: safePasswordHash,
        active: safeActive,
        downloadCount: safeDownloadCount,
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
      try {
        const checkSnap = await getDoc(ref);
        if (checkSnap.exists()) return;
      } catch {
        // ignore
      }
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  });
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

    const folderManifest = decodeShareFolderManifest(
      d.previewText ? String(d.previewText) : undefined
    );

    return {
      id: String(d.id || `shr_${safeToken}`),
      token: String(d.token || safeToken),
      targetType:
        folderManifest.isFolderShare || d.fileMimeType === 'application/x-unlim-folder'
          ? 'folder'
          : 'file',
      folderId: folderManifest.folderId || null,
      sharedFiles: folderManifest.sharedFiles,
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
      previewText: folderManifest.cleanPreviewText,
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
  const parsedMeta = parseTagsAndTrashFromJson(d.tagsJson);
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
    trashed: parsedMeta.trashed,
    downloadCount: typeof d.downloadCount === 'number' ? d.downloadCount : 0,
    createdAt: toIsoDateString(d.createdAt),
    updatedAt: toIsoDateString(d.updatedAt),
    previewText: d.previewText ? String(d.previewText) : undefined,
    previewDataUrl: d.previewDataUrl ? String(d.previewDataUrl) : undefined,
    lockedOverQuota: false,
    tags: parsedMeta.tags,
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
        const decodedParent = decodeFolderParentIdFromFirestore(String(d.parentId || 'root'));
        folders.push({
          id: String(d.id || docSnap.id),
          name: String(d.name || 'Folder'),
          parentId: decodedParent.parentId,
          ownerId: String(d.ownerId || safeUid),
          ownerName: String(d.ownerName || fallbackName),
          createdAt: toIsoDateString(d.createdAt),
          trashed: decodedParent.trashed,
          isPinProtected: decodedParent.isPinProtected,
          pinHash: decodedParent.pinHash,
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
          const folderManifest = decodeShareFolderManifest(
            d.previewText ? String(d.previewText) : undefined
          );
          shares.push({
            id: String(d.id || `shr_${docSnap.id}`),
            token: String(d.token || docSnap.id),
            targetType:
              folderManifest.isFolderShare || d.fileMimeType === 'application/x-unlim-folder'
                ? 'folder'
                : 'file',
            folderId: folderManifest.folderId || null,
            sharedFiles: folderManifest.sharedFiles,
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
            previewText: folderManifest.cleanPreviewText,
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

// ============================================================================
// ADMIN GOVERNANCE & 5-BILLION-USER SCALE USER SEARCH / UPLOAD POLICY
// ============================================================================

export async function fetchGlobalUploadPolicyFromFirestore(): Promise<{
  globalUploadsEnabled: boolean;
  maintenanceNote: string;
}> {
  try {
    const snap = await getDoc(doc(db, 'storageNodeConfig', 'policy'));
    if (!snap.exists()) {
      return { globalUploadsEnabled: true, maintenanceNote: '' };
    }
    const d = snap.data();
    return {
      globalUploadsEnabled: d.autoSyncUploads !== false,
      maintenanceNote: String(d.accountName || ''),
    };
  } catch {
    return { globalUploadsEnabled: true, maintenanceNote: '' };
  }
}

export async function saveGlobalUploadPolicyToFirestore(
  globalUploadsEnabled: boolean,
  maintenanceNote = ''
): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.email?.toLowerCase() !== 'titumamma2425@gmail.com') return;

  const ref = doc(db, 'storageNodeConfig', 'policy');
  try {
    await setDoc(ref, {
      id: 'policy',
      authMode: 'mtproto',
      botToken: '',
      chatId: 'GLOBAL_POLICY',
      botUsername: globalUploadsEnabled ? 'uploads_enabled' : 'uploads_disabled',
      autoSyncUploads: Boolean(globalUploadsEnabled),
      accountName: truncateString(maintenanceNote || 'Global Upload Policy', 120),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'storageNodeConfig/policy');
  }
}

export async function searchUsersInFirestore(
  searchTerm: string
): Promise<FirestoreUserProfileData[]> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.email?.toLowerCase() !== 'titumamma2425@gmail.com') return [];

  const term = (searchTerm || '').trim();
  const resultsMap = new Map<string, FirestoreUserProfileData>();

  const parseProfileSnap = (docId: string, d: Record<string, unknown>): FirestoreUserProfileData => {
    const gov = decodeGovernanceFromPromoField(String(d.usedPromoCodes || ''));
    return {
      uid: String(d.uid || docId),
      displayName: String(d.displayName || 'Cloud User'),
      email: gov.email || '',
      planId: (d.planId as StoragePlanId) || 'free_25gb',
      tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
      planExpiresAt: String(d.planExpiresAt || ''),
      graceEndsAt: String(d.graceEndsAt || ''),
      usedPromoCodes: String(d.usedPromoCodes || ''),
      isRestricted: gov.isRestricted,
      uploadDisabled: gov.uploadDisabled,
    };
  };

  // 1. O(1) Direct Document Lookup by User ID (scales to 5B+ users instantaneously)
  if (term && /^[a-zA-Z0-9_-]+$/.test(term)) {
    try {
      const directSnap = await getDoc(doc(db, 'userProfiles', sanitizeId(term)));
      if (directSnap.exists()) {
        const prof = parseProfileSnap(directSnap.id, directSnap.data() as Record<string, unknown>);
        resultsMap.set(prof.uid, prof);
      }
    } catch {
      // continue to bounded query
    }
  }

  // 2. Bounded Paginated Query (limit 100) for Name / Email / Partial UID filtering
  try {
    const q = query(collection(db, 'userProfiles'), limit(100));
    const snap = await getDocs(q);
    const lower = term.toLowerCase();
    snap.forEach((docSnap) => {
      const prof = parseProfileSnap(docSnap.id, docSnap.data() as Record<string, unknown>);
      if (
        !lower ||
        prof.uid.toLowerCase().includes(lower) ||
        prof.displayName.toLowerCase().includes(lower) ||
        (prof.email && prof.email.toLowerCase().includes(lower))
      ) {
        resultsMap.set(prof.uid, prof);
      }
    });
  } catch {
    // ignore if list is empty or offline
  }

  return Array.from(resultsMap.values());
}

export async function adminUpdateUserRestrictionInFirestore(
  targetUidRaw: string,
  patch: {
    isRestricted?: boolean;
    uploadDisabled?: boolean;
    planId?: StoragePlanId;
    displayName?: string;
    email?: string;
  }
): Promise<FirestoreUserProfileData> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.email?.toLowerCase() !== 'titumamma2425@gmail.com') {
    throw new Error('Only the Administrator can modify user restrictions.');
  }

  const safeUid = sanitizeId(targetUidRaw);
  const path = `userProfiles/${safeUid}`;
  const ref = doc(db, 'userProfiles', safeUid);

  let existingData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      existingData = snap.data() as Record<string, unknown>;
    }
  } catch {
    existingData = null;
  }

  const existingPromoRaw = existingData ? String(existingData.usedPromoCodes || '') : '';
  const nextPromoRaw = encodeGovernanceIntoPromoField({
    existingRaw: existingPromoRaw,
    isRestricted: patch.isRestricted,
    uploadDisabled: patch.uploadDisabled,
    email: patch.email,
  });

  const nextDisplayName = truncateString(
    patch.displayName || (existingData ? String(existingData.displayName || '') : '') || `User ${safeUid.slice(0, 8)}`,
    120
  );
  const nextPlanId: StoragePlanId =
    patch.planId || (existingData?.planId as StoragePlanId) || 'free_25gb';
  const nextTokens =
    existingData && typeof existingData.tokenBalance === 'number' ? existingData.tokenBalance : 0;
  const nextExpiresAt = existingData ? String(existingData.planExpiresAt || '') : '';
  const nextGraceEndsAt = existingData ? String(existingData.graceEndsAt || '') : '';

  if (existingData) {
    try {
      await updateDoc(ref, {
        displayName: nextDisplayName,
        planId: nextPlanId,
        usedPromoCodes: nextPromoRaw,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(ref, {
        uid: safeUid,
        displayName: nextDisplayName,
        planId: nextPlanId,
        tokenBalance: nextTokens,
        planExpiresAt: nextExpiresAt,
        graceEndsAt: nextGraceEndsAt,
        usedPromoCodes: nextPromoRaw,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }

  const decoded = decodeGovernanceFromPromoField(nextPromoRaw);
  return {
    uid: safeUid,
    displayName: nextDisplayName,
    email: decoded.email,
    planId: nextPlanId,
    tokenBalance: nextTokens,
    planExpiresAt: nextExpiresAt,
    graceEndsAt: nextGraceEndsAt,
    usedPromoCodes: nextPromoRaw,
    isRestricted: decoded.isRestricted,
    uploadDisabled: decoded.uploadDisabled,
  };
}

export interface GlobalUploadPolicy {
  uploadsEnabled: boolean;
  uploadDisabledReason?: string;
}

export interface FirestoreUserProfileDoc extends FirestoreUserProfileData {
  name: string;
}

export async function fetchGlobalUploadPolicy(): Promise<GlobalUploadPolicy> {
  const res = await fetchGlobalUploadPolicyFromFirestore();
  return {
    uploadsEnabled: res.globalUploadsEnabled,
    uploadDisabledReason: res.maintenanceNote,
  };
}

export async function setGlobalUploadPolicy(policy: GlobalUploadPolicy): Promise<void> {
  await saveGlobalUploadPolicyToFirestore(
    policy.uploadsEnabled,
    policy.uploadDisabledReason || ''
  );
}

export function subscribeToGlobalUploadPolicy(
  onUpdate: (policy: GlobalUploadPolicy) => void
): () => void {
  const ref = doc(db, 'storageNodeConfig', 'policy');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate({ uploadsEnabled: true, uploadDisabledReason: '' });
        return;
      }
      const d = snap.data();
      onUpdate({
        uploadsEnabled: d.autoSyncUploads !== false,
        uploadDisabledReason: String(d.accountName || ''),
      });
    },
    () => {
      onUpdate({ uploadsEnabled: true, uploadDisabledReason: '' });
    }
  );
}

export async function searchUsersAdmin(
  searchTerm: string
): Promise<FirestoreUserProfileDoc[]> {
  const list = await searchUsersInFirestore(searchTerm);
  return list.map((item) => ({
    ...item,
    name: item.displayName || 'Cloud User',
  }));
}

export async function setUserRestrictionAdmin(
  targetUid: string,
  patch: { isRestricted?: boolean; uploadDisabled?: boolean }
): Promise<FirestoreUserProfileDoc> {
  const updated = await adminUpdateUserRestrictionInFirestore(targetUid, patch);
  return {
    ...updated,
    name: updated.displayName || 'Cloud User',
  };
}


