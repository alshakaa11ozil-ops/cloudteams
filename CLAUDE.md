# CLAUDE.md — CloudTeams Project Manifest
> **Primary context document for AI-assisted development.**
> Place this file in your project root. All AI coding agents (Cursor, Roo Code, etc.) should read this file first before making any changes.

---

## 1. Project Identity

**Project Name:** CloudTeams
**Type:** Graduation Project — Full-Stack Web Application
**University:** Zhejiang University of Science and Technology (ZUST)
**School:** School of Computer Science & Technology
**Major:** Computer Science and Technology
**Duration:** 16 weeks (Solo)
**Expected Grade:** A- to A (85–95%)
**Completion Odds:** 80–85%
**Defense Month:** May (per university schedule)
**Current Week:** Week 2 (Week 1 ✅ Complete)
**Project Location:** `C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams`
**GitHub Repo:** https://github.com/alshakaa11ozil-ops/cloudteams
**IDE / Agentic Builder:** Cursor (with `.cursorrules` in project root)

### Mission
Build an AI-powered cloud storage platform designed specifically for team collaboration — one that prevents file conflicts, increases transparency, and makes teamwork simpler through soft file locking, real-time activity feeds, and Claude-powered weekly digests.

### Core Problem Being Solved
When multiple team members edit the same file simultaneously on platforms like Google Drive or Dropbox, one person's work gets silently overwritten. CloudTeams solves this with **Soft File Locking** — a mechanism that marks a file as `is_being_edited = true` the moment someone opens it, warning all other team members in real time.

### Target Users
- Primary: Student project groups (3–6 members)
- Secondary: Small offices and remote teams (5–20 people)

---

## 2. Current Infrastructure

### Backend Database
| Property | Value |
|---|---|
| **Database Engine** | PostgreSQL 18 (running locally) |
| **Dev Database** | `cloudteams_dev` ✅ Created |
| **Test Database** | `cloudteams_test` ✅ Created |
| **Management Tool** | DBeaver (drivers installed, connections verified) |
| **ORM** | Sequelize ✅ Installed |
| **Host** | `localhost` |
| **Port** | `5432` |

### Tech Stack (Full)
| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| State / Data | React Query |
| HTTP Client | Axios |
| Real-time | Socket.io |
| Backend Runtime | Node.js + Express.js (TypeScript) |
| Auth | JWT (7-day tokens) + bcrypt |
| File Uploads | Multer |
| Scheduled Jobs | node-cron |
| Database ORM | Sequelize |
| File Storage | Local disk (dev) → AWS S3 free tier (prod, optional) |
| Frontend Deploy | Vercel |
| Backend Deploy | Railway |
| DB Hosting | Railway PostgreSQL |

### Developer Machine
| Property | Value |
|---|---|
| Device | Huawei MateBook D 16 |
| OS | Windows 11 Home (Version 25H2) |
| Processor | Intel Core i5-13420H @ 2.10 GHz |
| RAM | 16.0 GB |
| Storage | 954 GB (169 GB used) |

---

## 3. AI & API Configuration

| Property | Value |
|---|---|
| **API Provider** | AgentRouter (OpenAI-compatible endpoint) |
| **Available Credits** | $150.00 |
| **Lead Architect AI** | Claude (planning, design, schema review, this manifest) |
| **Agentic Builder / IDE** | Antigravity (code generation, scaffolding, file execution) |

### Workflow Philosophy
- **Claude** acts as the **Lead Architect**: reviews requirements, designs system architecture, maintains this manifest, generates schemas, and audits code quality.
- **Antigravity** acts as the **Agentic Builder**: scaffolds files, implements features, runs terminal commands, and interacts with the local environment at `C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams`.
- This `CLAUDE.md` file is the **single source of truth** that bridges both roles. Always read it before writing code.

---

## 4. Completed Milestones

### ✅ Week 1 — Full Environment Setup (COMPLETE)

#### ✅ Milestone 1 — All Tools Installed
- Node.js, npm, Git, PostgreSQL 18, DBeaver, Antigravity IDE all installed and verified on Windows 11 machine.

