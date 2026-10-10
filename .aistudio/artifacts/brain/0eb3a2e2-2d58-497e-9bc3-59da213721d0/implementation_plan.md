# UnlimStorage — 2GB Telegram MTProto User Account Vault, Minimal JW Player Iframe & Real-Time Cross-Device Deletion Sync

This upgrade replaces the 20 MB Bot API limitation with a Global Admin Telegram User Account (MTProto) connection supporting up to 2 GB single-file uploads via direct Phone Number + OTP authentication in the Admin panel, streamlines the video embed into a clean JW Player-style interface with playback speed and fullscreen controls, and enforces real-time cross-device deletion synchronization so deleted files disappear immediately on all logged-in devices.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX choices have been confirmed from your answers and will govern the implementation:

- **Confirmed Decision 1 — Global Admin Telegram Account (2 GB MTProto Storage)**: A single Global Admin Telegram User Account powers the storage vault for the entire platform, allowing files up to **2 GB** (or 4 GB with Telegram Premium) to be transferred using Telegram's MTProto protocol (`GramJS`) into the Admin's private storage channel or Saved Messages without hitting the 20 MB Bot API wall.
- **Confirmed Decision 2 — Direct Phone Number & OTP Login in Admin Panel**: The Admin panel includes a dedicated **Telegram MTProto Account Login** wizard where the administrator enters their Telegram API ID, API Hash, and Phone Number, receives the 5-digit Telegram login OTP (plus optional 2FA password), and saves the persistent `StringSession` to the server and Firestore.
- **Confirmed Decision 3 — Minimal JW Player Style Iframe Video Player**: Both the in-app video preview and public `/embed` iframe use a clean, distraction-free **JW Player-style** dark player featuring only a smooth timeline scrubber, Play/Pause, Volume, Playback Speed selector (`0.5x` – `2x`), and Fullscreen toggle—removing extra headers, badges, and surrounding chrome.
- **Confirmed Decision 4 — Real-Time Multi-Device File Deletion Sync (`onSnapshot` + Tombstones)**: Live Firestore `onSnapshot` listeners on `cloudFiles` and `cloudFolders`, paired with a persistent deleted-ID tombstone registry, guarantee that deleting a file or folder on Device A immediately purges it from Device B's state, localStorage, and IndexedDB cache without ever re-uploading it back.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. **2 GB Telegram User Account (MTProto) Engine**: Connects the administrator's real Telegram account via MTProto (`GramJS`) so large videos and archives up to 2 GB stream directly in high-speed 512 KB MTProto parts without 20 MB Bot API limits, while retaining automatic fallback to chunked storage when needed.
  2. **In-Dashboard Phone + OTP Authentication**: Allows the admin (`titumamma2425@gmail.com`) to sign into Telegram directly inside the **Storage Node** view using Phone Number -> OTP Code -> optional 2FA Password, generating a reusable encrypted MTProto session string.
  3. **Simple JW Player Iframe Experience**: Replaces cluttered embed frames with a sleek, zero-distraction JW Player-inspired video canvas containing a responsive center play indicator, fluid red/terracotta progress bar, time display, playback speed menu, and fullscreen button.
  4. **Instant Cross-Device Deletion & Sync**: Subscribes every logged-in browser/device to real-time Firestore change streams (`docChanges()`) so file creations, renames, folder changes, and deletions propagate live across all active sessions within milliseconds.
