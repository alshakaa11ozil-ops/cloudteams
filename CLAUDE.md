# CLAUDE.md — CloudTeams Project Manifest
> **Primary context document for AI-assisted development.**
> Read this file before making any changes to the project.

---

## 1. Project Identity

**Project Name:** CloudTeams
**Type:** Graduation Project — Full-Stack Web Application
**University:** Zhejiang University of Science and Technology (ZUST)
**Duration:** 16 weeks (Solo)
**Expected Grade:** A- to A (85–95%)
**Defense Month:** May 2026
**Current Week:** 13
**Project Location:** `C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams`
**GitHub Repo:** https://github.com/alshakaa11ozil-ops/cloudteams
**IDE:** Cursor

### Mission
Build an AI-powered cloud storage platform for team collaboration that prevents file conflicts using soft file locking (lease model), real-time activity feeds, and Claude-powered weekly digests.

---

## 2. Tech Stack (CURRENT — DO NOT CHANGE)

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| State / Data | React Query |
| HTTP Client | Axios |
| Real-time | Socket.io |
| Backend | Node.js + Express + TypeScript |
| Auth | JWT (7-day tokens) + bcrypt |
| ORM | **Prisma 7** (NOT Sequelize — Sequelize is legacy/unused) |
| DB Adapter | **@prisma/adapter-pg** (required by Prisma 7) |
| File Uploads | Multer |
| Scheduled Jobs | node-cron |
| File Storage | Local disk (dev) → AWS S3 (prod) |
| Deploy Frontend | Vercel |
| Deploy Backend | Railway |

---

## 3. Database (CURRENT)

| Property | Value |
|---|---|
| Engine | PostgreSQL 18 (local) |
| Dev DB | `cloudteams_dev` |
| Test DB | `cloudteams_test` |
| ORM | Prisma 7 with @prisma/adapter-pg |
| Schema file | `backend/prisma/schema.prisma` |
| Migrations | `backend/prisma/migrations/` |
| Generated client | `backend/src/generated/prisma/` |

### ⚠️ CRITICAL — Prisma 7 Setup Rules
- NEVER use `new PrismaClient()` without the pg adapter
- ALWAYS import prisma from `src/config/database.ts` (singleton)
- NEVER create a second PrismaClient instance anywhere
- Run `npm run db:generate` after any schema change
- Run `npm run db:migrate` to apply schema changes

### Database Connection (src/config/database.ts)
```typescript
import { PrismaClient } from '../generated/prisma'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
export default prisma
```

---

## 4. Database Schema (9 Tables)

### Files Table — Lock Fields (LEASE MODEL — not boolean)
```
lockOwnerUserId   Int?      -- FK to users.id — who holds the lock
lockToken         String?   -- UUID given to lock owner — required for heartbeat/unlock
lockExpiresAt     DateTime? -- when lease expires — auto-release after this
editingStartedAt  DateTime? -- when editing started — UI display only
```

**⚠️ OLD FIELDS — DO NOT USE:**
```
is_being_edited   ← REMOVED
edited_by         ← REMOVED  
editing_started_at ← RENAMED to editingStartedAt (camelCase in Prisma)
```


## 5. Completed Milestones

### ✅ Week 1 — Environment Setup
- All tools installed, GitHub repo live, databases created

### ✅ Week 2 — Server + Database Foundation  
- Express server running on port 3001
- Prisma 7 connected with pg adapter
- 9 tables created via migrations
- Health check endpoint working: `GET /api/health`
- Lock lease model in place (lockToken, lockExpiresAt, lockOwnerUserId)

---
# Project Guide: File Management System (Week 5)

## 🛠 Tech Stack & Environment
- **Runtime:** Node.js / Express (Port 3001)
- **Database:** PostgreSQL via Prisma ORM
- **Uploads:** Multer (Local Storage in `/uploads`)
- **Deduplication:** SHA-256 Hashing via `crypto` module


