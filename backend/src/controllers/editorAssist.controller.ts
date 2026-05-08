// =============================================================================
// src/controllers/editorAssist.controller.ts
//
// PURPOSE: HTTP handler for POST /api/ai/editor-assist
//          Thin controller — validates request body, delegates to service.
//
// WHY A SEPARATE CONTROLLER (not in file.controller.ts):
//   This endpoint is an AI feature, not a file CRUD operation. It doesn't
//   read/write files on disk. Placing it in file.controller would make that
//   file even larger and violate single-responsibility.
//
// AUTH: Uses the standard authenticate middleware (JWT in Authorization header).
//       The teamId in the body is used for rate limiting, and team membership
//       is verified via assertTeamMember before calling Gemini.
// =============================================================================

import { Request, Response } from 'express'
import { AppError, assertTeamMember } from '../utils/teamGuard'
import { editorAssist } from '../services/AI/editorAssist.service'

export async function editorAssistHandler(req: Request, res: Response): Promise<void> {
    try {
        const userId = req.user!.userId
        const { text, instruction, teamId, customPrompt } = req.body

        // ── Validate required fields ────────────────────────────────────────
        if (!text || typeof text !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "text" field' })
            return
        }

        if (!instruction || typeof instruction !== 'string') {
            res.status(400).json({ error: 'Missing or invalid "instruction" field' })
            return
        }

        const validInstructions = [
            'make_professional', 'summarize', 'fix_grammar',
            'make_shorter', 'make_longer', 'custom'
        ]
        if (!validInstructions.includes(instruction)) {
            res.status(400).json({
                error: `Invalid instruction "${instruction}". Valid: ${validInstructions.join(', ')}`
            })
            return
        }

        const parsedTeamId = parseInt(String(teamId), 10)
        if (isNaN(parsedTeamId)) {
            res.status(400).json({ error: 'Missing or invalid "teamId" field' })
            return
        }

        // ── Team membership check ───────────────────────────────────────────
        // WHY CHECK HERE (not just in the editor):
        //   A malicious user could call this API directly with a teamId they
        //   don't belong to. The editor's Hocuspocus auth doesn't protect
        //   REST endpoints — those run through separate middleware.
        try {
            await assertTeamMember(userId, parsedTeamId, 'viewer')
        } catch (err) {
            if (err instanceof AppError) {
                res.status(err.statusCode).json({ error: err.message })
                return
            }
            throw err
        }

        // ── Call the service ────────────────────────────────────────────────
        const { result } = await editorAssist(
            text,
            instruction as import('../services/AI/editorAssist.service').InstructionKey,
            parsedTeamId,
            customPrompt
        )

        res.json({ result })

    } catch (err: any) {
        // Handle rate limit errors with proper HTTP 429
        if (err.message?.startsWith('RATE_LIMITED:')) {
            res.status(429).json({ error: err.message.replace('RATE_LIMITED: ', '') })
            return
        }

        // Handle Gemini-specific errors
        if (err.message?.startsWith('GEMINI_ERROR:')) {
            res.status(502).json({ error: err.message.replace('GEMINI_ERROR: ', '') })
            return
        }

        console.error('[editorAssistHandler]', err)
        res.status(500).json({ error: err.message || 'AI assistance failed' })
    }
}
