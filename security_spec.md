# UnlimCloud Firestore Security Specification (Phase 0 TDD & Red Team Audit)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false;`).
2. **Strict Tenant Isolation**:
   - A `UserProfile` document at `/userProfiles/{userId}` can only be read, created, or updated by the authenticated user whose `request.auth.uid == userId` (or a verified administrator).
   - A `CloudFileMeta` document at `/cloudFiles/{fileId}` can only be read, listed, created, updated, or deleted when `ownerId == request.auth.uid` (and for `create`, `exists(/databases/$(database)/documents/userProfiles/$(request.auth.uid))` must hold so no orphaned file metadata can be created without an initialized profile).
3. **Temporal & Identity Immutability**:
   - `createdAt` must equal `request.time` on `create` and remain immutable on `update`.
   - `updatedAt` must equal `request.time` on both `create` and `update`.
   - `uid`, `id`, and `ownerId` are strictly immutable on `update`.

## 2. The "Dirty Dozen" Payloads (All Must Return `PERMISSION_DENIED`)
1. **Unauthenticated Profile Read**: `auth = null`, `GET /userProfiles/usr_123` -> Denied by `isSignedIn()`.
2. **Cross-Tenant Profile Read (PII/Wallet Leak)**: `auth.uid = 'attacker'`, `GET /userProfiles/victim` -> Denied by `request.auth.uid == userId`.
3. **Shadow Field Injection on Profile Create**: `POST /userProfiles/usr_1` with `{ ..., isAdmin: true }` -> Denied by `data.keys().hasOnly(...)`.
4. **Unverified Email Spoofing**: `auth.token.email = 'titumamma2425@gmail.com'`, `email_verified = false` -> Denied by `request.auth.token.email_verified == true`.
5. **Negative Token Balance Injection**: `PATCH /userProfiles/usr_1` with `{ tokenBalance: -500 }` -> Denied by `data.tokenBalance >= 0 && data.tokenBalance <= 100000000`.
6. **Invalid Plan Enum Injection**: `PATCH /userProfiles/usr_1` with `{ planId: 'unlimited_free_hack' }` -> Denied by `data.planId in ['free_25gb', 'pro_50gb', 'ultra_1tb']`.
7. **Timestamp Forgery on Create**: `POST /userProfiles/usr_1` with `createdAt = Timestamp(2020, 1, 1)` -> Denied by `incoming().createdAt == request.time`.
8. **ID Poisoning Attack**: `POST /cloudFiles/a_1500_char_id...` -> Denied by `isValidId(fileId)`.
9. **Orphaned File Creation**: `POST /cloudFiles/file_1` when `/userProfiles/$(request.auth.uid)` does not exist -> Denied by `exists(/databases/$(database)/documents/userProfiles/$(request.auth.uid))`.
10. **Cross-User File Ownership Spoofing**: `auth.uid = 'attacker'`, `POST /cloudFiles/file_1` with `ownerId: 'victim'` -> Denied by `data.ownerId == request.auth.uid`.
11. **Unbounded String Resource Exhaustion**: `POST /cloudFiles/file_1` with `name` of 50,000 chars -> Denied by `data.name.size() <= 255`.
12. **Unauthorized Blanket List Scraping**: `auth.uid = 'attacker'`, `LIST /cloudFiles` without `where('ownerId', '==', 'attacker')` -> Denied by `resource.data.ownerId == request.auth.uid`.

## 3. Red Team Conflict Report
- **Identity Spoofing**: Blocked (`data.uid == request.auth.uid` and `data.ownerId == request.auth.uid`, plus immutability checks on update).
- **Shadow Update Test**: Blocked (`hasOnly()` enforced in both `isValidUserProfile`/`isValidCloudFileMeta` and `affectedKeys().hasOnly()` in every update branch).
- **Value Poisoning Test**: Blocked (`isValidUserProfile(incoming())` and `isValidCloudFileMeta(incoming())` wrap the entire `allow update` expression).
- **Query Trust Test**: Passed (`allow list` on `/cloudFiles/{fileId}` enforces `resource.data.ownerId == request.auth.uid || isAdmin()`).
