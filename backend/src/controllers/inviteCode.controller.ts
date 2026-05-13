// backend/src/controllers/inviteCode.controller.ts

import { Request, Response } from 'express'
import {
    joinTeamByCode,
    regenerateInviteCode,
    getInviteCode,
} from '../services/inviteCode.service'

// GET /api/teams/:id/invite-code
export async function getInviteCodeHandler(req: Request, res: Response) {
    try {
        const teamId = parseInt(req.params.id as string, 10)
        const result = await getInviteCode(teamId, req.user!.userId)
        res.json(result)
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'FORBIDDEN') return res.status(403).json({ error: 'Admins only' })
        if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Team not found' })
        res.status(500).json({ error: 'Server error' })
    }
}

// POST /api/teams/:id/invite-code/regenerate
export async function regenerateInviteCodeHandler(req: Request, res: Response) {
    try {
        const teamId = parseInt(req.params.id as string, 10)
        const code = await regenerateInviteCode(teamId, req.user!.userId)
        res.json({ code })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'FORBIDDEN') return res.status(403).json({ error: 'Admins only' })
        res.status(500).json({ error: 'Server error' })
    }
}

// POST /api/teams/join
export async function joinTeamHandler(req: Request, res: Response) {
    try {
        const { code } = req.body as { code: string }

        if (!code?.trim()) {
            return res.status(400).json({ error: 'Invite code is required' })
        }

        const team = await joinTeamByCode(code, req.user!.userId)
        res.json({ message: 'Joined team successfully', team })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : ''
        if (msg === 'INVALID_CODE') {
            return res.status(404).json({ error: 'Invalid or expired invite code' })
        }
        if (msg === 'ALREADY_MEMBER') {
            return res.status(409).json({ error: 'You are already a member of this team' })
        }
        res.status(500).json({ error: 'Server error' })
    }
}
