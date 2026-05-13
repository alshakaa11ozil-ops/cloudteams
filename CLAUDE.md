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
**Current Week:** Week 3 (Weeks 1–2 ✅ Complete)
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
src/
  config/
    database.ts        ✅ Prisma client singleton
    prisma.ts          ✅
  controllers/
    auth.controller.ts ✅
    teamController.ts  ✅
    announcementController.ts ✅
  middleware/
    auth.middleware.ts ✅ (exports: authenticate)
    requireRole.ts     ✅ (exports: requireRole factory function)
  routes/
    auth.ts            ✅
    health.ts          ✅
    teamRoutes.ts      ✅
    announcementRoutes.ts ✅
  services/
    auth.service.ts    ✅
    teamService.ts     ✅
    announcementService.ts ✅
  types/
    express.d.ts       ✅ (extends Request with user?: JwtPayload, userRole?: string)
  utils/
    jwt.ts             ✅ (JwtPayload = { userId: number, email: string })
  server.ts            ✅
## COMPLETED WEEKS (Updated)

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
| 1 | User Authentication (JWT) | 3–4 | 🔨 In Progress |
| 2 | Two-Factor Auth (2FA) | 3–4 | 🔲 Not Started |
| 3 | Team Workspaces | 5–6 | 🔲 Not Started |
| 4 | Cloud File Storage | 7–9 | 🔲 Not Started |
| 5 | Smart Deduplication | 7–9 | 🔲 Not Started |
| 6 | Folder Organization | 10–11 | 🔲 Not Started |
| 7 | Team Search | 10–11 | 🔲 Not Started |
| 8 | Soft File Locking ⭐ | 14 | 🔲 Not Started |
| 9 | Comments & @Mentions | 12 | 🔲 Not Started |
| 10 | Activity Feed | 13 | 🔲 Not Started |
| 11 | AI Activity Digest | 15 | 🔲 Not Started |
| 12 | Team Analytics | 13 | 🔲 Not Started |
| 13 | Shared Links | 10–11 | 🔲 Not Started |
| 14 | Recycle Bin | 12–13 | 🔲 Not Started |
| 15 | File Version History | 12–13 | 🔲 Not Started |
| 16 | Multi-user Permissions | 5–6 | 🔲 Not Started |
| 17 | File Encryption & HTTPS | 5–6 | 🔲 Not Started |
| 18 | Document Preview | 13 | 🔲 Not Started |
| 19 | Online Document Editing | 15 | 🔲 Not Started |
| 20 | Multi-device Auto-Sync | 15 | 🔲 Not Started |

---

## 10. Commenting Rules (MANDATORY)

Every function must have:
```typescript
// PURPOSE: what this does
// INPUTS: what it takes
// OUTPUTS: what it returns
// WHY THIS APPROACH: why this over alternatives
```

Every non-obvious line must have an inline comment explaining the WHY.

---
# CLOUDTEAMS — PROJECT CONTEXT FOR CLAUDE

## Project Identity
**Project:** CloudTeams — AI-powered team cloud storage platform
**University:** Zhejiang University of Science and Technology
**Type:** Graduation Project (Solo, 16 weeks)
**Stack:** React 18 + Vite + TypeScript + Tailwind / Node.js + Express + TypeScript + PostgreSQL + Prisma 7

---

