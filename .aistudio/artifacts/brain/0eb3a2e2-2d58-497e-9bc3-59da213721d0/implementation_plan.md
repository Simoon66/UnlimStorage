# UnlimStorage Cloud Drive & Media Suite Upgrades

This plan delivers a comprehensive upgrade across media playback, cloud file management, public sharing, folder privacy, and installable Progressive Web App (PWA) support based on your selected priorities.

## User Review & Critical Decisions

> [!IMPORTANT]
> All feature areas below directly reflect your confirmed selections from our planning questionnaire. Review the architectural flow and click **Proceed** when ready to build.

- **Confirmed Media Upgrade**: Automatic **Resume Playback** from the last watched timestamp for every video, with a non-intrusive resume toast and one-click "Start Over" option.
- **Confirmed Explorer & Storage Upgrades**:
  - **Trash Bin & Restore Workflow**: Soft-deleting files and folders to a dedicated Trash view before permanent deletion.
  - **Pause & Resume Large File Uploads**: Chunk-level upload state tracking allowing in-flight uploads to be paused and resumed without losing progress.
  - **Batch ZIP Download**: Selecting multiple files in the explorer and downloading them together as a single `.zip` archive with live progress.
  - **Grid & List Layout Toggle**: Switching seamlessly between the high-density tabular List view and a visual Grid card layout with media previews.
- **Confirmed Sharing, Security & Platform Upgrades**:
  - **Direct Multi-Quality Video Streaming on Public Share Pages**: Full `Auto`, `1080p`, `720p`, `480p`, and `360p` streaming, multi-audio track switching, and subtitle support on public share links (including `.mkv` files).
  - **Public Folder Sharing with Gallery View**: Sharing entire folders via public links with grid/list browsing, inline video streaming, and single-click folder download.
  - **PIN Lock Protection for Private Folders**: Securing sensitive folders behind a 4–6 digit PIN prompt.
  - **Installable Mobile & Desktop PWA**: Full Web App Manifest, service worker caching, in-app install button (with iOS Safari instructions), and offline status indicator.

---

## 1. Overview & Core Concept

- **What It Does**: Elevates UnlimStorage into an installable, full-featured cloud drive and streaming platform where users can organize files in Grid or List views, protect private folders with a PIN, recover accidentally deleted items from the Trash, pause and resume large uploads, download multi-file ZIP archives, and share both individual videos and entire folders with direct multi-quality streaming.
- **Target Audience / Persona**: Desktop and mobile power users storing, organizing, and streaming large video libraries (including multi-audio MKV files) and personal cloud archives backed by Telegram storage nodes.
- **Key Value**: Eliminates data loss from accidental deletions or interrupted uploads, saves time with batch ZIP downloads and automatic video playback resume, and makes public sharing and mobile installation effortless.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Resume Video Playback Flow**:
   - As a video plays, the player saves the current timestamp every 2 seconds (keyed by file ID or share token).
   - Re-opening a partially watched video (between 5% and 95% progress) automatically seeks to the saved position and displays a quiet top-left overlay badge (`Resumed at 14:28 · Start Over`) for 5 seconds.
   - Explorer Grid and List views also display a subtle progress bar underneath partially watched video items.

2. **Trash Bin & Recovery Flow**:
   - Clicking **Delete** on files or folders moves them to the **Trash** section in the sidebar rather than erasing them immediately.
   - Inside the **Trash** view, users can select items to **Restore** back to their original folder or **Delete Permanently**, or click **Empty Trash** to purge all trashed items at once.

3. **Pause & Resume Upload Flow**:
   - Uploading large files slices the payload into sequential chunks and shows each active transfer in the upload panel with **Pause**, **Resume**, and **Cancel** controls.
   - Pausing halts the current chunk upload immediately while retaining all completed parts on the server/client session; clicking **Resume** continues from the exact byte offset where it paused.

4. **Explorer Grid / List Toggle & Batch ZIP Download**:
   - The explorer toolbar includes a segmented **List | Grid** toggle persisted in user preferences.
   - Selecting multiple files reveals a **Download ZIP** button in the bulk action bar that streams and packages the selected files into a single `.zip` download with percentage feedback.

5. **PIN-Locked Folders**:
   - Folder actions include **Lock with PIN** (4–6 digits). Locked folders display a lock indicator in the explorer and require entering the PIN in a verification modal before opening, moving, sharing, or deleting.

6. **Public Folder Gallery & Direct Video Share Streaming**:
   - Users can click **Share Folder** on any folder to generate a public link (`/?share=<token>`).
   - Visitors opening a shared folder see a clean gallery portal (Grid/List toggle) where they can stream any video inside the folder using the full multi-quality (`Auto` / `1080p` / `720p` / `480p` / `360p`), multi-audio, and subtitle-enabled player, or download individual files / the full folder as a ZIP.

7. **Installable PWA & Offline Indicator**:
   - An **Install App** button appears in the navigation sidebar/header whenever the browser supports PWA installation (or shows a guided "Add to Home Screen" modal on iOS Safari), hiding automatically when already running in standalone mode.

### Visual Identity & Theme

- **Aesthetic Direction**: Warm industrial dark studio interface matching the existing obsidian and terracotta palette (`#141311` canvas, `#1C1A17` structural surfaces, `#2C2824` hairline borders, `#D97757` primary accent).
- **Color Palette & Mood**:
  - Dominant 60% Canvas: Deep Warm Obsidian (`#141311`)
  - Structural 30% Surfaces: Charcoal Slate (`#1C1A17` and `#24211D`) with crisp `1px solid #2C2824` hairline dividers
  - Accent 10% Budget: Warm Terracotta (`#D97757`), Semantic Emerald (`#2E9E6B`), Amber (`#D99B26`), and Crimson (`#D94848`)