#### ✅ Milestone 2 — GitHub Repository Live
- Repo created and pushed: https://github.com/alshakaa11ozil-ops/cloudteams
- `.gitignore` configured (covers `node_modules/`, `.env`, `dist/`, `build/`)
- `README.md` present

#### ✅ Milestone 3 — Project Folder Structure Created
- Location: `C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams`
- `backend/` folder created with all dependencies installed
- `frontend/` folder created with all dependencies installed (React + Vite + TypeScript + Tailwind)

#### ✅ Milestone 4 — Databases Created & Configured
- `cloudteams_dev` — development database ✅
- `cloudteams_test` — test database ✅
- Both verified in DBeaver with active connections

#### ✅ Milestone 5 — .env Files Configured
- `backend/.env` created with DB credentials, JWT secret, and API keys
- `.env` files are gitignored

#### ✅ Milestone 6 — Core SQL Schema Designed
The full database schema covers **8 core tables**:

```sql
users            -- Auth, 2FA secret
teams            -- Workspace container
team_members     -- Role-based membership (viewer / editor / admin)
folders          -- Nested folder structure
files            -- Core storage (locking + soft delete columns)
file_versions    -- Version history per file
comments         -- Threaded discussion with @mentions
activity_logs    -- Full audit trail for activity feed & AI digest
shared_links     -- Secure external sharing with password + expiry
```

**Key schema feature — Soft File Locking (on `files` table):**
```sql
is_being_edited     BOOLEAN DEFAULT FALSE,
edited_by           INTEGER REFERENCES users(id),
editing_started_at  TIMESTAMP
```

---

## 5. Current Roadmap — Week 2 (IN PROGRESS 🔨)

> Week 1 is done. Week 2 goal: get the backend server running and all 8 database models created.

### Task 1 — Create the Express Server Entry Point
File: `backend/src/server.ts`
```typescript
// Express app bootstrap
// - Initialize Express
// - Register middleware (cors, express.json, morgan)
// - Mount all route files under /api
// - Initialize Socket.io
// - Connect to DB then start listening on PORT
```
Start command should be: `npm run dev` → server live at `http://localhost:5000`

### Task 2 — Create Database Connection
File: `backend/src/config/database.ts`
```typescript
// Sequelize instance configured from .env
// Reads DB_NAME (switches to cloudteams_test when NODE_ENV=test)
// Exports sequelize instance + testConnection() function
// testConnection() logs: ✅ Database connected: cloudteams_dev
```

### Task 3 — Create All 8 Sequelize Models
Location: `backend/src/models/`

| File | Table | Key Fields |
|---|---|---|
| `User.ts` | `users` | id, email, passwordHash, name, twoFactorSecret |
| `Team.ts` | `teams` | id, name, ownerId, description |
| `TeamMember.ts` | `team_members` | teamId, userId, role (viewer/editor/admin) |
| `Folder.ts` | `folders` | id, teamId, parentFolderId, name, createdBy |
| `File.ts` | `files` | id, teamId, folderId, filename, hash, isBeingEdited, editedBy, editingStartedAt, isDeleted |
| `FileVersion.ts` | `file_versions` | id, fileId, versionNumber, uploadedBy, storagePath |
| `Comment.ts` | `comments` | id, fileId, teamId, userId, content, resolved |
| `ActivityLog.ts` | `activity_logs` | id, teamId, userId, action, targetType, targetId, metadata |
| `SharedLink.ts` | `shared_links` | id, fileId, token, passwordHash, expirationDate, downloadLimit |

All models must:
- Use TypeScript with proper interfaces
- Define associations (belongsTo, hasMany, belongsToMany)
- Be exported from a central `backend/src/models/index.ts`

### Task 4 — Health Check Endpoint
`GET /api/health` should return:
```json
{
  "status": "ok",
  "timestamp": "2026-03-16T...",
  "database": "connected",
  "environment": "development"
}
```
Test it: `curl http://localhost:5000/api/health`

### Task 5 — Run Migrations & Verify in DBeaver
```bash
cd backend
npx sequelize-cli db:migrate
# Then open DBeaver and confirm all 8 tables exist in cloudteams_dev
```
---

