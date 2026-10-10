# UnlimStorage — Permanent Cross-Device Cloud Sync, Hidden Telegram Storage Engine, Live MKV Multi-Track Demuxer & Interactive Toast Notifications

This upgrade makes uploaded files and folders permanently accessible across any device or browser signed into the same Google account, connects the hidden Telegram Bot storage engine for permanent multi-chunk binary persistence, adds real-time Matroska (`.mkv`) audio and subtitle stream demuxing inside the custom YouTube-style iframe player, and upgrades notifications with 4-second auto-dismiss, swipe gestures, and a close (`X`) button.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following product and architectural choices have been confirmed from your answers and will guide the implementation:

- **Confirmed Decision 1 — Hidden Telegram Storage Configuration**: Provide an Admin-only Storage Node configuration panel (visible strictly to `titumamma2425@gmail.com` and synced to Firestore so all devices share the active storage node) requiring only two credentials from Telegram:
  1. **Bot Token** (from `@BotFather`, e.g., `123456789:AAF...`)
  2. **Private Channel / Group Chat ID** (where the bot is an Admin, e.g., `-100...`)
  Regular users never see any mention of Telegram anywhere in the UI.
- **Confirmed Decision 2 — Cross-Device Permanent File & Folder Sync**: Synchronize every uploaded file's metadata, SHA-256 hash, folder location, and encrypted storage chunk manifest to Firestore, and automatically hydrate the user's full cloud drive (`cloudFiles` and `cloudFolders`) on login from any device or deployment URL.
- **Confirmed Decision 3 — Interactive Toast Notifications**: Every notification toast automatically vanishes after **4 seconds** with a smooth visual countdown bar, and can also be dismissed immediately by **swiping left/right/up** or clicking the **Close (`X`) button**.
- **Confirmed Decision 4 — Real-Time MKV Multi-Audio & Multi-Subtitle Demuxing**: Upgrade the custom YouTube-style iframe player with a real Matroska (`EBML` Cluster / `SimpleBlock` / `BlockGroup`) binary demuxer and WebAudio track synthesizer so switching between embedded audio tracks or subtitle tracks immediately changes the active audio output and subtitle overlay.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. **Cross-Device Permanent Cloud Vault**: When a user uploads a file on one device and logs in with the same Google account on another phone, PC, or deployment URL, their entire file list, folders, starred statuses, and storage quota load automatically from Firestore, while binary file chunks stream directly from the connected Telegram storage channel (or cloud chunk vault).
  2. **Zero-Trace Admin Storage Node Setup**: Only the administrator (`titumamma2425@gmail.com`) can view and configure the Telegram Bot Token and Channel Chat ID. Once verified and saved in the Admin panel, the credentials are persisted in Firestore so both server and serverless/static deployments can push and pull 19 MB file chunks transparently.
  3. **Real MKV Multi-Audio & Multi-Subtitle Switching**: Parses Matroska `Tracks`, `Cues`, and `Cluster` blocks directly from the `.mkv` binary stream, extracting embedded subtitle cues (`S_TEXT/UTF8`, `S_TEXT/ASS`, `S_TEXT/SSA`) across the entire file timeline and decoding/routing distinct audio tracks via WebAudio (`AudioContext` + multi-track buffer/decoder pipeline) so selecting Track 1, Track 2, or any subtitle language immediately changes playback.
  4. **Dismissible & Swipeable Toast Stack**: Replaces static alerts with an interactive notification stack supporting a 4-second auto-vanish timer (paused on hover), touch/pointer swipe-to-dismiss gestures, and an explicit `X` close button.
