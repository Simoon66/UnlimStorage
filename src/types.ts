export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  bandwidthLimitBytes: number;
  bandwidthUsedBytes: number;
  storageUsedBytes: number;
  createdAt: string;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  ownerName: string;
  createdAt: string;
}

export interface TelegramChunk {
  partIndex: number;
  messageId: number;
  fileId: string;
  sizeBytes: number;
  sha256Part: string;
}

export type StorageDriver = 'telegram' | 'local_vault';

export interface FileRecord {
  id: string;
  name: string;
  folderId: string | null;
  ownerId: string;
  ownerName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  storageDriver: StorageDriver;
  telegramChatId?: string;
  telegramChunks: TelegramChunk[];
  starred: boolean;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
  previewText?: string;
}

export interface ShareLink {
  id: string;
  token: string;
  fileId: string;
  fileName: string;
  fileSizeBytes: number;
  fileMimeType: string;
  fileSha256: string;
  creatorId: string;
  creatorName: string;
  hasPassword: boolean;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloadCount: number;
  throttleKbps: number | null; // null = unlimited
  bandwidthCapBytes: number | null;
  bandwidthUsedBytes: number;
  active: boolean;
  createdAt: string;
  lastAccessedAt: string | null;
}

export type TransferJobType = 'local_upload' | 'remote_url' | 'telegram_sync';
export type TransferJobStatus = 'queued' | 'streaming' | 'syncing_telegram' | 'completed' | 'failed';

export interface TransferJob {
  id: string;
  userId: string;
  userName: string;
  type: TransferJobType;
  sourceUrl?: string;
  fileName: string;
  folderId: string | null;
  totalBytes: number;
  transferredBytes: number;
  speedBps: number;
  status: TransferJobStatus;
  storageDriver: StorageDriver;
  fileId?: string;
  sha256?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export type AuditAction =
  | 'FILE_UPLOAD'
  | 'REMOTE_UPLOAD'
  | 'FILE_DOWNLOAD'
  | 'FILE_DELETE'
  | 'SHARE_CREATED'
  | 'SHARE_UNLOCKED'
  | 'SHARE_AUTH_FAILED'
  | 'SHARE_DOWNLOAD'
  | 'BANDWIDTH_THROTTLED'
  | 'BANDWIDTH_POLICY_UPDATED'
  | 'TELEGRAM_SYNC'
  | 'TELEGRAM_CONFIG'
  | 'USER_LOGIN'
  | 'USER_REGISTER';

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: AuditAction;
  targetName: string;
  ipAddress: string;
  bytesTransferred: number;
  integrityHash: string;
  status: 'success' | 'warning' | 'error';
  details: string;
}

export interface BandwidthSettings {
  globalThrottleKbps: number | null; // null = unthrottled
  defaultShareThrottleKbps: number | null;
  maxConcurrentTransfers: number;
  enforceUserQuotas: boolean;
  autoThrottlePeakHours: boolean;
}

export interface DailyBandwidthPoint {
  date: string;
  uploadBytes: number;
  downloadBytes: number;
  remoteFetchBytes: number;
  shareBytes: number;
}

export interface TelegramConfigState {
  connected: boolean;
  mode: 'telegram_live' | 'hybrid_fallback';
  botUsername?: string;
  botFirstName?: string;
  chatId: string;
  maskedToken: string;
  chunkSizeBytes: number;
  autoSyncUploads: boolean;
  lastVerifiedAt?: string;
}

export interface RealtimeNotification {
  id: string;
  timestamp: string;
  title: string;
  message: string;
  type: 'completed' | 'warning' | 'error' | 'info';
  fileName?: string;
  bytes?: number;
  sha256?: string;
  storageDriver?: StorageDriver;
}