## 6. Context Instructions for AI Coding Agents

> **Read this section carefully before writing any code.**

You are assisting in building **CloudTeams**, a full-stack team collaboration and cloud storage web application — a graduation project at Zhejiang University of Science and Technology. The developer is working solo on a **Windows 11 machine** using **Cursor** as the primary AI coding IDE. The project lives at `C:\Users\alsha\Desktop\gproject\cloudteams\cloudteams` and is on GitHub at `https://github.com/alshakaa11ozil-ops/cloudteams`. The folder structure uses `backend/` (not `server/`) and `frontend/` (not `client/`). The backend is **Node.js + Express + TypeScript** connected to a **local PostgreSQL 18 database** (`cloudteams_dev` for development, `cloudteams_test` for testing). The frontend is **React + Vite + TypeScript + Tailwind CSS** with **Axios** and **React Query**. The ORM is **Sequelize**. All environment variables live in `backend/.env` — never hardcode secrets. **Week 1 is complete**: tools installed, GitHub repo live, both databases created, dependencies installed, `.env` files configured. **Currently in Week 2**: the immediate goal is to create `backend/src/server.ts`, `backend/src/config/database.ts`, all 8 Sequelize models, and a `GET /api/health` endpoint. The project's signature feature is **Soft File Locking** (`is_being_edited`, `edited_by`, `editing_started_at` on the `files` table) — treat it as first-class in all file-related logic. The AI API uses **AgentRouter** (OpenAI-compatible) for the weekly digest feature only. Always use TypeScript, follow RESTful conventions, add JSDoc comments, and structure every feature with a `/services` layer and a `/controllers` layer. Do not modify the database schema without explicit instruction.

### ⚠️ Commenting Rules (MANDATORY — non-negotiable)
Every piece of code generated must follow these commenting rules so the developer can review, understand, and explain every line during their thesis defense:

**1. File Header — every file starts with this:**
```typescript
/**
 * @file filename.ts
 * @description What this file does in plain English (1-2 sentences)
 * @author CloudTeams
 */
```

**2. Function/Method JSDoc — every function gets this:**
```typescript
/**
 * @description What this function does in plain English
 * @param paramName - What this parameter is and why it's needed
 * @returns What is returned and why
 * @throws What errors can occur
 * @example
 * // How to call this function
 * const result = myFunction('example');
 */
```

**3. Inline comments — explain the WHY, not the WHAT:**
```typescript
// ✅ Good: explains reasoning
const saltRounds = 10; // 10 rounds = secure enough without being too slow

// ❌ Bad: just describes what the code already shows
const saltRounds = 10; // set saltRounds to 10
```

**4. Section dividers — group related logic:**
```typescript
// ─── Validation ──────────────────────────────────────────────
// ─── Database Query ───────────────────────────────────────────
// ─── Response ─────────────────────────────────────────────────
```

**5. Mark anything complex or important:**
```typescript
// 🔒 SOFT LOCK: Mark file as being edited to prevent conflicts
// ⚠️  WARNING: This must run inside a transaction to avoid race conditions
// 📌 NOTE: Token expires in 7 days — see JWT_EXPIRES_IN in .env
```

---

## 7. Feature Implementation Tracker

