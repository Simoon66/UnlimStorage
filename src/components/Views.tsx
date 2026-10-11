import React, { useState } from 'react';
import {
  Lock,
  Unlock,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  Gauge,
  Download,
  ShieldCheck,
  Send,
  RefreshCw,
  FileText,
  Clock,
  Coins,
  Sparkles,
  HardDrive,
  AlertTriangle,
  Code2,
  Smartphone,
  KeyRound,
} from 'lucide-react';
import {
  ShareLink,
  BandwidthSettings,
  AuditLog,
  TelegramConfigState,
  User,
  StoragePlanId,
} from '../types';
import { formatBytes, formatShortDate } from '../utils/format';

// ============================================================================
// 1. SHARED LINKS VIEW
// ============================================================================

interface SharedLinksViewProps {
  shares: ShareLink[];
  onToggleShareActive: (share: ShareLink) => Promise<void>;
  onUpdateShareThrottle: (share: ShareLink, throttleKbps: number | null) => Promise<void>;
  onDeleteShare: (shareId: string) => Promise<void>;
  onOpenPublicPortal: (token: string) => void;
}

export const SharedLinksView: React.FC<SharedLinksViewProps> = ({
  shares,
  onUpdateShareThrottle,
  onDeleteShare,
  onOpenPublicPortal,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedEmbedId, setCopiedEmbedId] = useState<string | null>(null);

  const handleCopy = (share: ShareLink) => {
    const url = `${window.location.origin}/?share=${encodeURIComponent(share.token)}`;
    navigator.clipboard.writeText(url);
    setCopiedId(share.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleCopyEmbed = (share: ShareLink) => {
    const embedUrl = `${window.location.origin}/?share=${encodeURIComponent(share.token)}&embed=1`;
    const snippet = `<iframe src="${embedUrl}" width="100%" height="480" frameborder="0" allowfullscreen allow="autoplay; fullscreen"></iframe>`;
    navigator.clipboard.writeText(snippet);
    setCopiedEmbedId(share.id);
    setTimeout(() => setCopiedEmbedId(null), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="border-b border-[#2C2824] pb-3.5">
        <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9]">Shared Download Links</h1>
        <p className="text-xs text-[#9E978E] mt-1">
          Copy your shared links, open the public download page, or adjust speed limits.
        </p>
      </div>

      {shares.length === 0 ? (
        <div className="p-8 sm:p-12 bg-[#1C1A17] border border-[#2C2824] text-center space-y-2">
          <div className="text-base font-bold text-[#F2EFE9]">No Shared Links Yet</div>
          <p className="text-xs text-[#9E978E]">
            Go to &ldquo;My Files&rdquo; and tap &ldquo;Share&rdquo; on any file card to create a
            direct download link.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shares.map((s) => (
            <div
              key={s.id}
              className={`p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col justify-between gap-4 ${
                !s.active ? 'opacity-60' : ''
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-11 h-11 bg-[#24211D] border border-[#2C2824] flex items-center justify-center shrink-0">
                    {s.targetType === 'folder' || s.fileMimeType === 'inode/directory' ? (
                      <HardDrive className="w-5 h-5 text-[#D97757]" />
                    ) : (
                      <FileText className="w-5 h-5 text-[#D97757]" />
                    )}
                  </div>
                  <button
                    onClick={() => onDeleteShare(s.id)}
                    className="min-w-[44px] min-h-[44px] -mr-2 -mt-2 flex items-center justify-center text-[#9E978E] hover:text-[#D94848] cursor-pointer"
                    title="Stop Sharing"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-[#F2EFE9] truncate" title={s.fileName}>
                      {s.fileName}
                    </h3>
                    {(s.targetType === 'folder' || s.fileMimeType === 'inode/directory') && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#24211D] border border-[#D97757] text-[#D97757] shrink-0">
                        FOLDER GALLERY
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#9E978E] mt-1 tabular-nums">
                    <span>{formatBytes(s.fileSizeBytes)}</span>
                    {Array.isArray(s.sharedFiles) && s.sharedFiles.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{s.sharedFiles.length} items</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span>{s.downloadCount} downloads</span>
                    <span aria-hidden="true">·</span>
                    {s.hasPassword ? (
                      <span className="text-[#D99B26] inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Password Protected
                      </span>
                    ) : (
                      <span className="text-[#2E9E6B] inline-flex items-center gap-1">
                        <Unlock className="w-3 h-3" /> Public Link
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-[#2C2824] text-xs">
                  <span className="text-[#9E978E]">Speed Limit:</span>
                  <select
                    value={s.throttleKbps || ''}
                    onChange={(e) =>
                      onUpdateShareThrottle(
                        s,
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="min-h-[40px] bg-[#141311] border border-[#2C2824] px-3 py-1.5 text-xs text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  >
                    <option value="">Full Speed</option>
                    <option value="2048">2 MB/s</option>
                    <option value="1024">1 MB/s</option>
                    <option value="512">512 KB/s</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    onClick={() => handleCopy(s)}
                    className="min-h-[44px] py-2.5 px-3 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedId === s.id ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    {copiedId === s.id ? 'Copied!' : 'Copy Link'}
                  </button>
                  <button
                    onClick={() => onOpenPublicPortal(s.token)}
                    className="min-h-[44px] py-2.5 px-3 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open Page
                  </button>
                </div>

                {(s.fileMimeType.startsWith('video/') ||
                  /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(s.fileName)) && (
                  <button
                    type="button"
                    onClick={() => handleCopyEmbed(s)}
                    className="w-full min-h-[38px] py-2 px-3 text-xs font-semibold bg-[#141311] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedEmbedId === s.id ? (
                      <Check className="w-3.5 h-3.5 text-[#2E9E6B]" />
                    ) : (
                      <Code2 className="w-3.5 h-3.5 text-[#D97757]" />
                    )}
                    <span>
                      {copiedEmbedId === s.id
                        ? 'Copied JW Player Iframe!'
                        : 'Copy JW Player Iframe'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. STORAGE PRICING & TOKEN PLANS VIEW (25GB Free, 50GB/500T, 1TB/1024T)
// ============================================================================

interface StoragePricingViewProps {
  user: User;
  lockedFilesCount: number;
  onOpenBuyTokens: () => void;
  onRedeemPromo: (code: string) => Promise<string>;
  onSubscribePlan: (planId: StoragePlanId) => Promise<string>;
  onSimulateExpiry: () => Promise<string>;
}

const PLANS: {
  id: StoragePlanId;
  name: string;
  storageLabel: string;
  tokensPerMonth: number;
  tag: string;
  description: string;
  features: string[];
}[] = [
  {
    id: 'free_25gb',
    name: 'Starter Cloud',
    storageLabel: '25 GB',
    tokensPerMonth: 0,
    tag: 'Free Forever',
    description: 'Included for every account with full encryption and file sharing.',
    features: [
      '25 GB Encrypted Cloud Storage',
      'Direct Download Links & Password Lock',
      'Built-in File Previews (Docs, Images, Media)',
      'Never expires — your first 25 GB is always free',
    ],
  },
  {
    id: 'pro_50gb',
    name: 'Pro Vault 50 GB',
    storageLabel: '50 GB',
    tokensPerMonth: 500,
    tag: 'Popular Monthly Plan',
    description: 'Double your encrypted cloud capacity for large projects and archives.',
    features: [
      '50 GB Encrypted Cloud Storage (Per Month)',
      'High-Speed Direct & Remote URL Transfers',
      '3-Month (90-Day) Data Hold if plan expires',
      'Instant activation & renewal with Tokens',
    ],
  },
  {
    id: 'ultra_1tb',
    name: 'Ultra Vault 1 TB',
    storageLabel: '1 TB',
    tokensPerMonth: 1024,
    tag: 'Maximum Capacity',
    description: '1,024 GB of private high-speed cloud storage for heavy backups and teams.',
    features: [
      '1 TB (1,024 GB) Encrypted Cloud Storage (Per Month)',
      'Maximum Unthrottled Download Streams',
      '3-Month (90-Day) Data Hold if plan expires',
      'Priority Cloud Storage Allocation',
    ],
  },
];

export const StoragePricingView: React.FC<StoragePricingViewProps> = ({
  user,
  lockedFilesCount,
  onOpenBuyTokens,
  onRedeemPromo,
  onSubscribePlan,
  onSimulateExpiry,
}) => {
  const [promoCode, setPromoCode] = useState('');
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const tokenBalance = user.tokenBalance || 0;
  const activePlan = user.planId || 'free_25gb';

  const nowMs = Date.now();
  const expMs = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : null;
  const graceMs = user.graceEndsAt ? new Date(user.graceEndsAt).getTime() : null;
  const isExpiredInGrace = Boolean(expMs && expMs < nowMs && (!graceMs || nowMs <= graceMs));
  const isPaidPlanActiveAndUnexpired =
    activePlan !== 'free_25gb' && Boolean(expMs && expMs > nowMs);
  const activeDaysLeft =
    expMs && expMs > nowMs ? Math.max(1, Math.ceil((expMs - nowMs) / 86400_000)) : 0;
  const graceDaysLeft = graceMs
    ? Math.max(1, Math.ceil((graceMs - nowMs) / 86400_000))
    : 90;

  const handlePromoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    setBusyPlan('promo');
    setNotice(null);
    try {
      const msg = await onRedeemPromo(promoCode.trim());
      setNotice({ type: 'success', text: msg });
      setPromoCode('');
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Invalid promo code',
      });
    } finally {
      setBusyPlan(null);
    }
  };

  const handlePlanSelect = async (planId: StoragePlanId) => {
    setBusyPlan(planId);
    setNotice(null);
    try {
      const msg = await onSubscribePlan(planId);
      setNotice({ type: 'success', text: msg });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not activate plan',
      });
    } finally {
      setBusyPlan(null);
    }
  };

  const handleSimulate = async () => {
    setBusyPlan('sim');
    setNotice(null);
    try {
      const msg = await onSimulateExpiry();
      setNotice({ type: 'success', text: msg });
    } catch (err: unknown) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Simulation failed',
      });
    } finally {
      setBusyPlan(null);
    }
  };

  const isUnlimitedAdmin =
    user.role === 'admin' ||
    user.email?.toLowerCase() === 'titumamma2425@gmail.com' ||
    activePlan === 'unlimited_admin';

  return (
    <div className="space-y-6">
      {/* Header & Wallet Bar */}
      <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9]">
            Storage Plans & Token Wallet
          </h1>
          <p className="text-xs text-[#9E978E]">
            {isUnlimitedAdmin ? (
              <>
                Your Administrator account includes{' '}
                <strong className="text-[#2E9E6B]">Permanent Unlimited Storage</strong> with no
                upload caps or expiry limits.
              </>
            ) : (
              <>
                Every user gets <strong className="text-[#F2EFE9]">25 GB Free</strong>. Upgrade to{' '}
                <strong className="text-[#F2EFE9]">50 GB (500 Tokens/mo)</strong> or{' '}
                <strong className="text-[#F2EFE9]">1 TB (1,024 Tokens/mo)</strong> anytime.
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-4 py-2.5 bg-[#141311] border border-[#2C2824] flex items-center gap-2.5">
            <Coins className="w-4 h-4 text-[#D97757]" />
            <div className="text-xs">
              <span className="text-[#9E978E]">Wallet: </span>
              <strong className="text-sm text-[#F2EFE9] tabular-nums">
                {tokenBalance.toLocaleString()} Tokens
              </strong>
            </div>
          </div>

          <button
            onClick={onOpenBuyTokens}
            className="min-h-[44px] px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] flex items-center gap-1.5 cursor-pointer"
          >
            <Coins className="w-4 h-4" />
            Buy Tokens (BDT / USD)
          </button>
        </div>
      </div>

      {isUnlimitedAdmin && (
        <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#2E9E6B] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-[#2E9E6B] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-[#F2EFE9]">
                Administrator Unlimited Storage Active
              </div>
              <p className="text-xs text-[#9E978E]">
                Your admin vault (<strong className="text-[#F2EFE9]">{user.email}</strong>) has
                unlimited multi-GB/TB storage capacity permanently unlocked.
              </p>
            </div>
          </div>
          <span className="px-3 py-1.5 text-xs font-bold bg-[#141311] border border-[#2E9E6B] text-[#2E9E6B] shrink-0">
            Unlimited Capacity
          </span>
        </div>
      )}

      {/* 3-Month Grace Period Alert if Expired */}
      {!isUnlimitedAdmin && (isExpiredInGrace || lockedFilesCount > 0) && (
        <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#D99B26] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#D99B26] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-[#F2EFE9]">
                Monthly Plan Expired — {graceDaysLeft} Days Left in 3-Month Grace Period
              </div>
              <p className="text-xs text-[#9E978E]">
                Your files are safe and have not been deleted. Your first 25 GB remains accessible,
                while <strong className="text-[#D99B26]">{lockedFilesCount} file(s)</strong> above
                25 GB are temporarily locked. Extend your 50 GB or 1 TB plan within {graceDaysLeft}{' '}
                days to restore full access before excess data over 25 GB is cleared.
              </p>
            </div>
          </div>
          <button
            onClick={() => handlePlanSelect(activePlan === 'free_25gb' ? 'pro_50gb' : activePlan)}
            className="min-h-[44px] px-4 py-2 text-xs font-bold bg-[#D97757] text-[#141311] shrink-0 cursor-pointer"
          >
            Extend Plan & Unlock Files
          </button>
        </div>
      )}

      {/* Quick Promo Code Redemption Bar */}
      <form
        onSubmit={handlePromoSubmit}
        className="p-4 bg-[#1C1A17] border border-[#2C2824] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-[#D97757] shrink-0" />
          <div className="text-xs">
            <span className="font-bold text-[#F2EFE9]">Redeem Promo Code</span>
            <span className="text-[#9E978E] ml-2">
              Have a token voucher code? Enter it to credit your wallet immediately.
            </span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="Enter promo code..."
            className="min-h-[42px] bg-[#141311] border border-[#2C2824] px-3.5 py-2 text-xs font-mono text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
          />
          <button
            type="submit"
            disabled={busyPlan === 'promo'}
            className="min-h-[42px] px-4 py-2 text-xs font-bold bg-[#24211D] border border-[#D97757] text-[#D97757] hover:bg-[#D97757] hover:text-[#141311] transition-colors cursor-pointer shrink-0"
          >
            {busyPlan === 'promo' ? 'Applying...' : 'Apply Code'}
          </button>
        </div>
      </form>

      {notice && (
        <div
          className={`p-4 border text-xs font-semibold ${
            notice.type === 'success'
              ? 'bg-[#1C1A17] border-[#2E9E6B] text-[#2E9E6B]'
              : 'bg-[#1C1A17] border-[#D94848] text-[#D94848]'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* 3 Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = !isUnlimitedAdmin && activePlan === plan.id && !isExpiredInGrace;
          const isLockedByHigherActivePlan =
            isUnlimitedAdmin ||
            (isPaidPlanActiveAndUnexpired &&
              (plan.id === 'free_25gb' ||
                (plan.id === 'pro_50gb' && activePlan === 'ultra_1tb')));
          const isClaimDisabled =
            isUnlimitedAdmin || isCurrent || isLockedByHigherActivePlan || busyPlan === plan.id;

          return (
            <div
              key={plan.id}
              className={`p-5 sm:p-6 bg-[#1C1A17] border flex flex-col justify-between gap-6 ${
                isCurrent ? 'border-[#D97757]' : 'border-[#2C2824]'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#D97757]">
                    {plan.tag}
                  </span>
                  {isCurrent && (
                    <span className="px-2.5 py-0.5 text-[11px] font-bold bg-[#24211D] border border-[#D97757] text-[#D97757]">
                      {plan.id === 'free_25gb'
                        ? 'Active Plan'
                        : `Claimed (${activeDaysLeft}d Left)`}
                    </span>
                  )}
                </div>

                <div>
                  <div className="text-2xl sm:text-3xl font-bold text-[#F2EFE9] tabular-nums">
                    {plan.storageLabel}
                  </div>
                  <div className="text-sm font-semibold text-[#F2EFE9] mt-0.5">{plan.name}</div>
                  <p className="text-xs text-[#9E978E] mt-1.5">{plan.description}</p>
                </div>

                <div className="p-3.5 bg-[#141311] border border-[#2C2824] flex items-baseline justify-between">
                  <span className="text-xs text-[#9E978E]">Monthly Price</span>
                  <span className="text-base font-bold text-[#F2EFE9] tabular-nums">
                    {plan.tokensPerMonth === 0
                      ? '0 Tokens (Free)'
                      : `${plan.tokensPerMonth.toLocaleString()} Tokens / mo`}
                  </span>
                </div>

                {isCurrent && plan.id !== 'free_25gb' && user.planExpiresAt && (
                  <div className="p-3 bg-[#141311] border border-[#2E9E6B]/60 text-xs text-[#2E9E6B] flex items-center justify-between">
                    <span>Active until {formatShortDate(user.planExpiresAt)}</span>
                    <span className="font-mono font-bold">{activeDaysLeft}d remaining</span>
                  </div>
                )}

                <ul className="space-y-2 text-xs text-[#F2EFE9]">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-[#2E9E6B] shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 pt-3 border-t border-[#2C2824]">
                {plan.id === 'free_25gb' ? (
                  <button
                    type="button"
                    disabled={isClaimDisabled}
                    onClick={() => handlePlanSelect('free_25gb')}
                    className="w-full min-h-[44px] px-4 py-2.5 text-xs font-semibold bg-[#24211D] border border-[#2C2824] text-[#9E978E] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isUnlimitedAdmin
                      ? 'Unlimited Admin Storage Active'
                      : isCurrent
                      ? 'Included Free Plan (Active)'
                      : isPaidPlanActiveAndUnexpired
                      ? `Current Plan Active (${activeDaysLeft}d Left)`
                      : 'Switch to 25 GB Free'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isClaimDisabled}
                    onClick={() => handlePlanSelect(plan.id)}
                    className={`w-full min-h-[44px] px-4 py-2.5 text-xs font-bold transition-colors ${
                      isUnlimitedAdmin || isCurrent || isLockedByHigherActivePlan
                        ? 'bg-[#24211D] border border-[#2C2824] text-[#9E978E] opacity-70 cursor-not-allowed'
                        : 'bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer'
                    }`}
                  >
                    {busyPlan === plan.id
                      ? 'Activating...'
                      : isUnlimitedAdmin
                      ? 'Unlimited Admin Storage Active'
                      : isCurrent
                      ? `Plan Active — Unlocks After Expiry (${activeDaysLeft}d Left)`
                      : isLockedByHigherActivePlan
                      ? `1 TB Plan Active (${activeDaysLeft}d Left)`
                      : isExpiredInGrace && activePlan === plan.id
                      ? `Renew ${plan.storageLabel} (${plan.tokensPerMonth.toLocaleString()} Tokens/mo)`
                      : `Claim ${plan.storageLabel} (${plan.tokensPerMonth.toLocaleString()} Tokens/mo)`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3-Month Data Retention Policy Box + Interactive Test Button */}
      <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <HardDrive className="w-5 h-5 text-[#D97757] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-xs font-bold text-[#F2EFE9]">
              How Monthly Plan Expiry & 3-Month Data Protection Works
            </div>
            <p className="text-xs text-[#9E978E] max-w-3xl leading-relaxed">
              When your monthly 50 GB or 1 TB plan ends, your files are{' '}
              <strong className="text-[#F2EFE9]">not deleted</strong>. Your first 25 GB stays open
              and downloadable at all times. Any files stored above 25 GB are locked for{' '}
              <strong className="text-[#F2EFE9]">3 months (90 days)</strong>. If you extend your
              plan within 3 months, all files unlock immediately; if not extended after 3 months,
              only the excess data over 25 GB is automatically cleared.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSimulate}
          disabled={busyPlan === 'sim'}
          className="min-h-[42px] px-4 py-2 text-xs font-semibold bg-[#24211D] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] shrink-0 cursor-pointer"
        >
          {busyPlan === 'sim' ? 'Simulating...' : 'Test >25 GB Expiry Lock'}
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// 3. SIMPLE ACTIVITY & DOWNLOAD SPEED VIEW (White-Label, No Telegram Mentions)
// ============================================================================

interface ActivityAndSpeedViewProps {
  settings: BandwidthSettings;
  logs: AuditLog[];
  onUpdateSettings: (patch: Partial<BandwidthSettings>) => Promise<void>;
}

const SPEED_OPTIONS: { label: string; desc: string; value: number | null }[] = [
  { label: 'Unlimited Speed', desc: 'Maximum download speed', value: null },
  { label: 'Fast (2 MB/s)', desc: 'Great for large files', value: 2048 },
  { label: 'Balanced (1 MB/s)', desc: 'Smooth everyday sharing', value: 1024 },
  { label: 'Data Saver (512 KB/s)', desc: 'Saves bandwidth', value: 512 },
];

function friendlyActionLabel(action: string): string {
  switch (action) {
    case 'FILE_UPLOAD':
      return 'Uploaded file';
    case 'REMOTE_UPLOAD':
      return 'Uploaded from web link';
    case 'FILE_DOWNLOAD':
      return 'Downloaded file';
    case 'FILE_DELETE':
      return 'Deleted file';
    case 'SHARE_CREATED':
      return 'Created share link';
    case 'SHARE_UNLOCKED':
      return 'Unlocked protected link';
    case 'SHARE_DOWNLOAD':
      return 'Shared link downloaded';
    case 'SHARE_AUTH_FAILED':
      return 'Wrong password entered';
    case 'PROMO_REDEEMED':
      return 'Redeemed promo code';
    case 'TOKENS_PURCHASED':
      return 'Purchased storage tokens';
    case 'PLAN_SUBSCRIBED':
      return 'Updated storage plan';
    default:
      return 'Account activity';
  }
}

export const ActivityAndSpeedView: React.FC<ActivityAndSpeedViewProps> = ({
  settings,
  logs,
  onUpdateSettings,
}) => {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="border-b border-[#2C2824] pb-3">
          <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9] flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[#D97757]" />
            Download Speed Control
          </h1>
          <p className="text-xs text-[#9E978E] mt-1">
            Tap to choose how fast files download from your drive and shared links.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {SPEED_OPTIONS.map((opt) => {
            const active = settings.globalThrottleKbps === opt.value;
            return (
              <button
                key={opt.label}
                onClick={() => onUpdateSettings({ globalThrottleKbps: opt.value })}
                className={`min-h-[68px] p-4 text-left border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#24211D] border-[#D97757]'
                    : 'bg-[#1C1A17] border-[#2C2824] hover:border-[#D97757]'
                }`}
              >
                <div className="text-sm font-bold text-[#F2EFE9] flex items-center justify-between">
                  <span>{opt.label}</span>
                  {active && <Check className="w-4 h-4 text-[#D97757]" />}
                </div>
                <div className="text-xs text-[#9E978E] mt-1">{opt.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#2C2824] pb-3">
          <div>
            <h2 className="text-lg font-bold text-[#F2EFE9] flex items-center gap-2">
              <Clock className="w-5 h-5 text-[#D97757]" />
              Recent Activity
            </h2>
            <p className="text-xs text-[#9E978E] mt-0.5">
              A private timeline of your uploads, downloads, shared links, and plan updates.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const header = 'id,timestamp,userName,action,targetName,bytesTransferred\n';
              const rows = logs
                .map(
                  (l) =>
                    `"${l.id}","${l.timestamp}","${l.userName}","${l.action}","${l.targetName.replace(
                      /"/g,
                      '""'
                    )}",${l.bytesTransferred}`
                )
                .join('\n');
              const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8' });
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = 'unlimstorage-activity.csv';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(blobUrl), 3000);
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-[#1C1A17] border border-[#2C2824] hover:border-[#D97757] text-[#F2EFE9] cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#D97757]" />
            Download CSV
          </button>
        </div>

        <div className="bg-[#1C1A17] border border-[#2C2824] divide-y divide-[#2C2824]">
          {logs.slice(0, 25).map((log) => (
            <div
              key={log.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 hover:bg-[#24211D]"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="text-sm font-semibold text-[#F2EFE9] break-words">
                  {friendlyActionLabel(log.action)} —{' '}
                  <span className="text-[#D97757]">{log.targetName}</span>
                </div>
                <div className="text-xs text-[#9E978E]">
                  By {log.userName}
                  {log.bytesTransferred > 0 ? ` · ${formatBytes(log.bytesTransferred)}` : ''}
                </div>
              </div>
              <div className="text-xs text-[#9E978E] tabular-nums shrink-0">
                {formatShortDate(log.timestamp)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// 4. ADMIN-ONLY STORAGE NODE CONFIGURATION (Hidden from Regular Users)
// ============================================================================

interface TelegramStorageViewProps {
  config: TelegramConfigState;
  onSaveConfig: (payload: {
    botToken?: string;
    chatId?: string;
    autoSyncUploads?: boolean;
    clearCredentials?: boolean;
  }) => Promise<void>;
  onSendMtprotoCode?: (payload: {
    apiId: number;
    apiHash: string;
    phoneNumber: string;
    chatId?: string;
  }) => Promise<{ phoneCodeHash: string; message?: string }>;
  onVerifyMtprotoCode?: (payload: {
    phoneCode: string;
    password?: string;
    chatId?: string;
  }) => Promise<void>;
  onDisconnectMtproto?: () => Promise<void>;
}

export const TelegramStorageView: React.FC<TelegramStorageViewProps> = ({
  config,
  onSaveConfig,
  onSendMtprotoCode,
  onVerifyMtprotoCode,
  onDisconnectMtproto,
}) => {
  const [activeTab, setActiveTab] = useState<'mtproto' | 'bot'>(
    config.authMode === 'bot' && !config.mtprotoConnected ? 'bot' : 'mtproto'
  );

  // Bot API state
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState(config.chatId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // MTProto User Account (2 GB) state
  const [apiIdInput, setApiIdInput] = useState(config.apiId ? String(config.apiId) : '');
  const [apiHashInput, setApiHashInput] = useState('');
  const [phoneInput, setPhoneInput] = useState(config.phoneNumber || '');
  const [mtprotoChatId, setMtprotoChatId] = useState(config.chatId || 'me');
  const [otpStep, setOtpStep] = useState<'request' | 'verify'>('request');
  const [otpCode, setOtpCode] = useState('');
  const [twoFaPassword, setTwoFaPassword] = useState('');
  const [mtprotoBusy, setMtprotoBusy] = useState(false);
  const [mtprotoError, setMtprotoError] = useState<string | null>(null);
  const [mtprotoSuccess, setMtprotoSuccess] = useState<string | null>(null);

  React.useEffect(() => {
    if (config.chatId && !chatId) {
      setChatId(config.chatId);
    }
    if (config.chatId && mtprotoChatId === 'me') {
      setMtprotoChatId(config.chatId);
    }
    if (config.apiId && !apiIdInput) {
      setApiIdInput(String(config.apiId));
    }
    if (config.phoneNumber && !phoneInput) {
      setPhoneInput(config.phoneNumber);
    }
  }, [config.chatId, config.apiId, config.phoneNumber, chatId, mtprotoChatId, apiIdInput, phoneInput]);

  const handleConnectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await onSaveConfig({
        botToken: botToken.trim() || undefined,
        chatId: chatId.trim(),
        autoSyncUploads: true,
      });
      setBotToken('');
      setSuccessMsg(
        'Permanent Cloud Storage Node connected & synced to Firestore! All uploads will now persist across every device.'
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not connect storage node');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSendMtprotoCode) return;
    setMtprotoBusy(true);
    setMtprotoError(null);
    setMtprotoSuccess(null);
    try {
      const parsedApiId = Number(apiIdInput.trim());
      if (!parsedApiId || Number.isNaN(parsedApiId)) {
        throw new Error('Please enter a valid numeric Telegram API ID from my.telegram.org.');
      }
      if (!apiHashInput.trim()) {
        throw new Error('Please enter your Telegram API Hash from my.telegram.org.');
      }
      if (!phoneInput.trim()) {
        throw new Error('Please enter your phone number in international format (e.g. +8801...).');
      }
      const res = await onSendMtprotoCode({
        apiId: parsedApiId,
        apiHash: apiHashInput.trim(),
        phoneNumber: phoneInput.trim(),
        chatId: mtprotoChatId.trim() || 'me',
      });
      setOtpStep('verify');
      setMtprotoSuccess(
        res.message ||
          'OTP code sent to your Telegram app! Enter the 5-digit login code below.'
      );
    } catch (err: unknown) {
      setMtprotoError(
        err instanceof Error ? err.message : 'Failed to request Telegram OTP login code'
      );
    } finally {
      setMtprotoBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onVerifyMtprotoCode) return;
    setMtprotoBusy(true);
    setMtprotoError(null);
    setMtprotoSuccess(null);
    try {
      if (!otpCode.trim()) {
        throw new Error('Please enter the 5-digit OTP code sent to your Telegram app.');
      }
      await onVerifyMtprotoCode({
        phoneCode: otpCode.trim(),
        password: twoFaPassword.trim() || undefined,
        chatId: mtprotoChatId.trim() || 'me',
      });
      setOtpCode('');
      setTwoFaPassword('');
      setOtpStep('request');
      setMtprotoSuccess(
        'Telegram User Account connected via MTProto! Direct uploads and streams up to 2 GB per file are now active.'
      );
    } catch (err: unknown) {
      setMtprotoError(
        err instanceof Error ? err.message : 'Failed to verify Telegram OTP code'
      );
    } finally {
      setMtprotoBusy(false);
    }
  };

  const handleDisconnectMtprotoClick = async () => {
    if (!onDisconnectMtproto) return;
    setMtprotoBusy(true);
    setMtprotoError(null);
    setMtprotoSuccess(null);
    try {
      await onDisconnectMtproto();
      setOtpStep('request');
      setMtprotoSuccess('Disconnected Telegram MTProto user session.');
    } catch (err: unknown) {
      setMtprotoError(
        err instanceof Error ? err.message : 'Could not disconnect MTProto session'
      );
    } finally {
      setMtprotoBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-[#2C2824] pb-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[#D97757]">
          Administrator Only — Strictly Hidden from Public Users
        </div>
        <h1 className="text-lg sm:text-xl font-bold text-[#F2EFE9] mt-0.5">
          Global Telegram Cloud Storage Vault (2 GB MTProto &amp; Bot Node)
        </h1>
        <p className="text-xs text-[#9E978E] mt-1">
          Sign in with your Telegram User Account via MTProto to unlock single-file uploads up to{' '}
          <strong className="text-[#F2EFE9]">2 GB</strong> without 20 MB bot limits, or use a
          standard Bot Token. Regular users never see this panel.
        </p>
      </div>

      {/* Active Connection Status Card */}
      <div className="p-4 sm:p-5 bg-[#1C1A17] border border-[#2C2824] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <ShieldCheck
            className={`w-5 h-5 shrink-0 mt-0.5 sm:mt-0 ${
              config.mtprotoConnected || config.connected ? 'text-[#2E9E6B]' : 'text-[#D99B26]'
            }`}
          />
          <div>
            <div className="text-sm font-bold text-[#F2EFE9]">
              {config.mtprotoConnected
                ? `2 GB MTProto User Vault Active (${
                    config.accountName ||
                    config.accountUsername ||
                    config.mtprotoUser ||
                    config.phoneNumber ||
                    'Connected'
                  })`
                : config.connected
                ? `Bot Storage Node Active (@${config.botUsername || 'Connected'})`
                : 'Local Vault Active — Connect Telegram Account for 2 GB Cross-Device Sync'}
            </div>
            <div className="text-xs text-[#9E978E] mt-0.5">
              {config.mtprotoConnected
                ? `Direct un-split file uploads up to 2,000 MB (2 GB) to target chat: ${
                    config.chatId || 'me (Saved Messages)'
                  }`
                : config.connected
                ? `Auto-splitting & syncing files in 19 MB chunks to Channel ${config.chatId}`
                : 'Log in with your Telegram phone number + OTP below to enable 2 GB direct uploads.'}
            </div>
          </div>
        </div>

        {config.mtprotoConnected ? (
          <button
            type="button"
            disabled={mtprotoBusy}
            onClick={handleDisconnectMtprotoClick}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-[#D94848] border border-[#2C2824] hover:border-[#D94848] bg-[#141311] shrink-0 cursor-pointer"
          >
            Disconnect 2 GB Vault
          </button>
        ) : config.connected ? (
          <button
            type="button"
            onClick={() => onSaveConfig({ clearCredentials: true })}
            className="min-h-[40px] px-4 py-2 text-xs font-medium text-[#D94848] border border-[#2C2824] bg-[#141311] shrink-0 cursor-pointer"
          >
            Disconnect Bot
          </button>
        ) : null}
      </div>

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 border border-[#2C2824] bg-[#141311] p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('mtproto')}
          className={`min-h-[42px] px-3 py-2 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'mtproto'
              ? 'bg-[#D97757] text-[#141311]'
              : 'text-[#9E978E] hover:text-[#F2EFE9]'
          }`}
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Telegram Account (2 GB MTProto)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('bot')}
          className={`min-h-[42px] px-3 py-2 text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer ${
            activeTab === 'bot'
              ? 'bg-[#D97757] text-[#141311]'
              : 'text-[#9E978E] hover:text-[#F2EFE9]'
          }`}
        >
          <KeyRound className="w-4 h-4 shrink-0" />
          <span>Bot Token (20 MB Chunked)</span>
        </button>
      </div>

      {activeTab === 'mtproto' ? (
        <div className="space-y-4">
          <div className="p-4 bg-[#141311] border border-[#2C2824] space-y-2 text-xs text-[#9E978E]">
            <div className="font-bold text-[#F2EFE9]">
              How to Connect Your Telegram Account for 2 GB Uploads:
            </div>
            <div>
              1. Go to{' '}
              <a
                href="https://my.telegram.org"
                target="_blank"
                rel="noreferrer"
                className="text-[#D97757] underline font-semibold"
              >
                my.telegram.org
              </a>
              , log in with your phone number, open{' '}
              <strong className="text-[#F2EFE9]">API development tools</strong>, and copy your{' '}
              <code className="text-[#D97757]">App api_id</code> and{' '}
              <code className="text-[#D97757]">App api_hash</code>.
            </div>
            <div>
              2. Enter your API ID, API Hash, and Phone Number below, then enter the 5-digit OTP
              code sent to your Telegram app.
            </div>
            <div>
              3. Set Target Chat ID to <code className="text-[#D97757]">me</code> to store files in
              your personal <strong className="text-[#F2EFE9]">Saved Messages</strong>, or paste your
              private Channel ID (<code className="text-[#D97757]">-100...</code>).
            </div>
          </div>

          {otpStep === 'request' ? (
            <form
              onSubmit={handleRequestOtp}
              className="p-5 sm:p-6 bg-[#1C1A17] border border-[#2C2824] space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    1. Telegram API ID (my.telegram.org)
                  </label>
                  <input
                    type="text"
                    required
                    value={apiIdInput}
                    onChange={(e) => setApiIdInput(e.target.value)}
                    placeholder="e.g. 24819204"
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    2. Telegram API Hash
                  </label>
                  <input
                    type="password"
                    required
                    value={apiHashInput}
                    onChange={(e) => setApiHashInput(e.target.value)}
                    placeholder={
                      config.maskedApiHash
                        ? `Saved (${config.maskedApiHash}) — paste to re-auth`
                        : 'e.g. a1b2c3d4e5f6...'
                    }
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    3. Telegram Phone Number (With Country Code)
                  </label>
                  <input
                    type="text"
                    required
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="e.g. +8801712345678"
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    4. Target Storage Chat / Channel ID
                  </label>
                  <input
                    type="text"
                    value={mtprotoChatId}
                    onChange={(e) => setMtprotoChatId(e.target.value)}
                    placeholder="me (Saved Messages) or -100..."
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>
              </div>

              {mtprotoError && <p className="text-xs text-[#D94848]">{mtprotoError}</p>}
              {mtprotoSuccess && <p className="text-xs text-[#2E9E6B]">{mtprotoSuccess}</p>}

              <div className="flex items-center justify-end pt-2 border-t border-[#2C2824]">
                <button
                  type="submit"
                  disabled={mtprotoBusy}
                  className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
                >
                  {mtprotoBusy ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>
                    {mtprotoBusy ? 'Sending OTP Code...' : 'Send Login OTP to Telegram'}
                  </span>
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={handleVerifyOtp}
              className="p-5 sm:p-6 bg-[#1C1A17] border border-[#D97757] space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#2C2824] pb-3">
                <div>
                  <div className="text-sm font-bold text-[#F2EFE9]">
                    Enter Telegram Login Code (OTP)
                  </div>
                  <div className="text-xs text-[#9E978E]">
                    Check the official Telegram app on {phoneInput} for your 5-digit login code.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOtpStep('request')}
                  className="px-3 py-1.5 text-xs text-[#9E978E] hover:text-[#F2EFE9] border border-[#2C2824] bg-[#141311] cursor-pointer"
                >
                  Back
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    Telegram 5-Digit OTP Code
                  </label>
                  <input
                    type="text"
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="e.g. 48291"
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm font-mono tracking-widest text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[#F2EFE9]">
                    2FA Cloud Password (Only if enabled)
                  </label>
                  <input
                    type="password"
                    value={twoFaPassword}
                    onChange={(e) => setTwoFaPassword(e.target.value)}
                    placeholder="Leave blank if no 2FA password"
                    className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
                  />
                </div>
              </div>

              {mtprotoError && <p className="text-xs text-[#D94848]">{mtprotoError}</p>}
              {mtprotoSuccess && <p className="text-xs text-[#2E9E6B]">{mtprotoSuccess}</p>}

              <div className="flex items-center justify-end pt-2 border-t border-[#2C2824]">
                <button
                  type="submit"
                  disabled={mtprotoBusy}
                  className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-6 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
                >
                  {mtprotoBusy ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>
                    {mtprotoBusy ? 'Verifying & Connecting...' : 'Verify OTP & Connect 2 GB Vault'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-[#141311] border border-[#2C2824] space-y-2 text-xs text-[#9E978E]">
            <div className="font-bold text-[#F2EFE9]">Standard Bot Token Setup (19 MB Chunks):</div>
            <div>
              1. Open <strong className="text-[#F2EFE9]">@BotFather</strong> on Telegram, send{' '}
              <code className="text-[#D97757]">/newbot</code>, and copy the HTTP API Token.
            </div>
            <div>
              2. Create a <strong className="text-[#F2EFE9]">Private Channel</strong>, add your Bot
              as an <strong className="text-[#F2EFE9]">Administrator</strong> (with Post Messages
              enabled), and paste the Channel Chat ID (starts with{' '}
              <code className="text-[#D97757]">-100...</code>).
            </div>
          </div>

          <form
            onSubmit={handleConnectBot}
            className="p-5 sm:p-6 bg-[#1C1A17] border border-[#2C2824] space-y-4"
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#F2EFE9]">
                1. Bot Token (From @BotFather)
              </label>
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={
                  config.connected
                    ? `Saved (${config.maskedToken || '••••••••'}) — paste new token to update`
                    : 'e.g. 7123456789:AAHxyz...'
                }
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#F2EFE9]">
                2. Private Storage Channel Chat ID
              </label>
              <input
                type="text"
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                placeholder="e.g. -1002198471092"
                className="w-full min-h-[44px] bg-[#141311] border border-[#2C2824] px-3.5 py-2.5 text-sm text-[#F2EFE9] focus:outline-none focus:border-[#D97757]"
              />
            </div>

            {error && <p className="text-xs text-[#D94848]">{error}</p>}
            {successMsg && <p className="text-xs text-[#2E9E6B]">{successMsg}</p>}

            <div className="flex items-center justify-end pt-2 border-t border-[#2C2824]">
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold bg-[#D97757] text-[#141311] hover:bg-[#E08568] cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {saving ? 'Verifying & Syncing...' : 'Save & Sync Bot Node'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