## 📝 Critical Coding Rules (MUST FOLLOW)
1. **Naming Convention:** Use **snake_case** for all Prisma model fields to match the schema (e.g., `original_name`, `storage_path`, `is_deleted`).
2. **Soft Deletes ONLY:** Never use `fs.unlink` to delete files from the `/uploads` folder. Set `is_deleted = true` and `deleted_at = now()`.
3. **Deduplication Logic:** - Calculate SHA-256 hash of every upload.
   - If hash exists in DB: Create a new record using the *existing* `storage_path`.
   - If hash is unique: Save file to `/uploads/[hash]` and create record.
4. **Error Handling:** Always wrap database and file system operations in `try/catch` blocks.

## 🗄 Prisma Schema Reference (File Model)
- `id`: Int (Auto-increment)
- `team_id`: Int
- `filename`: String (Display name)
- `original_name`: String (Original user filename)
- `file_size`: Int (Bytes)
- `mime_type`: String (e.g., 'application/pdf')
- `storage_path`: String (Path to physical file)
- `hash`: String? (SHA-256)
- `uploaded_by`: Int (User ID)
- `is_deleted`: Boolean (Default: false)
- `deleted_at`: DateTime?

## 🚀 API Endpoints to Implement
- `POST /api/files/upload`: Handle upload, hashing, and deduplication.
- `GET /api/teams/:id/files`: Return list where `is_deleted: false`.
- `GET /api/files/:id`: Return metadata for a single file.
- `GET /api/files/:id/download`: Use `res.download()` with `storage_path` and `original_name`.
- `DELETE /api/files/:id`: Perform soft delete.

## 🛠 Useful Commands
- `npm run dev`: Start the server
- `npx prisma generate`: Update Prisma client
- `npx prisma studio`: View database records

