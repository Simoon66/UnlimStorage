# UnlimStorage Firestore Security Specification (Phase 0 TDD & Red Team Audit)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false;`).
2. **Strict Tenant Isolation**:
   - A `UserProfile` document at `/userProfiles/{userId}` can only be read, created, or updated by the authenticated user whose `request.auth.uid == userId` (or a verified administrator). New registration is closed (`allow create: if isAdmin()`).
   - A `CloudFileMeta` document at `/cloudFiles/{fileId}` can only be read, listed, created, updated, or deleted when `ownerId == request.auth.uid` (and for `create`, `exists(/databases/$(database)/documents/userProfiles/$(request.auth.uid))` must hold).
   - A `PublicShareDoc` document at `/publicShares/{shareToken}` can be retrieved by single-document `get` using a valid capability token (`isValidId(shareToken)`) so unauthenticated recipients can open shared links across devices, while `list` is restricted to `isSignedIn() && (resource.data.creatorId == request.auth.uid || isAdmin())` and writes (`create`, `update`, `delete`) are strictly restricted to the verified owner (`creatorId == request.auth.uid`) or `isAdmin()`.
   - A `PublicShareChunk` document at `/publicShareChunks/{chunkId}` supports capability `get` (`isValidId(chunkId)`), forbids `list` (`allow list: if false;`), and restricts `create`/`update`/`delete` to the verified owner (`ownerId == request.auth.uid`) or `isAdmin()`.
3. **Temporal & Identity Immutability**:
   - `createdAt` must equal `request.time` on `create` and remain immutable on `update`.
   - `updatedAt` must equal `request.time` on both `create` and `update`.
   - `uid`, `id`, `ownerId`, `creatorId`, and `token` are strictly immutable on `update`.

## 2. The "Dirty Dozen" Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Profile Read**: `auth = null`, `GET /userProfiles/usr_123` -> Denied by `isSignedIn()`.
2. **Cross-Tenant Profile Read (PII/Wallet Leak)**: `auth.uid = 'attacker'`, `GET /userProfiles/victim` -> Denied by `request.auth.uid == userId`.
3. **Shadow Field Injection on Profile Create**: `POST /userProfiles/usr_1` with `{ ..., isAdmin: true }` -> Denied by `data.keys().hasOnly(...)`.
4. **Unverified Email Spoofing**: `auth.token.email = 'titumamma2425@gmail.com'`, `email_verified = false` -> Denied by `request.auth.token.email_verified == true`.
5. **Negative Token Balance Injection**: `PATCH /userProfiles/usr_1` with `{ tokenBalance: -500 }` -> Denied by `data.tokenBalance >= 0 && data.tokenBalance <= 100000000`.
6. **Invalid Plan Enum Injection**: `PATCH /userProfiles/usr_1` with `{ planId: 'unlimited_free_hack' }` -> Denied by `data.planId in ['free_25gb', 'pro_50gb', 'ultra_1tb', 'unlimited_admin']`.
7. **Timestamp Forgery on Create**: `POST /userProfiles/usr_1` with `createdAt = Timestamp(2020, 1, 1)` -> Denied by `incoming().createdAt == request.time`.
8. **ID Poisoning Attack**: `POST /cloudFiles/a_1500_char_id...` -> Denied by `isValidId(fileId)`.
9. **Orphaned File Creation**: `POST /cloudFiles/file_1` when `/userProfiles/$(request.auth.uid)` does not exist -> Denied by `exists(/databases/$(database)/documents/userProfiles/$(request.auth.uid))`.
10. **Cross-User Share Ownership Spoofing**: `auth.uid = 'attacker'`, `POST /publicShares/dl-7c5smd` with `creatorId: 'victim'` -> Denied by `data.creatorId == request.auth.uid`.
11. **Unbounded String Resource Exhaustion**: `POST /cloudFiles/file_1` with `name` of 50,000 chars -> Denied by `data.name.size() <= 255`.
12. **Unauthorized Blanket List Scraping on Public Shares**: `auth = null`, `LIST /publicShares` -> Denied by `isSignedIn() && (resource.data.creatorId == request.auth.uid || isAdmin())`.

## 3. Red Team Conflict Report
- **Identity Spoofing**: Blocked (`data.uid == request.auth.uid`, `data.ownerId == request.auth.uid`, `data.creatorId == request.auth.uid`, plus immutability checks on update).
- **Shadow Update Test**: Blocked (`hasOnly()` enforced in all validation helpers and `affectedKeys().hasOnly()` in every update branch).
- **Value Poisoning Test**: Blocked (`isValid[Entity](incoming())` wraps the entire `allow update` expression for every collection).
- **Query Trust Test**: Passed (`allow list` on `/cloudFiles`, `/cloudFolders`, and `/publicShares` enforces `resource.data.ownerId == request.auth.uid` or `resource.data.creatorId == request.auth.uid`).