| # | Feature | Category | Target Week | Status |
|---|---|---|---|---|
| 1 | User Authentication (JWT) | Security | 3–4 | 🔲 Not Started |
| 2 | Two-Factor Authentication (2FA) | Security | 3–4 | 🔲 Not Started |
| 3 | Team Workspaces | Collaboration | 5–6 | 🔲 Not Started |
| 4 | Cloud File Storage (Upload/Download) | Storage | 7–9 | 🔲 Not Started |
| 5 | Smart Deduplication (SHA-256) | Storage | 7–9 | 🔲 Not Started |
| 6 | Folder Organization | Storage | 10–11 | 🔲 Not Started |
| 7 | Team Search | Storage | 10–11 | 🔲 Not Started |
| 8 | **Soft File Locking** ⭐ | Collaboration | 14 | 🔲 Not Started |
| 9 | Comments & @Mentions | Collaboration | 12 | 🔲 Not Started |
| 10 | Activity Feed | Collaboration | 13 | 🔲 Not Started |
| 11 | AI Activity Digest (AgentRouter) | Collaboration | 15 | 🔲 Not Started |
| 12 | Team Analytics Dashboard | Collaboration | 13 | 🔲 Not Started |
| 13 | Shared Links with Security | Security | 10–11 | 🔲 Not Started |
| 14 | Recycle Bin & Data Recovery | Storage | 12–13 | 🔲 Not Started |
| 15 | File Version History | Collaboration | 12–13 | 🔲 Not Started |
| 16 | Multi-user Permissions | Security | 5–6 | 🔲 Not Started |
| 17 | File Encryption & HTTPS | Security | 5–6 | 🔲 Not Started |
| 18 | Online Document Preview | Collaboration | 13 | 🔲 Not Started |
| 19 | Online Document Editing | Collaboration | 15 | 🔲 Not Started |
| 20 | Multi-device Auto-Sync (WebSocket) | Storage | 15 | 🔲 Not Started |

**Week 2 Infrastructure Tasks (not features, but required before Week 3):**
| Task | Status |
|---|---|
| `backend/src/server.ts` — Express entry point | 🔨 In Progress |
| `backend/src/config/database.ts` — Sequelize connection | 🔨 In Progress |
| All 8 Sequelize models in `backend/src/models/` | 🔨 In Progress |
| `GET /api/health` endpoint | 🔨 In Progress |
| Sequelize migrations run on `cloudteams_dev` | 🔲 Not Started |

---

## 8. Key API Endpoints Reference (28+ Total)

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

POST   /api/teams
GET    /api/teams/:id
POST   /api/teams/:id/invite
GET    /api/teams/:id/members

POST   /api/files/upload
GET    /api/files/:id/download
DELETE /api/files/:id
POST   /api/files/:id/lock          ← Soft locking
POST   /api/files/:id/unlock        ← Soft locking
POST   /api/files/:id/heartbeat     ← Keep lock alive
GET    /api/files/:id/lock-status   ← Poll lock state

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

## 9. Project Directory Structure

```
cloudteams/                         ← repo root (GitHub: alshakaa11ozil-ops/cloudteams)
├── CLAUDE.md                       ← this file (AI context — read first)
├── .cursorrules                    ← Antigravity/Cursor agent rules
├── .gitignore
├── README.md
│
├── frontend/                       ← React + Vite + TypeScript + Tailwind
│   ├── public/
│   ├── src/
│   │   ├── components/             ← reusable UI components
│   │   ├── pages/                  ← route-level page components
│   │   ├── hooks/                  ← custom React hooks
│   │   ├── context/                ← React Context providers (auth, team)
│   │   ├── services/               ← Axios API call wrappers
│   │   ├── types/                  ← shared TypeScript interfaces
│   │   └── utils/                  ← helpers, formatters
│   ├── vite.config.ts              ← includes proxy to backend:5000
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── package.json
│
├── backend/                        ← Node.js + Express + TypeScript
│   ├── src/
│   │   ├── server.ts               ← ⬅ Week 2 Task 1: Entry point
│   │   ├── config/
│   │   │   ├── database.ts         ← ⬅ Week 2 Task 2: Sequelize connection
│   │   │   └── env.ts              ← validated env vars
│   │   ├── models/                 ← ⬅ Week 2 Task 3: All 8 Sequelize models
│   │   │   ├── index.ts            ← exports all models + associations
│   │   │   ├── User.ts
│   │   │   ├── Team.ts
│   │   │   ├── TeamMember.ts
│   │   │   ├── Folder.ts
│   │   │   ├── File.ts             ← includes soft locking columns
│   │   │   ├── FileVersion.ts
│   │   │   ├── Comment.ts
│   │   │   ├── ActivityLog.ts
│   │   │   └── SharedLink.ts
│   │   ├── controllers/            ← request handlers (thin layer)
│   │   ├── services/               ← business logic (thick layer)
│   │   ├── routes/                 ← ⬅ Week 2 Task 4: health route first
│   │   │   └── health.ts
│   │   ├── middleware/             ← auth, permissions, error handler
│   │   ├── jobs/                   ← node-cron scheduled tasks
│   │   │   ├── digestJob.ts        ← weekly AI digest (Sunday 6 PM)
│   │   │   └── lockCleanupJob.ts   ← stale lock cleanup (every 30 min)
│   │   ├── sockets/                ← Socket.io event handlers
│   │   └── utils/                  ← hash, token, file helpers
│   ├── uploads/                    ← local file storage (dev only, gitignored)
│   ├── .env                        ← secrets (gitignored) ✅ configured
│   ├── .env.example                ← committed template
│   ├── tsconfig.json
│   └── package.json
│
├── database/
│   ├── schema.sql                  ← full schema (source of truth)
│   └── migrations/                 ← Sequelize CLI migration files
│
└── docs/
    └── api.md                      ← endpoint documentation
```

