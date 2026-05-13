// src/controllers/digest.controller.ts
//
// PURPOSE: HTTP handler for POST /api/teams/:teamId/digest
// THIN CONTROLLER — just validates params and delegates to service

import { Request, Response } from 'express'
import { AppError } from '../utils/teamGuard'
import { generateDigest } from '../services/AI/digest.service'

export async function generateDigestHandler(req: Request, res: Response): Promise<void> {
    try {
        const teamId = parseInt((req.params.id || req.params.teamId) as string, 10)
        const userId = req.user!.userId

        if (isNaN(teamId)) {
            res.status(400).json({ error: 'Invalid team ID' })
            return
        }

        const force = req.body?.force === true

        const result = await generateDigest(teamId, userId, force)

        res.json({
            digest: result.digest,
            fromCache: result.fromCache,
            cachedAt: result.cachedAt ?? null,
            // Tell the frontend how long until they can regenerate
            nextRefreshAt: result.fromCache && result.cachedAt
                ? new Date(result.cachedAt.getTime() + 6 * 60 * 60 * 1000)
                : null
        })

    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        console.error('[generateDigestHandler]', err)
        res.status(500).json({ error: 'Failed to generate digest' })
    }
}