import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { addCommentHandler, listCommentsHandler, editCommentHandler, softDeleteCommentHandler } from '../controllers/comment.controller';

const router = Router();

// GET /api/teams/:teamId/files/:fileId/comments
// List all comments for a file
router.get('/:teamId/files/:fileId/comments', authenticate, listCommentsHandler);

// POST /api/teams/:teamId/files/:fileId/comments
// Add a new comment to a file
router.post('/:teamId/files/:fileId/comments', authenticate, addCommentHandler);

// GET /api/teams/:teamId/documents/:documentId/comments
// List all comments for a document
router.get('/:teamId/documents/:documentId/comments', authenticate, listCommentsHandler);

// POST /api/teams/:teamId/documents/:documentId/comments
// Add a new comment to a document
router.post('/:teamId/documents/:documentId/comments', authenticate, addCommentHandler);

// PATCH /api/teams/:teamId/comments/:commentId
// Edit comment text or resolve status
router.patch('/:teamId/comments/:commentId', authenticate, editCommentHandler);

// DELETE /api/teams/:teamId/comments/:commentId
// Soft-delete a comment
router.delete('/:teamId/comments/:commentId', authenticate, softDeleteCommentHandler);

export default router;