- **Target Audience / Persona**: Everyday cloud storage users who expect a clean, fast, Google Drive-style vault (`UnlimStorage`) with instant video streaming and cross-device file access, alongside an administrator who manages the underlying unlimited storage node privately.
- **Key Value**: True permanent multi-device cloud storage, genuine multi-audio/subtitle MKV playback inside a YouTube-grade custom iframe player, and non-intrusive toast notifications.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Connecting Permanent Storage (Admin Only)**:
     - The Admin opens **Storage Node** in the sidebar -> enters the **Telegram Bot Token** (`@BotFather`) and **Channel Chat ID** (`-100...`) -> clicks **Verify & Save Permanently**.
     - The app tests the bot connection, verifies channel write access, saves the configuration to Firestore, and activates automatic chunked cloud backup across all sessions.
  2. **Uploading & Opening Files on Another Device**:
     - A user uploads a file (with real chunked byte progress and a working **Cancel** button). The file is chunked into the permanent storage node and its record + chunk manifest is written to Firestore.
     - When the user signs in on another browser or device, `UnlimStorage` queries Firestore for their `cloudFiles` and `cloudFolders`, populates their drive immediately, and streams/reassembles binary chunks on demand when previewing or downloading.
  3. **Switching Audio & Subtitles in Custom YouTube Iframe Player**:
     - Opening any `.mkv` or video file launches the custom YouTube-style `<iframe>` player.
     - Clicking the **Audio Track (Headphones)** button opens the track selector showing all embedded Matroska audio streams (language, codec, channel layout). Selecting another track immediately switches the active audio decoder/WebAudio routing pipeline and confirms the switch on-screen.
     - Clicking the **Subtitles (CC)** button lists all embedded MKV subtitle tracks plus an option to load `.srt`/`.ass`/`.vtt` files. Selecting any subtitle track renders live synchronized captions over the video frame.
  4. **Interacting with Notifications**:
     - Whenever an action completes (upload, move, plan claim, folder creation, track switch), a toast slides in at the bottom-right with a 4-second progress indicator, an `X` close button, and pointer/touch drag support so swiping > 60px smoothly flings it off-screen.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian Enterprise SaaS Vault (`UnlimStorage`) with high-contrast dark surfaces, clean 1px structural borders, and zero AI-slop clutter.
  - *Color Palette & Mood*:
    - Dominant 60% Neutral Canvas: Deep Obsidian (`#141311`) and Charcoal Surface (`#1C1A17`).
    - Structural 30% Surfaces: Warm Slate Hairlines (`#2C2824`), Muted Stone Text (`#9E978E`), Primary Crisp Alabaster (`#F2EFE9`).
    - Accent 10% Budget: Terracotta Action Accent (`#D97757`), Semantic Emerald (`#2E9E6B`) for verified storage states, Amber (`#D99B26`) for warnings, Crimson (`#D94E4E`) for errors/YouTube scrub bar (`#FF0000`).
  - *Typography & Hierarchy*:
    - Display & Navigation: `Plus Jakarta Sans` / `Outfit` (600–700 weight, tight tracking).
    - Body UI: `DM Sans` / `Plus Jakarta Sans` (400/500 weight, 14px–15px).
    - Telemetry, File Sizes, Timestamps & Hash Digests: Monospace with strict `font-variant-numeric: tabular-nums` (`JetBrains Mono`).
  - *Component Styling & Layout*:
    - 1440px full-viewport SaaS workspace with a 256px left navigation sidebar, single-row contextual header bar, and single-elevation data cards (`border border-[#2C2824]`, no nested card-in-card borders or thick left accent bars).
- **Interactive Feedback & Motion**:
  - Compositor-only (`transform`, `opacity`) transitions under `180ms` (`cubic-bezier(0.16, 1, 0.3, 1)`).
  - Toast swipe gestures track pointer delta in real time (`translateX(${deltaX}px)`) with opacity fade and instant dismissal on release or `X` click.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Cross-Device Metadata + Chunk Manifest in Firestore with Binary Chunks in Telegram**:
  - *Chosen Approach*: Store structured file & folder records (including the `telegramChunks` array of `file_id`s and `sha256` hashes) in Firestore (`cloudFiles` and `cloudFolders`), while storing the heavy binary payloads (up to multiple GBs) as 19 MB chunks in the private Telegram storage channel.
  - *Why*: Firestore documents have a 1 MB limit and are designed for fast real-time metadata queries across devices, whereas Telegram's Bot API supports unlimited document chunks up to 20 MB per part for free permanent storage. Combining Firestore metadata sync with Telegram chunk storage makes files appear and download on any device worldwide.
  - *Alternatives Considered*: Browser-only IndexedDB was fast on a single device, but data stayed trapped on the local browser and never appeared when logging in from another device.
- **Decision 2 — In-Browser Matroska (`EBML`) Cluster Demuxer + Multi-Track Audio Engine**:
  - *Chosen Approach*: Parse both the Matroska `Tracks` header and `Cluster` (`SimpleBlock` / `BlockGroup`) payloads across the `.mkv` binary to extract complete embedded subtitle timelines (`UTF8` / `ASS` / `SSA` -> WebVTT cues) and demux secondary audio track packets into a synchronized WebAudio playback node (`AudioContext` + `HTMLMediaElement` / `AudioBuffer` / channel demuxer) inside the YouTube iframe player.
  - *Why*: Standard Chromium `<video>` tags often ignore secondary audio tracks and embedded MKV text tracks. Demuxing the MKV container streams in JavaScript guarantees that switching audio or subtitle tracks produces an immediate, audible and visual change.
- **Decision 3 — Auto-Vanishing Swipeable Toast Controller**:
  - *Chosen Approach*: Build a dedicated toast notification component with an individual 4000ms lifecycle timer, hover-pause, pointer-events swipe tracking (`onPointerDown` / `onPointerMove` / `onPointerUp`), and an accessible `X` close button.
  - *Why*: Prevents old notifications from lingering or blocking workspace controls on desktop and mobile screens.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        UnlimStorage Client Workspace                         │
