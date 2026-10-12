# UnlimStorage — Minimal White Workspace, Adaptive Streaming & Scale-Ready Admin Suite

This update transforms UnlimStorage into a crisp, ultra-clean white minimal cloud workspace with fluid responsive layouts, desktop Lasso multi-selection, simplified navigation, YouTube/Facebook-style adaptive bitrate streaming, universal file preview, high-scale admin user governance, and a synchronized dependency lockfile to resolve Cloudflare GitHub deployment failures.

## User Review & Critical Decisions

> [!IMPORTANT]
> All design and architectural choices below incorporate your confirmed preferences and the Cloudflare build log diagnostics.

- **Confirmed Decision 1 — Full Clean White Minimal Theme & Favicon**: The entire interface will transition to a crisp, distraction-free white minimal theme (`#FFFFFF` canvas, `#F8FAFC` subtle structural surfaces, `#E2E8F0` hairline borders, `#0F172A` high-contrast ink) paired with an edited white-theme favicon and brand mark derived from your uploaded image.
- **Confirmed Decision 2 — Adaptive Video Quality (1080p High = Lossless Original)**: Removes the redundant `Original` and duplicate `Auto` entries. The video player automatically adapts quality in real time based on live network speed and buffer health (stepping up to **1080p High [Original Lossless]** on fast connections and smoothly downshifting to **720p** or **480p** when bandwidth drops), while offering clean **1080p**, **720p**, and **480p** manual overrides.
- **Confirmed Decision 3 — Cloudflare GitHub Build Fix (`npm ci` Lockfile Sync)**: Your Cloudflare build log failed at `npm clean-install` because `package-lock.json` was missing `vite-plugin-pwa` and its transitive dependencies. We will synchronize dependencies and configure Cloudflare-compatible static/SPA build settings so every GitHub push deploys cleanly.

---

## 1. Overview & Core Concept

- **What It Does**: Provides an effortless, clutter-free personal and enterprise cloud drive backed by your main Telegram account (MTProto 2 GB lossless chunks), featuring instant drag-and-drop uploads, desktop Lasso selection, mobile touch selection with offline storage, universal file preview, unthrottled public sharing, and an administrative governance console.
- **Target Audience / Persona**: Everyday mobile and desktop users who want a fast, Google Drive-like experience without visual clutter, alongside administrators managing millions to billions of user records.
- **Key Value**: Combines zero-compression Telegram cloud storage with a lightweight, responsive white UI, seamless adaptive media playback, and full administrative control over user access and uploads.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Streamlined Navigation**: Top and side navigation is pared down to core essentials (**My Files**, **Gallery**, **Shared Links**, **Storage Plans**, and **Admin Panel** for admins). **Trash Bin** sits cleanly on the side as a compact icon button with an item badge, and the **Alerts & Offline** page is completely removed.
  2. **Lasso Multi-Selection & Free Fluid Layout**: In the Explorer, desktop users can click and drag anywhere on the canvas to draw a translucent selection rectangle (**Lasso**) that selects multiple file cards in real time, working alongside individual checkboxes and mobile touch-drag selection.
  3. **One-Click Unlimited Sharing**: Creating a share link immediately generates a full-speed direct link and optional password protection—all speed-throttling dropdowns and bandwidth caps are removed so every user downloads at their maximum internet speed.
  4. **YouTube/Facebook-Style Smooth Adaptive Video**: Videos start immediately using the preload buffer and monitor live network throughput (`navigator.connection` and buffer drain rate) to switch smoothly between **1080p (Lossless Original)**, **720p**, and **480p** without jarring reloads.
  5. **Universal File Preview**: Opening any file previews it directly in-app—including video (MKV, MP4, WebM, MOV, AVI), audio (MP3, WAV, FLAC, AAC, OGG), images (PNG, JPG, WebP, GIF, SVG, BMP), PDFs, Office/document formats, structured data (CSV/TSV table view, JSON tree), Markdown, source code, and archive inspection.
  6. **Admin User Governance & Upload Kill-Switch**: Admins can search across users by User ID, name, or email using indexed queries, restrict or suspend a user's data access, or toggle global and per-user file uploads on/off with a single switch.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Clean, minimal, airy white workspace inspired by modern productivity suites, comfortable across mobile, tablet, laptop, and ultrawide screens.
  - *Color Palette & Mood*:
    - `--background`: `#FFFFFF` (60% pure white primary canvas)
    - `--surface`: `#F8FAFC` / `#F1F5F9` (30% subtle slate structural surfaces with `#E2E8F0` 1px hairline borders)
    - `--foreground`: `#0F172A` primary ink and `#64748B` muted metadata
    - `--primary`: `#2563EB` royal blue primary action accent & Lasso highlight (`#16A34A` nominal green, `#D97706` warning amber, `#DC2626` danger crimson)
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for crisp headers and navigation, `DM Sans` for scannable file names and controls, and `JetBrains Mono` (`tabular-nums`) for file sizes, transfer speeds, and user IDs.
  - *Component Styling & Layout*: Free-flowing responsive grid (`auto-fill` fluid cards) with single-elevation surfaces, generous whitespace, and zero nested card clutter.
