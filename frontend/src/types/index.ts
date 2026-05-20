// src/types/index.ts
// PURPOSE: Single source of truth for all TypeScript interfaces.
// Every component, hook, and service imports types from here.
// WHY CENTRALISED: If the backend changes a field name, you fix it in
// one place here — not in 15 different component files.

// ─── USER ──────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  username?: string
  email: string;
  full_name: string | null  // optional full name — shown when set (Week 15)
  job_title: string | null  // optional job title — shown in profile (Week 15)
  avatar_color: string | null
  twoFactorEnabled: boolean   // ADD — safe boolean, never the secret

  // Note: password_hash is NEVER sent to the frontend
  // The backend strips it before returning user objects
  created_at: string;   // ISO 8601 string e.g. "2026-03-13T14:30:00.000Z"

}

// ─── AUTH RESPONSES ────────────────────────────────────────────────────────

// What the backend sends after a successful login (no 2FA)
export interface AuthResponse {
  token: string;   // JWT — we store this in localStorage
  user: User;
  message?: string
  twoFactorSetup?: {
    qrCode: string    // data URL — use as <img src={qrCode} />
    secret: string    // manual entry backup code
  }
}

// What the backend sends when the user has 2FA enabled
// This is NOT a full login — it's a checkpoint
export interface TwoFARequiredResponse {
  requires2FA: true;   // literal true — used to detect this branch
  tempToken: string;   // short-lived JWT, only valid for the 2FA challenge
}

// ─── TEAM ──────────────────────────────────────────────────────────────────
export type TeamRole = 'viewer' | 'editor' | 'admin';

export interface Team {
  id: number
  name: string
  description: string | null
  owner_id: number
  created_at: string
  updated_at: string
  invite_code?: string | null;
  invite_code_enabled?: boolean | null;
  myRole?: TeamRole           // present in list response (GET /teams)
  members?: TeamMember[]      // present in single team response (GET /teams/:id)
  _count?: {
    files: number
    documents: number
    totalBytes: number
    members?: number          // optional — not always present
  }
}
// The role a user holds in a specific team

// When fetching team members, the backend joins team_members + users
export interface TeamMember {
  id: number;           // team_members.id
  team_id: number;
  user_id: number;
  role: TeamRole;
  created_at: string;
  user: {             // joined User — subset of User fields (no sensitive data)
    id: number
    username: string
    email: string
    full_name: string | null   // needed for avatar display in member lists
    job_title: string | null   // shown in member cards / tooltips
    last_login: string | null
  }         // joined user object
}

// ─── UPLOADER ──────────────────────────────────────────────────────────────
// The backend always joins the uploader into file responses via Prisma include.
// This type matches exactly what the service returns.

export interface UploaderInfo {
  id: number;
  username: string;
  email: string;
  full_name?: string | null  // optional — not always joined

}

// ─── FILE & DOCUMENT ───────────────────────────────────────────────────────

export interface DocumentSummary {
  id: number
  title: string
  folderId: number | null
  createdBy: number
  creatorName: string | null
  lastSaved: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  lockOwnerUserId?: number | null
  lockExpiresAt?: string | null
}

export interface CloudFile {
  id: number;
  team_id: number;
  folder_id: number | null;
  filename: string;           // internal storage name (timestamp-prefixed)
  original_name: string;      // the filename the user sees in the UI
  file_size: number;          // bytes — divide by 1024*1024 for MB display
  mime_type: string;          // e.g. 'application/pdf', 'image/png'
  uploaded_by: number;        // FK to users.id
  is_deleted: boolean;
  deleted_at?: string | null; // ISO 8601 string or null
  created_at: string;         // ISO 8601 string
  updated_at: string;
  // ── Lock lease fields (Week 8 backend, Week 12 UI) ──────────────────────
  // NOTE: lockToken is intentionally absent — the backend NEVER sends it to
  // clients. It's a secret between the server and the lock owner only.
  lockOwnerUserId: number | null;    // who holds the lock (null = unlocked)
  lockExpiresAt: string | null;      // ISO string — when the lease expires
  editingStartedAt: string | null;   // when editing began (display only)
  // ── Joined relation — always present because service uses include ────────
  uploader: UploaderInfo;            // joined from users table
  encryption_iv?: string | null;     // hex-encoded IV, null = not encrypted
}

// ─── LOCK STATUS ───────────────────────────────────────────────────────────
// Shape returned by GET /api/teams/:teamId/files/:fileId/lock-status
// NOTE: lockToken is NOT in this response — the backend omits it intentionally.

export interface LockStatus {
  isLocked: boolean;
  lockedBy: {
    id: number;
    username: string;
    email: string;
  } | null;                          // null when file is not locked
  lockExpiresAt: string | null;      // ISO string or null
  timeRemainingSeconds: number | null; // countdown (null if not locked)
  editingStartedAt: string | null;
}

// ─── LOCK ACQUIRE RESPONSE ─────────────────────────────────────────────────
// Shape returned by POST /api/teams/:teamId/files/:fileId/lock
// The lockToken IS returned here — the client must store it for heartbeat/unlock.

export interface LockAcquireResponse {
  message: string;
  lockToken: string;         // UUID — store in component state, never in localStorage
  lockExpiresAt: string;     // ISO string — show to user as "lease valid until"
}

//   ─── FOLDER ────────────────────────────────────────────────────────────────