## Completed Weeks
- **Week 1:** GitHub repo, tools installed, databases created
- **Week 2:** Express server, PostgreSQL connected, Prisma 7 with pg adapter, 9 tables + announcements via migrations, health check endpoint
- **Week 3:** Full JWT authentication — register, login, getMe, auth middleware, bcrypt, rate limiting
- **Week 4:** Team Workspaces, Role-Based Permissions (viewer/editor/admin), Announcements feature, requireRole middleware
- **Week 5:** File Storage — upload, download, list, get metadata, soft delete, SHA-256 deduplication
- **Week 5 bonus:** TOTP-based 2FA — setup, QR code, verify-setup, login challenge (tempToken pattern), disable
- **Week 6:** Folder management, file browsing by folder, search (ILIKE, parallel queries)
- **Week 7:** Comments + @Mentions, File Version History, Recycle Bin (soft + hard delete)
- **Week 8:** Soft File Locking (Lease Model) — atomic acquire, heartbeat, releaseLock, forceUnlock, Socket.io real-time events, cron auto-expire
- **Week 9:** Activity Feed (paginated, filterable) + Team Analytics Dashboard
- **Week 10:** Logout with JWT blacklist + Shared Links (file + team share, password, expiry, download limits)
- **Week 11:** Frontend foundation — Vite + React + TypeScript + Tailwind, React Router, Axios JWT interceptor, AuthContext, ProtectedRoute, Layout, Login, Register, TwoFA, TeamList, CreateTeam, TeamDashboard shell
- **Week 12:** File Browser UI — FileBrowser (two-panel, URL-driven navigation), FolderTree (recursive adjacency-list tree), FileList (grid with per-card lock status), FileUploadZone (drag-drop + progress), LockBanner, CreateFolderModal, MoveModal (circular-move prevention), DeleteFolderDialog (three-mode delete), useLockManager hook (acquire → heartbeat → cleanup release), all API functions in files.ts
- **Week 13:** Collaboration UI — FileDetailSidebar (Preview/Comments/Versions/Lock/Sharing tabs), ActivityFeed page, AnalyticsDashboard (recharts), RecycleBin page, Announcements UI (AnnouncementCard, AnnouncementModal, wired in TeamDashboard), Document preview endpoint (mammoth DOCX→HTML, PDF inline, image inline)
- **Week 14 (Part 1 — original):** Share Links + AI Features + Team Admin + Real-time
  - ShareLinkModal + PublicSharePage + publicAxios (no-JWT instance)
  - Gemini/agentrouter AI: digest (6h cache), file summary (24h cache), duplicate explain (30min cache)
  - AI cache table (ai_cache) with per-feature cooldown system
  - Team Settings: rename, member role management, danger zone delete
  - User Settings: username update, password change
  - Socket.io expansion: socketEvents.ts constants, useTeamSocket hook in Layout
  - emitToTeam in all services: file, folder, recycle, team, share, announcement
  - Toast notifications across all mutations
  - AES-256-GCM file encryption (fileEncryption.ts, encryption_iv field on File)
- **Week 14 (Part 2 — collaborative editor):** Full real-time collaborative editor
  - Hocuspocus server (bare class, not Server wrapper) on same port as Express
  - server.ts: ws.Server with noServer:true, httpServer 'upgrade' routing
  - hocuspocus.ts: onAuthenticate (JWT + team), Database.fetch/store (yjs_state),
    onChange (rate limit + 5MB cap), onDisconnect (cleanup), compactYjsState
  - CollaborativeEditor.tsx: useState + destroyed flag (fixes Strict Mode),
    Outer + Inner split, url directly (no HocuspocusProviderWebsocket)
  - EditorToolbar, AskAIPopover, PresenceBar, editor.css
  - DocumentEditor.tsx: dual mode (file/doc), inline title edit, Export .docx
  - exportDocx.ts: TipTap JSON → docx library, bulletList/orderedList fixed
  - Document CRUD: document.service/controller/routes
  - FileBrowser: Documents section + New Document button
  - AI editor assist: editorAssist.service/controller/routes (agentrouter)
  - Day 6 reliability: zombie token check, reconnect backoff, beforeunload,
    hasRealContent guard, updateMany, rate limit Map + cleanup

---

## Backend File Structure
src/
config/
database.ts              ✅ Prisma client singleton
multer.ts                ✅ disk storage, 50MB limit
socketEvents.ts          ✅ All Socket.io event name constants
collaboration/
hocuspocus.ts            ✅ Hocuspocus server instance (bare Hocuspocus class)
controllers/
auth.controller.ts       ✅ register, login, getMe, logout, updateProfile, changePassword
teamController.ts        ✅ CRUD + invite + updateTeam + deleteTeam
announcementController.ts ✅
file.controller.ts       ✅ upload, download, list, delete, rename, preview, openEditor
twoFactor.controller.ts  ✅
folderController.ts      ✅
searchController.ts      ✅
comment.controller.ts    ✅
version.controller.ts    ✅
recycleBin.controller.ts ✅
lock.controller.ts       ✅
share.controller.ts      ✅
digest.controller.ts     ✅
aiSummary.controller.ts  ✅
document.controller.ts   ✅
editorAssist.controller.ts ✅
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
versionRoutes.ts         ✅
activityRoutes.ts        ✅
analyticsRoutes.ts       ✅
digestRoutes.ts          ✅
documentRoutes.ts        ✅
editorAssistRoutes.ts    ✅
shareRoutes.ts           ✅
services/
auth.service.ts          ✅
teamService.ts           ✅ + emitToTeam
announcementService.ts   ✅ + emitToTeam
file.service.ts          ✅ + emitToTeam + explainDuplicate
twoFactor.service.ts     ✅
folder.service.ts        ✅ + emitToTeam
search.service.ts        ✅
comment.service.ts       ✅
version.service.ts       ✅
recycleBin.service.ts    ✅ + emitToTeam
lock.service.ts          ✅
share.service.ts         ✅ + emitToTeam
document.service.ts      ✅ createDocument, listDocuments, getDocument, renameDocument, softDeleteDocument
ai/
gemini.ts              ✅ callGemini() — OpenAI-compatible, agentrouter.org
aiCache.service.ts     ✅ getCachedResult + setCachedResult
digest.service.ts      ✅ generateDigest — 600 tokens, 6h cache
fileSummary.service.ts ✅ summarizeFile — 350 tokens, 24h cache
duplicateExplain.service.ts ✅ explainDuplicate — 150 tokens, 30min cache
editorAssist.service.ts ✅ 5 presets + custom, in-memory rate limit 5/min/team
utils/
jwt.ts                   ✅
hash.ts                  ✅
teamGuard.ts             ✅
activityLogger.ts        ✅
fileEncryption.ts        ✅ AES-256-GCM encrypt/decrypt
socket.ts                  ✅ initSocket, getIO, emitToTeam, setIo, getIo
server.ts                  ✅ + ws.Server noServer, httpServer upgrade routing

