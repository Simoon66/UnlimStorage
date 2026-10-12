import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Folder,
  FolderPlus,
  FileText,
  FileCode,
  FileSpreadsheet,
  Image as ImageIcon,
  Film,
  Music,
  Upload,
  Globe,
  Link2,
  Star,
  Download,
  Trash2,
  Search,
  ChevronRight,
  X,
  User as UserIcon,
  CheckCircle2,
  AlertCircle,
  Cloud,
  Settings,
  Coins,
  Lock,
  Eye,
  ShieldCheck,
  LogIn,
  FolderInput,
  Loader2,
  Tag,
  Plus,
  CheckSquare,
  Square,
  Clock,
  LayoutGrid,
  List as ListIcon,
  Pause,
  Play,
  RotateCcw,
  KeyRound,
  FolderArchive,
  Copy,
  Smartphone,
  Bell,
  Check,
} from 'lucide-react';
import {
  User,
  FolderRecord,
  FileRecord,
  ShareLink,
  TransferJob,
  BandwidthSettings,
  TelegramConfigState,
  RealtimeNotification,
  StoragePlanId,
} from './types';
import { formatBytes, formatShortDate, formatSpeed } from './utils/format';
import {
  apiFetch,
  uploadFilesWithProgress,
  getClientBinaryBlob,
  syncClientDbWithFirestoreDrive,
  applyCloudDriveRealtimeSnapshot,
  preloadVideoFile,
} from './services/clientCloudFallback';
import {
  auth,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFirebaseUser,
  ensureFirestoreUserProfile,
  updateFirestoreUserProfile,
  syncCloudFileToFirestore,
  deleteCloudFileFromFirestore,
  syncCloudFolderToFirestore,
  deleteCloudFolderFromFirestore,
  fetchUserCloudDriveFromFirestore,
  subscribeToUserCloudDrive,
  fetchStorageNodeConfigFromFirestore,
  saveStorageNodeConfigToFirestore,
  syncPublicShareToFirestore,
  deletePublicShareFromFirestore,
  syncPublicShareBinaryChunksToFirestore,
  FirebaseUser,
} from './firebase';
import { PublicSharePortal } from './components/PublicSharePortal';
import {
  RemoteUploadModal,
  CreateShareModal,
  FileDetailDrawer,
  MoveFileModal,
  DeleteConfirmModal,
  DeleteTarget,
  BuyTokensModal,
  AuthModal,
  ManageTagsModal,
  FolderPinModal,
  FolderPinModalState,
} from './components/Modals';
import {
  SharedLinksView,
  StoragePricingView,
  TelegramStorageView,
  MediaGalleryView,
  NotificationSettingsView,
} from './components/Views';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  hashFolderPin,
  verifyFolderPin,
  downloadFilesAsZip,
  getVideoProgress,
} from './utils/mediaProgressAndZip';
import {
  NotificationPreferences,
  OfflineSavedFileMeta,
  getNotificationPreferences,
  saveNotificationPreferences,
  shouldNotifyForEvent,
  playTransferCompletionChime,
  triggerBrowserPushNotification,
  getOfflineSavedFilesMap,
  saveFileOfflineToDevice,
  removeFileFromOffline,
  clearAllOfflineFiles,
  analyzeFolderVisualIndicators,
} from './utils/offlineAndNotifications';

type ActiveView =
  | 'explorer'
  | 'gallery'
  | 'trash'
  | 'shares'
  | 'pricing'
  | 'settings'
  | 'telegram_settings';

function renderFileIcon(file: FileRecord) {
  if (file.lockedOverQuota) {
    return <Lock className="w-6 h-6 text-[#D99B26]" />;
  }
  if (
    file.mimeType.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(file.name)
  ) {
    return <ImageIcon className="w-6 h-6 text-[#D97757]" />;
  }
  if (file.mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
    return <Film className="w-6 h-6 text-[#D97757]" />;
  }
  if (file.mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(file.name)) {
    return <Music className="w-6 h-6 text-[#D97757]" />;
  }
  if (/\.(json|sh|ts|tsx|js|py|html|css)$/i.test(file.name)) {
    return <FileCode className="w-6 h-6 text-[#D97757]" />;
  }
  if (/\.(csv|xls|xlsx)$/i.test(file.name)) {
    return <FileSpreadsheet className="w-6 h-6 text-[#2E9E6B]" />;
  }
  return <FileText className="w-6 h-6 text-[#D97757]" />;
}

interface ToastNotificationCardProps {
  notification: RealtimeNotification;
  durationSeconds?: number;
  onDismiss: (id: string) => void;
}