## 6. Current Structure (backend/src/)
```

## COMPLETED WEEKS (Updated)

  All 7 tests passed. Uses speakeasy + qrcode libraries.
  * Week 6: Folder management, file browsing, and search
  - POST /api/folders — create nested folders (parent_folder_id support)
  - GET /api/teams/:id/folders — list all folders with computed breadcrumbs
  - PATCH /api/folders/:id — rename folder
  - DELETE /api/folders/:id — soft delete with 3 modes:
      ?recursive=false (default) — protect mode, refuses if files exist, returns 409 with file count
      ?recursive=files — orphan mode, moves files to root then deletes folder
      ?recursive=true — full recursive, soft-deletes folder AND all files inside
  - PATCH /api/files/:id — move file to different folder (or root with folderId=null)
  - GET /api/teams/:id/files?folderId= — list files, filterable by folder
  - GET /api/search?query=&teamId=&type=&since= — search files + folders by name, ILIKE, parallel Promise.all queries
  - assertTeamMember utility — centralized membership + role checking (DRY pattern)
  - activityLogger utility — created but deferred, to be researched and implemented properly later
  - Folder schema migration — added is_deleted (Boolean) and deleted_at (DateTime?) to folders table
  ## COMPLETED WEEKS

* Week 1: GitHub repo, tools installed, databases created
* Week 2: Express server, PostgreSQL connected, Prisma 7 with pg adapter,
  9 tables + announcements table created via migrations, health check endpoint
* Week 3: Full JWT authentication — register, login, getMe, auth middleware,
  bcrypt password hashing, rate limiting on auth routes
* Week 4: Team Workspaces, Role-Based Permissions (viewer/editor/admin),
  Team Announcements feature, requireRole middleware, all tested in Postman
* Week 5: File Storage — upload, download, list, get metadata, soft delete,
  SHA-256 deduplication (7/7 Postman tests passed)
* 2FA (bonus): TOTP-based two-factor authentication — setup, QR code generation,
  verify-setup, 2FA login challenge (tempToken pattern), disable.
  All 7 tests passed. Uses speakeasy + qrcode libraries.
* Week 6: Folder management, file browsing, and search
  - POST /api/folders — create nested folders (parent_folder_id support)
  - GET /api/teams/:id/folders — list all folders with computed breadcrumbs
  - PATCH /api/folders/:id — rename folder
  - DELETE /api/folders/:id — soft delete with 3 modes (protect/orphan/recursive)
  - PATCH /api/files/:id — move file to different folder
  - GET /api/teams/:id/files?folderId= — list files, filterable by folder
  - GET /api/search?query=&teamId=&type=&since= — ILIKE search, parallel queries
* Week 7: Comments, File Version History, Recycle Bin
  - Comments: add, list, edit (dual-permission), soft delete
  - @Mentions: regex parser, team-member validation, @team/@all support,
    50-mention cap, fire-and-forget activity log, self-mention prevention
  - File Version History: createVersion snapshot helper, listVersions with
    batch user lookup, restoreVersion inside $transaction (atomic)
  - Recycle Bin: listDeletedFiles, restoreFile (parent folder safety check),
    listDeletedFolders, getDeletedFolderContents, restoreFolder (recursive
    tree restore in transaction), hardDeleteFile (dedup-safe disk unlink),
    hardDeleteFolder, emptyRecycleBin
  - Activity logging on version restore inside transaction
  

## COMPLETED WEEKS

* Week 8: Soft File Locking (Lease Model)
  - lock.service.ts: acquireLock (atomic updateMany), extendLease,
    releaseLock, getLockStatus, forceUnlock — all with audit logging
  - lock.controller.ts: 5 handlers, assertTeamMember inside try/catch,
    err.statusCode pattern for AppError forwarding
  - lock.routes.ts: mergeParams: true, NO requireRole middleware
    (assertTeamMember handles role checks internally)
  - socket.ts: Socket.io singleton, initSocket(httpServer), getIO(),
    emitToTeam(teamId, event, payload) helper
  - cron.ts: startCronJobs(), expireStaleLeases() every 30 minutes,
    broadcasts file.lockExpired, writes lock_expired audit log
  - server.ts: http.createServer → initSocket → startCronJobs → listen
    lockRoutes mounted BEFORE teamRoutes (specific before general)
  - activityLogger.ts: strict ActivityAction union type, safe JSON
    metadata, Object.setPrototypeOf fix in AppError
  - logActivity added to: file.service (upload, delete, move),
    folder.service (create, rename, delete), comment.service (add)
  - Key fix: requireRole reads req.params.id — lock routes use
    req.params.teamId — never mix these two middlewares
## COMPLETED WEEKS



## COMPLETED WEEKS

* Week 1: GitHub repo, tools installed, databases created
* Week 2: Express server, PostgreSQL connected, Prisma 7 with pg adapter,
  9 tables + announcements table created via migrations, health check endpoint
* Week 3: Full JWT authentication — register, login, getMe, auth middleware,
  bcrypt password hashing, rate limiting on auth routes
* Week 4: Team Workspaces, Role-Based Permissions (viewer/editor/admin),
  Team Announcements feature, requireRole middleware, all tested in Postman
* Week 5: File Storage — upload, download, list, get metadata, soft delete,
  SHA-256 deduplication (7/7 Postman tests passed)
* 2FA (bonus): TOTP-based two-factor authentication — setup, QR code generation,
  verify-setup, 2FA login challenge (tempToken pattern), disable.
* Week 6: Folder management, file browsing, and search
* Week 7: Comments, @Mentions, File Version History, Recycle Bin
* Week 8: Soft File Locking (Lease Model) — atomic acquire, heartbeat,
  releaseLock, forceUnlock, Socket.io real-time events, cron auto-expire
* Week 9: Activity Feed (paginated, filterable) + Team Analytics Dashboard
* Week 10: Logout with JWT token blacklist + Shared Links (file + team share,
  password protection, expiry, download limits, atomic increment)

## FRONTEND STACK (Week 11+)
* Framework: React 18 + Vite + TypeScript
* Styling: Tailwind CSS
* Routing: React Router v6
* HTTP: Axios with JWT interceptor
* State: React Context API (auth) + React Query (server state)
* Real-time: Socket.io-client
* Charts: recharts (Week 13)
* Frontend runs on: http://localhost:5173
* Backend runs on: http://localhost:3001
- **Week 12:** File Browser UI — FileBrowser (two-panel, URL-driven navigation), FolderTree (recursive adjacency-list tree), FileList (grid with per-card lock status), FileUploadZone (drag-drop + progress), LockBanner, CreateFolderModal, MoveModal (circular-move prevention), DeleteFolderDialog (three-mode delete), useLockManager hook (acquire → heartbeat → cleanup release), all API functions in files.ts

---

## This Week: Week 13 — Collaboration UI + Document Preview

### Goals
- File detail sidebar: comments thread, @mentions, version history, lock status
- Activity feed page with filters
- Team analytics dashboard with recharts
- Recycle bin page
- Announcements UI on team dashboard
- Document preview endpoint (backend) + inline preview panel (frontend)

### Build Order
1. Backend: 5 missing activity log calls (rename, delete, restore, folder CRUD)
2. Backend: GET /api/files/:id/preview endpoint (mammoth for DOCX, pdf inline, image inline)
3. Frontend: FileDetailSidebar.tsx — tabs: Preview / Comments / Versions / Lock
4. Frontend: ActivityFeed.tsx page
5. Frontend: AnalyticsDashboard.tsx page
6. Frontend: RecycleBin.tsx page
7. Frontend: Wire announcements into TeamDashboard
8. Wire new routes into App.tsx

---
 Backend: Current File Structure
src/
config/
database.ts              ✅ Prisma client singleton
multer.ts                ✅ disk storage, 50MB limit
prisma.ts                ✅
controllers/
auth.controller.ts       ✅
teamController.ts        ✅
announcementController.ts ✅
file.controller.ts       ✅ (needs rename + delete activity logging)
twoFactor.controller.ts  ✅
folderController.ts      ✅ (needs create + delete activity logging)
searchController.ts      ✅
comment.controller.ts    ✅
version.controller.ts    ✅ (needs restore activity logging)
recycleBin.controller.ts ✅ (needs restore activity logging)
lock.controller.ts       ✅
middleware/
auth.middleware.ts       ✅
requireRole.ts           ✅
routes/
auth.ts                  ✅
health.ts                ✅
teamRoutes.ts            ✅
announcementRoutes.ts    ✅
fileRoutes.ts            ✅
folderRoutes.ts          ✅
searchRoutes.ts          ✅
lock.routes.ts           ✅
services/
auth.service.ts          ✅
teamService.ts           ✅
announcementService.ts   ✅
file.service.ts          ✅
twoFactor.service.ts     ✅
folder.service.ts        ✅
search.service.ts        ✅
comment.service.ts       ✅
version.service.ts       ✅
recycleBin.service.ts    ✅
lock.service.ts          ✅
types/
express.d.ts             ✅
utils/
jwt.ts                   ✅
hash.ts                  ✅
teamGuard.ts             ✅
activityLogger.ts        ✅
server.ts                  ✅

---

## Frontend: Current File Structure
frontend/src/
api/
axios.ts                 ✅ Axios instance + JWT interceptor
files.ts                 ✅ All file/folder/lock/search API functions
context/
AuthContext.tsx           ✅
hooks/
useAuth.ts               ✅
useLockManager.ts        ✅ acquire → heartbeat → cleanup release
components/
ProtectedRoute.tsx       ✅
Layout.tsx               ✅
FolderTree.tsx           ✅ recursive adjacency-list tree
FileList.tsx             ✅ file grid with per-card lock status
FileUploadZone.tsx       ✅ drag-drop + progress bar
LockBanner.tsx           ✅ amber warning bar
CreateFolderModal.tsx    ✅
MoveModal.tsx            ✅ circular-move prevention
DeleteFolderDialog.tsx   ✅ three-mode delete
pages/
auth/
Login.tsx              ✅
Register.tsx           ✅
TwoFAChallenge.tsx     ✅
teams/
TeamList.tsx           ✅
CreateTeam.tsx         ✅
TeamDashboard.tsx      ✅ (needs announcements wired in Week 13)
FileBrowser.tsx          ✅ two-panel, URL-driven, search, move, delete
types/
index.ts                 ✅ CloudFile, Folder, FolderWithBreadcrumb,
LockStatus, LockAcquireResponse, UploadResult
App.tsx                    ✅
main.tsx                   ✅

## PATTERNS — FRONTEND
* All API calls go through src/api/axios.ts — never raw fetch()
* Token stored in localStorage under key 'cloudteams_token'
* On 401 response → interceptor clears token + redirects to /login
* useAuth() hook — reads from AuthContext, never access context directly
* React Query for all GET requests — handles caching + loading states
* Every page has: loading state, error state, empty state

## KNOWN FRONTEND RULES
* Never use (req as any) — TypeScript strict mode
* Always handle the requires2FA: true case in login flow
* ProtectedRoute checks localStorage for token — if missing, redirect to /login
* After login: save token to localStorage, update AuthContext, navigate to /teams
## KNOWN BUG PATTERNS — NEVER REPEAT
* requireRole reads req.params.id — sub-routers mounted as /:id/x inherit
  param name "id", NOT "teamId". Always use req.params.id in controllers
  mounted under teamRoutes.
* mergeParams: true inherits param VALUE and NAME from parent router.
* Lock routes use NO requireRole — assertTeamMember handles auth internally.
* More specific routes must be registered BEFORE general ones in server.ts.
* $queryRaw COUNT/SUM returns BigInt — always convert with toNumber() before
  res.json() or serialization throws at runtime.
* instanceof Date fails on unknown type — use new Date(String(value)) instead.


## NEW ENDPOINTS (Week 8)
  POST /:teamId/files/:fileId/lock
  POST /:teamId/files/:fileId/heartbeat
  POST /:teamId/files/:fileId/unlock
  GET  /:teamId/files/:fileId/lock-status
  POST /:teamId/files/:fileId/force-unlock

## PATTERNS ESTABLISHED (additions)
  * assertTeamMember always inside try/catch — never outside
  * err.statusCode pattern: if (err.statusCode) res.status(err.statusCode).json(...)
  * lockRoutes uses mergeParams: true and NO requireRole middleware
  * emitToTeam() after every lock state change — always fire-and-forget
  * void logActivity() after every successful DB write — never await
  * Lock token is NEVER returned in getLockStatus response
  * requireRole reads req.params.id — only use on teamRoutes with /:id


 
## CRITICAL SCHEMA RULES

FileVersion NOW has a Prisma relation to User:
  uploader User @relation("FileVersionUploader", ...)
  Use: include: { uploader: { select: { username, email } } } ✅


All field names (confirmed from schema.prisma):
* User: id, username, email, password_hash, two_factor_secret, created_at, updated_at
* Team: id, name, description, owner_id, created_at, updated_at
* TeamMember: id, team_id, user_id, role, created_at
* Folder: id, team_id, parent_folder_id, name, created_by, is_deleted,
  deleted_at, created_at, updated_at
* File: id, team_id, folder_id, filename, original_name, file_size, mime_type,
  storage_path, hash, uploaded_by, is_deleted, deleted_at, created_at, updated_at,
  lockOwnerUserId, lockToken, lockExpiresAt, editingStartedAt
* FileVersion: id, file_id, version_number, storage_path, file_size,
  uploaded_by, created_at
* Comment: id, file_id, team_id, user_id, content, resolved, is_deleted,
  deleted_at, created_at, updated_at
* ActivityLog: id, team_id, user_id, action, target_type, target_id,
  metadata, ip, userAgent, created_at
* SharedLink: id, file_id, created_by, token, password_hash, expiration_date,
  download_limit, downloads_count, created_at
* Announcement: id, teamId, authorId, title, body, isPinned, createdAt, updatedAt


## API ENDPOINTS (current total: 45+)

Auth:     POST /register, /login, /logout, /refresh, GET /me
2FA:      POST /2fa/setup, /2fa/verify-setup, /2fa/login, /2fa/disable
Teams:    POST, GET, GET/:id, PATCH/:id, DELETE/:id, POST/:id/invite
Members:  GET/:id/members, PATCH/:id/members/:userId, DELETE/:id/members/:userId
Files:    POST /upload, GET team files, GET/:id, GET/:id/download,
          DELETE/:id, PATCH/:id
Folders:  POST, GET, PATCH/:id, DELETE/:id, GET /search
Comments: POST /:teamId/files/:fileId/comments
          GET  /:teamId/files/:fileId/comments
          PATCH /:teamId/comments/:commentId
          DELETE /:teamId/comments/:commentId
Versions: GET  /:teamId/files/:fileId/versions
          POST /:teamId/files/:fileId/versions/:version/restore
RecycleBin: GET  /:teamId/recycle-bin
            POST /:teamId/recycle-bin/files/:fileId/restore
            GET  /:teamId/recycle-bin/folders
            GET  /:teamId/recycle-bin/folders/:folderId/contents
            POST /:teamId/recycle-bin/folders/:folderId/restore
            DELETE /:teamId/recycle-bin/empty
            DELETE /:teamId/recycle-bin/files/:fileId
            DELETE /:teamId/recycle-bin/folders/:folderId

## PATTERNS ESTABLISHED (never break these)

* routes/ → controllers/ → services/ → prisma
* Controllers: thin — read req, call service, send res
* Services: all business logic, throw typed AppError or custom errors
* assertTeamMember(userId, teamId, minimumRole?) — RETURNS TeamMember object
* void logActivity(...) — fire and forget, never await
* prisma.$transaction(async tx => { ... }) for multi-step atomic operations
* req.user!.userId — never (req as any).user.userId
* Always parseInt(param, 10) for all route params
* Always return after every res.json() inside if blocks

## NEW FILES ADDED (Week 5 + 2FA)

src/
  config/
    multer.ts              ✅ disk storage, 50MB limit, blocked MIME types
  utils/
    hash.ts                ✅ SHA-256 streaming file hash utility
  services/
    file.service.ts        ✅ upload, dedup, list, get, download, soft delete
    twoFactor.service.ts   ✅ generateSetupData, verifySetupAndEnable,
                              completeTwoFactorLogin, disableTwoFactor,
                              issueTempToken
  controllers/
    file.controller.ts     ✅ 5 file endpoint handlers
    twoFactor.controller.ts ✅ 4 2FA endpoint handlers
  routes/
    fileRoutes.ts          ✅ file routes
    auth.ts                ✅ MODIFIED — added 4 2FA routes

## MODIFIED FILES (Week 5 + 2FA)

  src/services/auth.service.ts   ✅ loginUser now checks two_factor_secret,
                                    returns tempToken when 2FA enabled
  src/controllers/auth.controller.ts ✅ login handler now spreads result
                                        instead of hardcoding token/user
  src/utils/jwt.ts               ✅ signToken accepts optional expiresIn param,
                                    verifyToken exported

## NEW SCHEMA FIELDS

  users table:
    two_factor_secret  String?   — null = 2FA disabled, base32 secret = enabled

  files table:
    All fields as per original schema plus lease lock fields (Week 14)

## IMPORTANT PATTERNS LEARNED

* multipart/form-data sends ALL fields as strings — always parseInt() body fields
* authenticate middleware must run BEFORE multer on upload routes
* Every res.json() inside an if block must be followed by return
* Spread result in controller (...result) instead of hardcoding fields —
  handles multiple return shapes cleanly
* tempToken pattern: short-lived JWT with purpose: "2fa_challenge" —
  cannot be used to access protected routes

## API ENDPOINTS (Updated count: 35+)

  POST   /api/files/upload              upload a file (editor/admin only)
  GET    /api/files/teams/:id/files     list team files
  GET    /api/files/:id                 get file metadata
  GET    /api/files/:id/download        download file
  DELETE /api/files/:id                 soft delete

  POST   /api/auth/2fa/setup            generate secret + QR code
  POST   /api/auth/2fa/verify-setup     confirm scan + enable 2FA
  POST   /api/auth/2fa/login            complete login with 6-digit code
  POST   /api/auth/2fa/disable          disable 2FA (requires valid code)
---

## 7. API Endpoints

### Backend runs on: `http://localhost:3001`
```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

POST   /api/teams
GET    /api/teams/:id
POST   /api/teams/:id/invite

POST   /api/files/upload
GET    /api/files/:id/download
DELETE /api/files/:id
POST   /api/files/:id/lock
POST   /api/files/:id/unlock
POST   /api/files/:id/heartbeat
GET    /api/files/:id/lock-status
POST   /api/files/:id/force-unlock

POST   /api/folders
GET    /api/teams/:id/folders
GET    /api/search

POST   /api/files/:id/comments
GET    /api/files/:id/comments

GET    /api/files/:id/versions
POST   /api/files/:id/versions/:version/restore

POST   /api/files/:id/share
GET    /api/share/:token

GET    /api/recycle-bin
POST   /api/files/:id/restore

GET    /api/teams/:id/activity
GET    /api/teams/:id/analytics
```

