import prisma from '../config/database';
import { assertTeamMember, AppError } from '../utils/teamGuard';
import { logActivity, ActivityAction, ActivityTargetType } from '../utils/activityLogger';
import { emitToTeam } from '../socket';
import { SOCKET_EVENTS } from '../config/socketEvents';
/**
 * MENTION_REGEX: Looks for the '@' symbol followed by alphanumeric characters.
 * Example matches: "@alice", "@john_doe123"
 */
const MENTION_REGEX = /@(\w+)/g;

/**
 * Add a new comment to a file or document and parse any @mentions to create Activity Logs.
 */
export const addComment = async (teamId: number, userId: number, content: string, fileId?: number, documentId?: number) => {
    // 1. Verify user is at least a viewer in the team
    await assertTeamMember(userId, teamId, 'viewer');

    // 2. Validate the file or document exists, belongs to the team, and is not deleted
    let itemName = '';
    if (fileId) {
        const file = await prisma.file.findFirst({
            where: { id: fileId, team_id: teamId, is_deleted: false }
        });
        if (!file) throw new AppError('File not found or deleted', 404);
        itemName = file.original_name;
    } else if (documentId) {
        const doc = await prisma.documents.findFirst({
            where: { id: documentId, team_id: teamId, is_deleted: false }
        });
        if (!doc) throw new AppError('Document not found or deleted', 404);
        itemName = doc.title;
    } else {
        throw new AppError('Must provide either fileId or documentId', 400);
    }

    // 3. Create the Comment record
    const comment = await prisma.comment.create({
        data: {
            file_id: fileId,
            document_id: documentId,
            team_id: teamId,
            user_id: userId,
            content
        },
        include: { user: { select: { username: true } } }
    });
    void logActivity({
        teamId,
        userId,
        action: 'comment_created',
        targetType: 'comment',
        targetId: comment.id,
        metadata: {
            fileId,
            documentId,
            file_name: itemName, // ← Added for feed visibility (or document title)
            preview: content.slice(0, 100)
        },
    });
    // 4. Parse @Mentions out of the text content
    // content.matchAll returns an iterable of all regex matches
    const matches = Array.from(content.matchAll(MENTION_REGEX));
    // Extracts just the exact matched usernames (maintaining exact case for PostgreSQL)
    const extractedUsernames = matches.map(m => m[1]);

    // Improvement 1: Deduplicate using a Set
    // Improvement 2: Limit to a max of 50 mentions (prevents spam attacks)
    const uniqueUsernames = [...new Set(extractedUsernames)].slice(0, 50);

    if (uniqueUsernames.length > 0) {
        let validMentionedUsers: Array<{ id: number; username: string }> = [];

        // Check if the user is trying to notify the whole team 
        // We use .some() and .toLowerCase() so that @TEAM, @Team, or @team all work, 
        // while preserving the original exact case in uniqueUsernames for real users!
        const wantsToNotifyTeam = uniqueUsernames.some(u => u.toLowerCase() === 'team' || u.toLowerCase() === 'all');

        if (wantsToNotifyTeam) {
            // Find ALL members belonging to this team
            const teamMembers = await prisma.teamMember.findMany({
                where: { team_id: teamId },
                include: { user: { select: { id: true, username: true } } }
            });

            // Extract the user objects and prevent the author from notifying themselves
            validMentionedUsers = teamMembers
                .map(tm => tm.user)
                .filter(u => u.id !== userId);
        } else {
            // Normal specific user mentions
            const mentionedUsers = await prisma.user.findMany({
                where: {
                    username: { in: uniqueUsernames },  // We use the cleaned unique array
                    teams: { some: { team_id: teamId } } // Team-Only Mentions restriction
                },
                select: { id: true, username: true }
            });

            // Prevent Self-Mentions: filter out the author
            validMentionedUsers = mentionedUsers.filter(u => u.id !== userId);
        }

        // 6. Bulk insert an ActivityLog for every verified user that was mentioned
        if (validMentionedUsers.length > 0) {
            const logsToCreate = validMentionedUsers.map(mentionedUser => ({
                team_id: teamId,
                user_id: userId, // the 'author' of the mention
                action: 'user_mentioned' as const,
                target_type: 'comment',
                target_id: comment.id,
                metadata: { mentioned_user_id: mentionedUser.id, mentioned_username: mentionedUser.username },
            }));

            // Improvement 3: We purposely do NOT 'await' this!
            // This guarantees the HTTP response is lightning fast, while the DB writes in the background.
            prisma.activityLog.createMany({ data: logsToCreate })
                .catch(err => console.error('Failed to create mention logs:', err));
        }
    }

    // Real-time notification via helper
    emitToTeam(teamId, SOCKET_EVENTS.COMMENT_CREATED, {
        comment: comment as unknown as Record<string, unknown>,
        fileId: fileId,
        documentId: documentId,
        authorId: userId
    });

    return comment;
};

