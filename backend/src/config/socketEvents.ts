// src/config/socketEvents.ts
//
// PURPOSE: Single source of truth for ALL Socket.io event names.
//          Backend emits these. Frontend listens for these.
//          If you change a name here, TypeScript catches every place
//          that needs updating — no silent mismatches.
//
// PATTERN: Grouped by domain, named as 'domain:action'
//          This matches the convention already used for file:uploaded

export const SOCKET_EVENTS = {

    // ── Files ──────────────────────────────────────────────────────────────
    FILE_UPLOADED: 'file:uploaded',    // new file or new version
    FILE_DELETED: 'file:deleted',     // moved to recycle bin
    FILE_RESTORED: 'file:restored',    // restored from recycle bin
    FILE_RENAMED: 'file:renamed',     // file name changed
    FILE_MOVED: 'file:moved',       // moved to different folder

    // ── Folders ────────────────────────────────────────────────────────────
    FOLDER_CREATED: 'folder:created',
    FOLDER_RENAMED: 'folder:renamed',
    FOLDER_DELETED: 'folder:deleted',
    FOLDER_MOVED: 'folder:moved',

    // ── Locks ──────────────────────────────────────────────────────────────
    // Already wired from Week 8 — listed here for completeness
    FILE_LOCKED: 'file:locked',
    FILE_UNLOCKED: 'file:unlocked',
    FILE_LOCK_EXPIRED: 'file:lockExpired',

    // ── Members ────────────────────────────────────────────────────────────
    MEMBER_JOINED: 'member:joined',    // someone accepted invite
    MEMBER_LEFT: 'member:left',      // someone was removed
    MEMBER_ROLE_CHANGED: 'member:roleChanged',

    // ── Share Links ────────────────────────────────────────────────────────
    LINK_CREATED: 'link:created',     // new share link generated
    LINK_REVOKED: 'link:revoked',     // share link deleted

    // ── Announcements ──────────────────────────────────────────────────────
    ANNOUNCEMENT_POSTED: 'announcement:posted',
    ANNOUNCEMENT_PINNED: 'announcement:pinned',
    
    // ── Comments ──────────────────────────────────────────────────────────────
    COMMENT_CREATED: 'comment:created',
    COMMENT_RESOLVED: 'comment:resolved',
    // ── Documents ────────────────────────────────────────────────────────────
    DOCUMENT_CREATED: 'document:created',
    DOCUMENT_RENAMED: 'document:renamed',
    DOCUMENT_DELETED: 'document:deleted',
    DOCUMENT_MOVED: 'document:moved',

} as const

// Type for all event names — used in TypeScript for type-safe emit calls
export type SocketEvent = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS]