---

## 10. How to Run the Project Locally

> Always start services in this order: **Database → Backend → Frontend**

### Prerequisites
```bash
# Verify these are installed before starting:
node --version      # Recommended: v18 LTS or v20 LTS
npm --version       # v9+
psql --version      # PostgreSQL 14+
git --version
```

> ⚠️ **Windows note:** If `psql` is not found in your terminal, add PostgreSQL's `bin` folder to your system PATH:
> `C:\Program Files\PostgreSQL\<version>\bin`

### 1. Start PostgreSQL
PostgreSQL runs as a Windows service and should start automatically. To verify:
```bash
# In PowerShell (run as Administrator if needed):
Get-Service -Name postgresql*
# Status should show: Running
```
Or open **Services** (`services.msc`) and confirm the PostgreSQL service is running.

### 2. Start the Backend
```bash
cd backend
npm install           # first time only
npm run dev           # starts Express on http://localhost:5000
```
Expected output: `✅ Database connected: cloudteams_dev` then `🚀 Server running on port 5000`

Add to `backend/package.json`:
```json
"scripts": {
  "dev": "nodemon --exec ts-node src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "test": "jest --testPathPattern=tests/"
}
```

### 3. Start the Frontend
```bash
cd frontend
npm install           # first time only
npm run dev           # starts React/Vite on http://localhost:3000
```

### 4. Proxy Setup (Vite)
Add to `frontend/vite.config.ts` so frontend API calls reach the backend:
```typescript
export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5000',
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true
      }
    }
  }
})
```

---

## 11. Testing Strategy

### Framework
```bash
# Backend
npm install -D jest ts-jest @types/jest supertest @types/supertest

# Frontend
# React Testing Library is included with Vite/CRA by default
npm install -D @testing-library/react @testing-library/jest-dom
```

### Test Database
All tests run against `cloudteams_test`, never `cloudteams_dev`. The test database is reset before each test suite using Sequelize's `sync({ force: true })`.

```typescript
// server/src/config/database.ts
const dbName = process.env.NODE_ENV === 'test'
  ? 'cloudteams_test'
  : process.env.DB_NAME;
```

### Test File Locations
```
backend/
└── tests/
    ├── unit/
    │   ├── auth.service.test.ts
    │   ├── file.service.test.ts
    │   └── lock.service.test.ts    ← critical: test all locking edge cases
    ├── integration/
    │   ├── auth.routes.test.ts
    │   ├── files.routes.test.ts
    │   └── teams.routes.test.ts
    └── helpers/
        └── testDb.ts               ← DB setup/teardown utilities
```

### Key Test Scenarios (Soft File Locking — must cover all)
```
✅ Lock acquired when user opens file
✅ Warning shown to second user when file is locked
✅ Lock released on explicit unlock
✅ Lock auto-expires after 2 hours (mock system clock)
✅ Heartbeat extends lock expiry
✅ Admin can force-unlock any file
✅ Crash scenario: lock clears after 2h without heartbeat
✅ Two users race to lock same file — only one succeeds
```