/**
 * List all non-deleted comments for a specific file or document.
 * Returns them ordered oldest-first to form a natural reading thread.
 */
export const listComments = async (teamId: number, userId: number, fileId?: number, documentId?: number) => {
    await assertTeamMember(userId, teamId, 'viewer');

    return await prisma.comment.findMany({
        where: { 
            team_id: teamId, 
            is_deleted: false,
            ...(fileId ? { file_id: fileId } : {}),
            ...(documentId ? { document_id: documentId } : {})
        },
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    email: true,
                    full_name: true,
                }
            }
        },
        orderBy: { created_at: 'asc' } // Oldest top, newest bottom
    });
};

/**
 * Edit a comment. Applies complex dual-permission rules:
 * - Content edits: Author ONLY.
 * - Resolving: Author, Editor, or Admin.
 */
export const editComment = async (commentId: number, teamId: number, userId: number, newContent?: string, resolved?: boolean) => {
    const membership = await assertTeamMember(userId, teamId, 'viewer');

    // Find the comment first so we can check ownership
    const comment = await prisma.comment.findFirst({
        where: { id: commentId, team_id: teamId, is_deleted: false }
    });

    if (!comment) throw new AppError('Comment not found', 404);

    let updatedData: Partial<{ content: string; resolved: boolean }> = {};

    // Condition 1: Attempting to edit text content
    if (newContent !== undefined) {
        if (comment.user_id !== userId) {
            throw new AppError('Only the comment author can edit the text content', 403);
        }
        updatedData.content = newContent;
    }

    // Condition 2: Attempting to resolve/un-resolve the comment status
    if (resolved !== undefined) {
        const isAuthor = comment.user_id === userId;
        const isEditorOrAdmin = membership.role === 'editor' || membership.role === 'admin';

        if (!isAuthor && !isEditorOrAdmin) {
            throw new AppError('Only the author, editors, or admins can resolve this comment', 403);
        }
        updatedData.resolved = resolved;
    }

    if (Object.keys(updatedData).length === 0) {
        return comment; // Nothing to do
    }

    const updated = await prisma.comment.update({
        where: { id: commentId },
        data: updatedData
    });

    if (resolved !== undefined) {
        // Real-time notification via helper
        emitToTeam(teamId, SOCKET_EVENTS.COMMENT_RESOLVED, {
            commentId: commentId,
            fileId: comment.file_id,
            documentId: comment.document_id,
            resolved: resolved,
            resolvedBy: userId
        });
    }

    return updated;
};

/**
 * Soft delete a comment.
 * Only the Author or an Admin can delete.
 */
export const softDeleteComment = async (commentId: number, teamId: number, userId: number) => {
    const membership = await assertTeamMember(userId, teamId, 'viewer');

    const comment = await prisma.comment.findFirst({
        where: { id: commentId, team_id: teamId, is_deleted: false }
    });

    if (!comment) throw new AppError('Comment not found', 404);

    const isAuthor = comment.user_id === userId;
    const isAdmin = membership.role === 'admin';

    if (!isAuthor && !isAdmin) {
        throw new AppError('Only the author or an admin can delete this comment', 403);
    }

    // Update is_deleted to true instead of hard deleting (to protect audit trail logic)
    await prisma.comment.update({
        where: { id: commentId },
        data: {
            is_deleted: true,
            deleted_at: new Date()
        }
    });

    return { message: 'Comment soft-deleted successfully' };
};
