# Main Account Telegram Vault, Lossless Media Quality & Google Drive Upload UX

This update removes the **Activity & Speed** page, ensures all uploaded files are stored exclusively through your logged-in main Telegram account into your private Telegram channel without ever falling back to the Bot, guarantees 100% original lossless quality for all videos and images, adds a Google Drive-style mobile **Plus (`+`)** floating button, and enables full-screen desktop drag-and-drop file uploads.

## User Review & Critical Decisions

> [!IMPORTANT]
> Your preferences from the clarification step have been locked into this plan:

- **Confirmed Decision 1 — Private Channel Storage via Main Telegram Account**: Files will be uploaded and stored exclusively using your logged-in main Telegram account (MTProto session) into your private Telegram channel (`-100...`), resolving the channel entity from your account dialogs (`getDialogs`) so GramJS never fails on channel IDs and never falls back to the Bot API.
- **Confirmed Decision 2 — Mobile Plus (`+`) Button Behavior (Both Modes)**: The floating bottom-right `+` button on mobile will support both a Google Drive-style action sheet (**Upload Files**, **New Folder**, **Upload from Link**) and a direct one-tap **Upload Files** primary trigger.
- **Confirmed Decision 3 — 100% Original Uncompressed Media Quality**: Videos and images are stored as raw uncompressed binary documents (`forceDocument: true`) and streamed/previewed at 100% original resolution and quality (`Auto (Original Quality)` / lossless stream copy without downscaling).

---

## 1. Overview & Core Concept

- **What It Does**: Streamlines the workspace by removing the redundant Activity & Speed page, routes all cloud storage operations through your personal Telegram account's MTProto session into your private storage channel, preserves byte-exact original quality for every photo and video, and introduces Google Drive's signature upload ergonomics on both mobile and desktop.
- **Target Audience / Persona**: Cloud drive owners managing large HD/4K videos, high-resolution photos, and archives across desktop and mobile devices.
- **Key Value**: Eliminates unwanted Bot uploads, prevents any image or video compression during storage or playback, and makes uploading effortless from anywhere on the screen.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Clean Navigation Bar**: Both the desktop top navigation bar and the mobile bottom tab bar display only core drive destinations (**My Files**, **Trash Bin**, **Shared Links**, **Plans & Tokens**, and **Storage Node** for Admin), with **Activity & Speed** completely removed.
  2. **Main Account Private Channel Storage**: When you upload any file up to 2 GB, the server uses your persisted MTProto user session to send the file as an uncompressed document (`CustomFile` with original filename attributes) directly to your private Telegram channel using your main account.
  3. **Mobile Google Drive-Style Plus (`+`) Floating Action Button**: On mobile screens, a tactile floating `+` button sits in the natural thumb zone at the bottom-right corner above the bottom navigation bar. Tapping `+` opens a sleek Google Drive-style bottom sheet with a prominent **Upload Files** button alongside **New Folder** and **Upload from Web Link** (and double-tapping or tapping the primary action immediately launches the device file picker).
  4. **Desktop Full-Screen Drag & Drop**: Dragging one or more files anywhere over the browser window reveals a full-viewport dropzone overlay showing the target folder name and immediately starts uploading the dropped files upon release.
  5. **100% Lossless Video & Image Preview**: Opening an image renders the full-resolution original binary rather than a compressed thumbnail; opening a video streams at native 100% original resolution (`-c:v copy` for H.264 or native-resolution `-crf 18` for 10-bit HEVC) without downscaling.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dark vault workspace (`#141311` primary canvas, `#1C1A17` structural cards, `#2C2824` 1px borders, `#D97757` terracotta accent).
  - *Touch & Viewport Ergonomics*: $56\text{px} \times 56\text{px}$ floating mobile `+` button positioned in the lower-right thumb zone (`bottom-20 right-4`), paired with a 4-tab (or 5-tab for admin) bottom bar keeping total sticky height under the 15% mobile viewport cap.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dialog-Resolved MTProto Peer Entity & Strict Main-Account Priority**
  - *Chosen Approach*: Resolve numeric `-100...` private channel IDs via `client.getDialogs()` and `client.getInputEntity()` on your authenticated MTProto client, attach explicit `DocumentAttributeFilename` metadata so files keep their exact filename and extension in Telegram, and sync the MTProto session across Firestore and local storage so container restarts never revert to Bot mode.
  - *Why*: GramJS throws an entity lookup error when given a raw `-100...` string if dialogs haven't been cached in the current session, which previously caused the server's `catch` block to silently fall back to the Bot API.
  - *Alternatives Considered*: Falling back to the Bot API on entity error was rejected because you explicitly want your main account—not the Bot—to store all files.

- **Decision 2: Zero-Downscale Video & Image Pipeline**
  - *Chosen Approach*: Remove the 420p nearest-neighbor downscaling from `Auto` quality in the FFmpeg streaming pipeline. `Auto` and `Original` now use `-c:v copy` (zero re-encoding) whenever the video stream is H.264, and preserve 100% native resolution (`-crf 18` high bitrate) when transcoding 10-bit HEVC MKVs. Image previews load directly from the full-resolution binary endpoint before any thumbnail fallback.
  - *Why*: Ensures neither images nor videos lose a single pixel of clarity during upload, storage, or browser playback.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Browser Viewport (Desktop & Mobile)                 │
│                                                                            │
│  ┌──────────────────────────────────┐  ┌────────────────────────────────┐  │
│  │ Global Window Drag & Drop Layer  │  │ Mobile Floating Plus (+) FAB   │  │
│  │ • Full-screen dropzone overlay   │  │ • Thumb-zone (+56x56px button) │  │
│  │ • Drops anywhere -> Upload Files │  │ • Instant Upload + Drive Sheet │  │
│  └────────────────┬─────────────────┘  └───────────────┬────────────────┘  │
└───────────────────┼────────────────────────────────────┼───────────────────┘
                    └──────────────────┬─────────────────┘
                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                  Chunked Binary Upload & Lossless Media Engine             │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Main Account MTProto Vault (GramJS StringSession)                 │  │
│  │    • Syncs session across Firestore (storageNodeConfig) & Server DB  │  │
│  │    • Resolves Private Channel (-100...) via getDialogs()             │  │
│  │    • Uploads raw binary with forceDocument: true (0% compression)    │  │
│  │    • Broadcasts file:updated -> Syncs mtproto chunks to Firestore    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 2. 100% Original Quality Preview & Streaming                         │  │
│  │    • Images: Full original binary stream (/download?inline=1)        │  │
│  │    • Videos: Native resolution (-c:v copy or full-res CRF 18)        │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - **Navigation Cleanup**: Remove `'activity'` from `ActiveView` and strip the desktop header link, mobile bottom tab button, and `ActivityAndSpeedView` render block.
  - **Global Drag & Drop State**: Attach window-level `dragenter`, `dragover`, `dragleave`, and `drop` listeners using a drag depth counter (`dragDepthRef`) so dragging files anywhere over the screen activates the full-screen dropzone overlay and dropping files immediately invokes `handleUploadFiles`.
  - **Mobile Floating Plus (`+`) Button & Sheet**: Add `showMobilePlusMenu` state controlled by the bottom-right `+` FAB on mobile (`md:hidden`), offering one-tap **Upload Files Now**, **Create New Folder**, and **Upload from Web Link**.
  - **Main Account MTProto Persistence & Channel Resolution**: Fix the `verify-code` response and `file:updated` WebSocket payload mapping (`msg.payload.file || msg.payload`), auto-restore the MTProto session on startup, resolve the private channel entity via `getDialogs()`, and preserve original filenames on uploaded Telegram documents.