- **Interactive Feedback & Motion**: Instant `<150ms` hover states, live translucent blue Lasso marquee rectangle (`bg-blue-500/10 border border-blue-500`), and subtle bottom toast notifications.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Adaptive Bitrate with 1080p as Lossless Original**
  - *Chosen Approach*: Map the `1080p` tier directly to the lossless original stream (`Original` quality on the backend) while keeping automatic speed-based switching active by default and exposing `1080p`, `720p`, and `480p` in the selector.
  - *Why*: Eliminates confusing duplicate `Original` and `Auto` sections while ensuring high-speed users always receive 100% uncompressed video quality and slower connections avoid buffering.
- **Decision 2 — High-Scale Architecture & Admin Governance**
  - *Chosen Approach*: Use cursor-paginated, indexed queries (`limit`, `startAfter`, indexed `uid` / prefix search) and a global system policy document (`systemPolicies/global`) paired with per-user restriction flags (`isRestricted`, `uploadDisabled`) enforced both in the UI and backend/security rules.
  - *Why*: Prevents full-collection scans so the architecture scales cleanly to billions of records while giving the admin immediate enforcement power over user access and uploads.
- **Decision 3 — Synchronized Lockfile & Cloudflare SPA Output**
  - *Chosen Approach*: Sync `package.json` and `package-lock.json` via a clean install and include SPA routing configuration (`public/_redirects`) so `npm ci` on Cloudflare Pages succeeds on every commit.
  - *Why*: Directly fixes the `EUSAGE` lockfile mismatch error shown in your Cloudflare deployment log.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     Clean Minimal White Workspace Shell                    │
│  ┌──────────────────┐  ┌────────────────────────────────────────────────┐  │
│  │ Compact Sidebar  │  │ Fluid Viewport Canvas (Any Screen Size)        │  │
│  │ • My Files       │  │ ┌────────────────────────────────────────────┐ │  │
│  │ • Media Gallery  │  │ │ Explorer + Desktop Lasso Drag Selector     │ │  │
│  │ • Shared Links   │  │ │ • Pointer-down/move bounding box intersection│ │  │
│  │ • Storage Plans  │  │ │ • Mobile touch-drag + Save to Offline menu │ │  │
│  │ • Admin Console  │  │ └────────────────────────────────────────────┘ │  │
│  │ ──────────────── │  │ ┌────────────────────────────────────────────┐ │  │
│  │ [🗑 Trash Icon]  │  │ │ Universal Preview & Adaptive Player        │ │  │
│  └──────────────────┘  │ │ • Auto speed sensor <-> 1080p(Orig)/720/480│ │  │
│                        │ │ • Video/Audio/Image/PDF/CSV/Office/Code    │ │  │
│                        │ └────────────────────────────────────────────┘ │  │
│                        │ ┌────────────────────────────────────────────┐ │  │
│                        │ │ Scale-Ready Admin Governance Panel         │ │  │
│                        │ │ • User ID / Email / Name Search Bar        │ │  │
│                        │ │ • Global & Per-User Upload Kill-Switch     │ │  │
│                        │ │ • User Data Restriction / Suspension Toggle│ │  │
│                        │ └────────────────────────────────────────────┘ │  │
│                        └────────────────────────────────────────────────┘  │
└───────────────────────────────────────┬────────────────────────────────────┘
                                        │
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│        Indexed Firestore Metadata + Main Account Telegram MTProto          │
│  • Paginated/Indexed User & File Queries (No Unbounded Scans)              │
│  • Global System Policy (Uploads On/Off) & Per-User Restriction Enforcement│
│  • Unthrottled Direct Share Streaming & Lossless 2 GB MTProto Chunks       │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - **User Profile Governance Fields**: Extends user records with `isRestricted: boolean` (blocks data access/downloads when restricted by admin) and `uploadDisabled: boolean` (blocks file uploads for that specific user).
  - **Global System Policy**: Stores `globalUploadsEnabled: boolean` and `maintenanceMessage?: string` so the admin can pause or resume all file uploads platform-wide with one click.
  - **Lasso Selection State**: Tracks `lassoStart`, `lassoCurrent`, and `isLassoActive` pointer coordinates relative to the Explorer container, computing bounding-box intersections (`getBoundingClientRect`) against `[data-select-file-id]` cards in real time.
- **Interactive Component & State Mapping**:
  - **Desktop Lasso Overlay**: Dragging on empty Explorer space renders a selection box and updates `selectedFileIds`; holding `Shift`/`Ctrl` appends to existing selection.
  - **Adaptive Stream Controller**: Measures chunk download throughput and `navigator.connection.downlink` to automatically select `1080p` (lossless original), `720p`, or `480p` when in automatic mode, or locks to the user's chosen resolution override while preserving the current playback timestamp.
  - **Admin User Search & Controls**: Searches by exact User ID, email, or name filter and provides instant toggle buttons for **Restrict User Data**, **Disable User Upload**, and **Global Upload Master Switch**.