export interface Folder {
  id: number;
  team_id: number;
  parent_folder_id: number | null;  // null = root folder
  name: string;
  created_by: number;
  is_deleted: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

// Folder with computed breadcrumb from the backend
export interface FolderWithBreadcrumb extends Folder {
  breadcrumb: string;   // e.g. "Finance / Budgets / Q1"
}

// ─── UPLOAD RESULT ─────────────────────────────────────────────────────────
// Shape returned by POST /api/files/upload

export interface UploadResult {
  message: string;
  isDuplicate: boolean;   // true = same file existed, reference created
  duplicateReason?: string; // Optional AI explanation of why it was merged
  file: CloudFile;
}

// ─── API ERROR ─────────────────────────────────────────────────────────────

// The standard error shape our backend always sends
export interface ApiError {
  error: string;     // human-readable message
  code?: string;     // optional machine-readable code e.g. "FILE_LOCKED"
}

// ─── ACTIVITY FEED ─────────────────────────────────────────────────────────
// Matches ActivityEntry from activity.service.ts

export type ActivityAction =
  | 'file_uploaded'
  | 'file_downloaded'
  | 'file_deleted'
  | 'file_restored'
  | 'file_locked'
  | 'file_unlocked'
  | 'file_renamed'
  | 'file_moved'
  | 'file_version_created'
  | 'folder_created'
  | 'folder_deleted'
  | 'folder_renamed'
  | 'folder_restored'
  | 'version_restored'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_force_released'
  | 'comment_created'
  | 'link_created'
  | 'link_revoked'
  | 'announcement_posted'
  | 'announcement_pinned'
  | string


export interface ActivityEntry {
  id: number;
  action: string;            // e.g. 'file_uploaded', 'file_renamed'
  target_type: string | null;
  target_id: number | null;
  metadata: Record<string, unknown> | null;  // varies by action type
  ip: string | null;
  created_at: string;        // ISO 8601 string
  user: {
    id: number;
    username: string;
    email: string;
    full_name: string | null
  };
}

export interface ActivityFeedResult {
  data: ActivityEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ActivityFilters {
  page?: number;
  limit?: number;
  action?: string;
  since?: string;          // ISO date string
  userId?: number;
}

// ─── ANALYTICS ─────────────────────────────────────────────────────────────
// Matches AnalyticsResult from analytics.service.ts

export interface AnalyticsResult {
  storage: {
    totalBytes: number;
    totalBytesFormatted: string;  // e.g. "500.0 MB"
    fileCount: number;
  };
  fileTypes: Array<{
    mime_type: string;
    count: number;
  }>;
  memberActivity: Array<{
    user_id: number;
    username: string;
    email: string;
    action_count: number;
  }>;
  uploadsPerDay: Array<{
    day: string;     // ISO date string "2026-04-07"
    count: number;
  }>;
  topFolders: Array<{
    folder_id: number;
    folder_name: string;
    file_count: number;
  }>;
  largestFiles: Array<{
    file_id: number;
    original_name: string;
    file_size: number;
    file_size_formatted: string;
  }>;
  activityByType: Array<{
    day: string;
    action: string;
    count: number;
  }>;
}

// ─── COMMENTS ──────────────────────────────────────────────────────────────

export interface Comment {
  id: number;
  file_id: number;
  team_id: number;
  user_id: number;
  content: string;
  resolved: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  user: {
    id: number;
    username: string;
    email: string;
    full_name?: string | null

  };
}

// ─── FILE VERSIONS ─────────────────────────────────────────────────────────

export interface FileVersion {
  id: number;
  file_id: number;
  version_number: number;
  storage_path: string;
  file_size: number;
  created_at: string;
  encryption_iv?: string | null;
  uploaded_by: number;
  version_name?: string | null;   // optional user-provided label e.g. "Before Q3 review"
  uploader?: {
    id: number;
    username: string;
    email: string;
    full_name?: string | null

  };
}

// ─── RECYCLE BIN ───────────────────────────────────────────────────────────
// Matches getUnifiedRecycleBin response from recycleBin.service.ts

export interface RecycleBinResult {
  files: CloudFile[];
  folders: Folder[];
  documents: DocumentSummary[];
  total: number;
}

// ─── FILE PREVIEW ──────────────────────────────────────────────────────────
// Matches the preview endpoint response shapes

export type FilePreviewResponse =
  | { previewable: true; type: 'html'; content: string }   // DOCX / XLSX
  | { previewable: false; mimeType?: string; filename?: string };
// NOTE: PDF and images are streamed directly — no JSON response.
// Use a blob URL via fetchPreview() for those (see files.ts).
// ─── ANNOUNCEMENT ────────────────────────────────────────────────────────────
// Note: Announcement uses camelCase (teamId, authorId, isPinned, createdAt, updatedAt)
// because the schema defines them without @map() — Prisma keeps camelCase as-is
// ─── SHARED LINK ─────────────────────────────────────────────────────────────

export interface SharedLink {
  id: number;
  file_id: number | null;
  team_id: number;
  created_by: number;
  token: string;
  expiration_date: string | null;
  download_limit: number | null;
  downloads_count: number;
  created_at: string;
}


// ─── ANNOUNCEMENT ────────────────────────────────────────────────────────────
// Note: Announcement uses camelCase (teamId, authorId, isPinned, createdAt, updatedAt)
// because the schema defines them without @map() — Prisma keeps camelCase as-is

export interface Announcement {
  id: number;
  teamId: number;
  authorId: number;
  title: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    username: string;
    email: string;
    full_name: string | null
  }
}

// ─── AI FEATURES ───────────────────────────────────────────────────────────

export interface DigestResult {
  digest: string
  fromCache: boolean
  cachedAt: string | null
  nextRefreshAt: string | null
}

export interface FileSummaryResult {
  summary: string
  fromCache: boolean
  cachedAt: string | null
  fileName: string
}