- **Typography & Hierarchy**: Clean sans-serif interface hierarchy paired with `tabular-nums` monospace alignment for byte sizes, upload speeds, PIN inputs, and video timestamps.
- **Zero-Pill Metadata Discipline**: File sizes, dates, watch progress, and folder item counts render as clean unboxed text separated by middle dots (`·`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Chunked Upload Session State for Pause/Resume**
  - *Chosen Approach*: Track resumable upload sessions using deterministic upload IDs so completed chunks are retained in temporary storage while paused, and assembled into the final file record once the final chunk finishes.
  - *Why*: Allows multi-hundred-megabyte or multi-gigabyte video uploads to pause and resume reliably without re-sending already transferred data.
- **Decision 2: Soft-Delete Trash Architecture**
  - *Chosen Approach*: Use `trashed: true` and `trashedAt` metadata on file and folder records in both the backend/client database and Firestore, filtering trashed items out of the main Explorer and Shared views into a dedicated Trash view.
  - *Why*: Prevents accidental permanent loss of large Telegram-backed media files and syncs cleanly across devices via Firestore.
- **Decision 3: Unified Streaming Pipeline for Public Shares**
  - *Chosen Approach*: Connect public share tokens (both single-file video shares and files inside shared folders) to the same zero-buffer FFmpeg transcoding, audio-track probing, and subtitle extraction pipeline used in the authenticated drive.
  - *Why*: Ensures `.mkv` videos and multi-audio streams play with instant startup, quality selection (`Auto`, `1080p`, `720p`, `480p`, `360p`), and working timeline scrubbing on public share pages.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        UnlimStorage PWA Shell (Vite + SW)                    │
│  ┌────────────────────┐  ┌────────────────────────────────────────────────┐  │
│  │ Sidebar Navigation │  │ Main Explorer / Trash / Public Portal Viewport │  │
│  │ - My Files         │  │ ┌────────────────────────────────────────────┐ │  │
│  │ - Trash Bin (New)  │  │ │ Toolbar: Search · Grid/List · Batch ZIP    │ │  │
│  │ - Shared Links     │  │ └────────────────────────────────────────────┘ │  │
│  │ - Storage & Speed  │  │ ┌────────────────────┐ ┌─────────────────────┐ │  │
│  │ - Install PWA Btn  │  │ │ File/Folder Grid & │ │ PIN Lock & Share    │ │  │
│  └────────────────────┘  │ │ List Views         │ │ Modals              │ │  │
│                          │ └────────────────────┘ └─────────────────────┘ │  │
│  ┌───────────────────────┴────────────────────────────────────────────────┐  │
│  │ Resumable Upload Queue Bar (Pause / Resume / Cancel Chunked Transfers) │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Video Streaming & Public Share Portal Engine                 │
│  ┌───────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │ Custom Cinema Video Player        │  │ Public Share Portal             │  │
│  │ - Auto Resume Playback Timestamp  │  │ - Single Video Direct Stream    │  │
│  │ - Auto/1080p/720p/480p/360p       │  │ - Shared Folder Gallery View    │  │
│  │ - Multi-Audio & Windowed VTT CC   │  │ - Folder Batch ZIP Download     │  │
│  └───────────────────────────────────┘  └─────────────────────────────────┘  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                Express Backend & Firestore / Telegram Storage                │
│  - Resumable Chunk Upload Endpoints (/api/files/upload-chunk, /complete)     │
│  - Batch ZIP Streamer (/api/files/batch-zip & /api/public/share/:token/zip)  │
│  - Public Share Media Probe & FFmpeg Transcode Streamer                      │
│  - Firestore Sync (cloudFiles, cloudFolders, publicShares + security rules)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Extensions

- **FileRecord & FolderRecord**:
  - `trashed?: boolean` and `trashedAt?: string | null` for Trash bin management.
  - `pinHash?: string | null` and `isPinProtected?: boolean` on `FolderRecord` for PIN-locked private folders.
- **ShareLink**:
  - `targetType?: 'file' | 'folder'` and `folderId?: string | null` so a public share link can represent either a single file or a shared folder gallery.
- **Playback Resume Store**:
  - Persisted map (`unlim_video_progress_v1`) storing `{ currentTime, duration, updatedAt }` per `fileId` / share token.
- **Resumable Upload State**:
  - Extended `TransferJob` status with `'paused'`, tracking `uploadedBytes`, `chunkIndex`, and `AbortController` per active upload job so clicking Pause aborts only the current in-flight chunk and clicking Resume continues from the next unuploaded chunk.

### Interactive Component & State Mapping

- **Explorer View Switcher & Grid Cards**: Toggles between dense table rows and responsive media cards showing video watch progress bars, folder PIN lock badges, and quick action buttons.
- **Trash View**: Lists all trashed files and folders with individual **Restore** and **Delete Permanently** buttons plus a header **Empty Trash** action.
- **PIN Lock Modal**: Supports setting, changing, removing, and verifying a 4–6 digit folder PIN during session navigation.
- **Batch ZIP Generator**: Streams selected files (or shared folder files) into a standards-compliant `.zip` archive download with real-time progress reporting.
- **PWA Integration**: Configures `vite-plugin-pwa` with precaching, generates compliant `192x192`, `512x512`, and `apple-touch-icon.png` icons, and mounts the `PWAInstallButton` and `OfflineIndicator` components.
