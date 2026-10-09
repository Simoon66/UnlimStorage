import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Folder,
  FolderPlus,
  FileText,
  FileCode,
  FileSpreadsheet,
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
} from './types';
import { formatBytes, formatShortDate, formatSpeed } from './utils/format';
import { apiFetch } from './services/clientCloudFallback';
import { PublicSharePortal } from './components/PublicSharePortal';
import {
  RemoteUploadModal,
  CreateShareModal,
  FileDetailDrawer,
  AuthModal,
} from './components/Modals';
import {
  SharedLinksView,
  ActivityAndSpeedView,
  TelegramStorageView,
} from './components/Views';

type ActiveView = 'explorer' | 'shares' | 'activity' | 'telegram_settings';

function renderFileIcon(fileName: string) {
  if (/\.(json|sh|ts|tsx|js|py|html|css)$/i.test(fileName)) {
    return <FileCode className="w-6 h-6 text-[#D97757]" />;
  }
  if (/\.(csv|xls|xlsx)$/i.test(fileName)) {
    return <FileSpreadsheet className="w-6 h-6 text-[#2E9E6B]" />;
  }
  return <FileText className="w-6 h-6 text-[#D97757]" />;
}

export default function App() {
  const [publicShareToken, setPublicShareToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('share');
  });

  const [sessionToken, setSessionToken] = useState<string>(
    () => localStorage.getItem('unlim_session_token') || 'demo_admin_session_token'
  );
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);

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
  const [uploadingFiles, setUploadingFiles] = useState(false);

  // Modals
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [shareModalFile, setShareModalFile] = useState<FileRecord | null>(null);
  const [inspectedFile, setInspectedFile] = useState<FileRecord | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Real-time notifications
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = useCallback(
    (extra: Record<string, string> = {}) => ({
      Authorization: `Bearer ${sessionToken}`,
      ...extra,
    }),
    [sessionToken]
  );

  const pushNotification = useCallback((notif: RealtimeNotification) => {
    setNotifications((prev) => {
      if (prev.some((n) => n.id === notif.id)) return prev;
      return [notif, ...prev].slice(0, 3);
    });
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [meRes, filesRes, sharesRes, bwRes, logsRes, tgRes] = await Promise.all([
        apiFetch('/api/auth/me', { headers: authHeaders() }),
        apiFetch('/api/files', { headers: authHeaders() }),
        apiFetch('/api/shares', { headers: authHeaders() }),
        apiFetch('/api/bandwidth', { headers: authHeaders() }),
        apiFetch('/api/logs', { headers: authHeaders() }),
        apiFetch('/api/telegram/config', { headers: authHeaders() }),
      ]);

      if (meRes.ok) {
        const meData = await meRes.json();
        setCurrentUser(meData.user);
        setUsers(meData.users || []);
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
      if (tgRes.ok) {
        const tData = await tgRes.json();
        setTelegramConfig(tData.config);
      }
    } catch (err) {
      console.error('Error loading workspace data:', err);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Real-time WebSocket updates for transfers & notifications
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
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
          } else if (msg.event === 'log:created' && msg.payload) {
            const entry = msg.payload as AuditLog;
            setLogs((prev) => {
              if (prev.some((l) => l.id === entry.id)) return prev;
              return [entry, ...prev].slice(0, 300);
            });
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
      };
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

  const handleUploadFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    setUploadingFiles(true);

    try {
      const formData = new FormData();
      if (currentFolderId) {
        formData.append('folderId', currentFolderId);
      }
      arr.forEach((f) => formData.append('files', f));

      const res = await apiFetch('/api/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        pushNotification({
          id: `err_${Date.now()}`,
          timestamp: new Date().toISOString(),
          title: 'Could Not Upload',
          message: data.error || 'Failed to upload files',
          type: 'error',
        });
        return;
      }

      if (data.user) setCurrentUser(data.user);
      await loadWorkspaceData();
    } finally {
      setUploadingFiles(false);
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

  const handleDeleteFolder = async (folderId: string) => {
    const res = await apiFetch(`/api/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      if (currentFolderId === folderId) setCurrentFolderId(null);
      await loadWorkspaceData();
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
    }
  };

  const handleDeleteFile = async (file: FileRecord) => {
    const res = await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setShares((prev) => prev.filter((s) => s.fileId !== file.id));
    }
  };

  const handleDownloadFile = async (file: FileRecord) => {
    try {
      const url = `/api/files/${encodeURIComponent(file.id)}/download?token=${encodeURIComponent(
        sessionToken
      )}`;
      const res = await apiFetch(url, { headers: authHeaders() });
      if (!res.ok) return;
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
      throw new Error(data.error || 'Failed to update Telegram configuration');
    }
    setTelegramConfig(data.config);
  };

  const handleLogin = async (email: string, password: string) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid credentials');
    localStorage.setItem('unlim_session_token', data.token);
    setSessionToken(data.token);
    setCurrentUser(data.user);
    setUsers(data.users || []);
  };

  const handleRegister = async (
    name: string,
    email: string,
    password: string,
    role: 'admin' | 'member'
  ) => {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    localStorage.setItem('unlim_session_token', data.token);
    setSessionToken(data.token);
    setCurrentUser(data.user);
    setUsers(data.users || []);
  };

  const handleSwitchUser = async (userId: string) => {
    const res = await apiFetch('/api/auth/switch-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to switch account');
    localStorage.setItem('unlim_session_token', data.token);
    setSessionToken(data.token);
    setCurrentUser(data.user);
    setUsers(data.users || []);
  };

  // ============================================================================
  // PUBLIC SHARE PORTAL RENDERING
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
          loadWorkspaceData();
        }}
      />
    );
  }

  // ============================================================================
  // COMPUTED ITEMS
  // ============================================================================

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
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-[#2C2824] bg-[#1C1A17]">
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

        {/* Zone 2: 4 Simple, Friendly Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-[#9E978E] overflow-x-auto">
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
          <a
            href="#telegram-setup"
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
            Telegram Setup
          </a>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingFiles}
            className="px-4 py-2 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {uploadingFiles ? 'Uploading...' : '+ Upload Files'}
          </button>
        </div>
      </header>

      {/* ====================================================================
          MAIN USER-FRIENDLY CONTAINER
      ==================================================================== */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Friendly Welcome & Storage Summary Bar */}
        <div className="p-4 bg-[#1C1A17] border border-[#2C2824] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4 text-[#D97757]" />
            </div>
            <div>
              <div className="text-sm font-bold text-[#F2EFE9]">
                Unlimited Telegram Cloud Drive
              </div>
              <div className="text-xs text-[#9E978E] tabular-nums">
                {formatBytes(totalStorageBytes)} stored across {files.length} files ·{' '}
                {bandwidthSettings.globalThrottleKbps
                  ? `Speed limit: ${bandwidthSettings.globalThrottleKbps} KB/s`
                  : 'Full download speed active'}
              </div>
            </div>
          </div>

          {currentUser && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#9E978E]">
                Signed in as <strong className="text-[#F2EFE9]">{currentUser.name}</strong>
              </span>
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-3 py-1.5 text-xs font-medium bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center gap-1.5 cursor-pointer"
              >
                <UserIcon className="w-3.5 h-3.5 text-[#D97757]" />
                Switch Account
              </button>
            </div>
          )}
        </div>

        {/* Active Transfer Progress Bar (Only visible when uploading or fetching from URL) */}
        {activeStreamingJobs.length > 0 && (
          <div className="p-4 bg-[#1C1A17] border border-[#D97757] space-y-3">
            <div className="text-xs font-bold text-[#D97757]">
              Transfer in Progress ({activeStreamingJobs.length})
            </div>
            {activeStreamingJobs.map((job) => {
              const pct =
                job.totalBytes > 0
                  ? Math.min(100, Math.round((job.transferredBytes / job.totalBytes) * 100))
                  : 60;
              return (
                <div key={job.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-semibold text-[#F2EFE9]">{job.fileName}</span>
                    <span className="text-[#9E978E]">
                      {formatBytes(job.transferredBytes)} · {formatSpeed(job.speedBps)}
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
            VIEW 1: MY FILES (Google Drive Style Visual Cards)
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
            className="space-y-6"
          >
            {/* Easy Action Bar: Upload, Upload from URL, New Folder, Search */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Left Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Upload Files
                </button>

                <button
                  onClick={() => setShowRemoteModal(true)}
                  className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
                >
                  <Globe className="w-4 h-4 text-[#D97757]" />
                  Upload from Link (URL)
                </button>

                <button
                  onClick={() => setCreatingFolder((prev) => !prev)}
                  className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 text-[#D97757]" />
                  New Folder
                </button>

                <button
                  onClick={() => setOnlyStarred((prev) => !prev)}
                  className={`flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border cursor-pointer ${
                    onlyStarred
                      ? 'bg-[#24211D] border-[#D97757] text-[#D97757]'
                      : 'bg-[#1C1A17] border-[#2C2824] text-[#9E978E] hover:text-[#F2EFE9]'
                  }`}
                >
                  <Star className="w-3.5 h-3.5" fill={onlyStarred ? '#D97757' : 'none'} />
                  Starred
                </button>
              </div>

              {/* Right Search Box */}
              <div className="relative w-full lg:w-80">
                <Search className="w-4 h-4 text-[#9E978E] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search your files..."
                  className="w-full bg-[#1C1A17] border border-[#2C2824] pl-10 pr-4 py-2.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
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
                  className="flex-1 bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingFolder(false)}
                    className="px-4 py-2 text-xs text-[#9E978E] border border-[#2C2824] bg-[#141311] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Simple Breadcrumb when inside a folder */}
            {(activeFolder || onlyStarred) && (
              <div className="flex items-center gap-2 text-sm font-semibold">
                <button
                  onClick={() => {
                    setCurrentFolderId(null);
                    setOnlyStarred(false);
                  }}
                  className="text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer"
                >
                  My Files
                </button>
                <ChevronRight className="w-4 h-4 text-[#9E978E]" />
                <span className="text-[#D97757]">
                  {onlyStarred ? 'Starred Files' : activeFolder?.name}
                </span>
              </div>
            )}

            {/* Folders Section (Google Drive Style Cards) */}
            {!onlyStarred && !searchQuery.trim() && visibleSubfolders.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                  Folders
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
                  {visibleSubfolders.map((folder) => {
                    const count = files.filter((f) => f.folderId === folder.id).length;
                    return (
                      <div
                        key={folder.id}
                        onClick={() => setCurrentFolderId(folder.id)}
                        className="p-4 bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] transition-colors flex items-center justify-between gap-3 cursor-pointer group"
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
                            handleDeleteFolder(folder.id);
                          }}
                          className="p-1.5 text-[#9E978E] hover:text-[#D94848] opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
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

            {/* Files Section (Google Drive Style Visual Cards) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-[#9E978E] uppercase tracking-wider">
                  Files ({visibleFiles.length})
                </h2>
                <span className="text-xs text-[#9E978E]">
                  Tip: Drag and drop files anywhere to upload
                </span>
              </div>

              {visibleFiles.length === 0 ? (
                <div
                  className={`p-12 bg-[#1C1A17] border text-center space-y-3 ${
                    isDraggingOver ? 'border-[#D97757]' : 'border-[#2C2824]'
                  }`}
                >
                  <div className="text-base font-bold text-[#F2EFE9]">
                    This folder is empty
                  </div>
                  <p className="text-xs text-[#9E978E] max-w-md mx-auto">
                    Drop files here from your computer, or upload directly from any web link.
                  </p>
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] cursor-pointer"
                    >
                      + Upload Files
                    </button>
                    <button
                      onClick={() => setShowRemoteModal(true)}
                      className="px-4 py-2.5 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#F2EFE9] cursor-pointer"
                    >
                      Upload from Link
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {visibleFiles.map((file) => {
                    const existingShare = shares.find((s) => s.fileId === file.id);
                    return (
                      <div
                        key={file.id}
                        className="p-5 bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757]/70 transition-colors flex flex-col justify-between gap-4"
                      >
                        {/* Top Card Row: File Icon + Star & Delete */}
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <button
                              onClick={() => setInspectedFile(file)}
                              className="w-11 h-11 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0 cursor-pointer"
                              title="Preview File"
                            >
                              {renderFileIcon(file.name)}
                            </button>

                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleToggleStar(file)}
                                className={`p-1.5 cursor-pointer ${
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
                                onClick={() => handleDeleteFile(file)}
                                className="p-1.5 text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                                title="Delete File"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* File Name & Simple Metadata */}
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
                              <span>
                                {file.storageDriver === 'telegram'
                                  ? 'Telegram Cloud'
                                  : 'Cloud Drive'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>{formatShortDate(file.updatedAt)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Card Row: Big Clear Share & Download Buttons */}
                        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#2C2824]">
                          <button
                            onClick={() => setShareModalFile(file)}
                            className="py-2 px-3 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Link2 className="w-3.5 h-3.5 text-[#D97757]" />
                            {existingShare ? 'Shared Link' : 'Share'}
                          </button>

                          <button
                            onClick={() => handleDownloadFile(file)}
                            className="py-2 px-3 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download
                          </button>
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
            VIEW 3: ACTIVITY & SPEED
        ================================================================== */}
        {activeView === 'activity' && (
          <ActivityAndSpeedView
            settings={bandwidthSettings}
            logs={logs}
            onUpdateSettings={handleUpdateBandwidthSettings}
          />
        )}

        {/* ==================================================================
            VIEW 4: TELEGRAM SETUP
        ================================================================== */}
        {activeView === 'telegram_settings' && (
          <TelegramStorageView
            config={telegramConfig}
            onSaveConfig={handleSaveTelegramConfig}
          />
        )}
      </main>

      {/* ====================================================================
          REAL-TIME COMPLETION NOTIFICATION POPUP (Bottom-Right)
      ==================================================================== */}
      {notifications.length > 0 && (
        <div className="fixed bottom-5 right-5 z-50 w-full max-w-sm space-y-2 pointer-events-none">
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
                className="text-[#9E978E] hover:text-[#F2EFE9] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
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
          onClose={() => setInspectedFile(null)}
          onDownload={handleDownloadFile}
          onOpenShareModal={(f) => setShareModalFile(f)}
          onDelete={handleDeleteFile}
        />
      )}

      {showAuthModal && currentUser && (
        <AuthModal
          currentUser={currentUser}
          users={users}
          onClose={() => setShowAuthModal(false)}
          onLogin={handleLogin}
          onRegister={handleRegister}
          onSwitchUser={handleSwitchUser}
        />
      )}
    </div>
  );
}
