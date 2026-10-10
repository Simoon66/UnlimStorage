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
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { FileRecord, StoragePlanId } from './types';

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
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'default_id';
}

function truncateString(val: string, maxLen: number, fallback = 'Item'): string {
  const trimmed = (val || '').trim();
  if (!trimmed) return fallback.slice(0, maxLen);
  return trimmed.slice(0, maxLen);
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

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return {
        uid: String(d.uid || safeUid),
        displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
        planId: (d.planId as StoragePlanId) || 'free_25gb',
        tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
        planExpiresAt: String(d.planExpiresAt || ''),
        graceEndsAt: String(d.graceEndsAt || ''),
        usedPromoCodes: String(d.usedPromoCodes || ''),
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const initial: FirestoreUserProfileData = {
    uid: safeUid,
    displayName: truncateString(fbUser.displayName || fbUser.email?.split('@')[0] || 'User', 120),
    planId: 'free_25gb',
    tokenBalance: 0,
    planExpiresAt: '',
    graceEndsAt: '',
    usedPromoCodes: '',
  };

  try {
    await setDoc(ref, {
      ...initial,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return initial;
  } catch (error) {
    // Check if a concurrent session/listener created the profile right before this write
    try {
      const retrySnap = await getDoc(ref);
      if (retrySnap.exists()) {
        const d = retrySnap.data();
        return {
          uid: String(d.uid || safeUid),
          displayName: String(d.displayName || fbUser.displayName || 'Cloud User'),
          planId: (d.planId as StoragePlanId) || 'free_25gb',
          tokenBalance: typeof d.tokenBalance === 'number' ? d.tokenBalance : 0,
          planExpiresAt: String(d.planExpiresAt || ''),
          graceEndsAt: String(d.graceEndsAt || ''),
          usedPromoCodes: String(d.usedPromoCodes || ''),
        };
      }
    } catch {
      // ignore fallback check error and report original error
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

  if (isUpdate) {
    try {
      await updateDoc(ref, {
        name: truncateString(file.name, 255, 'file.bin'),
        folderId: sanitizeId(file.folderId || 'root'),
        starred: Boolean(file.starred),
        downloadCount: Math.max(0, Math.min(100000000, Math.floor(file.downloadCount || 0))),
        updatedAt: serverTimestamp(),
      });
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  try {
    await setDoc(ref, {
      id: safeFileId,
      ownerId: safeUid,
      ownerName: truncateString(file.ownerName || fbUser.displayName || 'User', 120),
      folderId: sanitizeId(file.folderId || 'root'),
      name: truncateString(file.name, 255, 'file.bin'),
      sizeBytes: Math.max(0, Math.min(1099511627776, Math.floor(file.sizeBytes))),
      mimeType: truncateString(file.mimeType || 'application/octet-stream', 128),
      starred: Boolean(file.starred),
      downloadCount: Math.max(0, Math.min(100000000, Math.floor(file.downloadCount || 0))),
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