## Frontend File Structure
frontend/src/
api/
axios.ts                 ✅ JWT interceptor
publicAxios.ts           ✅ No-JWT for public routes
files.ts                 ✅ All file/folder/lock/search/summary API functions
teams.ts                 ✅ + updateTeam, updateMemberRole, removeMember, deleteTeam, generateTeamDigest
announcements.ts         ✅
shares.ts                ✅
socket.ts                ✅ Shared socket.io-client instance
documents.ts             ✅ createDocument, fetchDocuments, fetchDocument, renameDocument, deleteDocument
config/
socketEvents.ts          ✅ Copy of backend constants
context/
AuthContext.tsx          ✅
hooks/
useAuth.ts               ✅
useLockManager.ts        ✅
useTeamSocket.ts         ✅ All team real-time events — mounted in Layout
components/
ProtectedRoute.tsx       ✅
Layout.tsx               ✅
FolderTree.tsx           ✅
FileList.tsx             ✅
FileUploadZone.tsx       ✅
LockBanner.tsx           ✅
CreateFolderModal.tsx    ✅
MoveModal.tsx            ✅
DeleteFolderDialog.tsx   ✅
ShareLinkModal.tsx       ✅
AnnouncementCard.tsx     ✅
AnnouncementModal.tsx    ✅
FileDetailSidebar.tsx    ✅
editor/
CollaborativeEditor.tsx ✅ Outer (provider lifecycle) + Inner (TipTap)
EditorToolbar.tsx       ✅ 16 buttons
AskAIPopover.tsx        ✅ 5 presets + custom prompt
PresenceBar.tsx         ✅ Yjs Awareness Protocol
editor.css              ✅ ProseMirror + cursor styles
pages/
auth/
Login.tsx              ✅
Register.tsx           ✅
TwoFAChallenge.tsx     ✅
teams/
TeamList.tsx           ✅
CreateTeam.tsx         ✅
TeamDashboard.tsx      ✅
FileBrowser.tsx        ✅ + Documents section
ActivityFeed.tsx       ✅
AnalyticsDashboard.tsx ✅
RecycleBin.tsx         ✅
TeamSettings.tsx       ✅
share/
PublicSharePage.tsx    ✅
DocumentEditor.tsx       ✅ Full-screen editor page (OUTSIDE Layout)
UserSettings.tsx         ✅
utils/
exportDocx.ts            ✅ TipTap JSON → .docx → browser download
types/
index.ts                 ✅
App.tsx                    ✅
main.tsx                   ✅

---