const ToastNotificationCard: React.FC<ToastNotificationCardProps> = ({
  notification,
  durationSeconds = 4,
  onDismiss,
}) => {
  const DURATION_MS = Math.max(2000, durationSeconds * 1000);
  const [remainingMs, setRemainingMs] = useState(DURATION_MS);
  const [isPaused, setIsPaused] = useState(false);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const dragStartXRef = useRef<number | null>(null);

  const triggerDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(notification.id);
    }, 180);
  }, [notification.id, onDismiss]);

  useEffect(() => {
    if (isPaused || isDragging || isExiting) return;
    const interval = setInterval(() => {
      setRemainingMs((prev) => {
        if (prev <= 50) {
          clearInterval(interval);
          triggerDismiss();
          return 0;
        }
        return prev - 50;
      });
    }, 50);
    return () => clearInterval(interval);
  }, [isPaused, isDragging, isExiting, triggerDismiss]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragStartXRef.current = e.clientX;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || dragStartXRef.current === null) return;
    const deltaX = e.clientX - dragStartXRef.current;
    setDragOffsetX(deltaX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    dragStartXRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (Math.abs(dragOffsetX) > 70) {
      triggerDismiss();
    } else {
      setDragOffsetX(0);
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (remainingMs / DURATION_MS) * 100));
  const opacity = isExiting
    ? 0
    : Math.max(0.25, 1 - Math.abs(dragOffsetX) / 220);

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: isExiting
          ? `translateX(${dragOffsetX >= 0 ? 120 : -120}%)`
          : `translateX(${dragOffsetX}px)`,
        opacity,
        transition: isDragging
          ? 'none'
          : 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease-out',
        touchAction: 'pan-y',
      }}
      title="Swipe left/right or click X to dismiss"
      className="pointer-events-auto relative overflow-hidden bg-[#1C1A17] border border-[#D97757] p-4 flex items-start justify-between gap-3 select-none cursor-grab active:cursor-grabbing shadow-xl"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {notification.type === 'error' ? (
          <AlertCircle className="w-4 h-4 text-[#D94848] shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-[#2E9E6B] shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 min-w-0">
          <div className="text-xs font-bold text-[#F2EFE9]">{notification.title}</div>
          <div className="text-xs text-[#9E978E] break-words">{notification.message}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          triggerDismiss();
        }}
        aria-label="Dismiss notification"
        className="min-w-[32px] min-h-[32px] -mr-1.5 -mt-1.5 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] hover:bg-[#262420] cursor-pointer shrink-0 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      {/* 4-second auto-dismiss countdown progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#262420]">
        <div
          className={`h-full transition-all duration-75 ${
            notification.type === 'error' ? 'bg-[#D94848]' : 'bg-[#D97757]'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};

export default function App() {
  const [publicShareToken, setPublicShareToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  });

  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [signingInGoogle, setSigningInGoogle] = useState<boolean>(false);
  const [authGateError, setAuthGateError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [activeView, setActiveView] = useState<ActiveView>('explorer');
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [transfers, setTransfers] = useState<TransferJob[]>([]);
  const [bandwidthSettings, setBandwidthSettings] = useState<BandwidthSettings>({
    globalThrottleKbps: null,
    defaultShareThrottleKbps: 1024,
    maxConcurrentTransfers: 6,
    enforceUserQuotas: true,
    autoThrottlePeakHours: false,
  });
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfigState>({
    connected: false,
    mode: 'hybrid_fallback',
    chatId: '',
    maskedToken: '',
    chunkSizeBytes: 19 * 1024 * 1024,
    autoSyncUploads: true,
  });

  // Drive navigation & filtering
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('unlimcloud_search_history_v1');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 8)
        : [];
    } catch {
      return [];
    }
  });
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyOffline, setOnlyOffline] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderPin, setNewFolderPin] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showMobilePlusMenu, setShowMobilePlusMenu] = useState(false);
  const dragDepthRef = useRef<number>(0);

  // User-Configurable Notification Preferences & Offline Local Storage State
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(() =>
    getNotificationPreferences()
  );
  const notificationPrefsRef = useRef<NotificationPreferences>(notificationPrefs);
  useEffect(() => {
    notificationPrefsRef.current = notificationPrefs;
  }, [notificationPrefs]);

  const [offlineFilesMap, setOfflineFilesMap] = useState<Record<string, OfflineSavedFileMeta>>(() =>
    getOfflineSavedFilesMap()
  );
  const [savingOfflineFileId, setSavingOfflineFileId] = useState<string | null>(null);
  const [offlineProgressPct, setOfflineProgressPct] = useState<number>(0);

  useEffect(() => {
    const syncOffline = () => setOfflineFilesMap(getOfflineSavedFilesMap());
    window.addEventListener('unlim:offline-files-changed', syncOffline);
    return () => window.removeEventListener('unlim:offline-files-changed', syncOffline);
  }, []);

  // Explorer Grid / List layout toggle (persisted in localStorage)
  const [explorerLayout, setExplorerLayout] = useState<'grid' | 'list'>(() => {
    try {
      return localStorage.getItem('tgdrive_explorer_layout_v1') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });

  // Folder PIN Lock session state
  const [unlockedFolderIds, setUnlockedFolderIds] = useState<string[]>([]);
  const [folderPinModalState, setFolderPinModalState] = useState<FolderPinModalState | null>(null);

  // Batch ZIP download progress state
  const [zipDownloading, setZipDownloading] = useState(false);
  const [zipProgressPct, setZipProgressPct] = useState(0);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Live File Upload Progress Bar & Post-Upload Processing State
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadPaused, setUploadPaused] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    percent: number;
    loadedBytes: number;
    totalBytes: number;
    speedBps: number;
  } | null>(null);
  const [postUploadProcessing, setPostUploadProcessing] = useState<{
    fileName: string;
  } | null>(null);

  // Modals & Drag-and-Drop Move/Copy State
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [shareModalFile, setShareModalFile] = useState<FileRecord | null>(null);
  const [shareModalFolder, setShareModalFolder] = useState<FolderRecord | null>(null);
  const [inspectedFile, setInspectedFile] = useState<FileRecord | null>(null);
  const [moveModalFile, setMoveModalFile] = useState<FileRecord | null>(null);
  const [batchMoveFiles, setBatchMoveFiles] = useState<FileRecord[] | null>(null);
  const [moveModalMode, setMoveModalMode] = useState<'move' | 'copy'>('move');
  const [tagModalFiles, setTagModalFiles] = useState<FileRecord[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [showBuyTokensModal, setShowBuyTokensModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  // Real-time notifications & Upload AbortController + Pause/Resume Controller
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const uploadChunkAbortControllerRef = useRef<AbortController | null>(null);
  const uploadPausedRef = useRef<boolean>(false);
  const uploadResumeResolverRef = useRef<((outcome: 'resumed' | 'cancelled') => void) | null>(null);

  const authHeaders = useCallback(
    (extra: Record<string, string> = {}) => {
      const headers: Record<string, string> = {
        ...extra,
      };
      if (firebaseUser) {
        headers['X-Firebase-Uid'] = firebaseUser.uid;
        if (firebaseUser.email) headers['X-Firebase-Email'] = firebaseUser.email;
        if (firebaseUser.displayName) headers['X-Firebase-Name'] = firebaseUser.displayName;
      }
      return headers;
    },
    [firebaseUser]
  );

  const pushNotification = useCallback((notif: RealtimeNotification) => {
    const decision = shouldNotifyForEvent(notif, notificationPrefsRef.current);
    if (decision.playSound) {
      playTransferCompletionChime();
    }
    if (decision.sendPush) {
      triggerBrowserPushNotification(notif.title, notif.message);
    }
    if (!decision.showToast) return;

    setNotifications((prev) => {
      if (prev.some((n) => n.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 3);
    });
  }, []);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          await ensureFirestoreUserProfile(fbUser);
          setFirebaseUser(fbUser);
          setAuthLoading(false);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('REGISTRATION_CLOSED')) {
            await signOutFirebaseUser().catch(() => null);
            setFirebaseUser(null);
            setCurrentUser(null);
            setAuthGateError(
              'New account registration is currently closed. Only existing registered accounts can sign in.'
            );
            setAuthLoading(false);
            return;
          }
          setFirebaseUser(fbUser);
          setAuthLoading(false);
        }
      } else {
        setFirebaseUser(null);
        setAuthLoading(false);
        setCurrentUser(null);
        setFolders([]);
        setFiles([]);
        setShares([]);
        setTransfers([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const isAdminEmail = firebaseUser.email?.toLowerCase() === 'titumamma2425@gmail.com';

      // 1. Pull permanent cross-device drive metadata & global Telegram node config from Firestore
      try {
        const [cloudDrive, nodeConfig] = await Promise.all([
          fetchUserCloudDriveFromFirestore(firebaseUser),
          fetchStorageNodeConfigFromFirestore(),
        ]);

        const { unsyncedLocalFiles, unsyncedLocalFolders, unsyncedLocalShares } =
          await syncClientDbWithFirestoreDrive({
            uid: firebaseUser.uid,
            email: firebaseUser.email || undefined,
            name: firebaseUser.displayName || undefined,
            headers: authHeaders(),
            profile: cloudDrive.profile,
            cloudFiles: cloudDrive.files,
            cloudFolders: cloudDrive.folders,
            cloudShares: cloudDrive.shares,
            storageNodeConfig: nodeConfig,
          });

        for (const f of unsyncedLocalFiles) {
          await syncCloudFileToFirestore(f).catch(() => null);
        }
        for (const fl of unsyncedLocalFolders) {
          await syncCloudFolderToFirestore(fl).catch(() => null);
        }
        for (const sh of unsyncedLocalShares) {
          const linkedFile =
            cloudDrive.files.find((cf) => cf.id === sh.fileId) ||
            unsyncedLocalFiles.find((uf) => uf.id === sh.fileId);
          await syncPublicShareToFirestore({
            share: sh,
            file: linkedFile || null,
            passwordHash: sh.passwordHash || null,
          }).catch(() => null);
        }

        // Restore persisted MTProto 2 GB session on backend if admin
        if (
          isAdminEmail &&
          nodeConfig?.mtprotoSession &&
          nodeConfig?.apiId &&
          nodeConfig?.apiHash
        ) {
          await apiFetch('/api/telegram/config', {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              authMode: 'mtproto',
              mtprotoSession: nodeConfig.mtprotoSession,
              apiId: nodeConfig.apiId,
              apiHash: nodeConfig.apiHash,
              phoneNumber: nodeConfig.phoneNumber,
              accountName: nodeConfig.accountName,
              accountUsername: nodeConfig.accountUsername,
              chatId: nodeConfig.chatId || 'me',
            }),
          }).catch(() => null);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('REGISTRATION_CLOSED')) {
          await signOutFirebaseUser().catch(() => null);
          setFirebaseUser(null);
          setCurrentUser(null);
          setAuthGateError(
            'New account registration is currently closed. Only existing registered accounts can sign in.'
          );
          return;
        }
        // Proceed with local/server state if Firestore query fails
      }

      const [meRes, filesRes, sharesRes, bwRes, tgRes] = await Promise.all([
        apiFetch('/api/auth/me', { headers: authHeaders() }),
        apiFetch('/api/files', { headers: authHeaders() }),
        apiFetch('/api/shares', { headers: authHeaders() }),
        apiFetch('/api/bandwidth', { headers: authHeaders() }),
        isAdminEmail
          ? apiFetch('/api/telegram/config', { headers: authHeaders() })
          : Promise.resolve(null),
      ]);

      let loadedUser: User | null = null;
      let loadedFiles: FileRecord[] = [];
      let loadedShares: ShareLink[] = [];

      if (meRes.ok) {
        const meData = await meRes.json();
        loadedUser = meData.user || null;
        setCurrentUser(meData.user);
      }
      if (filesRes.ok) {
        const fData = await filesRes.json();
        loadedFiles = fData.files || [];
        setFolders(fData.folders || []);
        setFiles(loadedFiles);
        setTransfers(fData.transfers || []);
      }
      if (sharesRes.ok) {
        const sData = await sharesRes.json();
        loadedShares = sData.shares || [];
        setShares(loadedShares);
      }

      // Ensure all files with Telegram chunks and all shares are synced to Firestore for cross-device public access
      for (const f of loadedFiles) {
        if (f.ownerId === firebaseUser.uid && f.telegramChunks && f.telegramChunks.length > 0) {
          syncCloudFileToFirestore(f).catch(() => null);
        }
      }
      for (const s of loadedShares) {
        if (s.creatorId === firebaseUser.uid) {
          const matchingFile = loadedFiles.find((f) => f.id === s.fileId && !f.trashed);
          if (matchingFile) {
            syncPublicShareToFirestore({
              share: s,
              file: matchingFile,
            }).catch(() => null);
          }
        }
      }

      if (bwRes.ok) {
        const bData = await bwRes.json();
        setBandwidthSettings(bData.settings);
      }
      if (tgRes && tgRes.ok) {
        const tData = await tgRes.json();
        setTelegramConfig(tData.config);
      }
    } catch (err) {
      console.error('Error loading workspace data:', err);
    }
  }, [authHeaders, firebaseUser]);

  useEffect(() => {
    if (firebaseUser) {
      loadWorkspaceData();
    }
  }, [firebaseUser, loadWorkspaceData]);

  // Real-time Firestore cross-device sync for files, folders, and shares (instant deletion & additions across devices)
  useEffect(() => {
    if (!firebaseUser) return;

    const unsubscribe = subscribeToUserCloudDrive(firebaseUser, {
      onFilesSnapshot: async (cloudFiles, removedFileIds) => {
        const reconciled = await applyCloudDriveRealtimeSnapshot({
          uid: firebaseUser.uid,
          headers: authHeaders(),
          cloudFiles,
          removedFileIds,
        });
        setFiles(reconciled.files);
        setShares(reconciled.shares);
        if (reconciled.user) {
          setCurrentUser(reconciled.user);
        }
        if (removedFileIds.length > 0) {
          const removedSet = new Set(removedFileIds);
          setInspectedFile((prev) => (prev && removedSet.has(prev.id) ? null : prev));
          setShareModalFile((prev) => (prev && removedSet.has(prev.id) ? null : prev));
          setMoveModalFile((prev) => (prev && removedSet.has(prev.id) ? null : prev));
        }
      },
      onFoldersSnapshot: async (cloudFolders, removedFolderIds) => {
        const reconciled = await applyCloudDriveRealtimeSnapshot({
          uid: firebaseUser.uid,
          headers: authHeaders(),
          cloudFolders,
          removedFolderIds,
        });
        setFolders(reconciled.folders);
        if (removedFolderIds.length > 0) {
          const removedFolderSet = new Set(removedFolderIds);
          setCurrentFolderId((prev) => (prev && removedFolderSet.has(prev) ? null : prev));
        }
      },
      onSharesSnapshot: async (cloudShares, removedShareTokens) => {
        const reconciled = await applyCloudDriveRealtimeSnapshot({
          uid: firebaseUser.uid,
          headers: authHeaders(),
          cloudShares,
          removedShareTokens,
        });
        setShares(reconciled.shares);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [firebaseUser, authHeaders]);

  // Real-time WebSocket updates for transfers & notifications
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.event === 'transfer:progress' && msg.payload) {
              const job = msg.payload as TransferJob;
              setTransfers((prev) => {
                const idx = prev.findIndex((t) => t.id === job.id);
                if (idx === -1) return [job, ...prev];
                const copy = [...prev];
                copy[idx] = job;
                return copy;
              });
            } else if (msg.event === 'transfer:completed' && msg.payload) {
              const { job, file, notification } = msg.payload as {
                job?: TransferJob;
                file?: FileRecord;
                notification?: RealtimeNotification;
              };
              if (job) {
                setTransfers((prev) => {
                  const idx = prev.findIndex((t) => t.id === job.id);
                  if (idx === -1) return [job, ...prev];
                  const copy = [...prev];
                  copy[idx] = job;
                  return copy;
                });
              }
              if (file) {
                setFiles((prev) => {
                  const idx = prev.findIndex((f) => f.id === file.id);
                  if (idx === -1) return [file, ...prev];
                  const copy = [...prev];
                  copy[idx] = file;
                  return copy;
                });
              }
              if (notification) {
                pushNotification(notification);
              }
            } else if (msg.event === 'transfer:failed' && msg.payload) {
              const { job, notification } = msg.payload as {
                job?: TransferJob;
                notification?: RealtimeNotification;
              };
              if (job) {
                setTransfers((prev) => {
                  const idx = prev.findIndex((t) => t.id === job.id);
                  if (idx === -1) return [job, ...prev];
                  const copy = [...prev];
                  copy[idx] = job;
                  return copy;
                });
              }
              if (notification) {
                pushNotification(notification);
              }
            } else if (msg.event === 'file:updated' && msg.payload) {
              const updatedFile = (msg.payload.file || msg.payload) as FileRecord;
              if (!updatedFile || !updatedFile.id) return;
              setFiles((prev) => {
                const idx = prev.findIndex((f) => f.id === updatedFile.id);
                if (idx === -1) return prev;
                const copy = [...prev];
                copy[idx] = updatedFile;
                return copy;
              });
              syncCloudFileToFirestore(updatedFile).catch(() => null);
              setShares((prevShares) => {
                for (const s of prevShares) {
                  if (s.fileId === updatedFile.id) {
                    syncPublicShareToFirestore({
                      share: s,
                      file: updatedFile,
                    }).catch(() => null);
                  }
                }
                return prevShares;
              });
            }
          } catch {
            // ignore
          }
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch {
        // ignore on static hosts
      }
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [pushNotification]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleGoogleSignIn = async () => {
    setSigningInGoogle(true);
    setAuthGateError(null);
    try {
      const fbUser = await signInWithGooglePopup();
      try {
        await ensureFirestoreUserProfile(fbUser);
      } catch (profileErr: unknown) {
        const pMsg = profileErr instanceof Error ? profileErr.message : '';
        if (pMsg.includes('REGISTRATION_CLOSED')) {
          await signOutFirebaseUser().catch(() => null);
          setFirebaseUser(null);
          setCurrentUser(null);
          const closedMsg =
            'New account registration is currently closed. Only existing registered accounts can sign in.';
          setAuthGateError(closedMsg);
          throw new Error(closedMsg);
        }
      }
      setFirebaseUser(fbUser);
      const isAdmin = fbUser.email?.toLowerCase() === 'titumamma2425@gmail.com';
      pushNotification({
        id: `auth_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Signed In with Google',
        message: isAdmin
          ? `Welcome back, ${fbUser.displayName || fbUser.email}! Your Unlimited Admin cloud drive is ready.`
          : `Welcome back, ${fbUser.displayName || fbUser.email}! Your private cloud drive is ready.`,
        type: 'completed',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed';
      setAuthGateError(msg);
      throw err;
    } finally {
      setSigningInGoogle(false);
    }
  };

  const handleSignOut = async () => {
    await signOutFirebaseUser().catch(() => null);
    setFirebaseUser(null);
    setCurrentUser(null);
    setFolders([]);
    setFiles([]);
    setShares([]);
    setTransfers([]);
    setActiveView('explorer');
  };

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    const totalBatchBytes = arr.reduce((acc, f) => acc + f.size, 0);
    const label =
      arr.length === 1 ? arr[0].name : `${arr.length} files (${arr[0].name}...)`;

    const abortController = new AbortController();
    uploadAbortControllerRef.current = abortController;
    const chunkAbortController = new AbortController();
    uploadChunkAbortControllerRef.current = chunkAbortController;
    uploadPausedRef.current = false;
    setUploadPaused(false);

    setUploadingFiles(true);
    setPostUploadProcessing(null);
    setUploadProgress({
      fileName: label,
      percent: 0,
      loadedBytes: 0,
      totalBytes: totalBatchBytes,
      speedBps: 0,
    });

    try {
      const result = await uploadFilesWithProgress({
        files: arr,
        folderId: currentFolderId,
        headers: authHeaders(),
        signal: abortController.signal,
        pauseController: {
          isPaused: () => uploadPausedRef.current,
          getChunkAbortSignal: () => uploadChunkAbortControllerRef.current?.signal,
          waitForResumeOrCancel: () =>
            new Promise<'resumed' | 'cancelled'>((resolve) => {
              uploadResumeResolverRef.current = resolve;
            }),
        },
        onProgress: (info) => {
          setUploadProgress({
            fileName: label,
            percent: info.percent,
            loadedBytes: info.loadedBytes,
            totalBytes: info.totalBytes,
            speedBps: info.speedBps,
          });
        },
        onProcessingStart: () => {
          setUploadProgress(null);
          setPostUploadProcessing({ fileName: label });
        },
      });

      if (result.cancelled || abortController.signal.aborted) {
        setPostUploadProcessing(null);
        pushNotification({
          id: `cancel_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Upload Cancelled',
          message: `Upload of "${label}" was cancelled.`,
          type: 'info',
        });
        return;
      }

      if (!result.ok) {
        setPostUploadProcessing(null);
        pushNotification({
          id: `err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Upload Blocked',
          message: result.data?.error || 'Failed to upload files',
          type: 'error',
        });
        return;
      }

      // Ensure the clean Processing screen shows smoothly before revealing the finalized file
      setPostUploadProcessing({ fileName: label });

      if (result.data?.user) setCurrentUser(result.data.user);
      if (Array.isArray(result.data?.files)) {
        const uploadedList = result.data.files as FileRecord[];
        setFiles((prev) => {
          const existingIds = new Set(uploadedList.map((u) => u.id));
          return [...uploadedList, ...prev.filter((f) => !existingIds.has(f.id))];
        });
        for (const uploaded of uploadedList) {
          syncCloudFileToFirestore(uploaded).catch(() => null);
        }
      }

      await new Promise((r) => setTimeout(r, 180));
      setPostUploadProcessing(null);

      // Refresh workspace data asynchronously in the background without blocking UI
      loadWorkspaceData().catch(() => null);
    } finally {
      uploadAbortControllerRef.current = null;
      uploadChunkAbortControllerRef.current = null;
      uploadPausedRef.current = false;
      uploadResumeResolverRef.current = null;
      setUploadPaused(false);
      setUploadingFiles(false);
      setUploadProgress(null);
      setPostUploadProcessing(null);
    }
  };

  const handleTogglePauseUpload = () => {
    if (!uploadingFiles) return;
    if (!uploadPausedRef.current) {
      // Pause immediately (abort current in-flight chunk XHR so it pauses right away and resumes from chunk offset)
      uploadPausedRef.current = true;
      setUploadPaused(true);
      if (uploadChunkAbortControllerRef.current) {
        uploadChunkAbortControllerRef.current.abort();
      }
      setUploadProgress((prev) => (prev ? { ...prev, speedBps: 0 } : prev));
    } else {
      // Resume upload from last completed chunk offset
      uploadPausedRef.current = false;
      setUploadPaused(false);
      uploadChunkAbortControllerRef.current = new AbortController();
      if (uploadResumeResolverRef.current) {
        const resolve = uploadResumeResolverRef.current;
        uploadResumeResolverRef.current = null;
        resolve('resumed');
      }
    }
  };

  const handleCancelUpload = () => {
    uploadPausedRef.current = false;
    setUploadPaused(false);
    if (uploadResumeResolverRef.current) {
      const resolve = uploadResumeResolverRef.current;
      uploadResumeResolverRef.current = null;
      resolve('cancelled');
    }
    if (uploadChunkAbortControllerRef.current) {
      uploadChunkAbortControllerRef.current.abort();
      uploadChunkAbortControllerRef.current = null;
    }
    if (uploadAbortControllerRef.current) {
      uploadAbortControllerRef.current.abort();
      uploadAbortControllerRef.current = null;
    }
    setUploadingFiles(false);
    setUploadProgress(null);
    setPostUploadProcessing(null);
  };

  const handleCancelRemoteTransfer = async (jobId: string) => {
    await apiFetch(`/api/transfers/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => null);
    setTransfers((prev) =>
      prev.map((t) =>
        t.id === jobId ? { ...t, status: 'failed', errorMessage: 'Cancelled by user' } : t
      )
    );
    pushNotification({
      id: `cancel_rm_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Remote Transfer Cancelled',
      message: 'The active transfer was stopped.',
      type: 'info',
    });
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    let pinHash: string | null = null;
    if (newFolderPin.trim()) {
      if (!/^\d{4,8}$/.test(newFolderPin.trim())) {
        pushNotification({
          id: `pin_err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Invalid Folder PIN',
          message: 'Optional Folder PIN must be 4 to 8 numeric digits.',
          type: 'error',
        });
        return;
      }
      pinHash = await hashFolderPin(newFolderPin.trim());
    }
    const res = await apiFetch('/api/folders', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: newFolderName.trim(),
        parentId: currentFolderId,
        pinHash,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setFolders((prev) => [...prev, data.folder]);
      if (pinHash && data.folder?.id) {
        setUnlockedFolderIds((prev) => Array.from(new Set([...prev, data.folder.id])));
      }
      syncCloudFolderToFirestore(data.folder).catch(() => null);
      setNewFolderName('');
      setNewFolderPin('');
      setCreatingFolder(false);
    }
  };

  const handleOpenFolder = (folder: FolderRecord) => {
    if (folder.isPinProtected && folder.pinHash && !unlockedFolderIds.includes(folder.id)) {
      setFolderPinModalState({ folder, mode: 'unlock' });
      return;
    }
    setCurrentFolderId(folder.id);
  };

  const handleSaveFolderPin = async (folder: FolderRecord, newPin: string | null) => {
    const pinHash = newPin ? await hashFolderPin(newPin) : null;
    const res = await apiFetch(`/api/folders/${encodeURIComponent(folder.id)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        pinHash,
        isPinProtected: Boolean(pinHash),
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to update folder PIN');
    }
    const data = await res.json();
    const updatedFolder: FolderRecord = data.folder || {
      ...folder,
      pinHash,
      isPinProtected: Boolean(pinHash),
    };
    setFolders((prev) => prev.map((fl) => (fl.id === folder.id ? updatedFolder : fl)));
    if (pinHash) {
      setUnlockedFolderIds((prev) => Array.from(new Set([...prev, folder.id])));
    } else {
      setUnlockedFolderIds((prev) => prev.filter((id) => id !== folder.id));
    }
    syncCloudFolderToFirestore(updatedFolder).catch(() => null);
    pushNotification({
      id: `pin_save_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: pinHash ? 'Folder PIN Lock Enabled' : 'Folder PIN Lock Removed',
      message: pinHash
        ? `"${folder.name}" is now protected with a PIN code.`
        : `PIN lock removed from "${folder.name}".`,
      type: 'completed',
    });
  };

  const handleCreateFolderFromModal = async (
    name: string,
    parentId: string | null
  ): Promise<FolderRecord | null> => {
    const res = await apiFetch('/api/folders', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, parentId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setFolders((prev) => [...prev, data.folder]);
    syncCloudFolderToFirestore(data.folder).catch(() => null);
    return data.folder;
  };

  const handleMoveFile = async (file: FileRecord, targetFolderId: string | null) => {
    if (file.folderId === targetFolderId) return;
    const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ folderId: targetFolderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to move file');
    }
    const updatedFile: FileRecord = data.file || {
      ...file,
      folderId: targetFolderId,
      updatedAt: new Date().toISOString(),
    };
    setFiles((prev) => prev.map((f) => (f.id === file.id ? updatedFile : f)));
    syncCloudFileToFirestore(updatedFile, true).catch(() => null);
    const destName =
      targetFolderId === null
        ? 'My Cloud Drive (Root)'
        : folders.find((fl) => fl.id === targetFolderId)?.name || 'Folder';
    pushNotification({
      id: `move_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'File Moved',
      message: `Moved "${file.name}" to ${destName}.`,
      type: 'completed',
    });
  };

  const handleBatchMoveFiles = async (
    targetFilesList: FileRecord[],
    targetFolderId: string | null
  ) => {
    const movable = targetFilesList.filter((f) => f.folderId !== targetFolderId);
    if (movable.length === 0) return;

    const updatedMap = new Map<string, FileRecord>();
    for (const file of movable) {
      const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      const data = await res.json().catch(() => ({}));
      const updatedFile: FileRecord = data.file || {
        ...file,
        folderId: targetFolderId,
        updatedAt: new Date().toISOString(),
      };
      updatedMap.set(file.id, updatedFile);
      syncCloudFileToFirestore(updatedFile, true).catch(() => null);
    }

    setFiles((prev) => prev.map((f) => updatedMap.get(f.id) || f));
    setSelectedFileIds([]);

    const destName =
      targetFolderId === null
        ? 'My Cloud Drive (Root)'
        : folders.find((fl) => fl.id === targetFolderId)?.name || 'Folder';
    pushNotification({
      id: `batch_move_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Batch Move Complete',
      message: `Moved ${movable.length} ${
        movable.length === 1 ? 'file' : 'files'
      } to ${destName}.`,
      type: 'completed',
    });
  };

  const handleCopyFiles = async (
    targetFilesList: FileRecord[],
    targetFolderId: string | null
  ) => {
    if (targetFilesList.length === 0) return;
    const res = await apiFetch('/api/files/copy', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fileIds: targetFilesList.map((f) => f.id),
        targetFolderId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not copy files');
    }
    const copiedList: FileRecord[] = Array.isArray(data.files) ? data.files : [];
    if (copiedList.length > 0) {
      setFiles((prev) => [...copiedList, ...prev]);
      for (const cf of copiedList) {
        syncCloudFileToFirestore(cf, true).catch(() => null);
      }
    }
    setSelectedFileIds([]);
    const destName =
      targetFolderId === null
        ? 'My Cloud Drive (Root)'
        : folders.find((fl) => fl.id === targetFolderId)?.name || 'Folder';
    pushNotification({
      id: `copy_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'File Copy Created',
      message: `Copied ${copiedList.length || targetFilesList.length} ${
        targetFilesList.length === 1 ? 'file' : 'files'
      } to ${destName}.`,
      type: 'completed',
    });
  };

  const handleCopySharedToMyDrive = async (payload: {
    token: string;
    targetFolderId: string | null;
    fileIds?: string[];
    password?: string;
  }): Promise<number> => {
    const res = await apiFetch(
      `/api/public/share/${encodeURIComponent(payload.token)}/copy`,
      {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          targetFolderId: payload.targetFolderId,
          fileIds: payload.fileIds,
          password: payload.password,
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not save shared file to your drive');
    }
    const copiedList: FileRecord[] = Array.isArray(data.files) ? data.files : [];
    if (copiedList.length > 0) {
      setFiles((prev) => [...copiedList, ...prev]);
      for (const cf of copiedList) {
        syncCloudFileToFirestore(cf, true).catch(() => null);
      }
    }
    return copiedList.length;
  };

  const handleToggleOfflineFile = async (file: FileRecord) => {
    if (savingOfflineFileId) return;
    if (offlineFilesMap[file.id]) {
      await removeFileFromOffline(file.id);
      setOfflineFilesMap(getOfflineSavedFilesMap());
      pushNotification({
        id: `offline_rm_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Removed from Offline Storage',
        message: `"${file.name}" was removed from local offline storage.`,
        type: 'info',
      });
      return;
    }

    setSavingOfflineFileId(file.id);
    setOfflineProgressPct(5);
    try {
      await saveFileOfflineToDevice(file, authHeaders(), (pct) => {
        setOfflineProgressPct(pct);
      });
      setOfflineFilesMap(getOfflineSavedFilesMap());
      pushNotification({
        id: `offline_save_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Saved Offline on Device',
        message: `"${file.name}" (${formatBytes(
          file.sizeBytes
        )}) is now saved in your device's local storage for offline use.`,
        type: 'completed',
        bytes: file.sizeBytes,
      });
    } catch (err: unknown) {
      pushNotification({
        id: `offline_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Could Not Save Offline',
        message:
          err instanceof Error
            ? err.message
            : 'Failed to store file in local device storage.',
        type: 'error',
      });
    } finally {
      setSavingOfflineFileId(null);
      setOfflineProgressPct(0);
    }
  };

  const handleSaveFileTags = async (
    targetFilesList: FileRecord[],
    updatedTags: string[]
  ) => {
    const cleanTags = Array.from(
      new Set(
        updatedTags
          .map((t) => t.trim().slice(0, 32))
          .filter(Boolean)
      )
    ).slice(0, 12);

    const updatedMap = new Map<string, FileRecord>();
    for (const file of targetFilesList) {
      const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tags: cleanTags }),
      });
      const data = await res.json().catch(() => ({}));
      const updatedFile: FileRecord = data.file || {
        ...file,
        tags: cleanTags,
        updatedAt: new Date().toISOString(),
      };
      updatedMap.set(file.id, updatedFile);
      syncCloudFileToFirestore(updatedFile, true).catch(() => null);
    }

    setFiles((prev) => prev.map((f) => updatedMap.get(f.id) || f));
    pushNotification({
      id: `tags_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'File Labels Saved',
      message:
        targetFilesList.length > 1
          ? `Updated labels on ${targetFilesList.length} files.`
          : `Updated labels for "${targetFilesList[0]?.name || 'file'}".`,
      type: 'completed',
    });
  };

  const handleQuickRemoveTag = async (file: FileRecord, tagToRemove: string) => {
    const nextTags = (file.tags || []).filter(
      (t) => t.toLowerCase() !== tagToRemove.toLowerCase()
    );
    await handleSaveFileTags([file], nextTags);
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const handleRestoreFile = async (file: FileRecord) => {
    const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ trashed: false, trashedAt: null }),
    });
    if (res.ok) {
      const data = await res.json();
      const restored: FileRecord = data.file || { ...file, trashed: false, trashedAt: null };
      setFiles((prev) => prev.map((f) => (f.id === file.id ? restored : f)));
      syncCloudFileToFirestore(restored, true).catch(() => null);
      pushNotification({
        id: `restore_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'File Restored',
        message: `"${file.name}" was restored to My Files.`,
        type: 'completed',
      });
    }
  };

  const handleRestoreFolder = async (folder: FolderRecord) => {
    const res = await apiFetch(`/api/folders/${encodeURIComponent(folder.id)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ trashed: false, trashedAt: null }),
    });
    if (res.ok) {
      const data = await res.json();
      const restoredFolder: FolderRecord = data.folder || {
        ...folder,
        trashed: false,
        trashedAt: null,
      };
      setFolders((prev) => prev.map((fl) => (fl.id === folder.id ? restoredFolder : fl)));
      syncCloudFolderToFirestore(restoredFolder).catch(() => null);
      if (Array.isArray(data.files)) {
        setFiles(data.files);
        for (const f of data.files as FileRecord[]) {
          if (f.folderId === folder.id) {
            syncCloudFileToFirestore(f, true).catch(() => null);
          }
        }
      } else {
        setFiles((prev) =>
          prev.map((f) =>
            f.folderId === folder.id ? { ...f, trashed: false, trashedAt: null } : f
          )
        );
      }
      pushNotification({
        id: `restore_fld_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Folder Restored',
        message: `"${folder.name}" and its files were restored to My Files.`,
        type: 'completed',
      });
    }
  };

  const executeDeleteTarget = async () => {
    if (!deleteTarget) return;
    const isPermanent = Boolean(deleteTarget.permanent || deleteTarget.type === 'empty-trash');

    if (deleteTarget.type === 'empty-trash') {
      const trashedFileList = files.filter((f) => f.trashed);
      const trashedFolderList = folders.filter((fl) => fl.trashed);
      for (const tf of trashedFileList) {
        await deleteCloudFileFromFirestore(tf.id).catch(() => null);
      }
      for (const tfl of trashedFolderList) {
        await deleteCloudFolderFromFirestore(tfl.id).catch(() => null);
      }
      const res = await apiFetch('/api/trash/empty', {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.user) setCurrentUser(data.user);
        setFiles((prev) => prev.filter((f) => !f.trashed));
        setFolders((prev) => prev.filter((fl) => !fl.trashed));
        pushNotification({
          id: `empty_trash_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Trash Bin Emptied',
          message: 'All trashed items were permanently erased across all devices.',
          type: 'info',
        });
      }
      return;
    }

    if (deleteTarget.type === 'folder') {
      const folderId = deleteTarget.id;
      const folderName = deleteTarget.name;
      if (!isPermanent) {
        const trashedAt = new Date().toISOString();
        const res = await apiFetch(`/api/folders/${encodeURIComponent(folderId)}`, {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ trashed: true, trashedAt }),
        });
        if (res.ok) {
          const data = await res.json();
          if (currentFolderId === folderId) setCurrentFolderId(null);
          const updatedFolder: FolderRecord = data.folder || {
            ...(folders.find((fl) => fl.id === folderId) as FolderRecord),
            trashed: true,
            trashedAt,
          };
          setFolders((prev) => prev.map((fl) => (fl.id === folderId ? updatedFolder : fl)));
          syncCloudFolderToFirestore(updatedFolder).catch(() => null);
          if (Array.isArray(data.files)) {
            setFiles(data.files);
            for (const f of data.files as FileRecord[]) {
              if (f.folderId === folderId) {
                syncCloudFileToFirestore(f, true).catch(() => null);
              }
            }
          } else {
            setFiles((prev) =>
              prev.map((f) => (f.folderId === folderId ? { ...f, trashed: true, trashedAt } : f))
            );
          }
          pushNotification({
            id: `trash_fld_${Date.now()}`,
            timestamp: new Date().toISOString(),
            title: 'Folder Moved to Trash Bin',
            message: `"${folderName}" was moved to Trash. Restore it anytime from the Trash Bin tab.`,
            type: 'info',
          });
        }
        return;
      }

      await deleteCloudFolderFromFirestore(folderId).catch(() => null);
      const res = await apiFetch(`/api/folders/${encodeURIComponent(folderId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        if (currentFolderId === folderId) setCurrentFolderId(null);
        setFolders((prev) => prev.filter((fl) => fl.id !== folderId));
        setFiles((prev) =>
          prev.map((f) => (f.folderId === folderId ? { ...f, folderId: null } : f))
        );
        pushNotification({
          id: `del_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Folder Permanently Deleted',
          message: `"${folderName}" was permanently removed across all devices.`,
          type: 'info',
        });
      }
    } else if (deleteTarget.type === 'batch-files') {
      const batchIds =
        deleteTarget.fileIds && deleteTarget.fileIds.length > 0
          ? deleteTarget.fileIds
          : selectedFileIds;
      const idSet = new Set(batchIds);

      if (!isPermanent) {
        const trashedAt = new Date().toISOString();
        const updatedMap = new Map<string, FileRecord>();
        for (const fid of batchIds) {
          const res = await apiFetch(`/api/files/${encodeURIComponent(fid)}`, {
            method: 'PATCH',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ trashed: true, trashedAt }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            if (data.file) {
              updatedMap.set(fid, data.file);
              syncCloudFileToFirestore(data.file, true).catch(() => null);
            }
          }
        }
        setFiles((prev) =>
          prev.map((f) =>
            idSet.has(f.id) ? updatedMap.get(f.id) || { ...f, trashed: true, trashedAt } : f
          )
        );
        setSelectedFileIds((prev) => prev.filter((id) => !idSet.has(id)));
        if (inspectedFile && idSet.has(inspectedFile.id)) setInspectedFile(null);
        if (shareModalFile && idSet.has(shareModalFile.id)) setShareModalFile(null);
        if (moveModalFile && idSet.has(moveModalFile.id)) setMoveModalFile(null);
        pushNotification({
          id: `batch_trash_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Moved to Trash Bin',
          message: `${batchIds.length} ${
            batchIds.length === 1 ? 'file was' : 'files were'
          } moved to the Trash Bin.`,
          type: 'info',
        });
        return;
      }

      const relatedShares = shares.filter((s) => idSet.has(s.fileId));
      for (const fid of batchIds) {
        await deleteCloudFileFromFirestore(fid).catch(() => null);
      }
      for (const sh of relatedShares) {
        deletePublicShareFromFirestore(sh.token).catch(() => null);
      }

      let latestUser: User | null = null;
      for (const fid of batchIds) {
        const res = await apiFetch(`/api/files/${encodeURIComponent(fid)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.user) latestUser = data.user;
        }
      }
      if (latestUser) setCurrentUser(latestUser);
      setFiles((prev) => prev.filter((f) => !idSet.has(f.id)));
      setShares((prev) => prev.filter((s) => !idSet.has(s.fileId)));
      setSelectedFileIds((prev) => prev.filter((id) => !idSet.has(id)));
      if (inspectedFile && idSet.has(inspectedFile.id)) setInspectedFile(null);
      if (shareModalFile && idSet.has(shareModalFile.id)) setShareModalFile(null);
      if (moveModalFile && idSet.has(moveModalFile.id)) setMoveModalFile(null);

      pushNotification({
        id: `batch_del_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Batch Delete Complete',
        message: `${batchIds.length} ${
          batchIds.length === 1 ? 'file was' : 'files were'
        } permanently deleted across all devices.`,
        type: 'info',
      });
    } else {
      const fileId = deleteTarget.id;
      const fileName = deleteTarget.name;

      if (!isPermanent) {
        const trashedAt = new Date().toISOString();
        const res = await apiFetch(`/api/files/${encodeURIComponent(fileId)}`, {
          method: 'PATCH',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ trashed: true, trashedAt }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const updatedFile: FileRecord = data.file || {
            ...(files.find((f) => f.id === fileId) as FileRecord),
            trashed: true,
            trashedAt,
          };
          setFiles((prev) => prev.map((f) => (f.id === fileId ? updatedFile : f)));
          setSelectedFileIds((prev) => prev.filter((id) => id !== fileId));
          if (inspectedFile?.id === fileId) setInspectedFile(null);
          if (shareModalFile?.id === fileId) setShareModalFile(null);
          if (moveModalFile?.id === fileId) setMoveModalFile(null);
          syncCloudFileToFirestore(updatedFile, true).catch(() => null);
          pushNotification({
            id: `trash_${Date.now()}`,
            timestamp: new Date().toISOString(),
            title: 'Moved to Trash Bin',
            message: `"${fileName}" was moved to the Trash Bin. You can restore it anytime.`,
            type: 'info',
          });
        }
        return;
      }

      const relatedShares = shares.filter((s) => s.fileId === fileId);
      await deleteCloudFileFromFirestore(fileId).catch(() => null);
      for (const sh of relatedShares) {
        deletePublicShareFromFirestore(sh.token).catch(() => null);
      }

      const res = await apiFetch(`/api/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) setCurrentUser(data.user);
        setFiles((prev) => prev.filter((f) => f.id !== fileId));
        setShares((prev) => prev.filter((s) => s.fileId !== fileId));
        setSelectedFileIds((prev) => prev.filter((id) => id !== fileId));
        if (inspectedFile?.id === fileId) setInspectedFile(null);
        if (shareModalFile?.id === fileId) setShareModalFile(null);
        if (moveModalFile?.id === fileId) setMoveModalFile(null);
        pushNotification({
          id: `del_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'File Permanently Deleted',
          message: `"${fileName}" was permanently deleted across all devices.`,
          type: 'info',
        });
      }
    }
  };

  const handleToggleStar = async (file: FileRecord) => {
    const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ starred: !file.starred }),
    });
    if (res.ok) {
      const data = await res.json();
      setFiles((prev) => prev.map((f) => (f.id === file.id ? data.file : f)));
      syncCloudFileToFirestore(data.file, true).catch(() => null);
    }
  };

  const handleDownloadFile = async (file: FileRecord) => {
    if (file.lockedOverQuota) {
      pushNotification({
        id: `lock_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'File Locked (Over 25 GB Free Limit)',
        message: 'Renew your 50 GB or 1 TB plan with Tokens to unlock this file.',
        type: 'warning',
      });
      setActiveView('pricing');
      return;
    }

    try {
      // 1. Check zero-copy client IndexedDB binary vault or Telegram chunk bridge first (supports 285MB+ MKV/videos)
      const cachedBinaryBlob = await getClientBinaryBlob(file.id, file);
      if (cachedBinaryBlob && cachedBinaryBlob.size > 64) {
        const blobUrl = URL.createObjectURL(cachedBinaryBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id ? { ...f, downloadCount: (f.downloadCount || 0) + 1 } : f
          )
        );
        return;
      }

      // 2. Otherwise stream full binary from server or fallback
      const url = `/api/files/${encodeURIComponent(file.id)}/download?uid=${encodeURIComponent(
        firebaseUser?.uid || ''
      )}&email=${encodeURIComponent(firebaseUser?.email || '')}`;
      const res = await apiFetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        pushNotification({
          id: `dl_err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Re-Upload Required for Full Binary',
          message:
            errData.error ||
            'Could not download full binary stream. If this file was uploaded before the large-file fix, please re-upload it once.',
          type: 'error',
        });
        return;
      }
      const blob = await res.blob();
      if (file.sizeBytes > 1024 && blob.size <= 64) {
        pushNotification({
          id: `dl_44b_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Legacy 44-Byte Placeholder Detected',
          message: `This "${file.name}" entry was created before the 5 GB binary vault fix. Please delete and re-upload "${file.name}" once to store the full ${formatBytes(
            file.sizeBytes
          )} binary.`,
          type: 'error',
        });
        return;
      }

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      loadWorkspaceData();
    } catch {
      // ignore
    }
  };

  const handleStartRemoteUpload = async (payload: {
    url: string;
    customFileName?: string;
    folderId: string | null;
    syncToTelegram: boolean;
  }) => {
    const res = await apiFetch('/api/transfers/remote', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start remote URL upload');
    }
    if (data.job) {
      setTransfers((prev) => [data.job, ...prev.filter((t) => t.id !== data.job.id)]);
    }
    await loadWorkspaceData();
  };

  const handleCreateShare = useCallback(
    async (payload: {
      fileId: string;
      folderId?: string;
      targetType?: 'file' | 'folder';
      customSlug?: string;
      password?: string;
      expiresInHours?: number | null;
      maxDownloads?: number | null;
      throttleKbps?: number | null;
      bandwidthCapMb?: number | null;
    }): Promise<ShareLink> => {
      const res = await apiFetch('/api/shares', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create share link');
      }
      const createdShare = data.share as ShareLink;
      setShares((prev) => [createdShare, ...prev.filter((s) => s.id !== createdShare.id)]);

      if (payload.targetType === 'folder' || payload.folderId) {
        await syncPublicShareToFirestore({
          share: createdShare,
          file: null,
        }).catch(() => null);
        return createdShare;
      }

      const targetFile =
        files.find((f) => f.id === payload.fileId) ||
        (shareModalFile?.id === payload.fileId ? shareModalFile : null);
      if (targetFile) {
        await syncPublicShareToFirestore({
          share: createdShare,
          file: targetFile,
        }).catch(() => null);

        if (
          targetFile.sizeBytes > 0 &&
          targetFile.sizeBytes <= 25 * 1024 * 1024 &&
          (!targetFile.telegramChunks || targetFile.telegramChunks.length === 0) &&
          !targetFile.telegramFileId
        ) {
          getClientBinaryBlob(targetFile.id)
            .then(async (localBlob) => {
              if (localBlob && localBlob.size > 64) {
                const chunkCount = await syncPublicShareBinaryChunksToFirestore(
                  targetFile.id,
                  localBlob
                );
                if (chunkCount > 0) {
                  await syncPublicShareToFirestore({
                    share: createdShare,
                    file: targetFile,
                    cloudChunkCount: chunkCount,
                  });
                }
              } else {
                const dlRes = await apiFetch(
                  `/api/files/${encodeURIComponent(targetFile.id)}/download`,
                  { headers: authHeaders() }
                );
                if (dlRes.ok) {
                  const serverBlob = await dlRes.blob();
                  if (serverBlob.size > 64) {
                    const chunkCount = await syncPublicShareBinaryChunksToFirestore(
                      targetFile.id,
                      serverBlob
                    );
                    if (chunkCount > 0) {
                      await syncPublicShareToFirestore({
                        share: createdShare,
                        file: targetFile,
                        cloudChunkCount: chunkCount,
                      });
                    }
                  }
                }
              }
            })
            .catch(() => null);
        }
      }

      return createdShare;
    },
    [authHeaders, files, shareModalFile]
  );

  const handleUpdateShare = useCallback(
    async (
      shareId: string,
      patch: {
        active?: boolean;
        throttleKbps?: number | null;
        password?: string | null;
      }
    ): Promise<ShareLink> => {
      const res = await apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update share settings');
      const updatedShare = data.share as ShareLink;
      setShares((prev) => prev.map((s) => (s.id === shareId ? updatedShare : s)));

      const targetFile = files.find((f) => f.id === updatedShare.fileId);
      if (targetFile) {
        await syncPublicShareToFirestore({
          share: updatedShare,
          file: targetFile,
        }).catch(() => null);
      }

      return updatedShare;
    },
    [authHeaders, files]
  );

  const handleToggleShareActive = async (share: ShareLink) => {
    await handleUpdateShare(share.id, { active: !share.active });
  };

  const handleUpdateShareThrottle = async (
    share: ShareLink,
    throttleKbps: number | null
  ) => {
    await handleUpdateShare(share.id, { throttleKbps });
  };

  const handleDeleteShare = async (shareId: string) => {
    const targetShare = shares.find((s) => s.id === shareId);
    const res = await apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      if (targetShare?.token) {
        await deletePublicShareFromFirestore(targetShare.token).catch(() => null);
      }
    }
  };

  const handleSaveTelegramConfig = async (payload: {
    authMode?: 'mtproto' | 'bot';
    botToken?: string;
    chatId?: string;
    autoSyncUploads?: boolean;
    clearCredentials?: boolean;
  }) => {
    const res = await apiFetch('/api/telegram/config', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update storage node configuration');
    }
    setTelegramConfig(data.config);
    await saveStorageNodeConfigToFirestore({
      authMode: payload.authMode || (data.config?.mtprotoConnected ? 'mtproto' : 'bot'),
      botToken: payload.clearCredentials
        ? ''
        : payload.authMode === 'mtproto'
        ? ''
        : payload.botToken,
      chatId: payload.clearCredentials ? '' : payload.chatId || data.config?.chatId,
      autoSyncUploads: payload.autoSyncUploads,
      clearCredentials: payload.clearCredentials,
    }).catch(() => null);
    pushNotification({
      id: `tg_cfg_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: payload.clearCredentials
        ? 'Telegram Node Disconnected'
        : payload.authMode === 'mtproto'
        ? 'Main Account Private Channel Updated'
        : 'Telegram Storage Node Connected',
      message: payload.clearCredentials
        ? 'Reverted to local disk storage fallback.'
        : `Permanent cross-device Telegram storage active (${data.config.chatId}).`,
      type: 'completed',
    });
  };

  const handleSendMtprotoCode = async (payload: {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    chatId?: string;
  }): Promise<{ phoneCodeHash: string; message?: string }> => {
    const res = await apiFetch('/api/telegram/mtproto/send-code', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send Telegram OTP code');
    }
    await saveStorageNodeConfigToFirestore({
      authMode: 'mtproto',
      apiId: String(payload.apiId),
      apiHash: payload.apiHash,
      phoneNumber: payload.phoneNumber,
      chatId: payload.chatId || 'me',
      botToken: '',
    }).catch(() => null);
    return {
      phoneCodeHash: data.phoneCodeHash,
      message: data.message,
    };
  };

  const handleVerifyMtprotoCode = async (payload: {
    phoneCode: string;
    password?: string;
    chatId?: string;
  }): Promise<void> => {
    const res = await apiFetch('/api/telegram/mtproto/verify-code', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to verify Telegram OTP code');
    }
    setTelegramConfig(data.config);
    const verifiedSession = data.mtprotoSession || data.sessionString || '';
    await saveStorageNodeConfigToFirestore({
      authMode: 'mtproto',
      apiId: data.apiId || data.config?.apiId || '',
      apiHash: data.apiHash || '',
      phoneNumber: data.phoneNumber || data.config?.phoneNumber || '',
      mtprotoSession: verifiedSession,
      accountName: data.accountName || data.config?.accountName || data.config?.mtprotoUser || '',
      accountUsername: data.accountUsername || data.config?.accountUsername || '',
      chatId: data.chatId || data.config?.chatId || payload.chatId || 'me',
      botToken: '',
      autoSyncUploads: true,
    }).catch(() => null);
    pushNotification({
      id: `tg_mtproto_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Main Telegram Account Connected',
      message: `Logged in as ${
        data.accountName || data.config?.accountName || data.config?.mtprotoUser || 'User'
      } — files now upload via your main account in 100% original quality!`,
      type: 'completed',
    });
  };

  const handleDisconnectMtproto = async (): Promise<void> => {
    const res = await apiFetch('/api/telegram/mtproto/disconnect', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to disconnect MTProto session');
    }
    setTelegramConfig(data.config);
    await saveStorageNodeConfigToFirestore({
      authMode: 'bot',
      mtprotoSession: '',
      accountName: '',
      accountUsername: '',
    }).catch(() => null);
    pushNotification({
      id: `tg_mtproto_disc_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: '2 GB MTProto Vault Disconnected',
      message: 'Telegram user session was disconnected.',
      type: 'info',
    });
  };

  // Billing & Token Handlers
  const handleRedeemPromo = async (code: string): Promise<string> => {
    const res = await apiFetch('/api/billing/promo', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to apply promo code');
    }
    if (data.user) {
      setCurrentUser(data.user);
      updateFirestoreUserProfile({
        tokenBalance: data.user.tokenBalance,
        usedPromoCodes: (data.user.usedPromoCodes || []).join(','),
      }).catch(() => null);
    }
    pushNotification({
      id: `promo_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: '+9,999 Tokens Credited!',
      message: data.message,
      type: 'completed',
    });
    await loadWorkspaceData();
    return data.message;
  };

  const handlePurchaseTokens = async (payload: {
    tokens: number;
    paymentMethod: string;
    amountLabel: string;
  }): Promise<string> => {
    const res = await apiFetch('/api/billing/buy-tokens', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Token purchase failed');
    }
    if (data.user) {
      setCurrentUser(data.user);
      updateFirestoreUserProfile({
        tokenBalance: data.user.tokenBalance,
      }).catch(() => null);
    }
    pushNotification({
      id: `buy_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Tokens Added to Wallet',
      message: data.message,
      type: 'completed',
    });
    await loadWorkspaceData();
    return data.message;
  };

  const handleSubscribePlan = async (planId: StoragePlanId): Promise<string> => {
    const res = await apiFetch('/api/billing/subscribe', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ planId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Could not update storage plan');
    }
    if (data.user) {
      setCurrentUser(data.user);
      updateFirestoreUserProfile({
        planId: data.user.planId,
        tokenBalance: data.user.tokenBalance,
        planExpiresAt: data.user.planExpiresAt || '',
        graceEndsAt: data.user.graceEndsAt || '',
      }).catch(() => null);
    }
    if (data.files) {
      setFiles(data.files);
    }
    pushNotification({
      id: `sub_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Storage Plan Updated',
      message: data.message,
      type: 'completed',
    });
    await loadWorkspaceData();
    return data.message;
  };

  const handleSimulateExpiry = async (): Promise<string> => {
    const res = await apiFetch('/api/billing/simulate-expiry', {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Simulation failed');
    }
    if (data.user) setCurrentUser(data.user);
    if (data.files) setFiles(data.files);
    pushNotification({
      id: `sim_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: '3-Month Expiry Grace Lock Active',
      message: 'Files above 25 GB are now locked. Renew your plan with Tokens to unlock.',
      type: 'warning',
    });
    return data.message;
  };

  // Collect all tags across files (plus standard 'Work', 'Personal', 'Archive' presets)
  const allFilterTags = React.useMemo(() => {
    const tagMap = new Map<string, { label: string; count: number }>();
    for (const preset of ['Work', 'Personal', 'Archive']) {
      tagMap.set(preset.toLowerCase(), { label: preset, count: 0 });
    }
    for (const f of files) {
      for (const rawTag of f.tags || []) {
        const clean = rawTag.trim();
        if (!clean) continue;
        const key = clean.toLowerCase();
        const existing = tagMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          tagMap.set(key, { label: clean, count: 1 });
        }
      }
    }
    return Array.from(tagMap.values());
  }, [files]);

  const allExistingTagNames = React.useMemo(
    () => allFilterTags.map((t) => t.label),
    [allFilterTags]
  );

  // Preload the first video file in the current folder so playback starts immediately
  useEffect(() => {
    if (!firebaseUser || files.length === 0) return;
    const firstVideo = files.find(
      (f) =>
        f.folderId === currentFolderId &&
        !f.lockedOverQuota &&
        (f.mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name))
    );
    if (firstVideo) {
      preloadVideoFile(firstVideo, authHeaders());
    }
  }, [files, currentFolderId, firebaseUser, authHeaders]);

  // Persist search history helper
  const saveSearchQueryToHistory = useCallback((rawQuery: string) => {
    const clean = rawQuery.trim();
    if (clean.length < 2) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item.toLowerCase() !== clean.toLowerCase());
      const next = [clean, ...filtered].slice(0, 8);
      try {
        localStorage.setItem('unlimcloud_search_history_v1', JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      return next;
    });
  }, []);

  const removeSearchHistoryItem = useCallback((queryToRemove: string) => {
    setSearchHistory((prev) => {
      const next = prev.filter((item) => item.toLowerCase() !== queryToRemove.toLowerCase());
      try {
        localStorage.setItem('unlimcloud_search_history_v1', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    try {
      localStorage.removeItem('unlimcloud_search_history_v1');
    } catch {
      // ignore
    }
  }, []);

  // Automatically record non-empty search queries into persistent history after typing pause
  useEffect(() => {
    const clean = searchQuery.trim();
    if (clean.length < 2) return;
    const timer = setTimeout(() => {
      saveSearchQueryToHistory(clean);
    }, 850);
    return () => clearTimeout(timer);
  }, [searchQuery, saveSearchQueryToHistory]);

  // Close search history dropdown when clicking outside the search container
  useEffect(() => {
    if (!showSearchHistory) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setShowSearchHistory(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [showSearchHistory]);

  // Global Keyboard Shortcut System:
  // - Esc: Close active drawers/modals or clear file selection
  // - Delete / Backspace: Open delete confirmation modal for selected files
  // - Ctrl+A / Cmd+A: Select all visible files in explorer
  // - /: Focus search input
  useEffect(() => {
    if (!firebaseUser || publicShareToken) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        Boolean(target) &&
        (target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.tagName === 'SELECT' ||
          target?.isContentEditable);

      if (e.key === 'Escape') {
        if (deleteTarget) {
          e.preventDefault();
          setDeleteTarget(null);
          return;
        }
        if (tagModalFiles) {
          e.preventDefault();
          setTagModalFiles(null);
          return;
        }
        if (moveModalFile || (batchMoveFiles && batchMoveFiles.length > 0)) {
          e.preventDefault();
          setMoveModalFile(null);
          setBatchMoveFiles(null);
          return;
        }
        if (shareModalFile) {
          e.preventDefault();
          setShareModalFile(null);
          return;
        }
        if (inspectedFile) {
          e.preventDefault();
          setInspectedFile(null);
          return;
        }
        if (showRemoteModal) {
          e.preventDefault();
          setShowRemoteModal(false);
          return;
        }
        if (showBuyTokensModal) {
          e.preventDefault();
          setShowBuyTokensModal(false);
          return;
        }
        if (showAuthModal) {
          e.preventDefault();
          setShowAuthModal(false);
          return;
        }
        if (creatingFolder) {
          e.preventDefault();
          setCreatingFolder(false);
          return;
        }
        if (showSearchHistory) {
          setShowSearchHistory(false);
          searchInputRef.current?.blur();
          return;
        }
        if (selectedFileIds.length > 0 && !isInputFocused) {
          setSelectedFileIds([]);
          return;
        }
        return;
      }

      const anyModalOpen = Boolean(
        deleteTarget ||
          tagModalFiles ||
          moveModalFile ||
          (batchMoveFiles && batchMoveFiles.length > 0) ||
          shareModalFile ||
          inspectedFile ||
          showRemoteModal ||
          showBuyTokensModal ||
          showAuthModal
      );

      if (anyModalOpen || isInputFocused || activeView !== 'explorer') {
        return;
      }

      // Compute visible files for Ctrl+A and Delete shortcuts
      const currentVisible = files.filter((f) => {
        if (selectedTagFilter) {
          const hasMatchingTag = (f.tags || []).some(
            (t) => t.toLowerCase() === selectedTagFilter.toLowerCase()
          );
          if (!hasMatchingTag) return false;
        }
        if (onlyStarred) {
          if (!f.starred) return false;
        } else if (!searchQuery.trim() && !selectedTagFilter) {
          if (f.folderId !== currentFolderId) return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesTag = (f.tags || []).some((t) => t.toLowerCase().includes(q));
          return (
            f.name.toLowerCase().includes(q) ||
            f.ownerName.toLowerCase().includes(q) ||
            matchesTag
          );
        }
        return true;
      });

      // Ctrl+A / Cmd+A: Select all visible files in explorer
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (currentVisible.length > 0) {
          e.preventDefault();
          const allSelected = currentVisible.every((f) => selectedFileIds.includes(f.id));
          if (allSelected) {
            const visibleSet = new Set(currentVisible.map((f) => f.id));
            setSelectedFileIds((prev) => prev.filter((id) => !visibleSet.has(id)));
          } else {
            const merged = new Set([...selectedFileIds, ...currentVisible.map((f) => f.id)]);
            setSelectedFileIds(Array.from(merged));
          }
        }
        return;
      }

      // Delete: Trigger delete confirmation modal for selected files
      if (e.key === 'Delete' && selectedFileIds.length > 0) {
        e.preventDefault();
        const selectedObjs = files.filter((f) => selectedFileIds.includes(f.id));
        if (selectedObjs.length === 1) {
          const single = selectedObjs[0];
          setDeleteTarget({
            type: 'file',
            id: single.id,
            name: single.name,
            subtitle: `Size: ${formatBytes(single.sizeBytes)}`,
          });
        } else if (selectedObjs.length > 1) {
          const totalBytes = selectedObjs.reduce((acc, f) => acc + f.sizeBytes, 0);
          setDeleteTarget({
            type: 'batch-files',
            id: 'batch_delete',
            name: `${selectedObjs.length} Selected Files`,
            subtitle: `Total size: ${formatBytes(totalBytes)}`,
            fileIds: selectedObjs.map((f) => f.id),
          });
        }
        return;
      }

      // '/': Focus explorer search input
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        setShowSearchHistory(true);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    firebaseUser,
    publicShareToken,
    deleteTarget,
    tagModalFiles,
    moveModalFile,
    batchMoveFiles,
    shareModalFile,
    inspectedFile,
    showRemoteModal,
    showBuyTokensModal,
    showAuthModal,
    creatingFolder,
    showSearchHistory,
    selectedFileIds,
    activeView,
    files,
    selectedTagFilter,
    onlyStarred,
    searchQuery,
    currentFolderId,
  ]);

  // Global Desktop Screen-Wide Drag-and-Drop File Upload Listener
  useEffect(() => {
    if (!firebaseUser || publicShareToken) return;

    const hasExternalFiles = (e: DragEvent) => {
      if (draggedFileId) return false;
      const types = Array.from(e.dataTransfer?.types || []);
      return types.includes('Files');
    };

    const handleWindowDragEnter = (e: DragEvent) => {
      if (!hasExternalFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingOver(true);
    };

    const handleWindowDragOver = (e: DragEvent) => {
      if (!hasExternalFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      if (!isDraggingOver) {
        setIsDraggingOver(true);
      }
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!hasExternalFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      if (!hasExternalFiles(e)) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        if (activeView !== 'explorer') {
          setActiveView('explorer');
        }
        handleUploadFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  });

  // ============================================================================
  // 1. PUBLIC SHARE PORTAL RENDERING
  // ============================================================================

  if (publicShareToken) {
    return (
      <PublicSharePortal
        token={publicShareToken}
        isAuthenticated={Boolean(firebaseUser)}
        userFolders={folders.filter((f) => !f.trashed)}
        onCopyToMyDrive={handleCopySharedToMyDrive}
        onCreateFolder={(name) => handleCreateFolderFromModal(name, null)}
        onExitPublicPortal={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('share');
          window.history.pushState({}, '', url.toString());
          setPublicShareToken(null);
          if (firebaseUser) {
            loadWorkspaceData();
          }
        }}
      />
    );
  }

  // ============================================================================
  // 2. STRICT FIREBASE GOOGLE LOGIN LANDING PAGE GATE
  //    (No user can access the platform without signing in with Google)
  // ============================================================================

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex items-center justify-center p-6">
        <div className="p-6 bg-[#1C1A17] border border-[#2C2824] text-center space-y-2 max-w-sm w-full">
          <div className="text-sm font-bold text-[#F2EFE9]">UnlimStorage Encrypted Vault</div>
          <div className="text-xs text-[#9E978E]">Verifying your secure cloud session...</div>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex flex-col justify-between p-4 sm:p-6">
        <header className="max-w-7xl w-full mx-auto flex items-center justify-between py-2 border-b border-[#2C2824]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#1C1A17] border border-[#2C2824] flex items-center justify-center">
              <Cloud className="w-4 h-4 text-[#D97757]" />
            </div>
            <span className="text-lg font-bold tracking-tight text-[#F2EFE9]">UnlimStorage</span>
          </div>
          <div className="text-xs text-[#9E978E]">25 GB Free Encrypted Cloud Storage</div>
        </header>

        <main className="flex-1 flex items-center justify-center py-8">
          <div className="w-full max-w-md bg-[#1C1A17] border border-[#2C2824] p-6 sm:p-8 space-y-6">
            <div className="w-12 h-12 bg-[#24211D] border border-[#2C2824] flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-[#D97757]" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-bold text-[#F2EFE9]">
                Sign in to UnlimStorage
              </h1>
              <p className="text-xs sm:text-sm text-[#9E978E] leading-relaxed">
                Sign in with your registered Google account to access your private encrypted cloud
                drive. New account registration is currently closed.
              </p>
            </div>

            <div className="p-4 bg-[#141311] border border-[#2C2824] space-y-2 text-xs text-[#9E978E]">
              <div className="flex items-center justify-between">
                <span>Access Status</span>
                <strong className="text-[#D97757]">Existing Members Only</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>New Registration</span>
                <strong className="text-[#9E978E]">Temporarily Closed</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Account Privacy</span>
                <strong className="text-[#F2EFE9]">100% Isolated Per-User Vault</strong>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <button
                onClick={() => {
                  handleGoogleSignIn().catch(() => null);
                }}
                disabled={signingInGoogle}
                className="w-full min-h-[48px] px-5 py-3 text-xs sm:text-sm font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                {signingInGoogle ? 'Signing in with Google...' : 'Sign in with Google'}
              </button>
            </div>

            {authGateError && (
              <div className="p-3 bg-[#141311] border border-[#D94848] text-xs text-[#D94848]">
                {authGateError}
              </div>
            )}
          </div>
        </main>

        <footer className="text-center text-xs text-[#9E978E] py-2">
          UnlimStorage — Private Encrypted Cloud Storage · Login Required
        </footer>
      </div>
    );
  }

  // ============================================================================
  // 3. COMPUTED WORKSPACE DATA (STRICT ADMIN EMAIL CHECK)
  // ============================================================================

  const isAdminUser =
    Boolean(firebaseUser) &&
    firebaseUser.email?.toLowerCase() === 'titumamma2425@gmail.com';

  const activeFolders = folders.filter((f) => !f.trashed);
  const trashedFolders = folders.filter((f) => Boolean(f.trashed));
  const activeFiles = files.filter((f) => !f.trashed);
  const trashedFiles = files.filter((f) => Boolean(f.trashed));
  const totalTrashCount = trashedFiles.length + trashedFolders.length;

  const activeFolder = activeFolders.find((f) => f.id === currentFolderId) || null;
  const visibleSubfolders = activeFolders.filter((f) => f.parentId === currentFolderId);

  const visibleFiles = activeFiles.filter((f) => {
    if (selectedTagFilter) {
      const hasMatchingTag = (f.tags || []).some(
        (t) => t.toLowerCase() === selectedTagFilter.toLowerCase()
      );
      if (!hasMatchingTag) return false;
    }

    if (onlyOffline) {
      if (!offlineFilesMap[f.id]) return false;
    }

    if (onlyStarred) {
      if (!f.starred) return false;
    } else if (!onlyOffline && !searchQuery.trim() && !selectedTagFilter) {
      if (f.folderId !== currentFolderId) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesTag = (f.tags || []).some((t) => t.toLowerCase().includes(q));
      return (
        f.name.toLowerCase().includes(q) ||
        f.ownerName.toLowerCase().includes(q) ||
        matchesTag
      );
    }
    return true;
  });

  const selectedFilesObjects = activeFiles.filter((f) => selectedFileIds.includes(f.id));
  const selectedTotalBytes = selectedFilesObjects.reduce((acc, f) => acc + f.sizeBytes, 0);
  const allVisibleSelected =
    visibleFiles.length > 0 && visibleFiles.every((f) => selectedFileIds.includes(f.id));

  const handleToggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleFiles.map((f) => f.id));
      setSelectedFileIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      const merged = new Set([...selectedFileIds, ...visibleFiles.map((f) => f.id)]);
      setSelectedFileIds(Array.from(merged));
    }
  };

  const handleBatchDownload = async () => {
    if (selectedFilesObjects.length === 0) return;
    const unlocked = selectedFilesObjects.filter((f) => !f.lockedOverQuota);
    if (unlocked.length === 0) {
      pushNotification({
        id: `batch_dl_lock_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Selected Files Locked',
        message: 'Extend your storage plan with Tokens to download locked files.',
        type: 'warning',
      });
      return;
    }
    pushNotification({
      id: `batch_dl_start_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Batch Download Started',
      message: `Downloading ${unlocked.length} ${
        unlocked.length === 1 ? 'file' : 'files'
      }...`,
      type: 'info',
    });
    for (const file of unlocked) {
      await handleDownloadFile(file);
      await new Promise((r) => setTimeout(r, 280));
    }
  };

  const handleBatchZipDownload = async () => {
    if (selectedFilesObjects.length === 0 || zipDownloading) return;
    const unlocked = selectedFilesObjects.filter((f) => !f.lockedOverQuota);
    if (unlocked.length === 0) {
      pushNotification({
        id: `batch_zip_lock_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Selected Files Locked',
        message: 'Extend your storage plan with Tokens to download locked files.',
        type: 'warning',
      });
      return;
    }

    setZipDownloading(true);
    setZipProgressPct(0);
    try {
      const zipEntries: { name: string; fetchBlob: () => Promise<Blob> }[] = unlocked.map(
        (file) => ({
          name: file.name,
          fetchBlob: async () => {
            const cached = await getClientBinaryBlob(file.id, file);
            if (cached && cached.size > 64) return cached;
            const url = `/api/files/${encodeURIComponent(file.id)}/download?uid=${encodeURIComponent(
              firebaseUser?.uid || ''
            )}&email=${encodeURIComponent(firebaseUser?.email || '')}`;
            const res = await apiFetch(url, { headers: authHeaders() });
            if (!res.ok) throw new Error(`Failed to fetch ${file.name}`);
            return await res.blob();
          },
        })
      );

      const archiveBaseName = activeFolder ? activeFolder.name : 'UnlimStorage-Selected-Files';
      await downloadFilesAsZip(zipEntries, `${archiveBaseName}.zip`, (pct) => {
        setZipProgressPct(pct);
      });
      pushNotification({
        id: `batch_zip_done_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'ZIP Archive Downloaded',
        message: `Bundled ${unlocked.length} ${
          unlocked.length === 1 ? 'file' : 'files'
        } into ${archiveBaseName}.zip.`,
        type: 'completed',
      });
    } catch (err: unknown) {
      pushNotification({
        id: `batch_zip_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'ZIP Download Failed',
        message: err instanceof Error ? err.message : 'Could not build ZIP archive',
        type: 'error',
      });
    } finally {
      setZipDownloading(false);
      setZipProgressPct(0);
    }
  };

  const handleChangeLayout = (nextLayout: 'grid' | 'list') => {
    setExplorerLayout(nextLayout);
    try {
      localStorage.setItem('tgdrive_explorer_layout_v1', nextLayout);
    } catch {
      // ignore
    }
  };

  const isUnlimitedAdmin =
    isAdminUser ||
    currentUser?.role === 'admin' ||
    currentUser?.planId === 'unlimited_admin';
  const totalStorageBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  const quotaLimitBytes = currentUser?.bandwidthLimitBytes || 25 * 1024 * 1024 * 1024;
  const quotaPct = isUnlimitedAdmin
    ? Math.min(100, Math.max(totalStorageBytes > 0 ? 2 : 0, Math.round((totalStorageBytes / (10 * 1024 * 1024 * 1024 * 1024)) * 100)))
    : Math.min(100, Math.round((totalStorageBytes / quotaLimitBytes) * 100));
  const lockedFilesCount = isUnlimitedAdmin
    ? 0
    : activeFiles.filter((f) => f.lockedOverQuota).length;
  const tokenBalance = currentUser?.tokenBalance || 0;
  const planBadge = isUnlimitedAdmin
    ? 'Unlimited Admin'
    : currentUser?.planId === 'ultra_1tb'
    ? '1 TB Ultra'
    : currentUser?.planId === 'pro_50gb'
    ? '50 GB Pro'
    : '25 GB Free';

  const activeStreamingJobs = transfers.filter(
    (t) =>
      t.status === 'queued' ||
      t.status === 'streaming' ||
      t.status === 'paused' ||
      t.status === 'syncing_telegram'
  );

  return (
    <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex flex-col">
      <OfflineIndicator />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* ====================================================================
          TOP BAR CONTRACT (Single Clean Navigation Bar — 3 Zones)
      ==================================================================== */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 py-3 border-b border-[#2C2824] bg-[#1C1A17]">
        {/* Zone 1: Brand Title */}
        <a
          href="#my-files"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('explorer');
            setCurrentFolderId(null);
            setOnlyStarred(false);
          }}
          className="text-lg font-bold tracking-tight text-[#F2EFE9] whitespace-nowrap shrink-0"
        >
          UnlimStorage
        </a>

        {/* Zone 2: Desktop Navigation Links (Admin Storage Node tab hidden from regular users) */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-[#9E978E]">
          <a
            href="#my-files"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('explorer');
              setOnlyStarred(false);
              setOnlyOffline(false);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'explorer'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            My Files ({activeFiles.length})
          </a>
          <a
            href="#gallery"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('gallery');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'gallery'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            Gallery
          </a>
          <a
            href="#trash"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('trash');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 flex items-center gap-1.5 ${
              activeView === 'trash'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            <span>Trash Bin</span>
            {totalTrashCount > 0 && (
              <span className="px-1.5 py-0.2 text-[11px] font-bold bg-[#24211D] border border-[#2C2824] text-[#D97757] tabular-nums">
                {totalTrashCount}
              </span>
            )}
          </a>
          <a
            href="#shared-links"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('shares');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'shares'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            Shared Links ({shares.length})
          </a>
          <a
            href="#pricing"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('pricing');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'pricing'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            Plans ({tokenBalance.toLocaleString()} T)
          </a>
          <a
            href="#settings"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('settings');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'settings'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            Alerts &amp; Offline ({Object.keys(offlineFilesMap).length})
          </a>
          {isAdminUser && (
            <a
              href="#storage-node"
              onClick={(e) => {
                e.preventDefault();
                setActiveView('telegram_settings');
              }}
              className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
                activeView === 'telegram_settings'
                  ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                  : 'hover:text-[#F2EFE9]'
              }`}
            >
              Storage Node (Admin)
            </a>
          )}
        </nav>

        {/* Zone 3: PWA Install + Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton compact />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            className="min-h-[40px] sm:min-h-[38px] px-4 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {uploadingFiles ? (uploadPaused ? 'Upload Paused' : 'Uploading...') : '+ Upload Files'}
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN CONTAINER
      ==================================================================== */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 md:pb-8 space-y-5 sm:space-y-6">
        {/* Storage Quota & Account Bar (Zero Telegram mention) */}
        <div className="p-3.5 sm:p-4 bg-[#1C1A17] border border-[#2C2824] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5 text-[#D97757]" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-[#F2EFE9] truncate">
                  UnlimStorage Encrypted Vault ({planBadge})
                </div>
                <div className="text-xs text-[#9E978E] tabular-nums">
                  <strong className="text-[#F2EFE9]">{formatBytes(totalStorageBytes)}</strong> used
                  of{' '}
                  {isUnlimitedAdmin ? (
                    <strong className="text-[#2E9E6B]">Unlimited Storage</strong>
                  ) : (
                    <strong className="text-[#F2EFE9]">{formatBytes(quotaLimitBytes)}</strong>
                  )}
                </div>
              </div>
              <div className="h-2 w-full bg-[#141311] border border-[#2C2824]">
                <div
                  style={{ width: `${quotaPct}%` }}
                  className={`h-full transition-all duration-300 ${
                    lockedFilesCount > 0 ? 'bg-[#D99B26]' : 'bg-[#D97757]'
                  }`}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5 pt-2.5 lg:pt-0 border-t lg:border-t-0 border-[#2C2824]">
            <button
              onClick={() => setShowBuyTokensModal(true)}
              className="min-h-[40px] px-3.5 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
            >
              <Coins className="w-3.5 h-3.5 text-[#D97757]" />
              <span className="tabular-nums">{tokenBalance.toLocaleString()} Tokens</span>
              <span className="text-[#D97757] font-bold ml-1">+ Buy</span>
            </button>

            {!firebaseUser ? (
              <button
                onClick={handleGoogleSignIn}
                disabled={signingInGoogle}
                className="min-h-[40px] px-3.5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                {signingInGoogle ? 'Signing in...' : 'Google Sign In'}
              </button>
            ) : null}

            {currentUser && (
              <button
                onClick={() => setShowAuthModal(true)}
                className="min-h-[40px] px-3.5 py-2 text-xs font-medium bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5 text-[#D97757]" />
                <span className="max-w-[130px] truncate">{currentUser.name}</span>
              </button>
            )}
          </div>
        </div>

        {/* LIVE FILE UPLOAD PROGRESS BAR (Determinate 0% -> 100% + Cancel Button) */}
        {(uploadProgress || postUploadProcessing || activeStreamingJobs.length > 0) && (
          <div className="p-4 bg-[#1C1A17] border border-[#D97757] space-y-3">
            {uploadProgress && !postUploadProcessing && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="font-bold text-[#F2EFE9] truncate">
                    {uploadPaused ? 'Paused Upload: ' : 'Uploading: '}
                    {uploadProgress.fileName}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="text-[#D97757] font-bold">
                      {uploadProgress.percent}% · {formatBytes(uploadProgress.loadedBytes)} /{' '}
                      {formatBytes(uploadProgress.totalBytes)} ·{' '}
                      {uploadPaused ? 'Paused' : formatSpeed(uploadProgress.speedBps)}
                    </span>
                    <button
                      type="button"
                      onClick={handleTogglePauseUpload}
                      className="min-h-[32px] px-3 py-1 text-xs font-bold bg-[#24211D] border border-[#D97757] text-[#F2EFE9] hover:bg-[#D97757] hover:text-[#141311] flex items-center gap-1 cursor-pointer"
                    >
                      {uploadPaused ? (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          Pause
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelUpload}
                      className="min-h-[32px] px-3 py-1 text-xs font-bold bg-[#141311] border border-[#D94848] text-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="h-2.5 w-full bg-[#141311] border border-[#2C2824]">
                  <div
                    style={{ width: `${uploadProgress.percent}%` }}
                    className={`h-full transition-all duration-100 ${
                      uploadPaused ? 'bg-[#D99B26]' : 'bg-[#D97757]'
                    }`}
                  />
                </div>
              </div>
            )}

            {postUploadProcessing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Loader2 className="w-4 h-4 text-[#D97757] animate-spin shrink-0" />
                    <span className="font-bold text-[#F2EFE9] truncate">
                      Processing: {postUploadProcessing.fileName}
                    </span>
                  </div>
                  <span className="text-[#D97757] font-semibold shrink-0">
                    Please wait...
                  </span>
                </div>
                <div className="h-2 w-full bg-[#141311] border border-[#2C2824] overflow-hidden">
                  <div className="h-full w-full bg-[#D97757] animate-pulse" />
                </div>
              </div>
            )}

            {activeStreamingJobs.map((job) => {
              const pct =
                job.totalBytes > 0
                  ? Math.min(100, Math.round((job.transferredBytes / job.totalBytes) * 100))
                  : 60;
              return (
                <div key={job.id} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="font-semibold text-[#F2EFE9] truncate">{job.fileName}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[#9E978E]">
                        {pct}% · {formatBytes(job.transferredBytes)} · {formatSpeed(job.speedBps)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCancelRemoteTransfer(job.id)}
                        className="min-h-[30px] px-2.5 py-0.5 text-xs font-semibold bg-[#141311] border border-[#D94848] text-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div className="h-2 w-full bg-[#141311] border border-[#2C2824]">
                    <div
                      style={{ width: `${pct}%` }}
                      className="h-full bg-[#D97757] transition-all duration-150"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* DEDICATED POST-UPLOAD PROCESSING LOADING SCREEN OVERLAY */}
        {postUploadProcessing && (
          <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#1C1A17] border border-[#D97757] p-6 space-y-4 text-center shadow-2xl">
              <div className="w-12 h-12 mx-auto bg-[#24211D] border border-[#2C2824] flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-[#D97757] animate-spin" />
              </div>
              <div className="space-y-1">
                <div className="text-base font-bold text-[#F2EFE9]">Processing...</div>
                <p className="text-xs text-[#9E978E] truncate px-2">
                  {postUploadProcessing.fileName}
                </p>
                <p className="text-[11px] text-[#9E978E]">
                  Finalizing your file for instant cloud access...
                </p>
              </div>
              <div className="h-2 w-full bg-[#141311] border border-[#2C2824] overflow-hidden">
                <div className="h-full w-full bg-[#D97757] animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            VIEW 1: MY FILES
        ================================================================== */}
        {activeView === 'explorer' && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleUploadFiles(e.dataTransfer.files);
              }
            }}
            className="space-y-5 sm:space-y-6"
          >
            {/* Expired Plan / Over-25GB Lock Warning Banner */}
            {lockedFilesCount > 0 && (
              <div className="p-4 bg-[#1C1A17] border border-[#D99B26] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs">
                  <Lock className="w-4 h-4 text-[#D99B26] shrink-0" />
                  <span>
                    <strong className="text-[#F2EFE9]">
                      {lockedFilesCount} file(s) over your 25 GB Free limit are locked
                    </strong>{' '}
                    <span className="text-[#9E978E]">
                      (3-month grace period active — extend your plan to unlock before auto-clear).
                    </span>
                  </span>
                </div>
                <button
                  onClick={() => setActiveView('pricing')}
                  className="min-h-[38px] px-4 py-1.5 text-xs font-bold bg-[#D97757] text-[#141311] shrink-0 cursor-pointer"
                >
                  Extend Plan with Tokens
                </button>
              </div>
            )}

            {/* Action Grid + Search */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
                >
                  <Upload className="w-4 h-4 shrink-0" />
                  <span>Upload Files</span>
                </button>

                <button
                  onClick={() => setShowRemoteModal(true)}
                  className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
                >
                  <Globe className="w-4 h-4 text-[#D97757] shrink-0" />
                  <span>Upload URL</span>
                </button>

                <button
                  onClick={() => setCreatingFolder((prev) => !prev)}
                  className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-[#D97757] shrink-0" />
                  <span>New Folder</span>
                </button>

                <button
                  onClick={() => setOnlyStarred((prev) => !prev)}
                  className={`min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border cursor-pointer ${
                    onlyStarred
                      ? 'bg-[#24211D] border-[#D97757] text-[#D97757]'
                      : 'bg-[#1C1A17] border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Star className="w-4 h-4 shrink-0" fill={onlyStarred ? '#D97757' : 'none'} />
                  <span>Starred</span>
                </button>

                <button
                  onClick={() => setOnlyOffline((prev) => !prev)}
                  className={`min-h-[44px] flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border cursor-pointer ${
                    onlyOffline
                      ? 'bg-[#24211D] border-[#2E9E6B] text-[#2E9E6B]'
                      : 'bg-[#1C1A17] border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <span>Offline ({Object.keys(offlineFilesMap).length})</span>
                </button>
              </div>

              <div ref={searchContainerRef} className="relative w-full lg:w-80">
                <Search className="w-4 h-4 text-[#9E978E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onFocus={() => setShowSearchHistory(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowSearchHistory(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
                      saveSearchQueryToHistory(searchQuery.trim());
                      setShowSearchHistory(false);
                    }
                  }}
                  placeholder="Search files or labels... (Press /)"
                  className="w-full min-h-[44px] bg-[#1C1A17] border border-[#2C2824] pl-10 pr-9 py-2.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      if (searchQuery.trim().length >= 2) {
                        saveSearchQueryToHistory(searchQuery.trim());
                      }
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="w-7 h-7 absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Persistent Search History Dropdown */}
                {showSearchHistory && searchHistory.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-[#1C1A17] border border-[#2C2824] shadow-2xl py-1">
                    <div className="px-3 py-1.5 border-b border-[#2C2824] flex items-center justify-between text-[11px] text-[#9E978E]">
                      <span className="font-semibold flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-[#D97757]" />
                        Recent Searches
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearSearchHistory();
                        }}
                        className="text-[11px] text-[#D97757] hover:underline cursor-pointer"
                      >
                        Clear All
                      </button>
                    </div>
                    <div className="max-h-52 overflow-y-auto divide-y divide-[#2C2824]/50">
                      {searchHistory.map((item) => (
                        <div
                          key={item}
                          className="flex items-center justify-between px-3 py-2 hover:bg-[#24211D] transition-colors group"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSearchQuery(item);
                              saveSearchQueryToHistory(item);
                              setShowSearchHistory(false);
                            }}
                            className="flex-1 flex items-center gap-2 text-left text-xs text-[#F2EFE9] group-hover:text-[#D97757] truncate cursor-pointer"
                          >
                            <Clock className="w-3.5 h-3.5 text-[#9E978E] group-hover:text-[#D97757] shrink-0" />
                            <span className="truncate">{item}</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSearchHistoryItem(item);
                            }}
                            className="p-1 text-[#9E978E] hover:text-[#D94848] cursor-pointer shrink-0"
                            title="Remove from history"
                            aria-label={`Remove ${item} from search history`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Tag / Label Filter Bar */}
            <div className="p-3 bg-[#1C1A17] border border-[#2C2824] flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-[#9E978E] uppercase tracking-wider mr-1.5 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5 text-[#D97757]" />
                  Labels:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedTagFilter(null)}
                  className={`min-h-[32px] px-3 py-1 text-xs font-semibold border transition-colors cursor-pointer ${
                    selectedTagFilter === null
                      ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                      : 'bg-[#141311] border-[#2C2824] text-[#9E978E] hover:border-[#D97757] hover:text-[#F2EFE9]'
                  }`}
                >
                  All Files ({files.length})
                </button>
                {allFilterTags.map((tagItem) => {
                  const isActive =
                    selectedTagFilter?.toLowerCase() === tagItem.label.toLowerCase();
                  return (
                    <button
                      key={tagItem.label}
                      type="button"
                      onClick={() =>
                        setSelectedTagFilter(isActive ? null : tagItem.label)
                      }
                      className={`min-h-[32px] px-3 py-1 text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                        isActive
                          ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                          : 'bg-[#141311] border-[#2C2824] text-[#9E978E] hover:border-[#D97757] hover:text-[#F2EFE9]'
                      }`}
                    >
                      <span>{tagItem.label}</span>
                      <span
                        className={`text-[11px] tabular-nums ${
                          isActive ? 'text-[#141311]/80 font-bold' : 'text-[#9E978E]'
                        }`}
                      >
                        ({tagItem.count})
                      </span>
                    </button>
                  );
                })}
              </div>

              {selectedTagFilter && (
                <button
                  type="button"
                  onClick={() => setSelectedTagFilter(null)}
                  className="min-h-[30px] px-2.5 py-1 text-xs text-[#D97757] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear Filter
                </button>
              )}
            </div>

            {/* Batch Actions Bar (Appears when 1 or more files are checked) */}
            {selectedFileIds.length > 0 && (
              <div className="p-3.5 bg-[#24211D] border border-[#D97757] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs">
                  <CheckSquare className="w-4 h-4 text-[#D97757] shrink-0" />
                  <span className="font-bold text-[#F2EFE9]">
                    {selectedFileIds.length}{' '}
                    {selectedFileIds.length === 1 ? 'file' : 'files'} selected
                  </span>
                  <span className="text-[#9E978E] tabular-nums">
                    ({formatBytes(selectedTotalBytes)})
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTagModalFiles(selectedFilesObjects)}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Tag className="w-3.5 h-3.5 text-[#D97757]" />
                    <span>Label ({selectedFileIds.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoveModalMode('move');
                      setBatchMoveFiles(selectedFilesObjects);
                    }}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-[#D97757]" />
                    <span>Move</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoveModalMode('copy');
                      setBatchMoveFiles(selectedFilesObjects);
                    }}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#D97757]" />
                    <span>Copy to Folder</span>
                  </button>

                  <button
                    type="button"
                    disabled={zipDownloading}
                    onClick={handleBatchZipDownload}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-bold bg-[#1C1A17] border border-[#D97757] text-[#D97757] hover:bg-[#D97757] hover:text-[#141311] disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {zipDownloading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>ZIP {zipProgressPct}%</span>
                      </>
                    ) : (
                      <>
                        <FolderArchive className="w-3.5 h-3.5" />
                        <span>Download ZIP ({selectedFileIds.length})</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleBatchDownload}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download ({selectedFileIds.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setDeleteTarget({
                        type: 'batch-files',
                        id: 'batch',
                        name: `${selectedFileIds.length} Selected Files`,
                        subtitle: `Total Size: ${formatBytes(selectedTotalBytes)}`,
                        fileIds: [...selectedFileIds],
                      })
                    }
                    className="min-h-[38px] px-3 py-1.5 text-xs font-semibold bg-[#141311] border border-[#D94848] text-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Move to Trash ({selectedFileIds.length})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedFileIds([])}
                    className="col-span-2 sm:col-span-1 min-h-[38px] px-3 py-1.5 text-xs text-[#9E978E] hover:text-[#F2EFE9] border border-[#2C2824] bg-[#141311] cursor-pointer"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}

            {/* Inline New Folder Input */}
            {creatingFolder && (
              <form
                onSubmit={handleCreateFolder}
                className="p-4 bg-[#1C1A17] border border-[#D97757] flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
              >
                <input
                  type="text"
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Type folder name..."
                  className="flex-1 min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(false)}
                    className="min-h-[44px] px-4 py-2 text-xs text-[#9E978E] border border-[#2C2824] bg-[#141311] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Breadcrumb (Also acts as Drop Target to move files back to Root) */}
            {(activeFolder || onlyStarred || selectedTagFilter) && (
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#1C1A17] border border-[#2C2824]">
                <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
                  <button
                    onClick={() => {
                      setCurrentFolderId(null);
                      setOnlyStarred(false);
                      setSelectedTagFilter(null);
                    }}
                    onDragOver={(e) => {
                      if (draggedFileId) {
                        e.preventDefault();
                        setDragOverFolderId('root');
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverFolderId === 'root') setDragOverFolderId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolderId(null);
                      if (draggedFileId) {
                        const f = files.find((item) => item.id === draggedFileId);
                        setDraggedFileId(null);
                        if (f) handleMoveFile(f, null).catch(() => null);
                      }
                    }}
                    className={`min-h-[36px] px-2.5 text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer ${
                      dragOverFolderId === 'root' ? 'border border-[#D97757] bg-[#24211D] text-[#F2EFE9]' : ''
                    }`}
                  >
                    My Files (Root)
                  </button>
                  <ChevronRight className="w-4 h-4 text-[#9E978E] shrink-0" />
                  <span className="text-[#D97757] truncate flex items-center gap-1.5">
                    {selectedTagFilter
                      ? `Label: ${selectedTagFilter}`
                      : onlyStarred
                      ? 'Starred Files'
                      : activeFolder?.name}
                    {activeFolder?.isPinProtected && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#24211D] border border-[#D97757]/50 text-[#D97757] flex items-center gap-1">
                        <KeyRound className="w-2.5 h-2.5" />
                        PIN Protected
                      </span>
                    )}
                  </span>
                </div>

                {activeFolder && !onlyStarred && !selectedTagFilter && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShareModalFolder(activeFolder)}
                      className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                      <span>Share Folder Gallery</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFolderPinModalState({
                          folder: activeFolder,
                          mode: 'manage',
                        })
                      }
                      className="min-h-[34px] px-3 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#D97757]" />
                      <span>{activeFolder.isPinProtected ? 'Manage PIN' : 'Set PIN Lock'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Folders Section (Supports Google Drive-style Drag & Drop + Content/Status Visual Indicators) */}
            {!onlyStarred && !onlyOffline && !selectedTagFilter && !searchQuery.trim() && visibleSubfolders.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                    Folders
                  </h2>
                  <span className="text-[11px] text-[#9E978E]">
                    Visual indicators show folder media type, starred/shared items &amp; PIN status
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {visibleSubfolders.map((folder) => {
                    const summary = analyzeFolderVisualIndicators(
                      folder,
                      activeFiles,
                      shares,
                      offlineFilesMap
                    );
                    const count = summary.fileCount;
                    const isDropTarget = dragOverFolderId === folder.id;
                    const isUnlocked = unlockedFolderIds.includes(folder.id);
                    const existingFolderShare = shares.find(
                      (s) =>
                        s.folderId === folder.id ||
                        (s.targetType === 'folder' && s.fileId === folder.id)
                    );

                    const renderCategoryBadgeIcon = () => {
                      if (folder.isPinProtected) {
                        return (
                          <Lock
                            className={`w-3 h-3 ${
                              isUnlocked ? 'text-[#389E6C]' : 'text-[#D99B26]'
                            }`}
                          />
                        );
                      }
                      if (summary.category === 'video') {
                        return <Film className="w-3 h-3 text-[#D97757]" />;
                      }
                      if (summary.category === 'image') {
                        return <ImageIcon className="w-3 h-3 text-[#2E9E6B]" />;
                      }
                      if (summary.category === 'audio') {
                        return <Music className="w-3 h-3 text-[#D99B26]" />;
                      }
                      if (summary.category === 'code') {
                        return <FileCode className="w-3 h-3 text-[#D97757]" />;
                      }
                      if (summary.hasShared) {
                        return <Link2 className="w-3 h-3 text-[#2E9E6B]" />;
                      }
                      if (summary.hasStarred) {
                        return <Star className="w-3 h-3 text-[#D97757]" fill="#D97757" />;
                      }
                      return null;
                    };

                    const badgeIcon = renderCategoryBadgeIcon();

                    return (
                      <div
                        key={folder.id}
                        onClick={() => handleOpenFolder(folder)}
                        onDragOver={(e) => {
                          if (draggedFileId) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverFolderId(folder.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverFolderId === folder.id) setDragOverFolderId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFolderId(null);
                          if (draggedFileId) {
                            const f = files.find((item) => item.id === draggedFileId);
                            setDraggedFileId(null);
                            if (f) handleMoveFile(f, folder.id).catch(() => null);
                          }
                        }}
                        className={`min-h-[72px] p-4 bg-[#1C1A17] border transition-colors flex items-center justify-between gap-2 cursor-pointer group ${
                          isDropTarget
                            ? 'border-[#D97757] bg-[#24211D]'
                            : 'border-[#2C2824] hover:border-[#D97757]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-10 h-10 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                            <Folder
                              className={`w-5 h-5 ${
                                summary.category === 'video'
                                  ? 'text-[#D97757]'
                                  : summary.category === 'image'
                                  ? 'text-[#2E9E6B]'
                                  : summary.category === 'audio'
                                  ? 'text-[#D99B26]'
                                  : 'text-[#D97757]'
                              }`}
                            />
                            {badgeIcon && (
                              <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-[#141311] border border-[#2C2824] flex items-center justify-center">
                                {badgeIcon}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-[#F2EFE9] truncate group-hover:text-[#D97757] flex items-center gap-1.5">
                              <span className="truncate">{folder.name}</span>
                              {summary.hasStarred && (
                                <Star
                                  className="w-3 h-3 text-[#D97757] shrink-0"
                                  fill="#D97757"
                                  aria-label="Contains starred items"
                                />
                              )}
                            </div>
                            <div className="text-xs text-[#9E978E] flex flex-wrap items-center gap-1 tabular-nums">
                              <span>
                                {count} {count === 1 ? 'file' : 'files'}
                              </span>
                              {count > 0 && (
                                <span className="text-[11px] text-[#F2EFE9]/80">
                                  · {summary.categoryLabel}
                                </span>
                              )}
                              {folder.isPinProtected && (
                                <span className="text-[10px] text-[#D99B26] font-semibold">
                                  · {isUnlocked ? 'Unlocked' : 'PIN'}
                                </span>
                              )}
                              {summary.hasShared && (
                                <span className="text-[10px] text-[#389E6C] font-semibold">
                                  · Shared
                                </span>
                              )}
                              {summary.hasOffline && (
                                <span className="text-[10px] text-[#2E9E6B] font-semibold">
                                  · Offline
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center -mr-2 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (folder.isPinProtected && !isUnlocked) {
                                setFolderPinModalState({ folder, mode: 'unlock' });
                                return;
                              }
                              setFolderPinModalState({
                                folder,
                                mode: 'manage',
                              });
                            }}
                            className={`min-w-[36px] min-h-[40px] flex items-center justify-center cursor-pointer ${
                              folder.isPinProtected
                                ? 'text-[#D99B26] hover:text-[#D97757]'
                                : 'text-[#9E978E] hover:text-[#D97757]'
                            }`}
                            title={folder.isPinProtected ? 'Manage PIN Lock' : 'Lock Folder with PIN'}
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (folder.isPinProtected && !isUnlocked) {
                                setFolderPinModalState({ folder, mode: 'unlock' });
                                return;
                              }
                              setShareModalFolder(folder);
                            }}
                            className={`min-w-[36px] min-h-[40px] flex items-center justify-center cursor-pointer ${
                              existingFolderShare
                                ? 'text-[#D97757]'
                                : 'text-[#9E978E] hover:text-[#D97757]'
                            }`}
                            title="Share Public Folder Gallery"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget({
                                type: 'folder',
                                id: folder.id,
                                name: folder.name,
                                subtitle: `Contains ${count} ${count === 1 ? 'file' : 'files'}`,
                              });
                            }}
                            className="min-w-[36px] min-h-[40px] flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                            title="Move Folder to Trash"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files Section */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                    Files ({visibleFiles.length})
                  </h2>
                  {visibleFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={handleToggleSelectAllVisible}
                      className="min-h-[32px] px-2.5 py-1 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                    >
                      {allVisibleSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-[#D97757]" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-[#9E978E]" />
                      )}
                      <span>
                        {allVisibleSelected ? 'Deselect All' : 'Select All'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <span className="hidden md:inline text-xs text-[#9E978E]">
                    Check files for batch ZIP/move · Tap any file to preview
                  </span>
                  {/* Grid / List Layout Toggle */}
                  <div className="flex items-center bg-[#1C1A17] border border-[#2C2824]">
                    <button
                      type="button"
                      onClick={() => handleChangeLayout('grid')}
                      className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                        explorerLayout === 'grid'
                          ? 'bg-[#D97757] text-[#141311]'
                          : 'text-[#9E978E] hover:text-[#F2EFE9]'
                      }`}
                      title="Grid View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangeLayout('list')}
                      className={`min-h-[32px] px-2.5 py-1 text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                        explorerLayout === 'list'
                          ? 'bg-[#D97757] text-[#141311]'
                          : 'text-[#9E978E] hover:text-[#F2EFE9]'
                      }`}
                      title="List View"
                    >
                      <ListIcon className="w-3.5 h-3.5" />
                      <span>List</span>
                    </button>
                  </div>
                </div>
              </div>

              {visibleFiles.length === 0 ? (
                <div
                  className={`p-8 sm:p-12 bg-[#1C1A17] border text-center space-y-3 ${
                    isDraggingOver ? 'border-[#D97757]' : 'border-[#2C2824]'
                  }`}
                >
                  <div className="text-base font-bold text-[#F2EFE9]">
                    {selectedTagFilter
                      ? `No files labeled "${selectedTagFilter}"`
                      : 'This folder is empty'}
                  </div>
                  <p className="text-xs text-[#9E978E] max-w-md mx-auto">
                    {selectedTagFilter
                      ? 'Assign this label to any file card using the + Label button, or clear the active filter.'
                      : 'Tap Upload Files below or upload directly from any web link.'}
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-2">
                    {selectedTagFilter ? (
                      <button
                        onClick={() => setSelectedTagFilter(null)}
                        className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                      >
                        Show All Files
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                        >
                          + Upload Files
                        </button>
                        <button
                          onClick={() => setShowRemoteModal(true)}
                          className="min-h-[44px] px-4 py-2.5 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] cursor-pointer"
                        >
                          Upload from Link
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : explorerLayout === 'list' ? (
                /* ============================================================
                    LIST VIEW LAYOUT
                ============================================================ */
                <div className="bg-[#1C1A17] border border-[#2C2824] divide-y divide-[#2C2824]">
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    const isLocked = Boolean(file.lockedOverQuota);
                    const isSelected = selectedFileIds.includes(file.id);
                    const fileTags = Array.isArray(file.tags) ? file.tags : [];
                    return (
                      <div
                        key={file.id}
                        draggable={!isLocked}
                        onMouseEnter={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onTouchStart={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onDragStart={(e) => {
                          setDraggedFileId(file.id);
                          e.dataTransfer.setData('text/plain', file.id);
                        }}
                        onDragEnd={() => {
                          setDraggedFileId(null);
                          setDragOverFolderId(null);
                        }}
                        className={`p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isSelected
                            ? 'bg-[#24211D]'
                            : 'hover:bg-[#24211D]/60'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Select ${file.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFile(file.id);
                            }}
                            className={`w-8 h-8 border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                                : 'bg-[#141311] border-[#2C2824] text-[#9E978E] hover:border-[#D97757] hover:text-[#F2EFE9]'
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            onClick={() => setInspectedFile(file)}
                            className="w-10 h-10 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0 cursor-pointer overflow-hidden"
                            title="Preview File"
                          >
                            {file.previewDataUrl && file.mimeType.startsWith('image/') ? (
                              <img
                                src={file.previewDataUrl}
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              renderFileIcon(file)
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setInspectedFile(file)}
                                className="text-sm font-bold text-[#F2EFE9] hover:text-[#D97757] text-left truncate cursor-pointer"
                                title={file.name}
                              >
                                {file.name}
                              </button>
                              {fileTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-[#141311] border border-[#2C2824] text-[#D97757]"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#9E978E] tabular-nums mt-0.5">
                              <span className="text-[#F2EFE9] font-medium">
                                {formatBytes(file.sizeBytes)}
                              </span>
                              <span>·</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
                              {existingShare && (
                                <>
                                  <span>·</span>
                                  <span className="text-[#389E6C] font-semibold">Shared</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1.5 shrink-0">
                          <button
                            onClick={() => setInspectedFile(file)}
                            className="min-h-[36px] px-2.5 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                            title="Preview File"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#D97757]" />
                            <span className="hidden lg:inline">Preview</span>
                          </button>
                          {!isLocked && (
                            <>
                              <button
                                onClick={() => setMoveModalFile(file)}
                                className="min-h-[36px] px-2.5 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                                title="Move File"
                              >
                                <FolderInput className="w-3.5 h-3.5 text-[#D97757]" />
                                <span className="hidden lg:inline">Move</span>
                              </button>
                              <button
                                onClick={() => setShareModalFile(file)}
                                className="min-h-[36px] px-2.5 py-1 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                                title="Share Link"
                              >
                                <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                                <span className="hidden lg:inline">
                                  {existingShare ? 'Shared' : 'Share'}
                                </span>
                              </button>
                              <button
                                onClick={() => handleDownloadFile(file)}
                                className="min-h-[36px] px-3 py-1 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center gap-1 cursor-pointer"
                                title="Download File"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Download</span>
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleToggleStar(file)}
                            className={`min-w-[36px] min-h-[36px] flex items-center justify-center border border-[#2C2824] bg-[#141311] cursor-pointer ${
                              file.starred ? 'text-[#D97757]' : 'text-[#9E978E] hover:text-[#F2EFE9]'
                            }`}
                            title="Star File"
                          >
                            <Star className="w-3.5 h-3.5" fill={file.starred ? '#D97757' : 'none'} />
                          </button>
                          <button
                            onClick={() =>
                              setDeleteTarget({
                                type: 'file',
                                id: file.id,
                                name: file.name,
                                subtitle: `Size: ${formatBytes(file.sizeBytes)}`,
                              })
                            }
                            className="min-w-[36px] min-h-[36px] flex items-center justify-center border border-[#2C2824] bg-[#141311] text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                            title="Move to Trash"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ============================================================
                    GRID VIEW LAYOUT
                ============================================================ */
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    const isLocked = Boolean(file.lockedOverQuota);
                    const isSelected = selectedFileIds.includes(file.id);
                    const fileTags = Array.isArray(file.tags) ? file.tags : [];
                    return (
                      <div
                        key={file.id}
                        draggable={!isLocked}
                        onMouseEnter={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onTouchStart={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onDragStart={(e) => {
                          setDraggedFileId(file.id);
                          e.dataTransfer.setData('text/plain', file.id);
                        }}
                        onDragEnd={() => {
                          setDraggedFileId(null);
                          setDragOverFolderId(null);
                        }}
                        className={`p-4 sm:p-5 border transition-colors flex flex-col justify-between gap-4 ${
                          isSelected
                            ? 'bg-[#24211D] border-[#D97757]'
                            : isLocked
                            ? 'bg-[#1C1A17] border-[#D99B26]/80'
                            : 'bg-[#1C1A17] border-[#2C2824] hover:border-[#D97757]/70'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5">
                              {/* Batch Action Selection Checkbox */}
                              <button
                                type="button"
                                role="checkbox"
                                aria-checked={isSelected}
                                aria-label={`Select ${file.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelectFile(file.id);
                                }}
                                className={`w-9 h-9 border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                                    : 'bg-[#141311] border-[#2C2824] text-[#9E978E] hover:border-[#D97757] hover:text-[#F2EFE9]'
                                }`}
                                title={isSelected ? 'Deselect file' : 'Select file for batch action'}
                              >
                                {isSelected ? (
                                  <CheckSquare className="w-4 h-4" />
                                ) : (
                                  <Square className="w-4 h-4" />
                                )}
                              </button>

                              <button
                                onClick={() => setInspectedFile(file)}
                                className="w-11 h-11 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0 cursor-pointer overflow-hidden"
                                title="Preview File"
                              >
                                {file.previewDataUrl && file.mimeType.startsWith('image/') ? (
                                  <img
                                    src={file.previewDataUrl}
                                    alt={file.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  renderFileIcon(file)
                                )}
                              </button>
                            </div>

                            <div className="flex items-center -mr-2 -mt-2">
                              <button
                                onClick={() => setInspectedFile(file)}
                                className="min-w-[36px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                                title="Preview File (MKV / Video / Image / PDF)"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setTagModalFiles([file])}
                                className="min-w-[36px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#D97757] cursor-pointer"
                                title="Manage Labels / Tags"
                              >
                                <Tag className="w-4 h-4" />
                              </button>
                              {!isLocked && (
                                <>
                                  <button
                                    onClick={() => {
                                      setMoveModalMode('copy');
                                      setMoveModalFile(file);
                                    }}
                                    className="min-w-[34px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#D97757] cursor-pointer"
                                    title="Copy File to Another Folder"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => void handleToggleOfflineFile(file)}
                                    disabled={savingOfflineFileId === file.id}
                                    className={`min-w-[34px] min-h-[44px] flex items-center justify-center cursor-pointer ${
                                      offlineFilesMap[file.id]
                                        ? 'text-[#2E9E6B]'
                                        : 'text-[#9E978E] hover:text-[#D97757]'
                                    }`}
                                    title={
                                      offlineFilesMap[file.id]
                                        ? 'Saved Offline on Device (Tap to Remove)'
                                        : 'Save Offline to Local Device Storage'
                                    }
                                  >
                                    <Smartphone className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => handleToggleStar(file)}
                                className={`min-w-[34px] min-h-[44px] flex items-center justify-center cursor-pointer ${
                                  file.starred
                                    ? 'text-[#D97757]'
                                    : 'text-[#9E978E] hover:text-[#F2EFE9]'
                                }`}
                                title="Star File"
                              >
                                <Star
                                  className="w-4 h-4"
                                  fill={file.starred ? '#D97757' : 'none'}
                                />
                              </button>
                              <button
                                onClick={() =>
                                  setDeleteTarget({
                                    type: 'file',
                                    id: file.id,
                                    name: file.name,
                                    subtitle: `Size: ${formatBytes(file.sizeBytes)}`,
                                  })
                                }
                                className="min-w-[34px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                                title="Move File to Trash"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div>
                            <button
                              onClick={() => setInspectedFile(file)}
                              className="text-sm font-bold text-[#F2EFE9] hover:text-[#D97757] text-left break-all line-clamp-1 cursor-pointer"
                              title={file.name}
                            >
                              {file.name}
                            </button>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#9E978E] mt-1 tabular-nums">
                              <span className="text-[#F2EFE9] font-medium">
                                {formatBytes(file.sizeBytes)}
                              </span>
                              <span aria-hidden="true">·</span>
                              {isLocked ? (
                                <span className="text-[#D99B26] font-semibold">
                                  Locked (&gt;25 GB Limit)
                                </span>
                              ) : offlineFilesMap[file.id] ? (
                                <span className="text-[#2E9E6B] font-semibold">
                                  Offline Ready
                                </span>
                              ) : savingOfflineFileId === file.id ? (
                                <span className="text-[#D97757] font-semibold">
                                  Saving Offline ({offlineProgressPct}%)
                                </span>
                              ) : (
                                <span>Encrypted Vault</span>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
                            </div>

                            {/* File Tags / Custom Labels Row */}
                            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                              {fileTags.map((tag) => {
                                const isFiltered =
                                  selectedTagFilter?.toLowerCase() === tag.toLowerCase();
                                return (
                                  <span
                                    key={tag}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold border transition-colors ${
                                      isFiltered
                                        ? 'bg-[#D97757] border-[#D97757] text-[#141311]'
                                        : 'bg-[#141311] border-[#2C2824] text-[#F2EFE9]'
                                    }`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedTagFilter(isFiltered ? null : tag)
                                      }
                                      className="hover:underline cursor-pointer"
                                      title={`Filter by "${tag}"`}
                                    >
                                      {tag}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickRemoveTag(file, tag);
                                      }}
                                      className={`ml-0.5 cursor-pointer ${
                                        isFiltered
                                          ? 'text-[#141311]/70 hover:text-[#141311]'
                                          : 'text-[#9E978E] hover:text-[#D94848]'
                                      }`}
                                      title={`Remove "${tag}" label`}
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </span>
                                );
                              })}
                              <button
                                type="button"
                                onClick={() => setTagModalFiles([file])}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-[#141311] border border-[#2C2824] hover:border-[#D97757] text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                                title="Add or edit custom labels"
                              >
                                <Plus className="w-2.5 h-2.5 text-[#D97757]" />
                                <span>{fileTags.length === 0 ? 'Add Label' : 'Label'}</span>
                              </button>
                            </div>
                          </div>
                        </div>

                        {isLocked ? (
                          <div className="pt-3 border-t border-[#2C2824]">
                            <button
                              onClick={() => setActiveView('pricing')}
                              className="w-full min-h-[44px] py-2.5 px-3 text-xs font-bold bg-[#24211D] border border-[#D99B26] text-[#D99B26] hover:bg-[#D99B26] hover:text-[#141311] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              Extend Plan to Unlock
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-4 gap-1.5 pt-3 border-t border-[#2C2824]">
                            <button
                              onClick={() => {
                                setMoveModalMode('move');
                                setMoveModalFile(file);
                              }}
                              className="min-h-[42px] py-2 px-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1 cursor-pointer"
                              title="Move File"
                            >
                              <FolderInput className="w-3.5 h-3.5 text-[#D97757]" />
                              <span>Move</span>
                            </button>

                            <button
                              onClick={() => {
                                setMoveModalMode('copy');
                                setMoveModalFile(file);
                              }}
                              className="min-h-[42px] py-2 px-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1 cursor-pointer"
                              title="Copy File to Another Folder"
                            >
                              <Copy className="w-3.5 h-3.5 text-[#D97757]" />
                              <span>Copy</span>
                            </button>

                            <button
                              onClick={() => setShareModalFile(file)}
                              className="min-h-[42px] py-2 px-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1 cursor-pointer"
                              title="Share File"
                            >
                              <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                              <span>{existingShare ? 'Shared' : 'Share'}</span>
                            </button>

                            <button
                              onClick={() => handleDownloadFile(file)}
                              className="min-h-[42px] py-2 px-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1 cursor-pointer"
                              title="Download File"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Save</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================================================
            VIEW 1B: TRASH BIN (Restore or Permanently Delete)
        ================================================================== */}
        {activeView === 'trash' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#2C2824] pb-4">
              <div>
                <h1 className="text-xl font-bold tracking-tight flex items-center gap-2.5">
                  <Trash2 className="w-5 h-5 text-[#D97757]" />
                  <span>Trash Bin</span>
                </h1>
                <p className="text-sm text-[#9E978E] mt-1">
                  Restore accidentally deleted files and folders, or permanently erase them from cloud storage.
                </p>
              </div>
              {totalTrashCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setDeleteTarget({
                      type: 'empty-trash',
                      id: 'empty-trash',
                      name: 'All Trashed Items',
                      subtitle: `${totalTrashCount} items in Trash Bin`,
                      permanent: true,
                    })
                  }
                  className="min-h-[42px] px-4 py-2 text-xs font-bold bg-[#D94848] text-[#F2EFE9] hover:bg-[#C53B3B] flex items-center justify-center gap-2 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Empty Trash ({totalTrashCount})</span>
                </button>
              )}
            </div>

            {totalTrashCount === 0 ? (
              <div className="p-12 bg-[#1C1A17] border border-[#2C2824] text-center space-y-3">
                <Trash2 className="w-8 h-8 text-[#9E978E] mx-auto" />
                <div className="text-base font-bold text-[#F2EFE9]">Trash Bin is Empty</div>
                <p className="text-xs text-[#9E978E] max-w-md mx-auto">
                  Items moved to Trash will appear here so you can restore them anytime before permanent deletion.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {trashedFolders.length > 0 && (
                  <div className="space-y-2.5">
                    <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                      Trashed Folders ({trashedFolders.length})
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {trashedFolders.map((folder) => (
                        <div
                          key={folder.id}
                          className="p-4 bg-[#1C1A17] border border-[#2C2824] flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Folder className="w-6 h-6 text-[#9E978E] shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[#F2EFE9] truncate">
                                {folder.name}
                              </div>
                              <div className="text-xs text-[#9E978E]">Folder in Trash</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRestoreFolder(folder)}
                              className="min-h-[36px] px-3 py-1 text-xs font-bold bg-[#24211D] border border-[#389E6C] text-[#389E6C] hover:bg-[#389E6C] hover:text-[#141311] flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  type: 'folder',
                                  id: folder.id,
                                  name: folder.name,
                                  subtitle: 'Permanently delete folder',
                                  permanent: true,
                                })
                              }
                              className="min-h-[36px] px-2.5 py-1 text-xs font-semibold bg-[#141311] border border-[#D94848] text-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] cursor-pointer"
                              title="Delete Forever"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {trashedFiles.length > 0 && (
                  <div className="space-y-2.5">
                    <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                      Trashed Files ({trashedFiles.length})
                    </h2>
                    <div className="bg-[#1C1A17] border border-[#2C2824] divide-y divide-[#2C2824]">
                      {trashedFiles.map((file) => (
                        <div
                          key={file.id}
                          className="p-3.5 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                              {renderFileIcon(file)}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-bold text-[#F2EFE9] truncate">
                                {file.name}
                              </div>
                              <div className="text-xs text-[#9E978E] tabular-nums">
                                {formatBytes(file.sizeBytes)} · Trashed{' '}
                                {formatShortDate(file.trashedAt || file.updatedAt)}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRestoreFile(file)}
                              className="min-h-[36px] px-3 py-1.5 text-xs font-bold bg-[#24211D] border border-[#389E6C] text-[#389E6C] hover:bg-[#389E6C] hover:text-[#141311] flex items-center gap-1.5 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Restore</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  type: 'file',
                                  id: file.id,
                                  name: file.name,
                                  subtitle: `Size: ${formatBytes(file.sizeBytes)}`,
                                  permanent: true,
                                })
                              }
                              className="min-h-[36px] px-3 py-1.5 text-xs font-semibold bg-[#141311] border border-[#D94848] text-[#D94848] hover:bg-[#D94848] hover:text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Forever</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================
            VIEW 2: SHARED LINKS
        ================================================================== */}
        {activeView === 'shares' && (
          <SharedLinksView
            shares={shares}
            onToggleShareActive={handleToggleShareActive}
            onUpdateShareThrottle={handleUpdateShareThrottle}
            onDeleteShare={handleDeleteShare}
            onOpenPublicPortal={(tok) => setPublicShareToken(tok)}
          />
        )}

        {/* ==================================================================
            VIEW 3: STORAGE PRICING & TOKEN WALLET
        ================================================================== */}
        {activeView === 'pricing' && currentUser && (
          <StoragePricingView
            user={currentUser}
            lockedFilesCount={lockedFilesCount}
            onOpenBuyTokens={() => setShowBuyTokensModal(true)}
            onRedeemPromo={handleRedeemPromo}
            onSubscribePlan={handleSubscribePlan}
            onSimulateExpiry={handleSimulateExpiry}
          />
        )}

        {/* ==================================================================
            VIEW 1C: MEDIA GALLERY WITH SEARCH BAR & OFFLINE VAULT
        ================================================================== */}
        {activeView === 'gallery' && (
          <MediaGalleryView
            files={files}
            folders={folders}
            offlineMap={offlineFilesMap}
            savingOfflineId={savingOfflineFileId}
            offlineProgressPct={offlineProgressPct}
            firebaseUid={firebaseUser?.uid || currentUser?.id || ''}
            firebaseEmail={firebaseUser?.email || currentUser?.email || ''}
            onInspectFile={(f) => setInspectedFile(f)}
            onCopyFile={(f) => {
              setMoveModalMode('copy');
              setMoveModalFile(f);
            }}
            onShareFile={(f) => setShareModalFile(f)}
            onDownloadFile={handleDownloadFile}
            onToggleOffline={(f) => void handleToggleOfflineFile(f)}
          />
        )}

        {/* ==================================================================
            VIEW 3B: NOTIFICATION & OFFLINE STORAGE SETTINGS VIEW
        ================================================================== */}
        {activeView === 'settings' && (
          <NotificationSettingsView
            prefs={notificationPrefs}
            offlineMap={offlineFilesMap}
            onUpdatePrefs={(next) => {
              setNotificationPrefs(next);
              saveNotificationPreferences(next);
            }}
            onTestToast={() => {
              pushNotification({
                id: `test_alert_${Date.now()}`,
                timestamp: new Date().toISOString(),
                title: 'Large Transfer Complete (Test)',
                message: '4K-Master-Archive.mkv (1.4 GB) uploaded at 100% original quality.',
                type: 'completed',
                bytes: 1400 * 1024 * 1024,
              });
            }}
            onRemoveOfflineFile={async (fid) => {
              await removeFileFromOffline(fid);
              setOfflineFilesMap(getOfflineSavedFilesMap());
            }}
            onClearAllOffline={async () => {
              await clearAllOfflineFiles();
              setOfflineFilesMap({});
              pushNotification({
                id: `clear_offline_${Date.now()}`,
                timestamp: new Date().toISOString(),
                title: 'Offline Storage Cleared',
                message: 'All locally cached offline files were removed from this device.',
                type: 'info',
              });
            }}
            onOpenOfflineFile={(fid) => {
              const found = files.find((f) => f.id === fid);
              if (found) setInspectedFile(found);
            }}
          />
        )}

        {/* ==================================================================
            VIEW 4: ADMIN-ONLY STORAGE NODE SETUP
        ================================================================== */}
        {activeView === 'telegram_settings' && isAdminUser && (
          <TelegramStorageView
            config={telegramConfig}
            authHeaders={authHeaders}
            onSaveConfig={handleSaveTelegramConfig}
            onSendMtprotoCode={handleSendMtprotoCode}
            onVerifyMtprotoCode={handleVerifyMtprotoCode}
            onDisconnectMtproto={handleDisconnectMtproto}
          />
        )}
      </main>

      {/* ====================================================================
          FULL-SCREEN DESKTOP DRAG & DROP UPLOAD OVERLAY
      ==================================================================== */}
      {isDraggingOver && !draggedFileId && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dragDepthRef.current = 0;
            setIsDraggingOver(false);
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
              if (activeView !== 'explorer') {
                setActiveView('explorer');
              }
              handleUploadFiles(e.dataTransfer.files);
            }
          }}
          className="fixed inset-0 z-50 bg-[#141311]/90 backdrop-blur-sm border-4 border-dashed border-[#D97757] m-3 flex items-center justify-center p-6 pointer-events-auto"
        >
          <div className="max-w-md w-full bg-[#1C1A17] border border-[#D97757] p-8 text-center space-y-4 shadow-2xl pointer-events-none">
            <div className="w-16 h-16 mx-auto bg-[#24211D] border border-[#D97757] flex items-center justify-center">
              <Upload className="w-8 h-8 text-[#D97757]" />
            </div>
            <div className="space-y-1.5">
              <div className="text-lg font-bold text-[#F2EFE9]">
                Drop Files Anywhere to Upload
              </div>
              <p className="text-xs text-[#9E978E]">
                Uploading to{' '}
                <strong className="text-[#F2EFE9]">
                  {activeFolder ? activeFolder.name : 'My Cloud Drive (Root)'}
                </strong>{' '}
                in <strong className="text-[#D97757]">100% Original Lossless Quality</strong>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          GOOGLE DRIVE-STYLE MOBILE FLOATING PLUS (+) UPLOAD BUTTON & ACTION SHEET
      ==================================================================== */}
      {showMobilePlusMenu && (
        <div
          onClick={() => setShowMobilePlusMenu(false)}
          className="fixed inset-0 z-40 bg-black/60 md:hidden flex items-end justify-end p-4 pb-36"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs bg-[#1C1A17] border border-[#D97757] shadow-2xl divide-y divide-[#2C2824]"
          >
            <div className="px-4 py-2.5 bg-[#24211D] flex items-center justify-between">
              <span className="text-xs font-bold text-[#F2EFE9] uppercase tracking-wider">
                Add to {activeFolder ? activeFolder.name : 'Cloud Drive'}
              </span>
              <button
                type="button"
                onClick={() => setShowMobilePlusMenu(false)}
                className="p-1 text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMobilePlusMenu(false);
                if (activeView !== 'explorer') setActiveView('explorer');
                fileInputRef.current?.click();
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-9 h-9 bg-[#D97757] text-[#141311] flex items-center justify-center shrink-0">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#F2EFE9]">
                  Upload Files / Videos / Photos
                </div>
                <div className="text-[11px] text-[#9E978E]">
                  100% Original Quality via Main Account
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMobilePlusMenu(false);
                if (activeView !== 'explorer') setActiveView('explorer');
                setCreatingFolder(true);
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-9 h-9 bg-[#24211D] border border-[#2C2824] text-[#D97757] flex items-center justify-center shrink-0">
                <FolderPlus className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#F2EFE9]">Create New Folder</div>
                <div className="text-[11px] text-[#9E978E]">
                  Organize files with optional PIN lock
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowMobilePlusMenu(false);
                if (activeView !== 'explorer') setActiveView('explorer');
                setShowRemoteModal(true);
              }}
              className="w-full px-4 py-3.5 text-left flex items-center gap-3 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-9 h-9 bg-[#24211D] border border-[#2C2824] text-[#D97757] flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-[#F2EFE9]">Upload from Web Link</div>
                <div className="text-[11px] text-[#9E978E]">
                  Fetch direct URL to your cloud vault
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="fixed right-4 bottom-20 z-40 md:hidden flex items-center shadow-2xl">
        <button
          type="button"
          onClick={() => {
            if (activeView !== 'explorer') setActiveView('explorer');
            fileInputRef.current?.click();
          }}
          disabled={uploadingFiles}
          title="Tap to Upload Files in Original Quality"
          aria-label="Upload Files"
          className="h-14 px-4 bg-[#D97757] text-[#141311] hover:bg-[#E08568] active:scale-95 transition-all flex items-center justify-center gap-2 font-bold text-xs border-r border-[#141311]/20 cursor-pointer"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
          <span>Upload</span>
        </button>
        <button
          type="button"
          onClick={() => setShowMobilePlusMenu((prev) => !prev)}
          title="More Upload & Folder Options"
          aria-label="More Upload Options"
          className="w-11 h-14 bg-[#24211D] border border-[#D97757] text-[#D97757] hover:bg-[#D97757] hover:text-[#141311] active:scale-95 transition-all flex items-center justify-center cursor-pointer"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      </div>

      {/* ====================================================================
          MOBILE FIXED BOTTOM TAB BAR
      ==================================================================== */}
      <nav
        className={`fixed bottom-0 left-0 right-0 z-40 md:hidden grid ${
          isAdminUser ? 'grid-cols-6' : 'grid-cols-5'
        } bg-[#1C1A17] border-t border-[#2C2824]`}
      >
        <button
          onClick={() => {
            setActiveView('explorer');
            setOnlyStarred(false);
            setOnlyOffline(false);
          }}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeView === 'explorer' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Folder className="w-4 h-4" />
          <span>Files</span>
        </button>

        <button
          onClick={() => setActiveView('gallery')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeView === 'gallery' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Film className="w-4 h-4" />
          <span>Gallery</span>
        </button>

        <button
          onClick={() => setActiveView('shares')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeView === 'shares' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Link2 className="w-4 h-4" />
          <span>Shared</span>
        </button>

        <button
          onClick={() => setActiveView('trash')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeView === 'trash' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          <span>Trash</span>
        </button>

        <button
          onClick={() => setActiveView('settings')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
            activeView === 'settings' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Bell className="w-4 h-4" />
          <span>Alerts</span>
        </button>

        {isAdminUser && (
          <button
            onClick={() => setActiveView('telegram_settings')}
            className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[10px] font-medium cursor-pointer ${
              activeView === 'telegram_settings'
                ? 'text-[#D97757] font-bold'
                : 'text-[#9E978E]'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Node</span>
          </button>
        )}
      </nav>

      {/* ====================================================================
          REAL-TIME COMPLETION NOTIFICATION POPUP (Configurable Duration + Swipe + X)
      ==================================================================== */}
      {notifications.length > 0 && (
        <div className="fixed bottom-20 md:bottom-5 left-4 right-4 md:left-auto md:right-5 z-50 md:w-full md:max-w-sm space-y-2 pointer-events-none">
          {notifications.map((n) => (
            <ToastNotificationCard
              key={n.id}
              notification={n}
              durationSeconds={notificationPrefs.toastDurationSeconds}
              onDismiss={(id) =>
                setNotifications((prev) => prev.filter((item) => item.id !== id))
              }
            />
          ))}
        </div>
      )}

      {/* ====================================================================
          MODALS
      ==================================================================== */}
      {showRemoteModal && (
        <RemoteUploadModal
          folders={folders.filter((fl) => !fl.trashed)}
          currentFolderId={currentFolderId}
          onClose={() => setShowRemoteModal(false)}
          onStartRemoteUpload={handleStartRemoteUpload}
        />
      )}

      {(shareModalFile || shareModalFolder) && (
        <CreateShareModal
          file={shareModalFile}
          folder={shareModalFolder}
          existingShare={
            shareModalFolder
              ? shares.find(
                  (s) =>
                    s.folderId === shareModalFolder.id ||
                    (s.targetType === 'folder' && s.fileId === shareModalFolder.id)
                )
              : shareModalFile
              ? shares.find((s) => s.fileId === shareModalFile.id)
              : undefined
          }
          defaultThrottleKbps={bandwidthSettings.defaultShareThrottleKbps}
          onClose={() => {
            setShareModalFile(null);
            setShareModalFolder(null);
          }}
          onCreateShare={handleCreateShare}
          onUpdateShare={handleUpdateShare}
          onPreviewPublicPortal={(tok) => setPublicShareToken(tok)}
        />
      )}

      {folderPinModalState && (
        <FolderPinModal
          state={folderPinModalState}
          onClose={() => setFolderPinModalState(null)}
          onUnlockSuccess={(folder) => {
            setUnlockedFolderIds((prev) => Array.from(new Set([...prev, folder.id])));
            setCurrentFolderId(folder.id);
          }}
          onSavePin={handleSaveFolderPin}
          verifyPinFn={async (inputPin, storedHash) => verifyFolderPin(inputPin, storedHash)}
        />
      )}

      {inspectedFile && (
        <FileDetailDrawer
          file={inspectedFile}
          currentFolderName={
            folders.find((fl) => fl.id === inspectedFile.folderId)?.name ||
            'My Cloud Drive (Root)'
          }
          firebaseUid={firebaseUser?.uid || currentUser?.id || ''}
          firebaseEmail={firebaseUser?.email || currentUser?.email || ''}
          isSavedOffline={Boolean(offlineFilesMap[inspectedFile.id])}
          onClose={() => setInspectedFile(null)}
          onDownload={handleDownloadFile}
          onOpenShareModal={(f) => setShareModalFile(f)}
          onOpenMoveModal={(f) => {
            setMoveModalMode('move');
            setMoveModalFile(f);
          }}
          onOpenCopyModal={(f) => {
            setMoveModalMode('copy');
            setMoveModalFile(f);
          }}
          onToggleOffline={(f) => void handleToggleOfflineFile(f)}
          onRequestDelete={(f) =>
            setDeleteTarget({
              type: 'file',
              id: f.id,
              name: f.name,
              subtitle: `Size: ${formatBytes(f.sizeBytes)}`,
            })
          }
          onGoToPricing={() => setActiveView('pricing')}
        />
      )}

      {(moveModalFile || (batchMoveFiles && batchMoveFiles.length > 0)) && (
        <MoveFileModal
          file={moveModalFile}
          targetFiles={batchMoveFiles || undefined}
          mode={moveModalMode}
          folders={folders.filter((fl) => !fl.trashed)}
          files={activeFiles}
          onClose={() => {
            setMoveModalFile(null);
            setBatchMoveFiles(null);
          }}
          onMoveFile={handleMoveFile}
          onMoveFiles={handleBatchMoveFiles}
          onCopyFiles={handleCopyFiles}
          onCreateFolder={handleCreateFolderFromModal}
        />
      )}

      {tagModalFiles && tagModalFiles.length > 0 && (
        <ManageTagsModal
          targetFiles={tagModalFiles}
          allExistingTags={allExistingTagNames}
          onClose={() => setTagModalFiles(null)}
          onSaveTags={handleSaveFileTags}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          target={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={executeDeleteTarget}
        />
      )}

      {showBuyTokensModal && (
        <BuyTokensModal
          currentBalance={tokenBalance}
          onClose={() => setShowBuyTokensModal(false)}
          onRedeemPromo={handleRedeemPromo}
          onPurchaseTokens={handlePurchaseTokens}
        />
      )}

      {showAuthModal && currentUser && (
        <AuthModal
          currentUser={currentUser}
          isAdmin={isAdminUser}
          onClose={() => setShowAuthModal(false)}
          onGoogleSignIn={handleGoogleSignIn}
          onSignOut={handleSignOut}
        />
      )}
    </div>
  );
}