│                                                                              │
│  ┌──────────────────────┐   ┌───────────────────────┐   ┌─────────────────┐  │
│  │  Swipeable Toast Bar │   │  Drive Explorer View  │   │ Admin Vault UI  │  │
│  │  • 4s Auto-Dismiss   │   │  • Real Byte Progress │   │ (Admin Email    │  │
│  │  • Touch/Mouse Swipe │   │  • AbortController    │   │  Only)          │  │
│  │  • Explicit X Close  │   │  • Drag & Drop Move   │   │ • Bot Token     │  │
│  └──────────────────────┘   └───────────┬───────────┘   │ • Chat ID       │  │
│                                         │               └────────┬────────┘  │
│                                         ▼                        │           │
│  ┌──────────────────────────────────────────────────┐            │           │
│  │     Custom YouTube Iframe Video Player           │            │           │
│  │  • Sandboxed <iframe> + React Portal UI          │            │           │
│  │  • Matroska (EBML) Cluster & Block Demuxer       │            │           │
│  │  • Live Multi-Audio Track Switcher (WebAudio)    │            │           │
│  │  • Live Multi-Subtitle Cue Renderer (SRT/ASS)    │            │           │
│  └──────────────────────────┬───────────────────────┘            │           │
└─────────────────────────────┼────────────────────────────────────┼───────────┘
                              │                                    │
              ┌───────────────┴────────────────┐                   │
              ▼                                ▼                   ▼
┌───────────────────────────────┐    ┌─────────────────────────────────────────┐
│   Firebase Cloud Firestore    │    │   Hidden Telegram Storage Engine        │
│ • /userProfiles/{uid}         │    │ • Splits files into ≤19 MB binary parts │
│ • /cloudFiles/{fileId}        │◄──▶│ • Sends parts via Bot API sendDocument  │
│   (includes chunk manifest)   │    │ • Reassembles via getFile on any device │
│ • /cloudFolders/{folderId}    │    │ • Local IndexedDB cache for instant     │
│ • /systemConfig/storageNode   │    │   zero-latency repeat playback          │
└───────────────────────────────┘    └─────────────────────────────────────────┘
```

- **Data Model & State**:
  - **`cloudFiles/{fileId}` (Firestore)**: Stores `id`, `ownerId`, `ownerName`, `folderId`, `name`, `sizeBytes`, `mimeType`, `sha256`, `storageDriver` (`telegram` or `local_vault`), `chunksJson` (serialized array of `{ partIndex, messageId, fileId, sizeBytes, sha256Part }`), `starred`, `downloadCount`, `createdAt`, and `updatedAt`.
  - **`cloudFolders/{folderId}` (Firestore)**: Stores `id`, `ownerId`, `ownerName`, `name`, `parentId`, `createdAt`, and `updatedAt` so custom folders also sync across devices.
  - **`systemConfig/storageNode` (Firestore)**: Stores the active `botToken`, `chatId`, `botUsername`, `autoSyncUploads`, and `updatedAt` so the connected Telegram storage node persists across page reloads, devices, and serverless deployments.
- **Interactive Component & State Mapping**:
  - **Cross-Device Hydration on Auth**: When `onAuthStateChanged` fires for an authenticated Google user, the app fetches both their `userProfiles/{uid}` document and queries `cloudFiles` and `cloudFolders` where `ownerId == uid`, merging them into the active workspace state so uploaded files appear on every device immediately.
  - **Permanent Upload Pipeline**: During chunked file upload, if the Telegram Storage Node is configured, each 19 MB segment is transmitted to Telegram (`sendDocument`) with live byte-level progress (`xhr.upload.onprogress`), returning permanent `file_id` handles that are saved to `cloudFiles/{fileId}` in Firestore.
  - **Cross-Device Download & Stream Pipeline**: When a user previews or downloads a file on a second device where local IndexedDB does not yet have the binary, the engine reads `telegramChunks` from the synced file record, fetches the segments from the storage node (`getFile`), caches the reassembled `Blob` in IndexedDB, and plays or downloads the full binary.
  - **MKV Multi-Audio & Subtitle Switching**:
    - The EBML parser scans `Segment -> Tracks` and `Cluster -> SimpleBlock / BlockGroup` across the video blob/stream to extract all embedded subtitle cues and audio track frames.
    - Selecting a different **Audio Track** in the YouTube iframe menu switches the active audio stream (using native `audioTracks` where available plus a synchronized secondary `<audio>` / WebAudio frequency & channel demux pipeline per track index so every track produces distinct audio output and never stays stuck on one track).
    - Selecting a different **Subtitle Track** switches the active cue list rendered in the custom YouTube caption overlay.
  - **Toast Notification Lifecycle**: Each toast stores `{ id, message, type, createdAt, durationMs: 4000 }`. A timer auto-removes the toast after 4 seconds (pausing if hovered), clicking the `X` button removes it immediately, and pointer drag gestures (`deltaX`) allow swiping any notification away on touch or desktop.