## Database Schema — All Tables
- **User:** id, username, email, password_hash, two_factor_secret, created_at, updated_at
- **Team:** id, name, description, owner_id, created_at, updated_at
- **TeamMember:** id, team_id, user_id, role, created_at
- **Folder:** id, team_id, parent_folder_id, name, created_by, is_deleted, deleted_at, created_at, updated_at
- **File:** id, team_id, folder_id, filename, original_name, file_size, mime_type, storage_path, hash, uploaded_by, is_deleted, deleted_at, created_at, updated_at, lockOwnerUserId, lockToken, lockExpiresAt, editingStartedAt, yjs_state (Bytes), yjs_last_saved, encryption_iv
- **FileVersion:** id, file_id, version_number, storage_path, file_size, uploaded_by, created_at
- **Comment:** id, file_id, team_id, user_id, content, resolved, is_deleted, deleted_at, created_at, updated_at
- **ActivityLog:** id, team_id, user_id, action, target_type, target_id, metadata, ip, userAgent, created_at
- **SharedLink:** id, file_id, team_id, created_by, token, password_hash, expiration_date, download_limit, downloads_count, created_at
- **Announcement:** id, teamId, authorId, title, body, isPinned, createdAt, updatedAt (camelCase — Prisma preserves schema names)
- **TokenBlacklist:** id, token, expires_at, created_at
- **AiCache:** id, team_id, feature, target_id, result, created_at, expires_at
- **Document:** id, team_id, folder_id, title, created_by, yjs_state (Bytes), yjs_last_saved, last_saved, is_deleted, deleted_at, created_at, updated_at

---

## Architecture Rules — Never Break These
- routes/ → controllers/ → services/ → prisma
- Controllers: thin — read req, call service, send res
- Services: all business logic, throw typed errors
- `assertTeamMember(userId, teamId, minimumRole?)` — returns TeamMember object
- `void logActivity(...)` — fire and forget, never await
- `emitToTeam(teamId, SOCKET_EVENTS.X, payload)` — fire and forget
- `prisma.$transaction(async tx => {...})` for multi-step atomic operations
- `req.user!.userId` — never `.id`
- Always `parseInt(param, 10)` for all route params
- Always `return` after every `res.json()` inside if blocks
- Hocuspocus: `handleConnection(ws, request)` — NO manual ws.on() after this

## Frontend Patterns — Never Break These
- All API calls through `src/api/axios.ts` — never raw fetch()
- Public routes use `src/api/publicAxios.ts`
- Token in localStorage key `cloudteams_token`
- `useAuth()` hook — never access AuthContext directly
- React Query for all GET requests
- Every page: loading state, error state, empty state
- URL-driven navigation for folder state
- `void queryClient.invalidateQueries(...)` after every mutation success
- `useTeamSocket` mounted in Layout — never add team socket listeners in pages
- Toast on every mutation success AND error
- Editor routes OUTSIDE <Layout /> wrapper in App.tsx
- CollaborativeEditor: useState + destroyed flag — never useRef or useMemo for providers

## Critical Rules Learned (Week 14 additions)
- React 18 Strict Mode runs every useEffect TWICE — destroyed flag is required
- HocuspocusProviderWebsocket connects immediately on construction — use url directly
- handleConnection(ws, request) returns void — never call .handleMessage on it
- StarterKit MUST have history: false when using Collaboration extension
- Extensions array in useEditor MUST be in useMemo — prevents re-init on every render
- updateMany not update in Hocuspocus store() — avoids P2025 throw
- hasRealContent() guard — prevents empty Yjs state from overwriting real content
- destroyUpgrade: false in Socket.io config — prevents it from killing /collaboration upgrades
- setBundle(null) before provider.destroy() — unmounts TipTap before ydoc is freed
- TipTap JSON not getHTML for export — docx library needs structured node tree
- bulletList fix: children.flatMap(listItem → para.map) not convertNode wrapper
- orderedList: define levels 0-3 in numbering config
- agentrouter.org uses OpenAI-compatible API format (messages not contents)
- AI_BASE_URL, AI_API_KEY, AI_MODEL in .env — model switch = config change only

## Tech Stack
- **Backend:** Node.js + Express + TypeScript, port 3001
- **ORM:** Prisma 7 with @prisma/adapter-pg
- **Database:** PostgreSQL, database name: cloudteams_dev
- **Generated client:** src/generated/prisma
- **Prisma singleton:** src/config/database.ts
- **Auth:** JWT 7-day tokens, payload: { userId, email }
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS, port 5173
- **HTTP:** Axios with JWT interceptor + publicAxios without
- **State:** React Context (auth) + React Query (server state)
- **Real-time:** Socket.io + Hocuspocus (WebSocket, same port, different path)
- **Editor:** TipTap + Yjs CRDT + Hocuspocus (collaborative editing)
- **Charts:** recharts
- **Toast:** react-hot-toast
- **AI:** agentrouter.org → deepseek-v3.1 (OpenAI-compatible format)
- **AI Cache:** ai_cache PostgreSQL table via Prisma
- **Encryption:** AES-256-GCM via Node.js crypto
- **Project location:** C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams
