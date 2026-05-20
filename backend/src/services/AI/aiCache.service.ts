// src/services/ai/aiCache.service.ts
//
// PURPOSE: Check for a cached AI result before calling Gemini.
//          Write the result to cache after a successful AI call.
//
// WHY THIS EXISTS:
//   Gemini Flash is free but has rate limits (15 req/min).
//   More importantly, AI responses are slow (1-3 seconds).
//   Caching means: second request returns in <10ms instead of 2000ms.
//   During the defense demo, this makes the feature feel instant.
//
// DESIGN: Uses upsert so re-generating always overwrites the old cache entry.
//   This means a user can force-refresh by waiting for the cooldown to expire.

import prisma from '../../config/database'

// Cooldown durations in milliseconds
// These are the single source of truth — change here to adjust all features
export const AI_COOLDOWNS = {
    digest: 6 * 60 * 60 * 1000,          // 6 hours  — team digest
    file_summary: 24 * 60 * 60 * 1000,   // 24 hours — file content rarely changes
    duplicate_explain: 30 * 60 * 1000,   // 30 min   — prevents rate spikes on repeated uploads
    analytics_summary: 6 * 60 * 60 * 1000, // 6 hours — team analytics
} as const

export type AiFeature = keyof typeof AI_COOLDOWNS

// ─── getCachedResult ────────────────────────────────────────────────────────
//
// PURPOSE: Return cached AI result if it exists and hasn't expired.
//
// INPUTS:
//   teamId    — which team's cache to check
//   feature   — which AI feature ('digest', 'file_summary', etc.)
//   targetId  — optional file/folder ID (null for team-level features like digest)
//
// OUTPUTS: cached result string, or null if cache miss / expired
export async function getCachedResult(
    teamId: number,
    feature: AiFeature,
    targetId: number | null = null
): Promise<{ result: string; cachedAt: Date } | null> {
    const cached = await prisma.ai_cache.findFirst({
        where: {
            team_id: teamId,
            feature,
            target_id: targetId
        }
    })
    if (!cached) return null
    if (cached.expires_at < new Date()) return null
    return { result: cached.result, cachedAt: cached.created_at }
}
// ─── setCachedResult ────────────────────────────────────────────────────────
export async function setCachedResult(
    teamId: number,
    feature: AiFeature,
    targetId: number | null,
    result: string
): Promise<void> {
    const cooldownMs = AI_COOLDOWNS[feature]
    const expiresAt = new Date(Date.now() + Math.max(cooldownMs, 1000))

    const existing = await prisma.ai_cache.findFirst({
        where: {
            team_id: teamId,
            feature,
            target_id: targetId
        }
    })

    if (existing) {
        await prisma.ai_cache.update({
            where: { id: existing.id },
            data: {
                result,
                created_at: new Date(),
                expires_at: expiresAt
            }
        })
    } else {
        await prisma.ai_cache.create({
            data: {
                team_id: teamId,
                feature,
                target_id: targetId,
                result,
                expires_at: expiresAt
            }
        })
    }
}
