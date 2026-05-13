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
//
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

    if (!cached) return null  // cache miss — never been generated

    // Check expiry — if expires_at is in the past, treat as miss
    if (cached.expires_at < new Date()) return null

    return { result: cached.result, cachedAt: cached.created_at }
}

// ─── setCachedResult ────────────────────────────────────────────────────────
//
// PURPOSE: Store an AI result in the cache after a successful Gemini call.
//
// WHY UPSERT: If the user regenerates (af0ter cooldown expires), we overwrite
//   the old entry rather than inserting a duplicate.
//
// INPUTS:
//   teamId    — which team owns this cache entry
//   feature   — which AI feature
//   targetId  — optional file ID (null for digest)
//   result    — the AI output string to store
//
export async function setCachedResult(
    teamId: number,
    feature: AiFeature,
    targetId: number | null,
    result: string
): Promise<void> {

    const cooldownMs = AI_COOLDOWNS[feature]

    // If cooldown is very short (duplicate_explain), set expires_at accordingly.
    const expiresAt = new Date(Date.now() + Math.max(cooldownMs, 1000))

    // Prisma's upsert does not support null values in composite unique keys.
    // We use a findFirst + conditional write to safely handle targetId being null.
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
