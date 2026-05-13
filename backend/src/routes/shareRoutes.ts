import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { getMetadataHandler, getTeamContentHandler, downloadFileHandler, revokeLinkHandler, getSharedDocumentHandler } from '../controllers/share.controller';

const router = Router();

// Rate limiter to prevent brute forcing passwords
const shareLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 30, // Limit IP to 30 requests per window
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/share/:token -> Basic Metadata
router.get('/:token', shareLimiter, getMetadataHandler);

// GET /api/share/:token/content -> Browse Team contents (requires ?password=... if protected)
router.get('/:token/content', shareLimiter, getTeamContentHandler);

// POST /api/share/:token/download -> Download a specific file inside the limit
router.post('/:token/download', shareLimiter, downloadFileHandler);

// GET /api/share/:token/document -> View a specific document inside the limit
router.get('/:token/document', shareLimiter, getSharedDocumentHandler);

// DELETE /api/share/:token -> Revoke
router.delete('/:token', authenticate, revokeLinkHandler);

export default router;