- **Target Audience / Persona**: An administrator and authorized cloud vault users managing large multi-hundred-megabyte and multi-gigabyte media files across multiple devices who need fast uploads, clean embeddable video playback, and reliable multi-device state consistency.
- **Key Value**: Unlocks up to 2 GB file transfers via Telegram MTProto, eliminates stale deleted files reappearing on secondary devices, and delivers a fast, distraction-free JW Player embed experience.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Admin Telegram Account Login (Phone + OTP)**:
     - The Admin opens **Storage Node** in the left sidebar and switches to **Telegram Account (2 GB MTProto)**.
     - Enters **API ID** & **API Hash** (from `my.telegram.org`) and **Phone Number** (e.g., `+8801...`), then clicks **Send OTP Code**.
     - Enters the **OTP Code** received in the Telegram app (and 2FA password if enabled) -> clicks **Verify & Connect 2 GB Vault**.
     - The connected Telegram account name, phone number, and active `MTProto 2 GB Ready` status appear immediately and persist across restarts.
  2. **High-Speed Large File Upload & Processing Screen**:
     - When uploading large files (up to 2 GB), the user sees a clean, high-speed progress bar for the upload phase followed by a smooth **"Finalizing your file for instant streaming..."** processing screen (hiding all underlying chunking/MTProto encoding mechanics from end users).
  3. **Minimal JW Player Style Video Playback**:
     - Opening a video or loading an `/embed/{token}` iframe renders a full-bleed black video viewport.
     - Moving the pointer reveals a minimal bottom control bar inspired by JW Player: Play/Pause, 10s Skip, Volume slider, tabular current/total time (`04:12 / 24:50`), Playback Speed selector (`0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`, `2x`), and Fullscreen toggle.
  4. **Deleting a File While Logged In on Two Devices**:
     - When the user deletes a file on Device 1, it is immediately deleted from the server, Firestore `cloudFiles/{fileId}`, and local IndexedDB, while recording a deletion tombstone.
     - Device 2 (logged into the same account) receives the real-time `removed` event from Firestore `onSnapshot`, immediately removes the file from the UI table, and purges its local cache so the deleted file never lingers or re-syncs.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian Enterprise SaaS Dashboard (`UnlimStorage`) paired with a minimalist cinema-black JW Player media viewport.
  - *Color Palette & Mood* (60-30-10 Discipline):
    - **60% Dominant Neutral Canvas**: Deep Obsidian (`#141311`) and Charcoal Workspace Surface (`#1C1A17`).
    - **30% Structural Surfaces**: Hairline Slate Borders (`#2C2824`), Muted Stone Metadata (`#9E978E`), Crisp Alabaster Primary Text (`#F2EFE9`).
    - **10% Accent Budget**: Terracotta Primary Accent (`#D97757`), Semantic Emerald (`#16A34A`) for connected MTProto status, Amber (`#D97706`) for OTP verification state, Crimson (`#DC2626`) for destructive actions.
  - *Typography & Hierarchy*:
    - Display & Workspace Navigation: `Plus Jakarta Sans` (600–700 weight, tight tracking).
    - Dense Table & Control Copy: `DM Sans` (400–500 weight, 13px–14px, single-line `whitespace-nowrap`).
    - File Sizes, Timestamps, Speed Multipliers & OTP Inputs: `JetBrains Mono` with strict `font-variant-numeric: tabular-nums`.
  - *Component Styling & Layout*:
    - Full 1440px desktop SaaS layout with a 256px sidebar, single-row contextual top header, compact 40px–44px table rows, and flat 1px structural borders (`border border-[#2C2824]`, zero nested card sandwiches or decorative pulsing dots).
- **Interactive Feedback & Motion**:
  - Routine control transitions settle within `150ms` (`cubic-bezier(0.16, 1, 0.3, 1)`) using compositor-only `transform` and `opacity`.
  - Video player controls auto-hide after 2.5 seconds of pointer inactivity during playback for an unobstructed viewing frame.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Server + Client Coordinated Telegram MTProto (`GramJS`) with StringSession Persistence**:
  - *Chosen Approach*: Authenticate the Admin's Telegram User Account via MTProto (`telegram` / GramJS) using Phone Number + OTP, and persist the authorized `StringSession` in the server database and `systemConfig/storageNode` in Firestore.
  - *Why*: Standard Telegram Bot API (`api.telegram.org/bot...`) enforces a hard 20 MB download limit (`getFile`) and 50 MB upload limit per request. A real Telegram User Account using MTProto supports single-file documents up to **2 GB** (and 4 GB for Premium accounts) with parallel worker connections.
  - *Alternatives Considered*: Per-user Telegram login was rejected so regular users don't have to connect their personal Telegram accounts; the Global Admin account handles all storage transparently behind the scenes.
- **Decision 2 — Real-Time Firestore `onSnapshot` + Deletion Tombstone Registry**:
  - *Chosen Approach*: Replace one-time startup fetches with continuous `onSnapshot` listeners on `cloudFiles` and `cloudFolders`, and track deleted file/folder IDs in a tombstone set (`deletedCloudIds`) before running any local-to-cloud reconciliation.
  - *Why*: Previously, when Device A deleted a file, Device B still held that file in its `localStorage` fallback state and would either keep showing it or re-upload its metadata back to Firestore on refresh. Real-time `onSnapshot` `removed` events + tombstones prevent stale local copies from ever resurrecting deleted files.
