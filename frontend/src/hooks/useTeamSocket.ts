// frontend/src/hooks/useTeamSocket.ts
//
// PURPOSE: Single hook that connects to a team's Socket.io room
//          and handles ALL real-time events for that team.
//
// WHY ONE HOOK NOT MANY:
//   If FileBrowser, TeamDashboard, and MembersPanel each set up
//   their own socket connections, we'd have 3 connections + 3 sets
//   of cleanup logic + potential duplicate event handling.
//   One hook = one connection, mounted at the Layout level,
//   handles everything while user is inside a team.
//
// USAGE:
//   Call this in Layout.tsx when teamId is present.
//   It runs for the entire team session, not per-page.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import socket from '../api/socket'
import { SOCKET_EVENTS } from '../socketEvents'
import { useAuth } from './useAuth'

interface UseTeamSocketOptions {
    teamId: number
}

export function useTeamSocket({ teamId }: UseTeamSocketOptions) {
    const queryClient = useQueryClient()
    const { user } = useAuth()

    useEffect(() => {
        if (!teamId) return

        // Connect and join team room
        socket.connect()
        socket.emit('join-team', { teamId })

        // ── Helper: skip events WE triggered ──────────────────────────────────
        const isMe = (id?: number) => id === user?.id

        // ── FILE EVENTS ───────────────────────────────────────────────────────

        const onFileUploaded = ({ uploadedBy }: { uploadedBy: number }) => {
            if (isMe(uploadedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            toast('A team member uploaded a file', { icon: '📄', duration: 3000 })
        }

        const onFileDeleted = ({ deletedBy }: { deletedBy: number }) => {
            if (isMe(deletedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            void queryClient.invalidateQueries({ queryKey: ['recycle-bin', teamId] })
            toast('A file was moved to the recycle bin', { icon: '🗑️', duration: 3000 })
        }

        const onFileRestored = ({ restoredBy }: { restoredBy: number }) => {
            if (isMe(restoredBy)) return
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            void queryClient.invalidateQueries({ queryKey: ['recycle-bin', teamId] })
            toast('A file was restored from recycle bin', { icon: '♻️', duration: 3000 })
        }

        const onFileRenamed = ({ renamedBy }: { renamedBy: number }) => {
            if (isMe(renamedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            toast('A file was renamed', { icon: '✏️', duration: 3000 })
        }

        const onFileMoved = ({ movedBy }: { movedBy: number }) => {
            if (isMe(movedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            toast('A file was moved', { icon: '📁', duration: 3000 })
        }

        // ── FOLDER EVENTS ─────────────────────────────────────────────────────

        const onFolderCreated = ({ createdBy }: { createdBy: number }) => {
            if (isMe(createdBy)) return
            void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
            toast('A new folder was created', { icon: '📂', duration: 3000 })
        }

        const onFolderRenamed = ({ renamedBy }: { renamedBy: number }) => {
            if (isMe(renamedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
            toast('A folder was renamed', { icon: '✏️', duration: 3000 })
        }

        const onFolderDeleted = ({ deletedBy }: { deletedBy: number }) => {
            if (isMe(deletedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
            void queryClient.invalidateQueries({ queryKey: ['files', teamId] })
            toast('A folder was deleted', { icon: '🗑️', duration: 3000 })
        }

        const onFolderMoved = ({ movedBy }: { movedBy: number }) => {
            if (isMe(movedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['folders', teamId] })
            toast('A folder was moved', { icon: '📁', duration: 3000 })
        }

        // ── LOCK EVENTS ───────────────────────────────────────────────────────

        const onFileLocked = ({ fileId, lockedBy }: { fileId: number; lockedBy: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['file-lock', fileId] })
            if (!isMe(lockedBy)) {
                toast('A team member is now editing a file', { icon: '🔒', duration: 3000 })
            }
        }

        const onFileUnlocked = ({ fileId, unlockedBy }: { fileId: number; unlockedBy?: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['file-lock', fileId] })
            if (isMe(unlockedBy)) return
            toast('A file is now available for editing', { icon: '🔓', duration: 3000 })
        }

        // ── MEMBER EVENTS ─────────────────────────────────────────────────────

        const onMemberJoined = ({ username }: { username: string; userId: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
            toast(`${username} joined the team! 👋`, { duration: 4000 })
        }

        const onMemberLeft = ({ userId: leftUserId }: { userId: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
            if (!isMe(leftUserId)) {
                toast('A team member was removed', { icon: 'ℹ️', duration: 3000 })
            }
        }

        const onMemberRoleChanged = ({ userId: changedUserId, username, newRole }: {
            userId: number
            username: string
            newRole: string
        }) => {
            void queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })

            if (changedUserId === user?.id) {
                toast(`Your role was changed to ${newRole}`, { icon: '🔔', duration: 6000 })
            } else {
                toast(`${username}'s role was changed to ${newRole}`, { icon: 'ℹ️', duration: 3000 })
            }
        }

        // ── SHARE LINK EVENTS ─────────────────────────────────────────────────

        const onLinkCreated = ({ createdBy }: { createdBy: number }) => {
            if (isMe(createdBy)) return
            void queryClient.invalidateQueries({ queryKey: ['file-shares', teamId] })
            toast('A team member created a share link', { icon: '🔗', duration: 3000 })
        }

        const onLinkRevoked = ({ revokedBy }: { revokedBy: number }) => {
            if (isMe(revokedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['file-shares', teamId] })
            toast('A share link was revoked', { icon: '🔒', duration: 3000 })
        }

        // ── ANNOUNCEMENT EVENTS ───────────────────────────────────────────────

        const onAnnouncementPosted = ({ postedBy }: { postedBy: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
            if (!isMe(postedBy)) {
                toast('New team announcement posted 📢', { duration: 5000 })
            }
        }

        const onAnnouncementPinned = () => {
            void queryClient.invalidateQueries({ queryKey: ['announcements', teamId] })
        }

        // ── COMMENT EVENTS ────────────────────────────────────────────────────

        const onCommentCreated = ({ fileId, authorId }: { fileId: number; authorId: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['comments', fileId] })
            if (!isMe(authorId)) {
                toast('New comment on a file', { icon: '💬', duration: 3000 })
            }
        }

        const onCommentResolved = ({ fileId }: { fileId: number }) => {
            void queryClient.invalidateQueries({ queryKey: ['comments', fileId] })
        }

        // ── DOCUMENT EVENTS ───────────────────────────────────────────────────

        const onDocumentCreated = ({ createdBy }: { createdBy: number }) => {
            if (isMe(createdBy)) return
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast('A team member created a new document', { icon: '📝', duration: 3000 })
        }

        const onDocumentRenamed = ({ renamedBy }: { renamedBy: number }) => {
            if (isMe(renamedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast('A document was renamed', { icon: '✏️', duration: 3000 })
        }

        const onDocumentDeleted = ({ deletedBy }: { deletedBy: number }) => {
            if (isMe(deletedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast('A document was deleted', { icon: '🗑️', duration: 3000 })
        }

        const onDocumentMoved = ({ movedBy }: { movedBy: number }) => {
            if (isMe(movedBy)) return
            void queryClient.invalidateQueries({ queryKey: ['documents', teamId] })
            toast('A document was moved', { icon: '📁', duration: 3000 })
        }

        // ── Register all listeners ────────────────────────────────────────────
        socket.on(SOCKET_EVENTS.FILE_UPLOADED, onFileUploaded)
        socket.on(SOCKET_EVENTS.FILE_DELETED, onFileDeleted)
        socket.on(SOCKET_EVENTS.FILE_RESTORED, onFileRestored)
        socket.on(SOCKET_EVENTS.FILE_RENAMED, onFileRenamed)
        socket.on(SOCKET_EVENTS.FILE_MOVED, onFileMoved)
        socket.on(SOCKET_EVENTS.FOLDER_CREATED, onFolderCreated)
        socket.on(SOCKET_EVENTS.FOLDER_RENAMED, onFolderRenamed)
        socket.on(SOCKET_EVENTS.FOLDER_DELETED, onFolderDeleted)
        socket.on(SOCKET_EVENTS.FOLDER_MOVED, onFolderMoved)
        socket.on(SOCKET_EVENTS.FILE_LOCKED, onFileLocked)
        socket.on(SOCKET_EVENTS.FILE_UNLOCKED, onFileUnlocked)
        socket.on(SOCKET_EVENTS.FILE_LOCK_EXPIRED, onFileUnlocked)
        socket.on(SOCKET_EVENTS.MEMBER_JOINED, onMemberJoined)
        socket.on(SOCKET_EVENTS.MEMBER_LEFT, onMemberLeft)
        socket.on(SOCKET_EVENTS.MEMBER_ROLE_CHANGED, onMemberRoleChanged)
        socket.on(SOCKET_EVENTS.LINK_CREATED, onLinkCreated)
        socket.on(SOCKET_EVENTS.LINK_REVOKED, onLinkRevoked)
        socket.on(SOCKET_EVENTS.ANNOUNCEMENT_POSTED, onAnnouncementPosted)
        socket.on(SOCKET_EVENTS.ANNOUNCEMENT_PINNED, onAnnouncementPinned)
        socket.on(SOCKET_EVENTS.COMMENT_CREATED, onCommentCreated)
        socket.on(SOCKET_EVENTS.COMMENT_RESOLVED, onCommentResolved)
        socket.on(SOCKET_EVENTS.DOCUMENT_CREATED, onDocumentCreated)
        socket.on(SOCKET_EVENTS.DOCUMENT_RENAMED, onDocumentRenamed)
        socket.on(SOCKET_EVENTS.DOCUMENT_DELETED, onDocumentDeleted)
        socket.on(SOCKET_EVENTS.DOCUMENT_MOVED, onDocumentMoved)

        // ── Cleanup ───────────────────────────────────────────────────────────
        return () => {
            socket.off(SOCKET_EVENTS.FILE_UPLOADED, onFileUploaded)
            socket.off(SOCKET_EVENTS.FILE_DELETED, onFileDeleted)
            socket.off(SOCKET_EVENTS.FILE_RESTORED, onFileRestored)
            socket.off(SOCKET_EVENTS.FILE_RENAMED, onFileRenamed)
            socket.off(SOCKET_EVENTS.FILE_MOVED, onFileMoved)
            socket.off(SOCKET_EVENTS.FOLDER_CREATED, onFolderCreated)
            socket.off(SOCKET_EVENTS.FOLDER_RENAMED, onFolderRenamed)
            socket.off(SOCKET_EVENTS.FOLDER_DELETED, onFolderDeleted)
            socket.off(SOCKET_EVENTS.FOLDER_MOVED, onFolderMoved)
            socket.off(SOCKET_EVENTS.FILE_LOCKED, onFileLocked)
            socket.off(SOCKET_EVENTS.FILE_UNLOCKED, onFileUnlocked)
            socket.off(SOCKET_EVENTS.FILE_LOCK_EXPIRED, onFileUnlocked)
            socket.off(SOCKET_EVENTS.MEMBER_JOINED, onMemberJoined)
            socket.off(SOCKET_EVENTS.MEMBER_LEFT, onMemberLeft)
            socket.off(SOCKET_EVENTS.MEMBER_ROLE_CHANGED, onMemberRoleChanged)
            socket.off(SOCKET_EVENTS.LINK_CREATED, onLinkCreated)
            socket.off(SOCKET_EVENTS.LINK_REVOKED, onLinkRevoked)
            socket.off(SOCKET_EVENTS.ANNOUNCEMENT_POSTED, onAnnouncementPosted)
            socket.off(SOCKET_EVENTS.ANNOUNCEMENT_PINNED, onAnnouncementPinned)
            socket.off(SOCKET_EVENTS.COMMENT_CREATED, onCommentCreated)
            socket.off(SOCKET_EVENTS.COMMENT_RESOLVED, onCommentResolved)
            socket.off(SOCKET_EVENTS.DOCUMENT_CREATED, onDocumentCreated)
            socket.off(SOCKET_EVENTS.DOCUMENT_RENAMED, onDocumentRenamed)
            socket.off(SOCKET_EVENTS.DOCUMENT_DELETED, onDocumentDeleted)
            socket.off(SOCKET_EVENTS.DOCUMENT_MOVED, onDocumentMoved)

            socket.emit('leave-team', { teamId })
            socket.disconnect()
        }

    }, [teamId, user?.id, queryClient])
}