### Run Tests
```bash
cd backend
npm test                        # run all tests
npm test -- --watch             # watch mode
npm test -- auth.service        # run single file
```

---

## 12. Known Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Soft lock not released on browser crash | Medium | High | Auto-expire after 2h via cron job every 30 min |
| WebSocket connection drops on mobile | Medium | Medium | Implement reconnection logic with exponential backoff in Socket.io client config |
| Google Docs integration (Feature 19) requires OAuth setup | High | Medium | Treat as bonus feature; implement basic preview first, editing as stretch goal |
| SHA-256 hash collision (deduplication) | Very Low | High | Academically negligible; note limitation in thesis |
| Railway free tier limits | Low | Medium | Monitor usage; fallback: Render.com also has free tier |
| AgentRouter API credits exhausted | Low | Medium | Monitor usage; AI digest costs ~$0.05/week per 100 teams — $150 budget is effectively unlimited |
| Windows line endings (CRLF) breaking shell scripts | Medium | Low | Add `.gitattributes` with `* text=auto eol=lf` |
| JWT secret accidentally committed to GitHub | Low | Critical | `.env` is gitignored ✅ — use `.env.example` for templates only |
| `backend/` vs `server/` folder name confusion for agents | Medium | Low | This file uses `backend/` — always use that name |

---

## 13. University Requirements Compliance

All 12 supervisor requirements are met by the 20 features:

| Category | Requirement | Feature(s) |
|---|---|---|
| Basic Storage | File upload, download, backup & sync | 4, 5, 20 |
| Basic Storage | Multi-device interconnection | 20 |
| Basic Storage | Folder management | 6 |
| Basic Storage | Data recovery & recycle bin | 14 |
| Security | Account login & 2FA | 1, 2 |
| Security | File encryption & transmission encryption | 17 |
| Security | Shared links with password & expiration | 13 |
| Security | Multi-user permission management | 16 |
| Collaboration | Multi-user collaborative editing | 8 |
| Collaboration | Folder sharing & team spaces | 3 |
| Collaboration | File version history & recovery | 15 |
| Collaboration | Online document preview & editing | 18, 19 |

### Grading Breakdown (per ZUST scoring standard)
| Component | Weight | Notes |
|---|---|---|
| Basic knowledge & skills | 20% | Full-stack mastery, foreign literature review |
| Thesis report & system quality | 30% | Correctness, scheme rationality, code quality |
| Normal work performance | 10% | Attendance, attitude, weekly check-ins |
| Defense performance | 40% | Clarity, answering questions, demonstration |

---

## 14. AI Activity Digest — Implementation Notes (Feature 11)

The weekly digest runs every **Sunday at 6:00 PM** via `node-cron`. It queries the past 7 days of `activity_logs`, sends the data to the AI API (AgentRouter), and emails a formatted summary to all team members.

```typescript
// server/src/jobs/digestJob.ts
import cron from 'node-cron';
import axios from 'axios';

// Every Sunday at 6 PM
cron.schedule('0 18 * * 0', async () => {
  const teams = await Team.findAll({ include: ['members'] });

  for (const team of teams) {
    const activity = await ActivityLog.findAll({
      where: {
        teamId: team.id,
        createdAt: { [Op.gte]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    });

    // Call AgentRouter (OpenAI-compatible)
    const response = await axios.post(
      `${process.env.AGENTROUTER_BASE_URL}/chat/completions`,
      {
        model: process.env.AI_MODEL,
        messages: [{
          role: 'user',
          content: `Summarize this team activity as a friendly weekly digest email:\n${JSON.stringify(activity)}`
        }]
      },
      { headers: { Authorization: `Bearer ${process.env.AGENTROUTER_API_KEY}` } }
    );

    const digest = response.data.choices[0].message.content;
    await sendEmail({ to: team.members.map(m => m.email), body: digest });
  }
});
```

**Estimated cost:** ~$0.05/week per 100 teams. With $150 in credits, this feature can run for years.

---

*Last updated: 2026-03-16 | Status: **Week 1 ✅ Complete → Week 2 🔨 In Progress***
*Next update: After Week 2 tasks complete (server.ts + models + health endpoint live).*