---

## 8. npm Scripts
```bash
npm run dev          # start server with nodemon
npm run build        # compile TypeScript
npm run start        # run compiled JS
npm run db:generate  # npx prisma generate
npm run db:migrate   # npx prisma migrate dev
npm run db:studio    # npx prisma studio
npm run db:reset     # npx prisma migrate reset
```

---

## 9. Feature Tracker

| # | Feature | Week | Status |
|---|---|---|---|
| 1 | User Authentication (JWT) | 3–4 | ✅ Complete |
| 2 | Two-Factor Auth (2FA) | 3–4 | ✅ Complete |
| 3 | Team Workspaces | 5–6 | ✅ Complete |
| 4 | Cloud File Storage | 7–9 | ✅ Complete |
| 5 | Smart Deduplication | 7–9 | ✅ Complete |
| 6 | Folder Organization | 10–11 | ✅ Complete |
| 7 | Team Search | 10–11 | ✅ Complete |
| 8 | Soft File Locking ⭐ | 14 | ✅ Complete |
| 9 | Comments & @Mentions | 12 | ✅ Complete |
| 10 | Activity Feed | 13 | ✅ Complete |
| 11 | AI Activity Digest | 15 | 🔲 Not Started |
| 12 | Team Analytics | 13 | ✅ Complete |
| 13 | Shared Links | 10–11 | ✅ Complete |
| 14 | Recycle Bin | 12–13 | ✅ Complete |
| 15 | File Version History | 12–13 | ✅ Complete |
| 16 | Multi-user Permissions | 5–6 | ✅ Complete |
| 17 | File Encryption & HTTPS | 5–6 | 🔨 In Progress |
| 18 | Document Preview | 13 | 🔲 Not Started |
| 19 | Online Document Editing | 15 | 🔲 Not Started |
| 20 | Multi-device Auto-Sync | 15 | 🔲 Not Started |

---

## PROJECT GUIDELINES (MANDATORY)

Every function must have:
```typescript
// PURPOSE: what this does
// INPUTS: what it takes
// OUTPUTS: what it returns
// WHY THIS APPROACH: why this over alternatives
```

Every non-obvious line must have an inline comment explaining the WHY.

---

