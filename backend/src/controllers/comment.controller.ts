import { Request, Response } from 'express';
import { addComment, listComments, editComment, softDeleteComment } from '../services/comment.service';
import { AppError } from '../utils/teamGuard';

/**
 * POST /api/teams/:teamId/files/:fileId/comments
 */
export const addCommentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = req.params.fileId ? parseInt(req.params.fileId as string, 10) : undefined;
        const documentId = req.params.documentId ? parseInt(req.params.documentId as string, 10) : undefined;
        const content = req.body.content as string;
        const userId = req.user!.userId;

        if (isNaN(teamId) || (fileId === undefined && documentId === undefined) || !content) {
            res.status(400).json({ error: 'Invalid parameters or missing content' });
            return;
        }

        const comment = await addComment(teamId, userId, content, fileId, documentId);
        res.status(201).json({ message: 'Comment created successfully', comment });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('addCommentHandler Error:', error);
            res.status(500).json({ error: 'Internal server error adding comment' });
        }
    }
};

/**
 * GET /api/teams/:teamId/files/:fileId/comments
 */
export const listCommentsHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const fileId = req.params.fileId ? parseInt(req.params.fileId as string, 10) : undefined;
        const documentId = req.params.documentId ? parseInt(req.params.documentId as string, 10) : undefined;
        const userId = req.user!.userId;

        if (isNaN(teamId) || (fileId === undefined && documentId === undefined)) {
            res.status(400).json({ error: 'Invalid exact ID parameters' });
            return;
        }

        const comments = await listComments(teamId, userId, fileId, documentId);
        res.status(200).json({ comments });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('listCommentsHandler Error:', error);
            res.status(500).json({ error: 'Internal server error listing comments' });
        }
    }
};

/**
 * PATCH /api/teams/:teamId/comments/:commentId
 * Request body can include { content: string, resolved: boolean }
 */
export const editCommentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const commentId = parseInt(req.params.commentId as string, 10);
        const userId = req.user!.userId;

        const { content, resolved } = req.body;

        if (isNaN(teamId) || isNaN(commentId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const updatedComment = await editComment(commentId, teamId, userId, content, resolved);
        res.status(200).json({ message: 'Comment updated successfully', comment: updatedComment });
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('editCommentHandler Error:', error);
            res.status(500).json({ error: 'Internal server error editing comment' });
        }
    }
};

/**
 * DELETE /api/teams/:teamId/comments/:commentId
 */
export const softDeleteCommentHandler = async (req: Request, res: Response): Promise<void> => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10);
        const commentId = parseInt(req.params.commentId as string, 10);
        const userId = req.user!.userId;

        if (isNaN(teamId) || isNaN(commentId)) {
            res.status(400).json({ error: 'Invalid ID parameters' });
            return;
        }

        const result = await softDeleteComment(commentId, teamId, userId);
        res.status(200).json(result);
    } catch (error) {
        if (error instanceof AppError) {
            res.status(error.statusCode).json({ error: error.message });
        } else {
            console.error('softDeleteCommentHandler Error:', error);
            res.status(500).json({ error: 'Internal server error deleting comment' });
        }
    }
};
