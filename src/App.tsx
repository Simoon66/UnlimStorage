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
  Gauge,
  Settings,
  Coins,
  Lock,
  Eye,
  ShieldCheck,
  LogIn,
} from 'lucide-react';
import {
  User,
  FolderRecord,
  FileRecord,
  ShareLink,
  TransferJob,
  AuditLog,
  BandwidthSettings,
  TelegramConfigState,
  RealtimeNotification,
  StoragePlanId,
} from './types';
import { formatBytes, formatShortDate, formatSpeed } from './utils/format';
import { apiFetch, uploadFilesWithProgress } from './services/clientCloudFallback';
import {
  auth,
  onAuthStateChanged,
  signInWithGooglePopup,
  signOutFirebaseUser,
  ensureFirestoreUserProfile,
  updateFirestoreUserProfile,
  syncCloudFileToFirestore,
  deleteCloudFileFromFirestore,
  FirebaseUser,
} from './firebase';
import { PublicSharePortal } from './components/PublicSharePortal';
import {
  RemoteUploadModal,
  CreateShareModal,
  FileDetailDrawer,
  DeleteConfirmModal,
  DeleteTarget,
  BuyTokensModal,
  AuthModal,
} from './components/Modals';
import {
  SharedLinksView,
  StoragePricingView,
  ActivityAndSpeedView,
  TelegramStorageView,
} from './components/Views';