- **Decision 3 — Streamlined JW Player Style Iframe**:
  - *Chosen Approach*: Strip away multi-tab debug overlays, top metadata ribbons, and complex filter panels inside the video player in favor of a clean JW Player control bar (Play/Pause, Seek bar, Volume, Speed selector, Fullscreen).
  - *Why*: Matches the user's request for a fast, lightweight, familiar JW Player embed that loads immediately on any site or share page.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        UnlimStorage Client Workspace                         │
│                                                                              │
│  ┌──────────────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │   Drive Explorer View    │  │  Admin MTProto Panel │  │ JW Player      │  │
│  │  • Fast Upload + Hidden  │  │  • API ID & API Hash │  │ Iframe Embed   │  │
│  │    Processing Loader     │  │  • Phone -> OTP Code │  │ • Clean Video  │  │
│  │  • Real-Time File Table  │  │  • 2FA Password Step │  │ • Speed Menu   │  │
│  │  • Instant Delete Action │  │  • Session Status    │  │ • Fullscreen   │  │
│  └────────────┬─────────────┘  └──────────┬───────────┘  └────────┬───────┘  │
└───────────────┼───────────────────────────┼───────────────────────┼──────────┘
                │                           │                       │
                ▼                           ▼                       ▼
┌───────────────────────────────┐  ┌───────────────────────────────────────────┐
│   Firebase Cloud Firestore    │  │    Backend & Telegram MTProto Engine      │
│ • Real-Time onSnapshot Sync   │  │ • GramJS TelegramClient (StringSession)   │
│ • /cloudFiles/{fileId}        │  │ • /api/telegram/mtproto/send-code         │
│ • /cloudFolders/{folderId}    │  │ • /api/telegram/mtproto/verify-code       │
│ • Deletion Tombstone Guard    │  │ • Up to 2 GB Direct MTProto File Upload   │
│ • /systemConfig/storageNode   │  │ • HTTP Range Stream Proxy for JW Player   │
└───────────────────────────────┘  └───────────────────────────────────────────┘
```

- **Data Model & State**:
  - **`systemConfig/storageNode`**: Extended to store `mode` (`mtproto` | `bot`), `apiId`, `apiHash`, `phoneNumber`, `mtprotoSession` (encrypted/persisted `StringSession`), `accountName`, `accountUsername`, alongside existing `botToken` and `chatId` fallback fields.
  - **`cloudFiles/{fileId}` & `cloudFolders/{folderId}`**: Synchronized in real time via Firestore `onSnapshot`. Includes storage driver metadata (`mtproto` | `telegram` | `local_vault`), message/document identifiers, and file size up to 2 GB+.
  - **Deletion Tombstone Registry**: Local + cloud-synced set of deleted file and folder IDs ensuring that once an item is deleted on any device, no other open tab or device can re-insert it from local cache.
- **Interactive Component & State Mapping**:
  - **Admin MTProto OTP Flow**:
    1. `Step 1 (Credentials & Phone)`: Admin inputs `apiId`, `apiHash`, `phoneNumber`, and target `chatId` (defaulting to `me` / Saved Messages or private storage channel) -> triggers `/api/telegram/mtproto/send-code` -> transitions UI to `Step 2 (OTP Input)`.
    2. `Step 2 (OTP & Optional 2FA)`: Admin inputs the Telegram login code (and 2FA cloud password if prompted) -> triggers `/api/telegram/mtproto/verify-code` -> receives authorized `StringSession` -> saves to backend and Firestore `systemConfig/storageNode` -> transitions UI to `Connected (2 GB MTProto Active)`.
  - **Real-Time Multi-Device Sync & Delete**:
    - An active `subscribeToUserCloudDrive(uid, callbacks)` listener in Firestore watches `cloudFiles` and `cloudFolders` where `ownerId == uid`.
    - When `change.type === 'removed'` fires on any device, the client immediately purges the file/folder from React state, removes it from `localStorage` fallback DB, deletes its binary from IndexedDB, and adds the ID to the tombstone list.
  - **JW Player Style Embed Component**:
    - Renders a clean `<iframe>` housing a dark HTML5 video surface with pointer-activity auto-hide controls, smooth scrub bar with hover time preview, Play/Pause, Mute/Volume slider, Speed popover (`0.5x`, `0.75x`, `1x`, `1.25x`, `1.5x`, `2x`), and Fullscreen button.
