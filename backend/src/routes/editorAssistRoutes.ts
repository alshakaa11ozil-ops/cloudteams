// =============================================================================
// src/routes/editorAssistRoutes.ts
//
// PURPOSE: Route for the AI editor assistant endpoint.
//          Follows the same pattern as digestRoutes.ts — minimal route file
//          that just wires authenticate middleware to the controller handler.
//
// ROUTE: POST /api/ai/editor-assist
//   Body: { text, instruction, teamId, customPrompt? }
//   Auth: JWT required (authenticate middleware)
// =============================================================================

import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import { editorAssistHandler } from '../controllers/editorAssist.controller'

const router = Router()

// POST /api/ai/editor-assist
// WHY /api/ai/ prefix: Groups all AI endpoints under one namespace.
// Makes it easy to apply a dedicated rate limiter to all AI routes later.
router.post('/ai/editor-assist', authenticate, editorAssistHandler)

export default router