type ActiveView = 'explorer' | 'shares' | 'pricing' | 'activity' | 'telegram_settings';

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
  const [logs, setLogs] = useState<AuditLog[]>([]);
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
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Live File Upload Progress Bar State
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    fileName: string;
    percent: number;
    loadedBytes: number;
    totalBytes: number;
    speedBps: number;
  } | null>(null);

  // Modals
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [shareModalFile, setShareModalFile] = useState<FileRecord | null>(null);
  const [inspectedFile, setInspectedFile] = useState<FileRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [showBuyTokensModal, setShowBuyTokensModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Real-time notifications
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setNotifications((prev) => {
      if (prev.some((n) => n.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 3);
    });
  }, []);

  // Listen to Firebase Auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthLoading(false);
      if (fbUser) {
        try {
          await ensureFirestoreUserProfile(fbUser);
        } catch {
          // ignore if offline or unverified
        }
      } else {
        setCurrentUser(null);
        setFolders([]);
        setFiles([]);
        setShares([]);
        setTransfers([]);
        setLogs([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    if (!firebaseUser) return;
    try {
      const isAdminEmail = firebaseUser.email?.toLowerCase() === 'titumamma2425@gmail.com';
      const [meRes, filesRes, sharesRes, bwRes, logsRes, tgRes] = await Promise.all([
        apiFetch('/api/auth/me', { headers: authHeaders() }),
        apiFetch('/api/files', { headers: authHeaders() }),
        apiFetch('/api/shares', { headers: authHeaders() }),
        apiFetch('/api/bandwidth', { headers: authHeaders() }),
        apiFetch('/api/logs', { headers: authHeaders() }),
        isAdminEmail
          ? apiFetch('/api/telegram/config', { headers: authHeaders() })
          : Promise.resolve(null),
      ]);

      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUser(meData.user);
      }
      if (filesRes.ok) {
        const fData = await filesRes.json();
        setFolders(fData.folders || []);
        setFiles(fData.files || []);
        setTransfers(fData.transfers || []);
      }
      if (sharesRes.ok) {
        const sData = await sharesRes.json();
        setShares(sData.shares || []);
      }
      if (bwRes.ok) {
        const bData = await bwRes.json();
        setBandwidthSettings(bData.settings);
      }
      if (logsRes.ok) {
        const lData = await logsRes.json();
        setLogs(lData.logs || []);
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
      setFirebaseUser(fbUser);
      pushNotification({
        id: `auth_${Date.now()}`,
        timestamp: new Date().toISOString(),
        title: 'Signed In with Google',
        message: `Welcome, ${fbUser.displayName || fbUser.email}! Your private 25 GB cloud drive is ready.`,
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
    setLogs([]);
    setActiveView('explorer');
  };

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;

    const totalBatchBytes = arr.reduce((acc, f) => acc + f.size, 0);
    const label =
      arr.length === 1 ? arr[0].name : `${arr.length} files (${arr[0].name}...)`;

    setUploadingFiles(true);
    setUploadProgress({
      fileName: label,
      percent: 5,
      loadedBytes: 0,
      totalBytes: totalBatchBytes,
      speedBps: 0,
    });

    try {
      const result = await uploadFilesWithProgress({
        files: arr,
        folderId: currentFolderId,
        headers: authHeaders(),
        onProgress: (info) => {
          setUploadProgress({
            fileName: label,
            percent: info.percent,
            loadedBytes: info.loadedBytes,
            totalBytes: info.totalBytes,
            speedBps: info.speedBps,
          });
        },
      });

      if (!result.ok) {
        pushNotification({
          id: `err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Upload Blocked',
          message: result.data?.error || 'Failed to upload files',
          type: 'error',
        });
        return;
      }

      if (result.data?.user) setCurrentUser(result.data.user);
      if (Array.isArray(result.data?.files)) {
        for (const uploaded of result.data.files as FileRecord[]) {
          syncCloudFileToFirestore(uploaded).catch(() => null);
        }
      }
      await loadWorkspaceData();
    } finally {
      setTimeout(() => {
        setUploadingFiles(false);
        setUploadProgress(null);
      }, 350);
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const res = await apiFetch('/api/folders', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        name: newFolderName.trim(),
        parentId: currentFolderId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setFolders((prev) => [...prev, data.folder]);
      setNewFolderName('');
      setCreatingFolder(false);
    }
  };

  const executeDeleteTarget = async () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'folder') {
      const res = await apiFetch(`/api/folders/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        if (currentFolderId === deleteTarget.id) setCurrentFolderId(null);
        await loadWorkspaceData();
        pushNotification({
          id: `del_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Folder Deleted',
          message: `"${deleteTarget.name}" was removed.`,
          type: 'info',
        });
      }
    } else {
      const res = await apiFetch(`/api/files/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) setCurrentUser(data.user);
        setFiles((prev) => prev.filter((f) => f.id !== deleteTarget.id));
        setShares((prev) => prev.filter((s) => s.fileId !== deleteTarget.id));
        deleteCloudFileFromFirestore(deleteTarget.id).catch(() => null);
        pushNotification({
          id: `del_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'File Deleted',
          message: `"${deleteTarget.name}" was permanently deleted from your cloud drive.`,
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
      const url = `/api/files/${encodeURIComponent(file.id)}/download?uid=${encodeURIComponent(
        firebaseUser?.uid || ''
      )}&email=${encodeURIComponent(firebaseUser?.email || '')}`;
      const res = await apiFetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        pushNotification({
          id: `dl_err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Download Blocked',
          message: errData.error || 'Could not download file',
          type: 'error',
        });
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
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
      setShares((prev) => [data.share, ...prev]);
      return data.share;
    },
    [authHeaders]
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
      setShares((prev) => prev.map((s) => (s.id === shareId ? data.share : s)));
      return data.share;
    },
    [authHeaders]
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
    const res = await apiFetch(`/api/shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      setShares((prev) => prev.filter((s) => s.id !== shareId));
    }
  };

  const handleUpdateBandwidthSettings = async (patch: Partial<BandwidthSettings>) => {
    const res = await apiFetch('/api/bandwidth/settings', {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setBandwidthSettings(data.settings);
    }
  };

  const handleSaveTelegramConfig = async (payload: {
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

  // ============================================================================
  // 1. PUBLIC SHARE PORTAL RENDERING
  // ============================================================================

  if (publicShareToken) {
    return (
      <PublicSharePortal
        token={publicShareToken}
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
          <div className="text-sm font-bold text-[#F2EFE9]">UnlimCloud Encrypted Vault</div>
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
            <span className="text-lg font-bold tracking-tight text-[#F2EFE9]">UnlimCloud</span>
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
                Sign in to UnlimCloud
              </h1>
              <p className="text-xs sm:text-sm text-[#9E978E] leading-relaxed">
                Sign in with your Google account to unlock your private{' '}
                <strong className="text-[#F2EFE9]">25 GB Free encrypted cloud drive</strong>.
                Authentication is required to upload, preview, or manage files.
              </p>
            </div>

            <div className="p-4 bg-[#141311] border border-[#2C2824] space-y-2 text-xs text-[#9E978E]">
              <div className="flex items-center justify-between">
                <span>Starter Storage Included</span>
                <strong className="text-[#2E9E6B]">25 GB Free Forever</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>Pro &amp; Ultra Plans</span>
                <strong className="text-[#F2EFE9]">50 GB (500 T) · 1 TB (1024 T)</strong>
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
          UnlimCloud — Private Encrypted Cloud Storage · Login Required
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

  const activeFolder = folders.find((f) => f.id === currentFolderId) || null;
  const visibleSubfolders = folders.filter((f) => f.parentId === currentFolderId);

  const visibleFiles = files.filter((f) => {
    if (onlyStarred) {
      if (!f.starred) return false;
    } else if (!searchQuery.trim()) {
      if (f.folderId !== currentFolderId) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return f.name.toLowerCase().includes(q) || f.ownerName.toLowerCase().includes(q);
    }
    return true;
  });

  const totalStorageBytes = files.reduce((acc, f) => acc + f.sizeBytes, 0);
  const quotaLimitBytes = currentUser?.bandwidthLimitBytes || 25 * 1024 * 1024 * 1024;
  const quotaPct = Math.min(100, Math.round((totalStorageBytes / quotaLimitBytes) * 100));
  const lockedFilesCount = files.filter((f) => f.lockedOverQuota).length;
  const tokenBalance = currentUser?.tokenBalance || 0;
  const planBadge =
    currentUser?.planId === 'ultra_1tb'
      ? '1 TB Ultra'
      : currentUser?.planId === 'pro_50gb'
      ? '50 GB Pro'
      : '25 GB Free';

  const activeStreamingJobs = transfers.filter(
    (t) => t.status === 'queued' || t.status === 'streaming' || t.status === 'syncing_telegram'
  );

  return (
    <div className="min-h-screen bg-[#141311] text-[#F2EFE9] flex flex-col">
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
          UnlimCloud
        </a>

        {/* Zone 2: Desktop Navigation Links (Admin Storage Node tab hidden from regular users) */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#9E978E]">
          <a
            href="#my-files"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('explorer');
              setOnlyStarred(false);
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'explorer'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            My Files ({files.length})
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
            Plans & Tokens ({tokenBalance.toLocaleString()} T)
          </a>
          <a
            href="#activity"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('activity');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 py-1 ${
              activeView === 'activity'
                ? 'text-[#F2EFE9] border-b-2 border-[#D97757] font-semibold'
                : 'hover:text-[#F2EFE9]'
            }`}
          >
            Activity & Speed
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

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            className="min-h-[40px] sm:min-h-[38px] px-4 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {uploadingFiles ? 'Uploading...' : '+ Upload Files'}
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
                  UnlimCloud Encrypted Vault ({planBadge})
                </div>
                <div className="text-xs text-[#9E978E] tabular-nums">
                  <strong className="text-[#F2EFE9]">{formatBytes(totalStorageBytes)}</strong> used
                  of <strong className="text-[#F2EFE9]">{formatBytes(quotaLimitBytes)}</strong>
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

        {/* LIVE FILE UPLOAD PROGRESS BAR (Determinate 0% -> 100%) */}
        {(uploadProgress || activeStreamingJobs.length > 0) && (
          <div className="p-4 bg-[#1C1A17] border border-[#D97757] space-y-3">
            {uploadProgress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs tabular-nums">
                  <span className="font-bold text-[#F2EFE9] truncate">
                    Uploading: {uploadProgress.fileName}
                  </span>
                  <span className="text-[#D97757] font-bold shrink-0">
                    {uploadProgress.percent}% · {formatBytes(uploadProgress.loadedBytes)} /{' '}
                    {formatBytes(uploadProgress.totalBytes)} ·{' '}
                    {formatSpeed(uploadProgress.speedBps)}
                  </span>
                </div>
                <div className="h-2.5 w-full bg-[#141311] border border-[#2C2824]">
                  <div
                    style={{ width: `${uploadProgress.percent}%` }}
                    className="h-full bg-[#D97757] transition-all duration-100"
                  />
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
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-semibold text-[#F2EFE9] truncate">{job.fileName}</span>
                    <span className="text-[#9E978E] shrink-0">
                      {pct}% · {formatBytes(job.transferredBytes)} · {formatSpeed(job.speedBps)}
                    </span>
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
              </div>

              <div className="relative w-full lg:w-80">
                <Search className="w-4 h-4 text-[#9E978E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your files..."
                  className="w-full min-h-[44px] bg-[#1C1A17] border border-[#2C2824] pl-10 pr-4 py-2.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
              </div>
            </div>

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

            {/* Breadcrumb */}
            {(activeFolder || onlyStarred) && (
              <div className="flex items-center gap-2 text-sm font-semibold">
                <button
                  onClick={() => {
                    setCurrentFolderId(null);
                    setOnlyStarred(false);
                  }}
                  className="min-h-[40px] px-2 -ml-2 text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                >
                  My Files
                </button>
                <ChevronRight className="w-4 h-4 text-[#9E978E]" />
                <span className="text-[#D97757] truncate">
                  {onlyStarred ? 'Starred Files' : activeFolder?.name}
                </span>
              </div>
            )}

            {/* Folders Section */}
            {!onlyStarred && !searchQuery.trim() && visibleSubfolders.length > 0 && (
              <div className="space-y-2.5">
                <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                  Folders
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {visibleSubfolders.map((folder) => {
                    const count = files.filter((f) => f.folderId === folder.id).length;
                    return (
                      <div
                        key={folder.id}
                        onClick={() => setCurrentFolderId(folder.id)}
                        className="min-h-[64px] p-4 bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Folder className="w-6 h-6 text-[#D97757] shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-[#F2EFE9] truncate group-hover:text-[#D97757]">
                              {folder.name}
                            </div>
                            <div className="text-xs text-[#9E978E]">
                              {count} {count === 1 ? 'file' : 'files'}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({
                              type: 'folder',
                              id: folder.id,
                              name: folder.name,
                              subtitle: `Contains ${count} ${count === 1 ? 'file' : 'files'}`,
                            });
                          }}
                          className="min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                          title="Delete Folder"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Files Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                  Files ({visibleFiles.length})
                </h2>
                <span className="hidden sm:inline text-xs text-[#9E978E]">
                  Tap any file to preview · Drag & drop files anywhere to upload
                </span>
              </div>

              {visibleFiles.length === 0 ? (
                <div
                  className={`p-8 sm:p-12 bg-[#1C1A17] border text-center space-y-3 ${
                    isDraggingOver ? 'border-[#D97757]' : 'border-[#2C2824]'
                  }`}
                >
                  <div className="text-base font-bold text-[#F2EFE9]">
                    This folder is empty
                  </div>
                  <p className="text-xs text-[#9E978E] max-w-md mx-auto">
                    Tap Upload Files below or upload directly from any web link.
                  </p>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-2">
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
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    const isLocked = Boolean(file.lockedOverQuota);
                    return (
                      <div
                        key={file.id}
                        className={`p-4 sm:p-5 bg-[#1C1A17] border transition-colors flex flex-col justify-between gap-4 ${
                          isLocked
                            ? 'border-[#D99B26]/80'
                            : 'border-[#2C2824] hover:border-[#D97757]/70'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
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

                            <div className="flex items-center -mr-2 -mt-2">
                              <button
                                onClick={() => setInspectedFile(file)}
                                className="min-w-[40px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                                title="Preview File"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleToggleStar(file)}
                                className={`min-w-[40px] min-h-[44px] flex items-center justify-center cursor-pointer ${
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
                                className="min-w-[40px] min-h-[44px] flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                                title="Delete File"
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
                              ) : (
                                <span>Encrypted Vault</span>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
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
                          <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#2C2824]">
                            <button
                              onClick={() => setShareModalFile(file)}
                              className="min-h-[44px] py-2.5 px-3 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Link2 className="w-4 h-4 text-[#D97757]" />
                              {existingShare ? 'Shared Link' : 'Share'}
                            </button>

                            <button
                              onClick={() => handleDownloadFile(file)}
                              className="min-h-[44px] py-2.5 px-3 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-4 h-4" />
                              Download
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
            VIEW 4: ACTIVITY & SPEED
        ================================================================== */}
        {activeView === 'activity' && (
          <ActivityAndSpeedView
            settings={bandwidthSettings}
            logs={logs}
            onUpdateSettings={handleUpdateBandwidthSettings}
          />
        )}

        {/* ==================================================================
            VIEW 5: ADMIN-ONLY STORAGE NODE SETUP
        ================================================================== */}
        {activeView === 'telegram_settings' && isAdminUser && (
          <TelegramStorageView
            config={telegramConfig}
            onSaveConfig={handleSaveTelegramConfig}
          />
        )}
      </main>

      {/* ====================================================================
          MOBILE FIXED BOTTOM TAB BAR
      ==================================================================== */}
      <nav
        className={`fixed bottom-0 left-0 right-0 z-40 md:hidden grid ${
          isAdminUser ? 'grid-cols-5' : 'grid-cols-4'
        } bg-[#1C1A17] border-t border-[#2C2824]`}
      >
        <button
          onClick={() => {
            setActiveView('explorer');
            setOnlyStarred(false);
          }}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeView === 'explorer' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Folder className="w-5 h-5" />
          <span>My Files</span>
        </button>

        <button
          onClick={() => setActiveView('shares')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeView === 'shares' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Link2 className="w-5 h-5" />
          <span>Shared</span>
        </button>

        <button
          onClick={() => setActiveView('pricing')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeView === 'pricing' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Coins className="w-5 h-5" />
          <span>Plans</span>
        </button>

        <button
          onClick={() => setActiveView('activity')}
          className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
            activeView === 'activity' ? 'text-[#D97757] font-bold' : 'text-[#9E978E]'
          }`}
        >
          <Gauge className="w-5 h-5" />
          <span>Speed</span>
        </button>

        {isAdminUser && (
          <button
            onClick={() => setActiveView('telegram_settings')}
            className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              activeView === 'telegram_settings'
                ? 'text-[#D97757] font-bold'
                : 'text-[#9E978E]'
            }`}
          >
            <Settings className="w-5 h-5" />
            <span>Node</span>
          </button>
        )}
      </nav>

      {/* ====================================================================
          REAL-TIME COMPLETION NOTIFICATION POPUP
      ==================================================================== */}
      {notifications.length > 0 && (
        <div className="fixed bottom-20 md:bottom-5 left-4 right-4 md:left-auto md:right-5 z-50 md:w-full md:max-w-sm space-y-2 pointer-events-none">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="pointer-events-auto bg-[#1C1A17] border border-[#D97757] p-4 flex items-start justify-between gap-3"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {n.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-[#D94848] shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-[#2E9E6B] shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 min-w-0">
                  <div className="text-xs font-bold text-[#F2EFE9]">{n.title}</div>
                  <div className="text-xs text-[#9E978E] break-words">{n.message}</div>
                </div>
              </div>
              <button
                onClick={() =>
                  setNotifications((prev) => prev.filter((item) => item.id !== n.id))
                }
                className="min-w-[36px] min-h-[36px] -mr-2 -mt-2 flex items-center justify-center text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ====================================================================
          MODALS
      ==================================================================== */}
      {showRemoteModal && (
        <RemoteUploadModal
          folders={folders}
          currentFolderId={currentFolderId}
          onClose={() => setShowRemoteModal(false)}
          onStartRemoteUpload={handleStartRemoteUpload}
        />
      )}

      {shareModalFile && (
        <CreateShareModal
          file={shareModalFile}
          existingShare={shares.find((s) => s.fileId === shareModalFile.id)}
          defaultThrottleKbps={bandwidthSettings.defaultShareThrottleKbps}
          onClose={() => setShareModalFile(null)}
          onCreateShare={handleCreateShare}
          onUpdateShare={handleUpdateShare}
          onPreviewPublicPortal={(tok) => setPublicShareToken(tok)}
        />
      )}

      {inspectedFile && (
        <FileDetailDrawer
          file={inspectedFile}
          firebaseUid={firebaseUser?.uid}
          firebaseEmail={firebaseUser?.email || ''}
          onClose={() => setInspectedFile(null)}
          onDownload={handleDownloadFile}
          onOpenShareModal={(f) => setShareModalFile(f)}
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
