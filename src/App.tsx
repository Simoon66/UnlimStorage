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
  Pencil,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  CornerLeftUp,
  Menu,
  MoreVertical,
  SlidersHorizontal,
  Sparkles,
  HardDrive,
  LogOut,
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
  subscribeToGlobalUploadPolicy,
  GlobalUploadPolicy,
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
  getOfflineSavedFileRecords,
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
    return <Lock className="w-5 h-5 text-amber-500" />;
  }
  if (
    file.mimeType.startsWith('image/') ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(file.name)
  ) {
    return <ImageIcon className="w-5 h-5 text-blue-400" />;
  }
  if (file.mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|wmv)$/i.test(file.name)) {
    return <Film className="w-5 h-5 text-purple-400" />;
  }
  if (file.mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name)) {
    return <Music className="w-5 h-5 text-emerald-400" />;
  }
  if (/\.(json|sh|ts|tsx|js|py|html|css|sql|yaml|yml)$/i.test(file.name)) {
    return <FileCode className="w-5 h-5 text-cyan-400" />;
  }
  if (/\.(csv|xls|xlsx)$/i.test(file.name)) {
    return <FileSpreadsheet className="w-5 h-5 text-emerald-400" />;
  }
  return <FileText className="w-5 h-5 text-amber-400" />;
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
      className="pointer-events-auto relative overflow-hidden bg-[#12131C] border border-[#2563EB]/40 p-4 rounded-xl flex items-start justify-between gap-3 select-none cursor-grab active:cursor-grabbing shadow-xl text-white"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {notification.type === 'error' ? (
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        )}
        <div className="space-y-0.5 min-w-0">
          <div className="text-xs font-bold text-white">{notification.title}</div>
          <div className="text-xs text-zinc-400 break-words">{notification.message}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          triggerDismiss();
        }}
        aria-label="Dismiss notification"
        className="min-w-[32px] min-h-[32px] -mr-1.5 -mt-1.5 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer shrink-0 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      {/* 4-second auto-dismiss countdown progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10">
        <div
          className={`h-full transition-all duration-75 ${
            notification.type === 'error' ? 'bg-rose-500' : 'bg-blue-500'
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
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<'all' | 'image' | 'video' | 'document' | 'other'>('all');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
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
  const touchDragSelectActiveRef = useRef<boolean>(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Explorer Sort state (Name, Size, Date Modified, Type + Asc/Desc direction)
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'size' | 'type'>(() => {
    try {
      const saved = localStorage.getItem('unlimcloud_sort_by_v1');
      if (saved === 'name' || saved === 'size' || saved === 'date' || saved === 'type') {
        return saved;
      }
      return 'date';
    } catch {
      return 'date';
    }
  });
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    try {
      const saved = localStorage.getItem('unlimcloud_sort_order_v1');
      return saved === 'asc' || saved === 'desc' ? saved : 'desc';
    } catch {
      return 'desc';
    }
  });
  const [showSortMenu, setShowSortMenu] = useState<boolean>(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  // Desktop 'Lasso' Drag-to-Select Marquee State
  const [lassoModeActive, setLassoModeActive] = useState<boolean>(false);
  const [lassoBox, setLassoBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const lassoContainerRef = useRef<HTMLDivElement | null>(null);
  const lassoBaselineSelectionRef = useRef<string[]>([]);

  // Global Upload Policy & User Restriction State (5B-Scale Admin Governance)
  const [globalUploadPolicy, setGlobalUploadPolicyState] = useState<GlobalUploadPolicy>({
    uploadsEnabled: true,
    uploadDisabledReason: '',
  });
  const [userProfileFlags, setUserProfileFlags] = useState<{
    isRestricted: boolean;
    uploadDisabled: boolean;
  }>({
    isRestricted: false,
    uploadDisabled: false,
  });

  useEffect(() => {
    const unsub = subscribeToGlobalUploadPolicy((policy) => {
      setGlobalUploadPolicyState(policy);
    });
    return () => unsub();
  }, []);

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

  // Skeleton Loading State (Data Fetching & Navigation Transitions)
  const [isFetchingWorkspace, setIsFetchingWorkspace] = useState<boolean>(true);
  const [isNavigatingExplorer, setIsNavigatingExplorer] = useState<boolean>(false);
  const navSkeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMountedNavRef = useRef<boolean>(false);

  // Right-Click File Context Menu & Rename File Modal State
  const [fileContextMenu, setFileContextMenu] = useState<{
    file: FileRecord;
    x: number;
    y: number;
  } | null>(null);
  const [renameModalFile, setRenameModalFile] = useState<FileRecord | null>(null);
  const [renameInputValue, setRenameInputValue] = useState<string>('');
  const [renamingBusy, setRenamingBusy] = useState<boolean>(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

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

  // Perceived-performance skeleton transition when navigating folders or filters
  useEffect(() => {
    if (!hasMountedNavRef.current) {
      hasMountedNavRef.current = true;
      return;
    }
    setIsNavigatingExplorer(true);
    if (navSkeletonTimerRef.current) {
      clearTimeout(navSkeletonTimerRef.current);
    }
    navSkeletonTimerRef.current = setTimeout(() => {
      setIsNavigatingExplorer(false);
      navSkeletonTimerRef.current = null;
    }, 220);
    return () => {
      if (navSkeletonTimerRef.current) {
        clearTimeout(navSkeletonTimerRef.current);
      }
    };
  }, [currentFolderId, onlyStarred, onlyOffline, selectedTagFilter, activeView]);

  // Dismiss right-click context menu on outside click, scroll, resize, or Escape
  useEffect(() => {
    if (!fileContextMenu) return;
    const handleDismiss = () => setFileContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFileContextMenu(null);
    };
    window.addEventListener('click', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fileContextMenu]);

  // Close Sort dropdown menu on outside click or Escape key
  useEffect(() => {
    if (!showSortMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSortMenu(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSortMenu]);

  // Auto-focus and highlight filename stem when Rename modal opens
  useEffect(() => {
    if (!renameModalFile) return;
    setRenameInputValue(renameModalFile.name);
    const timer = setTimeout(() => {
      const input = renameInputRef.current;
      if (!input) return;
      input.focus();
      const lastDotIdx = renameModalFile.name.lastIndexOf('.');
      if (lastDotIdx > 0) {
        input.setSelectionRange(0, lastDotIdx);
      } else {
        input.select();
      }
    }, 40);
    return () => clearTimeout(timer);
  }, [renameModalFile]);

  const loadWorkspaceData = useCallback(async () => {
    if (!firebaseUser) {
      setIsFetchingWorkspace(false);
      return;
    }
    setIsFetchingWorkspace(true);
    try {
      const isAdminEmail = firebaseUser.email?.toLowerCase() === 'titumamma2425@gmail.com';

      // 1. Pull permanent cross-device drive metadata & global Telegram node config from Firestore
      try {
        const [cloudDrive, nodeConfig] = await Promise.all([
          fetchUserCloudDriveFromFirestore(firebaseUser),
          fetchStorageNodeConfigFromFirestore(),
        ]);

        if (cloudDrive.profile) {
          setUserProfileFlags({
            isRestricted: Boolean(cloudDrive.profile.isRestricted),
            uploadDisabled: Boolean(cloudDrive.profile.uploadDisabled),
          });
        }

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
    } finally {
      setIsFetchingWorkspace(false);
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

    const handleChunksSynced = (ev: Event) => {
      const custom = ev as CustomEvent<{
        fileId: string;
        telegramChunks: FileRecord['telegramChunks'];
        telegramChatId?: string;
      }>;
      const detail = custom.detail;
      if (!detail?.fileId || !Array.isArray(detail.telegramChunks)) return;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === detail.fileId
            ? {
                ...f,
                storageDriver: 'telegram',
                telegramChunks: detail.telegramChunks,
                telegramChatId: detail.telegramChatId || f.telegramChatId,
              }
            : f
        )
      );
      setInspectedFile((prev) =>
        prev && prev.id === detail.fileId
          ? {
              ...prev,
              storageDriver: 'telegram',
              telegramChunks: detail.telegramChunks,
              telegramChatId: detail.telegramChatId || prev.telegramChatId,
            }
          : prev
      );
    };

    window.addEventListener('unlim:file-chunks-synced', handleChunksSynced);

    return () => {
      window.removeEventListener('unlim:file-chunks-synced', handleChunksSynced);
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

    const isAdminAccount =
      firebaseUser?.email?.toLowerCase() === 'titumamma2425@gmail.com' ||
      currentUser?.role === 'admin';

    if (!isAdminAccount && userProfileFlags.isRestricted) {
      pushNotification({
        id: `restrict_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Account Restricted by Administrator',
        message:
          'Your account or data access has been restricted by the administrator. File uploads are disabled.',
        type: 'error',
      });
      return;
    }

    if (!isAdminAccount && userProfileFlags.uploadDisabled) {
      pushNotification({
        id: `up_user_off_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Uploads Disabled for Your Account',
        message: 'File uploads have been turned off for your User ID by the administrator.',
        type: 'error',
      });
      return;
    }

    if (!isAdminAccount && !globalUploadPolicy.uploadsEnabled) {
      pushNotification({
        id: `up_global_off_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'File Uploads Temporarily Paused',
        message:
          globalUploadPolicy.uploadDisabledReason ||
          'File uploads are currently turned off by the administrator.',
        type: 'error',
      });
      return;
    }

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
    setTransfers((prev) =>
      prev.filter(
        (t) =>
          t.status !== 'streaming' &&
          t.status !== 'queued' &&
          t.status !== 'syncing_telegram'
      )
    );
  };

  const handleCancelRemoteTransfer = async (jobId: string) => {
    await apiFetch(`/api/transfers/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: authHeaders(),
    }).catch(() => null);
    setTransfers((prev) => prev.filter((t) => t.id !== jobId));
    pushNotification({
      id: `cancel_rm_${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: 'Transfer Dismissed',
      message: 'The active transfer was stopped and dismissed.',
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

  const handleOpenFileContextMenu = (e: React.MouseEvent, file: FileRecord) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 228;
    const menuHeight = 330;
    const safeX = Math.max(12, Math.min(e.clientX, window.innerWidth - menuWidth - 12));
    const safeY = Math.max(12, Math.min(e.clientY, window.innerHeight - menuHeight - 12));
    setFileContextMenu({ file, x: safeX, y: safeY });
  };

  const handleRenameFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameModalFile || renamingBusy) return;
    const trimmedName = renameInputValue.trim();
    if (!trimmedName || trimmedName === renameModalFile.name) {
      setRenameModalFile(null);
      return;
    }
    setRenamingBusy(true);
    try {
      const res = await apiFetch(`/api/files/${encodeURIComponent(renameModalFile.id)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: trimmedName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rename file');
      }
      const updatedFile: FileRecord = data.file || {
        ...renameModalFile,
        name: trimmedName,
        updatedAt: new Date().toISOString(),
      };
      setFiles((prev) => prev.map((f) => (f.id === renameModalFile.id ? updatedFile : f)));
      if (inspectedFile?.id === renameModalFile.id) {
        setInspectedFile(updatedFile);
      }
      if (shareModalFile?.id === renameModalFile.id) {
        setShareModalFile(updatedFile);
      }
      syncCloudFileToFirestore(updatedFile, true).catch(() => null);
      for (const s of shares) {
        if (s.fileId === updatedFile.id) {
          syncPublicShareToFirestore({
            share: s,
            file: updatedFile,
          }).catch(() => null);
        }
      }
      pushNotification({
        id: `rename_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'File Renamed',
        message: `Renamed "${renameModalFile.name}" to "${trimmedName}".`,
        type: 'completed',
      });
      setRenameModalFile(null);
    } catch (err: unknown) {
      pushNotification({
        id: `rename_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Rename Failed',
        message: err instanceof Error ? err.message : 'Could not rename file.',
        type: 'error',
      });
    } finally {
      setRenamingBusy(false);
    }
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
        message: `"${file.name}" was removed from mobile offline storage.`,
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
        title: 'Saved to Offline Storage',
        message: `"${file.name}" (${formatBytes(
          file.sizeBytes
        )}) is now saved locally on your phone for offline access.`,
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

  const handleBatchSaveOffline = async (targetFilesList: FileRecord[]) => {
    if (targetFilesList.length === 0 || savingOfflineFileId) return;
    const allAlreadyOffline = targetFilesList.every((f) => Boolean(offlineFilesMap[f.id]));

    if (allAlreadyOffline) {
      for (const f of targetFilesList) {
        await removeFileFromOffline(f.id);
      }
      setOfflineFilesMap(getOfflineSavedFilesMap());
      pushNotification({
        id: `offline_batch_rm_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Removed from Offline',
        message: `${targetFilesList.length} ${
          targetFilesList.length === 1 ? 'file was' : 'files were'
        } removed from mobile offline storage.`,
        type: 'info',
      });
      setSelectedFileIds([]);
      return;
    }

    const toSave = targetFilesList.filter((f) => !offlineFilesMap[f.id] && !f.lockedOverQuota);
    if (toSave.length === 0) return;

    try {
      let savedCount = 0;
      let totalBytesSaved = 0;
      for (let i = 0; i < toSave.length; i++) {
        const f = toSave[i];
        setSavingOfflineFileId(f.id);
        setOfflineProgressPct(5);
        await saveFileOfflineToDevice(f, authHeaders(), (pct) => {
          const overall = Math.round(((i + pct / 100) / toSave.length) * 100);
          setOfflineProgressPct(Math.max(5, Math.min(99, overall)));
        });
        savedCount++;
        totalBytesSaved += f.sizeBytes;
      }
      setOfflineFilesMap(getOfflineSavedFilesMap());
      pushNotification({
        id: `offline_batch_save_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Saved to Offline Storage',
        message:
          savedCount === 1
            ? `"${toSave[0].name}" is saved in local storage and ready to open offline.`
            : `${savedCount} files (${formatBytes(
                totalBytesSaved
              )}) saved in local storage for offline access.`,
        type: 'completed',
        bytes: totalBytesSaved,
      });
      setSelectedFileIds([]);
    } catch (err: unknown) {
      pushNotification({
        id: `offline_batch_err_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Offline Save Failed',
        message:
          err instanceof Error
            ? err.message
            : 'Could not save selected files to local storage.',
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

  // Global Desktop Screen-Wide Drag-and-Drop File Upload Listener (with auto-reset on cancelled drags/dialogs)
  useEffect(() => {
    if (!firebaseUser || publicShareToken) return;

    const resetDragOverlay = () => {
      dragDepthRef.current = 0;
      setIsDraggingOver(false);
    };

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
      if (
        dragDepthRef.current === 0 ||
        !e.relatedTarget ||
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        resetDragOverlay();
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      const external = hasExternalFiles(e);
      resetDragOverlay();
      if (!external) return;
      e.preventDefault();
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        if (activeView !== 'explorer') {
          setActiveView('explorer');
        }
        handleUploadFiles(e.dataTransfer.files);
      }
    };

    const handleKeyDownReset = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetDragOverlay();
      }
    };

    // Note: mousemove never fires during an active OS drag-and-drop; if it fires while isDraggingOver is true, the drag was cancelled
    const handleMouseMoveWhileStuck = () => {
      if (isDraggingOver) {
        resetDragOverlay();
      }
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('dragend', resetDragOverlay);
    window.addEventListener('blur', resetDragOverlay);
    window.addEventListener('focus', resetDragOverlay);
    window.addEventListener('pointerdown', resetDragOverlay);
    window.addEventListener('mousemove', handleMouseMoveWhileStuck);
    window.addEventListener('keydown', handleKeyDownReset);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('dragend', resetDragOverlay);
      window.removeEventListener('blur', resetDragOverlay);
      window.removeEventListener('focus', resetDragOverlay);
      window.removeEventListener('pointerdown', resetDragOverlay);
      window.removeEventListener('mousemove', handleMouseMoveWhileStuck);
      window.removeEventListener('keydown', handleKeyDownReset);
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
      <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] flex items-center justify-center p-6">
        <div className="p-6 bg-[#101118] border border-[#1F212D] rounded-2xl text-center space-y-2 max-w-sm w-full shadow-2xl">
          <div className="text-sm font-bold text-white">StackDrive Encrypted Vault</div>
          <div className="text-xs text-zinc-400">Verifying your secure cloud session...</div>
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] flex flex-col justify-between p-4 sm:p-6">
        <header className="max-w-7xl w-full mx-auto flex items-center justify-between py-2 border-b border-[#1F212D]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 border border-blue-500/30 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white">StackDrive</span>
              <span className="text-[10px] text-zinc-400">UnlimCloud Vault</span>
            </div>
          </div>
          <div className="text-xs text-zinc-400">25 GB Free Encrypted Cloud Storage</div>
        </header>

        <main className="flex-1 flex items-center justify-center py-8">
          <div className="w-full max-w-md bg-[#101118] border border-[#1F212D] rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/30 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-blue-400" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-bold text-white">
                Sign in to StackDrive
              </h1>
              <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                Sign in with your registered Google account to access your private encrypted cloud
                drive.
              </p>
            </div>

            <div className="p-4 bg-[#141622] border border-[#212330] rounded-xl space-y-2 text-xs text-zinc-400">
              <div className="flex items-center justify-between">
                <span>Access Status</span>
                <strong className="text-blue-400">Secure Cloud Access</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Account Privacy</span>
                <strong className="text-white">100% Isolated Per-User Vault</strong>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <button
                onClick={() => {
                  handleGoogleSignIn().catch(() => null);
                }}
                disabled={signingInGoogle}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl text-xs sm:text-sm font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-600/20 active:scale-98 transition-all disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                {signingInGoogle ? 'Signing in with Google...' : 'Sign in with Google'}
              </button>
            </div>

            {authGateError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-400">
                {authGateError}
              </div>
            )}
          </div>
        </main>

        <footer className="text-center text-xs text-zinc-500 py-2">
          StackDrive — Private Encrypted Cloud Storage · Powered by UnlimCloud
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

  const offlineRecords = getOfflineSavedFileRecords();
  const serverFileIdSet = new Set(files.map((f) => f.id));
  const mergedFilesWithOffline = [
    ...files,
    ...offlineRecords.filter((of) => !serverFileIdSet.has(of.id)),
  ];

  const activeFolders = folders.filter((f) => !f.trashed);
  const trashedFolders = folders.filter((f) => Boolean(f.trashed));
  const activeFiles = mergedFilesWithOffline.filter((f) => !f.trashed);
  const trashedFiles = files.filter((f) => Boolean(f.trashed));
  const totalTrashCount = trashedFiles.length + trashedFolders.length;

  const activeFolder = activeFolders.find((f) => f.id === currentFolderId) || null;
  const visibleSubfolders = activeFolders.filter((f) => f.parentId === currentFolderId);

  // Build ordered nested folder breadcrumb path from Root down to activeFolder
  const folderBreadcrumbChain: FolderRecord[] = (() => {
    const chain: FolderRecord[] = [];
    const visited = new Set<string>();
    let cursorId: string | null = currentFolderId;
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const found = activeFolders.find((fl) => fl.id === cursorId);
      if (!found) break;
      chain.unshift(found);
      cursorId = found.parentId || null;
    }
    return chain;
  })();

  const handleSelectSortField = (field: 'date' | 'name' | 'size' | 'type') => {
    if (sortBy === field) {
      const nextOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      setSortOrder(nextOrder);
      try {
        localStorage.setItem('unlimcloud_sort_order_v1', nextOrder);
      } catch {
        // ignore
      }
    } else {
      const defaultOrder: 'asc' | 'desc' = field === 'name' || field === 'type' ? 'asc' : 'desc';
      setSortBy(field);
      setSortOrder(defaultOrder);
      try {
        localStorage.setItem('unlimcloud_sort_by_v1', field);
        localStorage.setItem('unlimcloud_sort_order_v1', defaultOrder);
      } catch {
        // ignore
      }
    }
    setShowSortMenu(false);
  };

  const handleSetSortOrder = (nextOrder: 'asc' | 'desc') => {
    setSortOrder(nextOrder);
    try {
      localStorage.setItem('unlimcloud_sort_order_v1', nextOrder);
    } catch {
      // ignore
    }
    setShowSortMenu(false);
  };

  const isFileCategory = useCallback(
    (file: FileRecord, cat: 'image' | 'video' | 'document' | 'other') => {
      const isImg =
        file.mimeType.startsWith('image/') ||
        /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(file.name);
      if (cat === 'image') return isImg;
      const isVid =
        file.mimeType.startsWith('video/') ||
        /\.(mp4|webm|mov|mkv|avi|wmv)$/i.test(file.name);
      if (cat === 'video') return isVid;
      const isDoc =
        file.mimeType.includes('pdf') ||
        file.mimeType.includes('document') ||
        file.mimeType.includes('text') ||
        /\.(pdf|doc|docx|txt|xls|xlsx|csv|ppt|pptx|json|md|rtf|epub)$/i.test(file.name);
      if (cat === 'document') return isDoc;
      return !isImg && !isVid && !isDoc;
    },
    []
  );

  const categoryStats = {
    image: {
      count: activeFiles.filter((f) => isFileCategory(f, 'image')).length,
      bytes: activeFiles
        .filter((f) => isFileCategory(f, 'image'))
        .reduce((acc, f) => acc + f.sizeBytes, 0),
    },
    video: {
      count: activeFiles.filter((f) => isFileCategory(f, 'video')).length,
      bytes: activeFiles
        .filter((f) => isFileCategory(f, 'video'))
        .reduce((acc, f) => acc + f.sizeBytes, 0),
    },
    document: {
      count: activeFiles.filter((f) => isFileCategory(f, 'document')).length,
      bytes: activeFiles
        .filter((f) => isFileCategory(f, 'document'))
        .reduce((acc, f) => acc + f.sizeBytes, 0),
    },
    other: {
      count: activeFiles.filter((f) => isFileCategory(f, 'other')).length,
      bytes: activeFiles
        .filter((f) => isFileCategory(f, 'other'))
        .reduce((acc, f) => acc + f.sizeBytes, 0),
    },
  };

  const recentSuggestedFiles = [...activeFiles]
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    )
    .slice(0, 4);

  const filteredFiles = activeFiles.filter((f) => {
    if (selectedCategoryFilter !== 'all') {
      if (!isFileCategory(f, selectedCategoryFilter)) return false;
    }

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
    } else if (
      !onlyOffline &&
      selectedCategoryFilter === 'all' &&
      !searchQuery.trim() &&
      !selectedTagFilter
    ) {
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

  const visibleFiles: FileRecord[] = (() => {
    const getFileTypeKey = (file: FileRecord) => {
      const dotIdx = file.name.lastIndexOf('.');
      const ext = dotIdx > 0 ? file.name.slice(dotIdx + 1).toLowerCase() : '';
      return ext || (file.mimeType || 'unknown').toLowerCase();
    };

    return [...filteredFiles].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortBy === 'size') {
        cmp = (a.sizeBytes || 0) - (b.sizeBytes || 0);
      } else if (sortBy === 'type') {
        cmp = getFileTypeKey(a).localeCompare(getFileTypeKey(b), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (cmp === 0) {
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
      } else {
        const timeA = new Date(a.createdAt || 0).getTime() || 0;
        const timeB = new Date(b.createdAt || 0).getTime() || 0;
        cmp = timeA - timeB;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  })();

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
    <div className="min-h-screen bg-[#0A0B0E] text-[#F3F4F6] flex overflow-hidden">
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
          1. DESKTOP SLEEK LEFT SIDEBAR (Matching reference images)
      ==================================================================== */}
      <aside className="hidden md:flex w-64 xl:w-72 bg-[#101118] border-r border-[#1F212D] flex-col justify-between p-4 h-screen sticky top-0 shrink-0 select-none z-30">
        <div className="space-y-5 overflow-y-auto no-scrollbar">
          {/* Brand Logo & Title */}
          <div className="flex items-center justify-between px-2 pt-1">
            <a
              href="#my-drive"
              onClick={(e) => {
                e.preventDefault();
                setActiveView('explorer');
                setCurrentFolderId(null);
                setOnlyStarred(false);
                setOnlyOffline(false);
                setSelectedCategoryFilter('all');
                setSelectedTagFilter(null);
              }}
              className="flex items-center gap-2.5 text-base font-bold tracking-tight text-white hover:opacity-90 transition-opacity"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20 text-white">
                <Cloud className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-base leading-tight tracking-tight text-white">StackDrive</span>
                <span className="text-[10px] text-zinc-400 font-medium">UnlimCloud Vault</span>
              </div>
            </a>
          </div>

          {/* Primary Action: + Upload File */}
          <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFiles}
              className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-98 transition-all cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{uploadingFiles ? (uploadPaused ? 'Upload Paused' : 'Uploading...') : 'Upload Files'}</span>
            </button>

            {/* Quick Secondary Actions: New Folder & Web URL */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setCreatingFolder((prev) => !prev)}
                className="py-2 px-2.5 rounded-lg bg-[#161722] hover:bg-[#1E202E] border border-[#232535] text-zinc-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
                <span>New Folder</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRemoteModal(true)}
                className="py-2 px-2.5 rounded-lg bg-[#161722] hover:bg-[#1E202E] border border-[#232535] text-zinc-300 hover:text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>From URL</span>
              </button>
            </div>
          </div>

          {/* Nav Section: MY DRIVE */}
          <div className="space-y-1">
            <div className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              My Drive
            </div>
            <nav className="space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setActiveView('explorer');
                  setSelectedCategoryFilter('all');
                  setOnlyStarred(false);
                  setOnlyOffline(false);
                  setSelectedTagFilter(null);
                  setCurrentFolderId(null);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'explorer' && selectedCategoryFilter === 'all' && !onlyStarred && !onlyOffline && !selectedTagFilter
                    ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Folder className={`w-4 h-4 ${activeView === 'explorer' && selectedCategoryFilter === 'all' && !onlyStarred ? 'text-blue-400' : 'text-zinc-400'}`} />
                  <span>All Files</span>
                </span>
                <span className="text-[11px] font-medium text-zinc-500 tabular-nums">
                  {activeFiles.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('explorer');
                  setSelectedCategoryFilter('all');
                  setSortBy('date');
                  setSortOrder('desc');
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'explorer' && sortBy === 'date' && sortOrder === 'desc'
                    ? 'text-zinc-200 hover:bg-[#161722]'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-zinc-400" />
                  <span>Recent</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('explorer');
                  setOnlyStarred((prev) => !prev);
                  setSelectedCategoryFilter('all');
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  onlyStarred
                    ? 'bg-amber-500/15 text-amber-400 font-bold border border-amber-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Star className={`w-4 h-4 ${onlyStarred ? 'text-amber-400 fill-amber-400' : 'text-zinc-400'}`} />
                  <span>Favorites</span>
                </span>
                <span className="text-[11px] font-medium text-zinc-500 tabular-nums">
                  {activeFiles.filter((f) => f.starred).length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('trash')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'trash'
                    ? 'bg-rose-500/15 text-rose-400 font-bold border border-rose-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Trash2 className={`w-4 h-4 ${activeView === 'trash' ? 'text-rose-400' : 'text-zinc-400'}`} />
                  <span>Trash</span>
                </span>
                {totalTrashCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-400 tabular-nums">
                    {totalTrashCount}
                  </span>
                )}
              </button>
            </nav>
          </div>

          {/* Nav Section: CATEGORIES & TOOLS */}
          <div className="space-y-1">
            <div className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Tools &amp; Shares
            </div>
            <nav className="space-y-0.5">
              <button
                type="button"
                onClick={() => setActiveView('gallery')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'gallery'
                    ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Film className="w-4 h-4 text-purple-400" />
                  <span>Media Gallery</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('shares')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'shares'
                    ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Link2 className="w-4 h-4 text-emerald-400" />
                  <span>Shared Links</span>
                </span>
                <span className="text-[11px] font-medium text-zinc-500 tabular-nums">
                  {shares.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('pricing')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'pricing'
                    ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Coins className="w-4 h-4 text-amber-400" />
                  <span>Plans &amp; Tokens</span>
                </span>
                <span className="text-[11px] font-medium text-amber-400/90 tabular-nums">
                  {tokenBalance.toLocaleString()} T
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveView('settings')}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                  activeView === 'settings'
                    ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Settings className="w-4 h-4 text-zinc-400" />
                  <span>Settings &amp; Offline</span>
                </span>
                {Object.keys(offlineFilesMap).length > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 tabular-nums">
                    {Object.keys(offlineFilesMap).length}
                  </span>
                )}
              </button>

              {isAdminUser && (
                <button
                  type="button"
                  onClick={() => setActiveView('telegram_settings')}
                  className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all cursor-pointer ${
                    activeView === 'telegram_settings'
                      ? 'bg-blue-600/15 text-blue-400 font-bold border border-blue-500/20'
                      : 'text-zinc-400 hover:text-white hover:bg-[#161722]'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <HardDrive className="w-4 h-4 text-cyan-400" />
                    <span>Admin Panel</span>
                  </span>
                </button>
              )}
            </nav>
          </div>
        </div>

        {/* Bottom Section: Storage Meter Card & User Pill */}
        <div className="pt-3 border-t border-[#1F212D] space-y-3">
          {/* Storage Meter Card (Matching StackDrive storage widget) */}
          <div className="p-3.5 rounded-2xl bg-[#14151E] border border-[#212330] space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                <Cloud className="w-3.5 h-3.5 text-blue-400" />
                <span>Storage</span>
              </span>
              <span className="text-[11px] font-bold text-blue-400">
                {isUnlimitedAdmin ? 'Unlimited' : `${quotaPct}%`}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#0D0E14] overflow-hidden">
              <div
                style={{ width: `${Math.max(3, quotaPct)}%` }}
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400 tabular-nums">
              <span>{formatBytes(totalStorageBytes)}</span>
              <span>{isUnlimitedAdmin ? 'Unlimited' : formatBytes(quotaLimitBytes)}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowBuyTokensModal(true)}
              className="w-full mt-1 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-400 text-xs font-semibold transition-colors cursor-pointer text-center"
            >
              Extend / Buy Tokens
            </button>
          </div>

          {/* User Profile Pill */}
          {currentUser ? (
            <div
              onClick={() => setShowAuthModal(true)}
              className="p-2 rounded-xl bg-[#14151E] hover:bg-[#1A1C28] border border-[#212330] flex items-center justify-between gap-2 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-xs shrink-0">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{currentUser.name}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{planBadge}</div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingInGoogle}
              className="w-full py-2 px-3 rounded-xl bg-[#14151E] hover:bg-[#1A1C28] border border-[#212330] text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5 text-blue-400" />
              <span>{signingInGoogle ? 'Signing in...' : 'Sign In with Google'}</span>
            </button>
          )}
        </div>
      </aside>

      {/* ====================================================================
          2. MOBILE SLIDE-OUT DRAWER (Smooth App-like menu on mobile)
      ==================================================================== */}
      {mobileSidebarOpen && (
        <div
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs md:hidden flex"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-72 bg-[#101118] border-r border-[#1F212D] h-full flex flex-col justify-between p-4 space-y-4 shadow-2xl animate-app-modal"
          >
            <div className="space-y-4 overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between pb-2 border-b border-[#1F212D]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white">
                    <Cloud className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-white text-base">StackDrive</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="w-8 h-8 rounded-lg bg-[#181926] text-zinc-400 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  fileInputRef.current?.click();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 text-white font-semibold text-xs flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>Upload Files</span>
              </button>

              <nav className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('explorer');
                    setSelectedCategoryFilter('all');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'explorer' && selectedCategoryFilter === 'all'
                      ? 'bg-blue-600/15 text-blue-400 font-bold'
                      : 'text-zinc-400'
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  <span>My Drive</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveView('gallery');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'gallery' ? 'bg-blue-600/15 text-blue-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  <Film className="w-4 h-4" />
                  <span>Media Gallery</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveView('shares');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'shares' ? 'bg-blue-600/15 text-blue-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  <Link2 className="w-4 h-4" />
                  <span>Shared Links</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveView('pricing');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'pricing' ? 'bg-blue-600/15 text-blue-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  <Coins className="w-4 h-4" />
                  <span>Plans &amp; Tokens</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveView('trash');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'trash' ? 'bg-rose-500/15 text-rose-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Trash Bin ({totalTrashCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveView('settings');
                    setMobileSidebarOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2.5 ${
                    activeView === 'settings' ? 'bg-blue-600/15 text-blue-400 font-bold' : 'text-zinc-400'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                  <span>Settings &amp; Offline</span>
                </button>
              </nav>
            </div>

            <div className="pt-2 border-t border-[#1F212D]">
              <div className="text-[11px] text-zinc-400">
                Storage: {formatBytes(totalStorageBytes)} of {isUnlimitedAdmin ? 'Unlimited' : formatBytes(quotaLimitBytes)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          3. MAIN CONTENT WORKSPACE (Header + Explorer / Views)
      ==================================================================== */}
      <div className="flex-1 min-w-0 flex flex-col h-screen overflow-y-auto bg-[#0A0B0E]">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 h-16 px-4 sm:px-6 bg-[#0A0B0E]/90 backdrop-blur-md border-b border-[#1A1C24] flex items-center justify-between gap-3 sm:gap-4 shrink-0">
          {/* Left: Hamburger on Mobile + Search Bar */}
          <div className="flex items-center gap-3 flex-1 min-w-0 max-w-xl">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden w-9 h-9 rounded-xl bg-[#14151D] border border-[#212330] text-zinc-400 hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div ref={searchContainerRef} className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                placeholder="Search in Drive..."
                className="w-full h-10 rounded-xl bg-[#14151D] border border-[#212330] pl-10 pr-9 text-xs sm:text-sm text-[#F3F4F6] placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
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
                  className="w-6 h-6 rounded-full absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer"
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Persistent Search History Dropdown */}
              {showSearchHistory && searchHistory.length > 0 && (
                <div className="animate-app-modal absolute left-0 right-0 top-full mt-1.5 z-30 rounded-2xl bg-[#14151D] border border-[#212330] shadow-xl py-1 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-[#212330] flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="font-semibold flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-blue-400" />
                      Recent Searches
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearSearchHistory();
                      }}
                      className="text-[11px] text-blue-400 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto divide-y divide-[#212330]/50">
                    {searchHistory.map((item) => (
                      <div
                        key={item}
                        className="flex items-center justify-between px-3.5 py-2 hover:bg-[#1C1E2A] transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery(item);
                            saveSearchQueryToHistory(item);
                            setShowSearchHistory(false);
                          }}
                          className="flex-1 flex items-center gap-2 text-left text-xs text-zinc-300 group-hover:text-blue-400 truncate cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 shrink-0" />
                          <span className="truncate">{item}</span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSearchHistoryItem(item);
                          }}
                          className="p-1 text-zinc-500 hover:text-rose-400 cursor-pointer shrink-0"
                          title="Remove from history"
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

          {/* Right Header Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* View Mode Toggle: Grid vs List */}
            <div className="hidden sm:flex items-center p-0.5 rounded-xl bg-[#14151D] border border-[#212330]">
              <button
                type="button"
                onClick={() => handleChangeLayout('grid')}
                className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  explorerLayout === 'grid'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => handleChangeLayout('list')}
                className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                  explorerLayout === 'list'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="List View"
              >
                <ListIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Side Trash Bin Icon Button */}
            <button
              type="button"
              onClick={() => setActiveView('trash')}
              title={`Trash Bin (${totalTrashCount} items)`}
              aria-label="Open Trash Bin"
              className={`relative min-h-[36px] min-w-[36px] px-2 py-1.5 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
                activeView === 'trash'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  : 'bg-[#14151D] border-[#212330] text-zinc-400 hover:text-white hover:border-zinc-700'
              }`}
            >
              <Trash2 className="w-4 h-4 shrink-0" />
              {totalTrashCount > 0 && (
                <span className="text-[11px] font-bold tabular-nums text-rose-400">{totalTrashCount}</span>
              )}
            </button>

            <PWAInstallButton compact />

            {/* Profile Avatar / Login */}
            {currentUser ? (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="w-9 h-9 rounded-xl bg-[#14151D] hover:bg-[#1E202E] border border-[#212330] text-blue-400 font-bold text-xs flex items-center justify-center cursor-pointer transition-colors"
                title={currentUser.name}
              >
                {currentUser.name.charAt(0).toUpperCase()}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={signingInGoogle}
                className="h-9 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7 pb-28 md:pb-12 space-y-6 sm:space-y-8">
          {/* LIVE FILE UPLOAD PROGRESS BAR */}
          {(uploadProgress || postUploadProcessing || activeStreamingJobs.length > 0) && (
            <div className="p-4 rounded-2xl bg-[#13141C] border border-blue-500/40 shadow-lg space-y-3">
              {uploadProgress && !postUploadProcessing && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="font-bold text-white truncate">
                      {uploadPaused ? 'Paused: ' : 'Uploading: '}
                      {uploadProgress.fileName}
                    </span>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className="text-blue-400 font-bold">
                        {uploadProgress.percent}% · {formatBytes(uploadProgress.loadedBytes)} /{' '}
                        {formatBytes(uploadProgress.totalBytes)} ·{' '}
                        {uploadPaused ? 'Paused' : formatSpeed(uploadProgress.speedBps)}
                      </span>
                      <button
                        type="button"
                        onClick={handleTogglePauseUpload}
                        className="min-h-[28px] px-2.5 py-0.5 text-xs font-semibold rounded-lg bg-[#181A26] border border-[#2B2D3E] text-zinc-200 hover:bg-blue-600 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        {uploadPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                        <span>{uploadPaused ? 'Resume' : 'Pause'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelUpload}
                        className="min-h-[28px] px-2.5 py-0.5 text-xs font-semibold rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500 hover:text-white flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#181A26] overflow-hidden">
                    <div
                      style={{ width: `${uploadProgress.percent}%` }}
                      className={`h-full rounded-full transition-all duration-100 ${
                        uploadPaused ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                    />
                  </div>
                </div>
              )}

              {postUploadProcessing && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                      <span className="font-bold text-white truncate">
                        Processing: {postUploadProcessing.fileName}
                      </span>
                    </div>
                    <span className="text-blue-400 font-semibold shrink-0">Please wait...</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#181A26] overflow-hidden">
                    <div className="h-full w-full bg-blue-500 animate-pulse" />
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
                      <span className="font-semibold text-white truncate">{job.fileName}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-zinc-400">
                          {pct}% · {formatBytes(job.transferredBytes)} · {formatSpeed(job.speedBps)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCancelRemoteTransfer(job.id)}
                          className="min-h-[26px] px-2 py-0.5 text-[11px] font-semibold rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[#181A26] overflow-hidden">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full rounded-full bg-blue-500 transition-all duration-150"
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
              <div className="w-full max-w-sm bg-[#13141C] border border-blue-500/40 p-6 rounded-2xl space-y-4 text-center shadow-2xl">
                <div className="w-12 h-12 mx-auto rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
                <div className="space-y-1">
                  <div className="text-base font-bold text-white">Processing...</div>
                  <p className="text-xs text-zinc-400 truncate px-2">
                    {postUploadProcessing.fileName}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Finalizing your file for instant cloud access...
                  </p>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#181A26] overflow-hidden">
                  <div className="h-full w-full bg-blue-500 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {/* ==================================================================
              VIEW 1: MY FILES / EXPLORER
          ================================================================== */}
          {activeView === 'explorer' && (
            <div className="animate-app-view space-y-6 sm:space-y-7">
              {/* Expired Plan / Over-25GB Lock Warning Banner */}
              {lockedFilesCount > 0 && (
                <div className="p-4 rounded-2xl bg-[#1C1710] border border-amber-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs text-amber-300">
                    <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      <strong className="text-white">
                        {lockedFilesCount} file(s) over your 25 GB limit are locked
                      </strong>{' '}
                      <span className="text-zinc-400">
                        (Extend your plan to unlock before auto-clear).
                      </span>
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveView('pricing')}
                    className="h-9 px-4 rounded-xl text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 shrink-0 cursor-pointer"
                  >
                    Extend Plan with Tokens
                  </button>
                </div>
              )}

              {/* ==============================================================
                  THE 4 CATEGORY OVERVIEW CARDS (Iconic StackDrive Dashboard Feature)
              ============================================================== */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                {/* 1. Images */}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) => (prev === 'image' ? 'all' : 'image'))
                  }
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                    selectedCategoryFilter === 'image'
                      ? 'bg-blue-950/40 border-blue-500 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/50'
                      : 'bg-[#13141C] border-[#212330] hover:bg-[#181926] hover:border-blue-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-400">
                      {categoryStats.image.count} Files
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">Images</div>
                    <div className="text-xs text-zinc-400 font-medium">
                      {formatBytes(categoryStats.image.bytes)}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-[#1C1E2A] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          totalStorageBytes > 0
                            ? Math.min(100, Math.max(4, Math.round((categoryStats.image.bytes / totalStorageBytes) * 100)))
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-blue-500"
                    />
                  </div>
                </button>

                {/* 2. Videos */}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) => (prev === 'video' ? 'all' : 'video'))
                  }
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                    selectedCategoryFilter === 'video'
                      ? 'bg-purple-950/40 border-purple-500 shadow-lg shadow-purple-500/10 ring-1 ring-purple-500/50'
                      : 'bg-[#13141C] border-[#212330] hover:bg-[#181926] hover:border-purple-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                      <Film className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-400">
                      {categoryStats.video.count} Files
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">Videos</div>
                    <div className="text-xs text-zinc-400 font-medium">
                      {formatBytes(categoryStats.video.bytes)}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-[#1C1E2A] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          totalStorageBytes > 0
                            ? Math.min(100, Math.max(4, Math.round((categoryStats.video.bytes / totalStorageBytes) * 100)))
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-purple-500"
                    />
                  </div>
                </button>

                {/* 3. Documents */}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) => (prev === 'document' ? 'all' : 'document'))
                  }
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                    selectedCategoryFilter === 'document'
                      ? 'bg-amber-950/40 border-amber-500 shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/50'
                      : 'bg-[#13141C] border-[#212330] hover:bg-[#181926] hover:border-amber-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-400">
                      {categoryStats.document.count} Files
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">Documents</div>
                    <div className="text-xs text-zinc-400 font-medium">
                      {formatBytes(categoryStats.document.bytes)}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-[#1C1E2A] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          totalStorageBytes > 0
                            ? Math.min(100, Math.max(4, Math.round((categoryStats.document.bytes / totalStorageBytes) * 100)))
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-amber-500"
                    />
                  </div>
                </button>

                {/* 4. Others */}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedCategoryFilter((prev) => (prev === 'other' ? 'all' : 'other'))
                  }
                  className={`p-4 rounded-2xl border text-left transition-all duration-200 cursor-pointer ${
                    selectedCategoryFilter === 'other'
                      ? 'bg-emerald-950/40 border-emerald-500 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/50'
                      : 'bg-[#13141C] border-[#212330] hover:bg-[#181926] hover:border-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                      <FolderArchive className="w-5 h-5" />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-400">
                      {categoryStats.other.count} Files
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-white">Others</div>
                    <div className="text-xs text-zinc-400 font-medium">
                      {formatBytes(categoryStats.other.bytes)}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-[#1C1E2A] overflow-hidden">
                    <div
                      style={{
                        width: `${
                          totalStorageBytes > 0
                            ? Math.min(100, Math.max(4, Math.round((categoryStats.other.bytes / totalStorageBytes) * 100)))
                            : 0
                        }%`,
                      }}
                      className="h-full rounded-full bg-emerald-500"
                    />
                  </div>
                </button>
              </div>

              {/* Active Category Filter Reset Strip */}
              {selectedCategoryFilter !== 'all' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-[#14151E] border border-blue-500/30 text-xs">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <span className="text-zinc-500">Filtered view:</span>
                    <strong className="text-blue-400 capitalize">{selectedCategoryFilter}s</strong>
                    <span className="text-zinc-500">({visibleFiles.length} files)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryFilter('all')}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Filter</span>
                  </button>
                </div>
              )}

              {/* ==============================================================
                  SUGGESTED / RECENT FILES ROW (Direct from user reference image)
              ============================================================== */}
              {recentSuggestedFiles.length > 0 &&
                selectedCategoryFilter === 'all' &&
                !searchQuery.trim() &&
                !selectedTagFilter &&
                !onlyStarred &&
                !onlyOffline && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        Suggested Files
                      </h2>
                      <span className="text-[11px] text-zinc-500">
                        Quick access to recently active files
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                      {recentSuggestedFiles.map((file) => (
                        <div
                          key={`sugg_${file.id}`}
                          onClick={() => {
                            if (file.lockedOverQuota) {
                              setActiveView('pricing');
                            } else {
                              setInspectedFile(file);
                            }
                          }}
                          className="group p-3.5 rounded-2xl bg-[#13141C] border border-[#212330] hover:border-blue-500/50 hover:bg-[#181926] transition-all cursor-pointer space-y-3"
                        >
                          <div className="h-28 w-full rounded-xl bg-[#181A25] border border-[#242636] flex items-center justify-center overflow-hidden relative">
                            {file.previewDataUrl && file.mimeType.startsWith('image/') ? (
                              <img
                                src={file.previewDataUrl}
                                alt={file.name}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            ) : file.mimeType.startsWith('video/') ? (
                              <div className="flex flex-col items-center justify-center gap-1.5 text-purple-400">
                                <div className="w-9 h-9 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center">
                                  <Play className="w-4 h-4 ml-0.5 fill-purple-400" />
                                </div>
                                <span className="text-[10px] text-zinc-400 font-medium">Video</span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center gap-1">
                                {renderFileIcon(file)}
                                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                                  {file.name.split('.').pop() || 'FILE'}
                                </span>
                              </div>
                            )}
                            {file.starred && (
                              <div className="absolute top-2 right-2 w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white group-hover:text-blue-400 truncate transition-colors">
                              {file.name}
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-1 tabular-nums">
                              <span>{formatBytes(file.sizeBytes)}</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Action Toolbar on Mobile (Upload & New Folder buttons) */}
              <div className="flex md:hidden flex-wrap items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[38px] rounded-xl flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-bold bg-blue-600 text-white shadow-xs cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span>Upload</span>
                </button>
                <button
                  onClick={() => setCreatingFolder((prev) => !prev)}
                  className="min-h-[38px] rounded-xl flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#13141C] border border-[#212330] text-zinc-300 cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>New Folder</span>
                </button>
              </div>

              {/* Single-Row Swipeable Filter & Quick Action Rail */}
              <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTagFilter(null);
                    setOnlyStarred(false);
                    setOnlyOffline(false);
                    setSelectedCategoryFilter('all');
                  }}
                  className={`min-h-[34px] px-3.5 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    selectedTagFilter === null && !onlyStarred && !onlyOffline && selectedCategoryFilter === 'all'
                      ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                      : 'bg-[#13141C] border-[#212330] text-zinc-400 hover:border-zinc-700 hover:text-white'
                  }`}
                >
                  All Files ({activeFiles.length})
                </button>

                <button
                  type="button"
                  onClick={() => setOnlyStarred((prev) => !prev)}
                  className={`min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    onlyStarred
                      ? 'bg-amber-500 border-amber-500 text-black font-bold'
                      : 'bg-[#13141C] border-[#212330] text-zinc-400 hover:text-white'
                  }`}
                >
                  <Star className="w-3.5 h-3.5 shrink-0" fill={onlyStarred ? 'currentColor' : 'none'} />
                  <span>Starred</span>
                </button>

                <button
                  type="button"
                  onClick={() => setOnlyOffline((prev) => !prev)}
                  className={`min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    onlyOffline
                      ? 'bg-emerald-500 border-emerald-500 text-black font-bold'
                      : 'bg-[#13141C] border-[#212330] text-zinc-400 hover:text-white'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  <span>Offline ({Object.keys(offlineFilesMap).length})</span>
                </button>

                {/* Custom Label / Tag Filter Chips */}
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
                      className={`min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap shrink-0 transition-all flex items-center gap-1.5 cursor-pointer ${
                        isActive
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-[#13141C] border-[#212330] text-zinc-400 hover:border-zinc-700 hover:text-white'
                      }`}
                    >
                      <Tag className="w-3 h-3 shrink-0" />
                      <span>{tagItem.label}</span>
                      <span
                        className={`text-[11px] tabular-nums ${
                          isActive ? 'text-white/80 font-bold' : 'text-zinc-500'
                        }`}
                      >
                        ({tagItem.count})
                      </span>
                    </button>
                  );
                })}

                {selectedTagFilter && (
                  <button
                    type="button"
                    onClick={() => setSelectedTagFilter(null)}
                    className="min-h-[34px] px-2.5 py-1 text-xs text-blue-400 hover:underline whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Reset</span>
                  </button>
                )}
              </div>

            {/* Desktop Batch Actions Bar (Hidden on mobile; mobile uses the bottom selection menu) */}
            {selectedFileIds.length > 0 && (
              <div className="animate-app-modal hidden md:flex p-3.5 rounded-2xl bg-[#12131C] border border-blue-500/40 flex-row items-center justify-between gap-3 shadow-xl">
                <div className="flex items-center gap-2.5 text-xs">
                  <CheckSquare className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="font-bold text-white">
                    {selectedFileIds.length}{' '}
                    {selectedFileIds.length === 1 ? 'file' : 'files'} selected
                  </span>
                  <span className="text-zinc-400 tabular-nums">
                    ({formatBytes(selectedTotalBytes)})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedFilesObjects[0]) {
                        setShareModalFile(selectedFilesObjects[0]);
                      }
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Share</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      selectedFilesObjects.forEach((f) => {
                        void handleToggleStar(f);
                      });
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Star
                      className="w-3.5 h-3.5 text-amber-400"
                      fill={
                        selectedFilesObjects.length > 0 &&
                        selectedFilesObjects.every((f) => f.starred)
                          ? 'currentColor'
                          : 'none'
                      }
                    />
                    <span>
                      {selectedFilesObjects.length > 0 &&
                      selectedFilesObjects.every((f) => f.starred)
                        ? 'Unstar'
                        : 'Star'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTagModalFiles(selectedFilesObjects)}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Tag className="w-3.5 h-3.5 text-blue-400" />
                    <span>Label</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoveModalMode('move');
                      setBatchMoveFiles(selectedFilesObjects);
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <FolderInput className="w-3.5 h-3.5 text-blue-400" />
                    <span>Move</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMoveModalMode('copy');
                      setBatchMoveFiles(selectedFilesObjects);
                    }}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-blue-400" />
                    <span>Copy</span>
                  </button>

                  <button
                    type="button"
                    disabled={zipDownloading}
                    onClick={handleBatchZipDownload}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold bg-[#181A26] border border-blue-500/50 text-blue-400 hover:bg-blue-600 hover:text-white disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {zipDownloading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>ZIP {zipProgressPct}%</span>
                      </>
                    ) : (
                      <>
                        <FolderArchive className="w-3.5 h-3.5" />
                        <span>ZIP ({selectedFileIds.length})</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleBatchDownload}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-blue-600/20 transition-all"
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
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500 hover:text-white flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedFileIds([])}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white border border-[#212330] bg-[#141622] hover:bg-[#1C1E2D] cursor-pointer transition-colors"
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {/* Inline New Folder Input */}
            {creatingFolder && (
              <form
                onSubmit={handleCreateFolder}
                className="p-4 bg-[#12131C] border border-blue-500/40 rounded-2xl flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shadow-lg"
              >
                <input
                  type="text"
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Type folder name..."
                  className="flex-1 min-h-[44px] bg-[#181A26] border border-[#212330] rounded-xl px-3.5 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
                <div className="grid grid-cols-2 sm:flex items-center gap-2">
                  <button
                    type="submit"
                    className="min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 cursor-pointer shadow-md shadow-blue-600/20 transition-all"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(false)}
                    className="min-h-[44px] px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white border border-[#212330] bg-[#141622] hover:bg-[#1C1E2D] cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Clickable Nested Folder Breadcrumb Path (Jump back to any parent folder or drag files onto parent segments) */}
            <nav
              aria-label="Folder breadcrumb path"
              className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-[#12131C] border border-[#212330] shadow-sm"
            >
              <div className="flex flex-wrap items-center gap-1.5 text-xs sm:text-sm font-semibold min-w-0">
                {/* Quick 'Up One Level' button when inside a subfolder */}
                {activeFolder && !onlyStarred && !onlyOffline && !selectedTagFilter && (
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(activeFolder.parentId || null)}
                    title={
                      activeFolder.parentId
                        ? 'Jump up to parent folder'
                        : 'Jump back to My Files (Root)'
                    }
                    className="min-h-[32px] px-2.5 py-1 rounded-xl bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center gap-1 cursor-pointer transition-colors shrink-0 mr-1"
                  >
                    <CornerLeftUp className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs">Up</span>
                  </button>
                )}

                {/* Root Segment */}
                <button
                  type="button"
                  onClick={() => {
                    setCurrentFolderId(null);
                    setOnlyStarred(false);
                    setOnlyOffline(false);
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
                  className={`min-h-[32px] px-2.5 py-1 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer ${
                    dragOverFolderId === 'root'
                      ? 'border border-blue-500 bg-blue-500/20 text-white'
                      : !activeFolder && !onlyStarred && !onlyOffline && !selectedTagFilter
                      ? 'bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span>My Files</span>
                </button>

                {/* Special Filter Crumb OR Nested Folder Ancestor Chain */}
                {selectedTagFilter ? (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="min-h-[32px] px-2.5 py-1 rounded-xl bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 shrink-0" />
                      <span>Label: {selectedTagFilter}</span>
                    </span>
                  </>
                ) : onlyStarred ? (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="min-h-[32px] px-2.5 py-1 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-bold flex items-center gap-1.5">
                      <Star className="w-3.5 h-3.5 shrink-0" fill="currentColor" />
                      <span>Starred Files</span>
                    </span>
                  </>
                ) : onlyOffline ? (
                  <>
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span className="min-h-[32px] px-2.5 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 shrink-0" />
                      <span>Offline Saved Files</span>
                    </span>
                  </>
                ) : (
                  folderBreadcrumbChain.map((crumb, idx) => {
                    const isLastCrumb = idx === folderBreadcrumbChain.length - 1;
                    const isCrumbDropTarget = dragOverFolderId === crumb.id;
                    return (
                      <React.Fragment key={crumb.id}>
                        <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentFolderId(crumb.id);
                            setOnlyStarred(false);
                            setOnlyOffline(false);
                            setSelectedTagFilter(null);
                          }}
                          onDragOver={(e) => {
                            if (draggedFileId && crumb.id !== currentFolderId) {
                              e.preventDefault();
                              setDragOverFolderId(crumb.id);
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverFolderId === crumb.id) setDragOverFolderId(null);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDragOverFolderId(null);
                            if (draggedFileId && crumb.id !== currentFolderId) {
                              const f = files.find((item) => item.id === draggedFileId);
                              setDraggedFileId(null);
                              if (f) handleMoveFile(f, crumb.id).catch(() => null);
                            }
                          }}
                          className={`min-h-[32px] px-2.5 py-1 rounded-xl flex items-center gap-1.5 max-w-[200px] sm:max-w-[260px] truncate transition-colors cursor-pointer ${
                            isCrumbDropTarget
                              ? 'border border-blue-500 bg-blue-500/20 text-white'
                              : isLastCrumb
                              ? 'bg-blue-600/20 border border-blue-500/40 text-blue-400 font-bold'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                          }`}
                          title={`Open folder "${crumb.name}"`}
                        >
                          <span className="truncate">{crumb.name}</span>
                          {crumb.isPinProtected && (
                            <KeyRound className="w-3 h-3 text-amber-400 shrink-0" />
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })
                )}
              </div>

              {activeFolder && !onlyStarred && !selectedTagFilter && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShareModalFolder(activeFolder)}
                    className="min-h-[32px] px-3 py-1 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5 text-blue-400" />
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
                    className="min-h-[32px] px-3 py-1 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>{activeFolder.isPinProtected ? 'Manage PIN' : 'Set PIN Lock'}</span>
                  </button>
                </div>
              )}
            </nav>

            {/* Folders Section (Supports Google Drive-style Drag & Drop + Content/Status Visual Indicators) */}
            {!onlyStarred && !onlyOffline && !selectedTagFilter && !searchQuery.trim() && visibleSubfolders.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Folders ({visibleSubfolders.length})
                  </h2>
                  <span className="hidden sm:inline text-[11px] text-zinc-400">
                    Visual indicators show folder media type, starred/shared items &amp; PIN status
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
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
                              isUnlocked ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          />
                        );
                      }
                      if (summary.category === 'video') {
                        return <Film className="w-3 h-3 text-blue-400" />;
                      }
                      if (summary.category === 'image') {
                        return <ImageIcon className="w-3 h-3 text-emerald-400" />;
                      }
                      if (summary.category === 'audio') {
                        return <Music className="w-3 h-3 text-amber-400" />;
                      }
                      if (summary.category === 'code') {
                        return <FileCode className="w-3 h-3 text-indigo-400" />;
                      }
                      if (summary.hasShared) {
                        return <Link2 className="w-3 h-3 text-cyan-400" />;
                      }
                      if (summary.hasStarred) {
                        return <Star className="w-3 h-3 text-amber-400" fill="currentColor" />;
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
                        className={`animate-app-card rounded-2xl min-h-[68px] p-3.5 sm:p-4 bg-[#12131C] border flex items-center justify-between gap-2 cursor-pointer group transition-all ${
                          isDropTarget
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-[#212330] hover:border-blue-500/60 hover:bg-[#161724]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative w-10 h-10 rounded-xl bg-[#181A26] border border-[#252838] flex items-center justify-center shrink-0">
                            <Folder
                              className={`w-5 h-5 ${
                                summary.category === 'video'
                                  ? 'text-blue-400'
                                  : summary.category === 'image'
                                  ? 'text-emerald-400'
                                  : summary.category === 'audio'
                                  ? 'text-amber-400'
                                  : 'text-blue-400'
                              }`}
                            />
                            {badgeIcon && (
                              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-md bg-[#0D0E15] border border-[#212330] flex items-center justify-center">
                                {badgeIcon}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-white truncate group-hover:text-blue-400 flex items-center gap-1.5 transition-colors">
                              <span className="truncate">{folder.name}</span>
                              {summary.hasStarred && (
                                <Star
                                  className="w-3 h-3 text-amber-400 shrink-0"
                                  fill="currentColor"
                                  aria-label="Contains starred items"
                                />
                              )}
                            </div>
                            <div className="text-xs text-zinc-400 flex flex-wrap items-center gap-1 tabular-nums">
                              <span>
                                {count} {count === 1 ? 'file' : 'files'}
                              </span>
                              {count > 0 && (
                                <span className="text-[11px] text-zinc-400">
                                  · {summary.categoryLabel}
                                </span>
                              )}
                              {folder.isPinProtected && (
                                <span className="text-[10px] text-amber-400 font-semibold">
                                  · {isUnlocked ? 'Unlocked' : 'PIN'}
                                </span>
                              )}
                              {summary.hasShared && (
                                <span className="text-[10px] text-emerald-400 font-semibold">
                                  · Shared
                                </span>
                              )}
                              {summary.hasOffline && (
                                <span className="md:hidden text-[10px] text-emerald-400 font-semibold">
                                  · Offline
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center -mr-1.5 shrink-0">
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
                            className={`min-w-[34px] min-h-[38px] rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                              folder.isPinProtected
                                ? 'text-amber-400 hover:text-amber-300'
                                : 'text-zinc-400 hover:text-white'
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
                            className={`min-w-[34px] min-h-[38px] rounded-lg flex items-center justify-center cursor-pointer transition-colors ${
                              existingFolderShare
                                ? 'text-blue-400'
                                : 'text-zinc-400 hover:text-white'
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
                            className="min-w-[34px] min-h-[38px] rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-400 cursor-pointer transition-colors"
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

            {/* Files Section with Desktop 'Lasso' Drag-to-Select Support */}
            <div
              ref={lassoContainerRef}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                // Do not start lasso when clicking interactive buttons, inputs, links, or draggable cards unless Lasso mode is explicitly toggled on
                if (
                  !lassoModeActive &&
                  target.closest('button, a, input, select, label, [data-select-file-id]')
                ) {
                  return;
                }
                if (
                  lassoModeActive &&
                  target.closest('button, a, input, select, label')
                ) {
                  return;
                }
                const container = lassoContainerRef.current;
                if (!container) return;
                const rect = container.getBoundingClientRect();
                const startX = e.clientX - rect.left;
                const startY = e.clientY - rect.top;
                lassoBaselineSelectionRef.current = e.shiftKey || e.metaKey || e.ctrlKey ? [...selectedFileIds] : [];
                setLassoBox({
                  startX,
                  startY,
                  currentX: startX,
                  currentY: startY,
                });

                const handleWindowMouseMove = (moveEv: MouseEvent) => {
                  const curRect = container.getBoundingClientRect();
                  const curX = moveEv.clientX - curRect.left;
                  const curY = moveEv.clientY - curRect.top;
                  setLassoBox({
                    startX,
                    startY,
                    currentX: curX,
                    currentY: curY,
                  });

                  const minX = Math.min(startX, curX) + curRect.left;
                  const maxX = Math.max(startX, curX) + curRect.left;
                  const minY = Math.min(startY, curY) + curRect.top;
                  const maxY = Math.max(startY, curY) + curRect.top;

                  if (Math.abs(curX - startX) < 6 && Math.abs(curY - startY) < 6) return;

                  const cards = container.querySelectorAll<HTMLElement>('[data-select-file-id]');
                  const hitIds = new Set<string>(lassoBaselineSelectionRef.current);
                  cards.forEach((card) => {
                    const cRect = card.getBoundingClientRect();
                    const intersects =
                      cRect.left <= maxX &&
                      cRect.right >= minX &&
                      cRect.top <= maxY &&
                      cRect.bottom >= minY;
                    const fid = card.getAttribute('data-select-file-id');
                    if (intersects && fid) {
                      hitIds.add(fid);
                    }
                  });
                  setSelectedFileIds(Array.from(hitIds));
                };

                const handleWindowMouseUp = () => {
                  setLassoBox(null);
                  window.removeEventListener('mousemove', handleWindowMouseMove);
                  window.removeEventListener('mouseup', handleWindowMouseUp);
                };

                window.addEventListener('mousemove', handleWindowMouseMove);
                window.addEventListener('mouseup', handleWindowMouseUp);
              }}
              className={`relative space-y-2.5 ${lassoModeActive ? 'cursor-crosshair select-none' : ''}`}
            >
              {/* Live Lasso Marquee Box Overlay */}
              {lassoBox &&
                (Math.abs(lassoBox.currentX - lassoBox.startX) > 4 ||
                  Math.abs(lassoBox.currentY - lassoBox.startY) > 4) && (
                  <div
                    style={{
                      left: `${Math.min(lassoBox.startX, lassoBox.currentX)}px`,
                      top: `${Math.min(lassoBox.startY, lassoBox.currentY)}px`,
                      width: `${Math.abs(lassoBox.currentX - lassoBox.startX)}px`,
                      height: `${Math.abs(lassoBox.currentY - lassoBox.startY)}px`,
                      backgroundColor: 'rgba(37, 99, 235, 0.10)',
                      border: '1.5px solid #2563EB',
                    }}
                    className="absolute z-30 pointer-events-none rounded-sm"
                  />
                )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                    Files ({visibleFiles.length})
                  </h2>
                  {visibleFiles.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleToggleSelectAllVisible}
                        className="min-h-[32px] px-2.5 py-1 text-xs font-semibold rounded-xl bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        {allVisibleSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-zinc-400" />
                        )}
                        <span>
                          {allVisibleSelected ? 'Deselect All' : 'Select All'}
                        </span>
                      </button>

                      {/* Desktop Lasso Drag-Selection Toggle */}
                      <button
                        type="button"
                        onClick={() => setLassoModeActive((prev) => !prev)}
                        title="Toggle Lasso Mode — Click and drag across cards to select multiple files"
                        className={`hidden md:inline-flex min-h-[32px] px-2.5 py-1 rounded-xl text-xs font-semibold border items-center gap-1.5 cursor-pointer transition-colors ${
                          lassoModeActive
                            ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-600/20'
                            : 'bg-[#181A26] border border-[#212330] hover:border-blue-500 text-zinc-200'
                        }`}
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>{lassoModeActive ? 'Lasso Mode: ON' : 'Lasso Select'}</span>
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 sm:gap-2.5">
                  <span className="hidden xl:inline text-xs text-zinc-400">
                    Right-click any file for quick actions or drag to multi-select
                  </span>

                  {/* Sort Dropdown Menu (Name, Size, Date Modified, Type) */}
                  <div ref={sortMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSortMenu((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={showSortMenu}
                      aria-label="Sort files"
                      className="min-h-[32px] px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <ArrowUpDown className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>
                        Sort:{' '}
                        {sortBy === 'name'
                          ? 'Name'
                          : sortBy === 'size'
                          ? 'Size'
                          : sortBy === 'type'
                          ? 'Type'
                          : 'Date'}
                      </span>
                      {sortOrder === 'asc' ? (
                        <ArrowUp className="w-3 h-3 text-zinc-400 shrink-0" />
                      ) : (
                        <ArrowDown className="w-3 h-3 text-zinc-400 shrink-0" />
                      )}
                      <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                    </button>

                    {showSortMenu && (
                      <div
                        role="menu"
                        aria-label="Sort files by"
                        className="animate-app-pop absolute right-0 top-full mt-1.5 z-40 w-52 rounded-2xl bg-[#12131C] backdrop-blur-md border border-[#252838] shadow-2xl p-1.5 select-none text-white"
                      >
                        <div className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                          Sort Files By
                        </div>
                        {(
                          [
                            { id: 'name', label: 'Name' },
                            { id: 'size', label: 'Size' },
                            { id: 'date', label: 'Date Modified' },
                            { id: 'type', label: 'Type' },
                          ] as const
                        ).map((opt) => {
                          const isSelected = sortBy === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              role="menuitem"
                              onClick={() => handleSelectSortField(opt.id)}
                              className={`w-full px-2.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                isSelected
                                  ? 'bg-blue-600/20 text-blue-400'
                                  : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <Check
                                  className={`w-3.5 h-3.5 ${
                                    isSelected ? 'opacity-100 text-blue-400' : 'opacity-0'
                                  }`}
                                />
                                <span>{opt.label}</span>
                              </span>
                              {isSelected && (
                                <span className="text-[10px] font-bold text-blue-400 flex items-center gap-0.5">
                                  {sortOrder === 'asc' ? 'ASC ↑' : 'DESC ↓'}
                                </span>
                              )}
                            </button>
                          );
                        })}

                        <div className="my-1 border-t border-[#212330]" />
                        <div className="grid grid-cols-2 gap-1 p-0.5">
                          <button
                            type="button"
                            onClick={() => handleSetSortOrder('asc')}
                            className={`min-h-[30px] px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                              sortOrder === 'asc'
                                ? 'bg-blue-600 text-white'
                                : 'bg-[#181A26] text-zinc-400 hover:text-white'
                            }`}
                          >
                            <ArrowUp className="w-3 h-3" />
                            <span>Ascending</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetSortOrder('desc')}
                            className={`min-h-[30px] px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                              sortOrder === 'desc'
                                ? 'bg-blue-600 text-white'
                                : 'bg-[#181A26] text-zinc-400 hover:text-white'
                            }`}
                          >
                            <ArrowDown className="w-3 h-3" />
                            <span>Descending</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Grid / List Layout Toggle */}
                  <div className="flex items-center bg-[#181A26] border border-[#212330] rounded-xl overflow-hidden p-0.5">
                    <button
                      type="button"
                      onClick={() => handleChangeLayout('grid')}
                      className={`min-h-[28px] px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                        explorerLayout === 'grid'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                      title="Grid View"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Grid</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangeLayout('list')}
                      className={`min-h-[28px] px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                        explorerLayout === 'list'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                      title="List View"
                    >
                      <ListIcon className="w-3.5 h-3.5" />
                      <span>List</span>
                    </button>
                  </div>
                </div>
              </div>

              {(isFetchingWorkspace && files.length === 0) || isNavigatingExplorer ? (
                explorerLayout === 'list' ? (
                  /* ============================================================
                      SKELETON LOADING STATE — LIST VIEW
                  ============================================================ */
                  <div
                    aria-busy="true"
                    aria-label="Loading file list"
                    className="rounded-2xl overflow-hidden bg-[#12131C] border border-[#212330] divide-y divide-[#212330]"
                  >
                    {[68, 52, 74, 46, 62, 58].map((widthPct, idx) => (
                      <div
                        key={idx}
                        className="p-3 sm:px-4 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-lg bg-[#181A26] border border-[#252838] animate-pulse shrink-0" />
                          <div className="w-10 h-10 rounded-xl bg-[#181A26] border border-[#252838] animate-pulse shrink-0" />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div
                              style={{ width: `${widthPct}%` }}
                              className="h-3.5 max-w-xs rounded-md bg-white/10 animate-pulse"
                            />
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-14 rounded-md bg-white/5 animate-pulse" />
                              <div className="h-2.5 w-20 rounded-md bg-white/5 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* ============================================================
                      SKELETON LOADING STATE — GRID VIEW CARDS
                  ============================================================ */
                  <div
                    aria-busy="true"
                    aria-label="Loading file grid cards"
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
                  >
                    {[72, 58, 80, 64, 54, 76, 60, 68].map((widthPct, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl p-3.5 sm:p-4 bg-[#12131C] border border-[#212330] flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-lg bg-[#181A26] border border-[#252838] animate-pulse shrink-0" />
                          <div className="w-11 h-11 rounded-xl bg-[#181A26] border border-[#252838] animate-pulse shrink-0" />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div
                              style={{ width: `${widthPct}%` }}
                              className="h-3.5 rounded-md bg-white/10 animate-pulse"
                            />
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-12 rounded-md bg-white/5 animate-pulse" />
                              <div className="h-2.5 w-16 rounded-md bg-white/5 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : visibleFiles.length === 0 ? (
                <div
                  className={`rounded-2xl p-8 sm:p-12 bg-[#12131C] border text-center space-y-3 ${
                    isDraggingOver ? 'border-blue-500 bg-blue-500/10' : 'border-[#212330]'
                  }`}
                >
                  <div className="text-base font-bold text-white">
                    {selectedTagFilter
                      ? `No files labeled "${selectedTagFilter}"`
                      : 'This folder is empty'}
                  </div>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto">
                    {selectedTagFilter
                      ? 'Assign this label to any file card using the + Label button, or clear the active filter.'
                      : 'Tap Upload Files below or upload directly from any web link.'}
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-2">
                    {selectedTagFilter ? (
                      <button
                        onClick={() => setSelectedTagFilter(null)}
                        className="min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 cursor-pointer shadow-md shadow-blue-600/20 transition-all"
                      >
                        Show All Files
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 cursor-pointer shadow-md shadow-blue-600/20 transition-all"
                        >
                          + Upload Files
                        </button>
                        <button
                          onClick={() => setShowRemoteModal(true)}
                          className="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#181A26] border border-[#212330] hover:border-blue-500 text-white cursor-pointer transition-colors"
                        >
                          Upload from Link
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : explorerLayout === 'list' ? (
                /* ============================================================
                    LIST VIEW LAYOUT (Supports Mobile Touch Drag-to-Select)
                ============================================================ */
                <div
                  onTouchMove={(e) => {
                    if (!touchDragSelectActiveRef.current && selectedFileIds.length === 0) return;
                    const touch = e.touches[0];
                    if (!touch) return;
                    const targetEl = document
                      .elementFromPoint(touch.clientX, touch.clientY)
                      ?.closest('[data-select-file-id]');
                    const fid = targetEl?.getAttribute('data-select-file-id');
                    if (fid) {
                      setSelectedFileIds((prev) => (prev.includes(fid) ? prev : [...prev, fid]));
                    }
                  }}
                  onTouchEnd={() => {
                    touchDragSelectActiveRef.current = false;
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  className="rounded-2xl overflow-hidden bg-[#12131C] border border-[#212330] divide-y divide-[#212330]"
                >
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    const isLocked = Boolean(file.lockedOverQuota);
                    const isSelected = selectedFileIds.includes(file.id);
                    const fileTags = Array.isArray(file.tags) ? file.tags : [];
                    return (
                      <div
                        key={file.id}
                        data-select-file-id={file.id}
                        draggable={!isLocked}
                        onContextMenu={(e) => handleOpenFileContextMenu(e, file)}
                        onClick={() => {
                          if (isLocked) {
                            setActiveView('pricing');
                            return;
                          }
                          setInspectedFile(file);
                        }}
                        onMouseEnter={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onTouchStart={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = setTimeout(() => {
                            touchDragSelectActiveRef.current = true;
                            setSelectedFileIds((prev) =>
                              prev.includes(file.id) ? prev : [...prev, file.id]
                            );
                          }, 320);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                        }}
                        onDragStart={(e) => {
                          setDraggedFileId(file.id);
                          e.dataTransfer.setData('text/plain', file.id);
                        }}
                        onDragEnd={() => {
                          setDraggedFileId(null);
                          setDragOverFolderId(null);
                        }}
                        className={`p-3 sm:px-4 flex items-center justify-between gap-3 transition-colors select-none cursor-pointer group ${
                          isSelected
                            ? 'bg-blue-600/15'
                            : 'hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Select ${file.name}`}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              touchDragSelectActiveRef.current = true;
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFile(file.id);
                            }}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-[#181A26] border-[#252838] text-zinc-400 hover:border-blue-500 hover:text-white'
                            }`}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <div className="w-10 h-10 rounded-xl bg-[#181A26] border border-[#252838] flex items-center justify-center shrink-0 overflow-hidden">
                            {file.previewDataUrl && file.mimeType.startsWith('image/') ? (
                              <img
                                src={file.previewDataUrl}
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              renderFileIcon(file)
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-sm font-bold text-white group-hover:text-blue-400 truncate transition-colors"
                                title={file.name}
                              >
                                {file.name}
                              </span>
                              {file.starred && (
                                <Star
                                  className="w-3.5 h-3.5 text-amber-400 shrink-0"
                                  fill="currentColor"
                                />
                              )}
                              {fileTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-blue-600/15 border border-blue-500/30 text-blue-400 shrink-0"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 tabular-nums mt-0.5">
                              <span className="text-white font-medium">
                                {formatBytes(file.sizeBytes)}
                              </span>
                              <span>·</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
                              {offlineFilesMap[file.id] && (
                                <>
                                  <span>·</span>
                                  <span className="text-emerald-400 font-semibold">Offline</span>
                                </>
                              )}
                              {existingShare && (
                                <>
                                  <span>·</span>
                                  <span className="text-cyan-400 font-semibold">Shared</span>
                                </>
                              )}
                              {isLocked && (
                                <>
                                  <span>·</span>
                                  <span className="text-amber-400 font-semibold">Locked</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ============================================================
                    GRID VIEW LAYOUT (Click Card to Preview, Select for Actions)
                ============================================================ */
                <div
                  onTouchMove={(e) => {
                    if (!touchDragSelectActiveRef.current && selectedFileIds.length === 0) return;
                    const touch = e.touches[0];
                    if (!touch) return;
                    const targetEl = document
                      .elementFromPoint(touch.clientX, touch.clientY)
                      ?.closest('[data-select-file-id]');
                    const fid = targetEl?.getAttribute('data-select-file-id');
                    if (fid) {
                      setSelectedFileIds((prev) => (prev.includes(fid) ? prev : [...prev, fid]));
                    }
                  }}
                  onTouchEnd={() => {
                    touchDragSelectActiveRef.current = false;
                    if (longPressTimerRef.current) {
                      clearTimeout(longPressTimerRef.current);
                      longPressTimerRef.current = null;
                    }
                  }}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
                >
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    const isLocked = Boolean(file.lockedOverQuota);
                    const isSelected = selectedFileIds.includes(file.id);
                    const fileTags = Array.isArray(file.tags) ? file.tags : [];
                    return (
                      <div
                        key={file.id}
                        data-select-file-id={file.id}
                        draggable={!isLocked && !lassoModeActive}
                        onContextMenu={(e) => handleOpenFileContextMenu(e, file)}
                        onClick={() => {
                          if (isLocked) {
                            setActiveView('pricing');
                            return;
                          }
                          setInspectedFile(file);
                        }}
                        onMouseEnter={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                        }}
                        onTouchStart={() => {
                          if (!isLocked) preloadVideoFile(file, authHeaders());
                          if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                          longPressTimerRef.current = setTimeout(() => {
                            touchDragSelectActiveRef.current = true;
                            setSelectedFileIds((prev) =>
                              prev.includes(file.id) ? prev : [...prev, file.id]
                            );
                          }, 320);
                        }}
                        onTouchEnd={() => {
                          if (longPressTimerRef.current) {
                            clearTimeout(longPressTimerRef.current);
                            longPressTimerRef.current = null;
                          }
                        }}
                        onDragStart={(e) => {
                          setDraggedFileId(file.id);
                          e.dataTransfer.setData('text/plain', file.id);
                        }}
                        onDragEnd={() => {
                          setDraggedFileId(null);
                          setDragOverFolderId(null);
                        }}
                        className={`animate-app-card rounded-2xl p-3.5 sm:p-4 border flex items-center justify-between gap-3 select-none cursor-pointer group transition-all ${
                          isSelected
                            ? 'bg-blue-600/15 border-blue-500 shadow-md shadow-blue-600/10'
                            : isLocked
                            ? 'bg-[#12131C] border-amber-500/50'
                            : 'bg-[#12131C] border-[#212330] hover:border-blue-500/60 hover:bg-[#161724]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Selection Checkbox */}
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Select ${file.name}`}
                            onTouchStart={(e) => {
                              e.stopPropagation();
                              touchDragSelectActiveRef.current = true;
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectFile(file.id);
                            }}
                            className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-[#181A26] border-[#252838] text-zinc-400 hover:border-blue-500 hover:text-white'
                            }`}
                            title={isSelected ? 'Deselect file' : 'Select file'}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* File Thumbnail / Icon */}
                          <div className="w-11 h-11 rounded-xl bg-[#181A26] border border-[#252838] flex items-center justify-center shrink-0 overflow-hidden">
                            {file.previewDataUrl && file.mimeType.startsWith('image/') ? (
                              <img
                                src={file.previewDataUrl}
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              renderFileIcon(file)
                            )}
                          </div>

                          {/* File Name & Clean Metadata */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-sm font-bold text-white group-hover:text-blue-400 text-left break-all line-clamp-1 transition-colors"
                                title={file.name}
                              >
                                {file.name}
                              </span>
                              {file.starred && (
                                <Star
                                  className="w-3.5 h-3.5 text-amber-400 shrink-0"
                                  fill="currentColor"
                                />
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                              <span className="text-white font-semibold">
                                {formatBytes(file.sizeBytes)}
                              </span>
                              <span aria-hidden="true">·</span>
                              {isLocked ? (
                                <span className="text-amber-400 font-semibold">
                                  Locked (&gt;25 GB)
                                </span>
                              ) : offlineFilesMap[file.id] ? (
                                <span className="text-emerald-400 font-semibold">
                                  Offline Ready
                                </span>
                              ) : savingOfflineFileId === file.id ? (
                                <span className="text-blue-400 font-semibold">
                                  Saving {offlineProgressPct}%
                                </span>
                              ) : (
                                <span>{formatShortDate(file.updatedAt)}</span>
                              )}
                              {existingShare && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-cyan-400 font-semibold">Shared</span>
                                </>
                              )}
                            </div>
                            {fileTags.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                {fileTags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-blue-600/15 border border-blue-500/30 text-blue-400"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
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
            files={activeFiles}
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
              const found = activeFiles.find((f) => f.id === fid);
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
          onClick={() => {
            dragDepthRef.current = 0;
            setIsDraggingOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (
              !e.relatedTarget ||
              e.clientX <= 0 ||
              e.clientY <= 0 ||
              e.clientX >= window.innerWidth ||
              e.clientY >= window.innerHeight
            ) {
              dragDepthRef.current = 0;
              setIsDraggingOver(false);
            }
          }}
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
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs border-4 border-dashed border-[#D97757] m-3 rounded-3xl flex items-center justify-center p-6 pointer-events-auto cursor-pointer"
        >
          <div className="relative max-w-md w-full bg-[#1C1A17] border border-[#D97757] rounded-2xl p-8 text-center space-y-4 shadow-2xl">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dragDepthRef.current = 0;
                setIsDraggingOver(false);
              }}
              aria-label="Dismiss upload overlay"
              className="w-8 h-8 rounded-xl bg-[#24211D] border border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9] absolute top-3.5 right-3.5 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#24211D] border border-[#D97757] flex items-center justify-center">
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
              <p className="text-[11px] text-[#9E978E] pt-1">
                Click anywhere or press Esc to cancel
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          GOOGLE DRIVE-STYLE MOBILE FLOATING PLUS (+) UPLOAD BUTTON & NATIVE BOTTOM SHEET
      ==================================================================== */}
      {showMobilePlusMenu && (
        <div
          onClick={() => setShowMobilePlusMenu(false)}
          className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs md:hidden flex items-end justify-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-app-sheet w-full bg-[#1C1A17] rounded-t-3xl border-t border-[#2C2824] shadow-2xl p-4 pb-8 space-y-2"
          >
            {/* Native Bottom Sheet Drag Pill */}
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mb-2" />
            <div className="px-2 pb-2 flex items-center justify-between border-b border-[#2C2824]">
              <span className="text-xs font-bold text-[#F2EFE9] uppercase tracking-wider">
                Add to {activeFolder ? activeFolder.name : 'Cloud Drive'}
              </span>
              <button
                type="button"
                onClick={() => setShowMobilePlusMenu(false)}
                className="w-8 h-8 rounded-full bg-[#24211D] flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
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
              className="w-full p-3.5 rounded-2xl text-left flex items-center gap-3.5 bg-[#24211D]/60 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#D97757] text-[#141311] flex items-center justify-center shrink-0 shadow-xs">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#F2EFE9]">
                  Upload Files, Videos &amp; Photos
                </div>
                <div className="text-xs text-[#9E978E]">
                  100% Original Lossless Quality via Main Account
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
              className="w-full p-3.5 rounded-2xl text-left flex items-center gap-3.5 bg-[#24211D]/60 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#24211D] border border-[#2C2824] text-[#D97757] flex items-center justify-center shrink-0">
                <FolderPlus className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#F2EFE9]">Create New Folder</div>
                <div className="text-xs text-[#9E978E]">
                  Organize files with optional PIN protection
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
              className="w-full p-3.5 rounded-2xl text-left flex items-center gap-3.5 bg-[#24211D]/60 hover:bg-[#24211D] cursor-pointer"
            >
              <div className="w-11 h-11 rounded-2xl bg-[#24211D] border border-[#2C2824] text-[#D97757] flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#F2EFE9]">Upload from Web Link</div>
                <div className="text-xs text-[#9E978E]">
                  Fetch direct file URL straight to your cloud vault
                </div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          MOBILE SELECTION ACTION SHEET (Slides up smoothly when 1+ files selected)
      ==================================================================== */}
      {selectedFileIds.length > 0 && activeView === 'explorer' && (
        <div className="animate-app-sheet fixed bottom-16 left-2 right-2 z-40 md:hidden rounded-3xl bg-white/95 backdrop-blur-md border border-[#D97757]/50 shadow-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#2C2824]">
            <div className="flex items-center gap-2 text-xs min-w-0">
              <CheckSquare className="w-4 h-4 text-[#D97757] shrink-0" />
              <span className="font-bold text-[#F2EFE9] truncate">
                {selectedFileIds.length}{' '}
                {selectedFileIds.length === 1 ? 'file' : 'files'}
              </span>
              <span className="text-[#9E978E] tabular-nums shrink-0">
                ({formatBytes(selectedTotalBytes)})
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  selectedFilesObjects.forEach((f) => {
                    void handleToggleStar(f);
                  });
                }}
                className="min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                title="Star / Unstar Selected"
              >
                <Star
                  className="w-3 h-3 text-[#D97757]"
                  fill={
                    selectedFilesObjects.length > 0 &&
                    selectedFilesObjects.every((f) => f.starred)
                      ? '#D97757'
                      : 'none'
                  }
                />
                <span>Star</span>
              </button>
              <button
                type="button"
                onClick={() => setTagModalFiles(selectedFilesObjects)}
                className="min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
                title="Label Selected"
              >
                <Tag className="w-3 h-3 text-[#D97757]" />
                <span>Label</span>
              </button>
              <button
                type="button"
                onClick={handleToggleSelectAllVisible}
                className="min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] cursor-pointer"
              >
                {allVisibleSelected ? 'None' : 'All'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedFileIds([])}
                className="min-h-[30px] px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#141311] border border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9] flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {/* 1. Share */}
            <button
              type="button"
              onClick={() => {
                if (selectedFilesObjects[0]) {
                  setShareModalFile(selectedFilesObjects[0]);
                }
              }}
              className="min-h-[42px] rounded-xl px-2 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
              <span>Share</span>
            </button>

            {/* 2. Save to Offline (Local Storage + IndexedDB) */}
            <button
              type="button"
              disabled={Boolean(savingOfflineFileId)}
              onClick={() => void handleBatchSaveOffline(selectedFilesObjects)}
              className={`min-h-[42px] rounded-xl px-2 py-2 text-xs font-bold border flex items-center justify-center gap-1.5 cursor-pointer ${
                selectedFilesObjects.length > 0 &&
                selectedFilesObjects.every((f) => Boolean(offlineFilesMap[f.id]))
                  ? 'bg-[#24211D] border-[#2E9E6B] text-[#2E9E6B]'
                  : 'bg-[#24211D] border-[#D97757] text-[#F2EFE9]'
              }`}
            >
              {savingOfflineFileId ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#D97757] shrink-0" />
                  <span>{offlineProgressPct}%</span>
                </>
              ) : selectedFilesObjects.length > 0 &&
                selectedFilesObjects.every((f) => Boolean(offlineFilesMap[f.id])) ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#2E9E6B] shrink-0" />
                  <span>Offline</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
                  <span>Save Offline</span>
                </>
              )}
            </button>

            {/* 3. Copy to Folder */}
            <button
              type="button"
              onClick={() => {
                setMoveModalMode('copy');
                setBatchMoveFiles(selectedFilesObjects);
              }}
              className="min-h-[42px] rounded-xl px-2 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
              <span>Copy</span>
            </button>

            {/* 4. Move to Folder */}
            <button
              type="button"
              onClick={() => {
                setMoveModalMode('move');
                setBatchMoveFiles(selectedFilesObjects);
              }}
              className="min-h-[42px] rounded-xl px-2 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FolderInput className="w-3.5 h-3.5 text-[#D97757] shrink-0" />
              <span>Move</span>
            </button>

            {/* 5. Download */}
            <button
              type="button"
              onClick={handleBatchDownload}
              className="min-h-[42px] rounded-xl px-2 py-2 text-xs font-bold bg-[#D97757] text-[#141311] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Download</span>
            </button>

            {/* 6. Delete (Move to Trash) */}
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
              className="min-h-[42px] rounded-xl px-2 py-2 text-xs font-semibold bg-[#141311] border border-[#D94848] text-[#D94848] flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 shrink-0" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* Sleek Google-Drive Style Floating '+' Pill Button on Mobile */}
      {selectedFileIds.length === 0 && (
        <div className="animate-app-fab fixed right-4 bottom-20 z-40 md:hidden flex items-center rounded-2xl overflow-hidden shadow-[0_10px_28px_rgba(37,99,235,0.32)] border border-blue-500/20">
          <button
            type="button"
            onClick={() => {
              if (activeView !== 'explorer') setActiveView('explorer');
              fileInputRef.current?.click();
            }}
            disabled={uploadingFiles}
            title="Tap to Upload Files in Original Quality"
            aria-label="Upload Files"
            className="h-13 pl-4 pr-3.5 bg-[#D97757] text-[#141311] hover:bg-[#E08568] active:scale-95 transition-all flex items-center justify-center gap-1.5 font-bold text-xs cursor-pointer"
          >
            <Plus className="w-5 h-5 stroke-[2.5]" />
            <span>Upload</span>
          </button>
          <button
            type="button"
            onClick={() => setShowMobilePlusMenu((prev) => !prev)}
            title="More Upload & Folder Options"
            aria-label="More Upload Options"
            className="w-11 h-13 bg-white text-[#D97757] border-l border-slate-200 active:scale-95 transition-all flex items-center justify-center cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ====================================================================
          MOBILE FIXED BOTTOM TAB BAR (Native App Frosted Bar + Pill Active Indicator)
      ==================================================================== */}
      <nav
        className={`fixed bottom-0 left-0 right-0 z-40 md:hidden grid ${
          isAdminUser ? 'grid-cols-5' : 'grid-cols-4'
        } bg-white/95 backdrop-blur-md border-t border-slate-200/90 shadow-[0_-4px_20px_rgba(15,23,42,0.04)] px-1 py-1`}
      >
        <button
          onClick={() => {
            setActiveView('explorer');
            setOnlyStarred(false);
            setOnlyOffline(false);
          }}
          className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer transition-all ${
            activeView === 'explorer' ? 'text-[#D97757] font-bold' : 'text-[#9E978E] font-medium'
          }`}
        >
          <div
            className={`px-3.5 py-1 rounded-full transition-all duration-200 ${
              activeView === 'explorer' ? 'bg-blue-50 scale-105' : ''
            }`}
          >
            <Folder className="w-4 h-4" />
          </div>
          <span>Files</span>
        </button>

        <button
          onClick={() => setActiveView('gallery')}
          className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer transition-all ${
            activeView === 'gallery' ? 'text-[#D97757] font-bold' : 'text-[#9E978E] font-medium'
          }`}
        >
          <div
            className={`px-3.5 py-1 rounded-full transition-all duration-200 ${
              activeView === 'gallery' ? 'bg-blue-50 scale-105' : ''
            }`}
          >
            <Film className="w-4 h-4" />
          </div>
          <span>Gallery</span>
        </button>

        <button
          onClick={() => setActiveView('shares')}
          className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer transition-all ${
            activeView === 'shares' ? 'text-[#D97757] font-bold' : 'text-[#9E978E] font-medium'
          }`}
        >
          <div
            className={`px-3.5 py-1 rounded-full transition-all duration-200 ${
              activeView === 'shares' ? 'bg-blue-50 scale-105' : ''
            }`}
          >
            <Link2 className="w-4 h-4" />
          </div>
          <span>Shared</span>
        </button>

        <button
          onClick={() => setActiveView('pricing')}
          className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer transition-all ${
            activeView === 'pricing' ? 'text-[#D97757] font-bold' : 'text-[#9E978E] font-medium'
          }`}
        >
          <div
            className={`px-3.5 py-1 rounded-full transition-all duration-200 ${
              activeView === 'pricing' ? 'bg-blue-50 scale-105' : ''
            }`}
          >
            <Coins className="w-4 h-4" />
          </div>
          <span>Plans</span>
        </button>

        {isAdminUser && (
          <button
            onClick={() => setActiveView('telegram_settings')}
            className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[11px] cursor-pointer transition-all ${
              activeView === 'telegram_settings'
                ? 'text-[#D97757] font-bold'
                : 'text-[#9E978E] font-medium'
            }`}
          >
            <div
              className={`px-3.5 py-1 rounded-full transition-all duration-200 ${
                activeView === 'telegram_settings' ? 'bg-blue-50 scale-105' : ''
              }`}
            >
              <Settings className="w-4 h-4" />
            </div>
            <span>Admin</span>
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

      {/* ====================================================================
          RIGHT-CLICK FILE CONTEXT MENU (Copy, Move, Rename, Delete & Quick Actions)
      ==================================================================== */}
      {fileContextMenu && (
        <div
          style={{
            left: `${fileContextMenu.x}px`,
            top: `${fileContextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          role="menu"
          aria-label={`Actions for ${fileContextMenu.file.name}`}
          className="animate-app-pop fixed z-50 w-56 rounded-2xl bg-white/98 backdrop-blur-md border border-slate-200/90 shadow-[0_14px_38px_rgba(15,23,42,0.16)] p-1.5 select-none"
        >
          {/* Context Menu File Header */}
          <div className="px-2.5 py-2 border-b border-slate-100 mb-1">
            <div className="text-xs font-bold text-slate-900 truncate" title={fileContextMenu.file.name}>
              {fileContextMenu.file.name}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
              {formatBytes(fileContextMenu.file.sizeBytes)}
            </div>
          </div>

          {/* 1. Preview */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              if (target.lockedOverQuota) {
                setActiveView('pricing');
              } else {
                setInspectedFile(target);
              }
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Eye className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Preview File</span>
            </span>
          </button>

          {/* 2. Rename */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              setRenameModalFile(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Pencil className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Rename</span>
            </span>
          </button>

          {/* 3. Copy */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              setMoveModalMode('copy');
              setMoveModalFile(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Copy className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Copy to Folder...</span>
            </span>
          </button>

          {/* 4. Move */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              setMoveModalMode('move');
              setMoveModalFile(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <FolderInput className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Move to Folder...</span>
            </span>
          </button>

          {/* 5. Share */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              setShareModalFile(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Share Link</span>
            </span>
          </button>

          {/* 6. Star / Unstar */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              void handleToggleStar(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Star
                className="w-3.5 h-3.5 text-[#D97757]"
                fill={fileContextMenu.file.starred ? '#D97757' : 'none'}
              />
              <span>{fileContextMenu.file.starred ? 'Remove Star' : 'Add to Starred'}</span>
            </span>
          </button>

          {/* 7. Download */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              void handleDownloadFile(target);
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-800 hover:bg-slate-100/90 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Download className="w-3.5 h-3.5 text-[#D97757]" />
              <span>Download</span>
            </span>
          </button>

          <div className="my-1 border-t border-slate-100" />

          {/* 8. Delete */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const target = fileContextMenu.file;
              setFileContextMenu(null);
              setDeleteTarget({
                type: 'file',
                id: target.id,
                name: target.name,
                subtitle: `Size: ${formatBytes(target.sizeBytes)}`,
              });
            }}
            className="w-full px-2.5 py-2 rounded-xl text-xs font-semibold text-[#D94848] hover:bg-red-50 flex items-center justify-between gap-2 cursor-pointer transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Trash2 className="w-3.5 h-3.5 text-[#D94848]" />
              <span>Delete</span>
            </span>
          </button>
        </div>
      )}

      {/* ====================================================================
          RENAME FILE MODAL
      ==================================================================== */}
      {renameModalFile && (
        <div
          onClick={() => {
            if (!renamingBusy) setRenameModalFile(null);
          }}
          className="animate-app-backdrop fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-app-modal w-full max-w-md rounded-2xl bg-[#1C1A17] border border-[#2C2824] shadow-xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#2C2824] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#24211D] border border-[#2C2824] flex items-center justify-center">
                  <Pencil className="w-4 h-4 text-[#D97757]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#F2EFE9]">Rename File</h3>
                  <p className="text-[11px] text-[#9E978E]">
                    Enter a new name for this file
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={renamingBusy}
                onClick={() => setRenameModalFile(null)}
                className="w-8 h-8 rounded-lg bg-[#24211D] border border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9] flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameFileSubmit} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#9E978E]">
                  File Name
                </label>
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameInputValue}
                  onChange={(e) => setRenameInputValue(e.target.value)}
                  disabled={renamingBusy}
                  placeholder="Enter file name..."
                  className="w-full h-11 px-3.5 rounded-xl text-sm bg-[#24211D] border border-[#2C2824] focus:border-[#D97757] text-[#F2EFE9] outline-none transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={renamingBusy}
                  onClick={() => setRenameModalFile(null)}
                  className="h-10 px-4 rounded-xl text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] hover:border-[#D97757] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    renamingBusy ||
                    !renameInputValue.trim() ||
                    renameInputValue.trim() === renameModalFile.name
                  }
                  className="h-10 px-5 rounded-xl text-xs font-bold bg-[#D97757] text-[#141311] disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                >
                  {renamingBusy ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Name</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
