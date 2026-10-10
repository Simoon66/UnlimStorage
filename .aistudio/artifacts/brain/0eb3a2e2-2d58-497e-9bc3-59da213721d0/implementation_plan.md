# UnlimCloud — Public Cloud Storage Platform, Firebase Auth & Token Pricing Plan

This update transforms **UnlimCloud** into a public-facing, white-label cloud storage platform with **Firebase Google Authentication**, strict per-user data privacy, live upload progress bars, rich file previews, delete confirmations, and a **Token-Based Storage Pricing & Subscription System** (`25 GB Free`, `50 GB` for `500 Tokens/mo`, `1 TB` for `1024 Tokens/mo`, and promo code **`1tBfri26`** for **`9,999 Tokens`**).

---

## 1. White-Label Privacy & Security Architecture

### Zero Telegram Mention for Public Users
- **White-Label Branding**: All user-facing screens, file cards, share portals, and previews display **UnlimCloud Encrypted Vault** with zero mention of Telegram.
- **Admin-Only Storage Node Config**: The backend storage configuration tab (`Storage Node Admin`) is hidden from regular users and is only visible when signed in with the administrator email (`titumamma2425@gmail.com`).

### Firebase Google Sign-In & Per-User Data Isolation
- **Google Sign-In (`signInWithPopup`)**: Users sign in with one click using their Google account via Firebase Authentication.
- **Strict Per-User Isolation (`firestore.rules` + Server Guards)**:
  - Each user's files, folders, shared links, token wallet, and subscription state are scoped to their authenticated `uid`.
  - Users can never list, view, or modify another user's files or folders.
  - Public direct download links (`/?share=<token>`) remain accessible to recipients (with optional password verification).

---

## 2. Token Wallet, Pricing Page & 3-Month Grace Period Engine

### Storage Plans (Monthly Subscriptions)
| Plan | Storage Quota | Monthly Cost | Key Rules |
| :--- | :--- | :--- | :--- |
| **Free Starter** | **25 GB** | **0 Tokens / month** | Default plan for every user |
| **Pro 50 GB** | **50 GB** | **500 Tokens / month** | Instant upgrade or renewal using wallet tokens |
| **Ultra 1 TB** | **1 TB (1,024 GB)** | **1,024 Tokens / month** | High-capacity vault with priority speed |

### Token Checkout (BDT & USD) + Promo Code `1tBfri26`
- **Buy Tokens Modal**: Users can purchase token packs via simulated checkout supporting **bKash**, **Nagad**, **BDT Card**, and **USD Card** (`500 Tokens`, `1,200 Tokens`, `5,000 Tokens`).
- **Promo Code Input (`1tBfri26`)**:
  - Entering **`1tBfri26`** in the Promo Code box immediately credits **`9,999 Tokens`** to the user's wallet and logs the redemption so they can subscribe to or extend the `50 GB` or `1 TB` plans right away.

### Monthly Expiry & 3-Month (90-Day) Over-Quota Lock Rule
- **Cumulative File Allocation**: A user's files (ordered oldest-to-newest) up to `25 GB` are always covered by the Free tier.
- **When a Paid Plan Expires**:
  1. **Within 3 Months (90-Day Grace Period)**: No data is deleted. All files within the first `25 GB` remain completely accessible. Any files exceeding `25 GB` are marked **"Locked — Over 25 GB Limit (Renew Plan within X days)"** and cannot be downloaded or shared until the user renews their plan.
  2. **After 3 Months (90 Days Unrenewed)**: If the plan is not extended within 90 days after expiry, the locked files exceeding the `25 GB` limit are automatically removed.
  3. **Interactive Quota Simulator**: Includes a quick **"Simulate Plan Expiry (>25 GB Lock)"** test control on the Pricing & Plans view so you can immediately preview how files above `25 GB` lock during the 3-month grace period.

---

## 3. Live File Upload Progress Bar, File Previews & Delete Confirmation

### Real-Time Upload Progress Bar
- **Live Percentage & Speed Tracker**: Uses `XMLHttpRequest` upload progress events (`upload.onprogress`) combined with backend chunk streaming to display a real-time progress bar (`0%` → `100%`), bytes uploaded (`e.g., 14.2 MB / 42.0 MB`), and transfer speed (`MB/s`) on both mobile and desktop.
- **Quota Enforcement**: Prevents new uploads if adding the file would exceed the user's active plan limit (`25 GB`, `50 GB`, or `1 TB`), prompting them to upgrade their plan with tokens.

### Multi-Format File Preview Modal
- **Images (`PNG`, `JPG`, `GIF`, `WEBP`, `SVG`)**: Crisp inline image viewer.
- **Video & Audio (`MP4`, `WEBM`, `MP3`, `WAV`, `OGG`)**: Built-in media player with playback controls.
- **Documents (`PDF`)**: Embedded PDF document viewer.
- **Code & Text (`TXT`, `MD`, `JSON`, `CSV`, `JS`, `TS`, `PY`, `HTML`, `CSS`)**: Formatted code/text reader with one-click copy and download.

### Delete Confirmation Dialog
- Clicking **Delete** on any file or folder opens a confirmation modal displaying the file/folder name, size, and a clear **Cancel** / **Confirm Permanent Delete** action to prevent accidental data loss.
