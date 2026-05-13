// src/services/ai/digest.service.ts
//
// PURPOSE: Generate a weekly team activity digest using Gemini.
//          Produces a narrative digest — not just a stats recap, but a
//          genuine insight into team health, productivity patterns, and
//          what needs attention.
//
// WHAT "GOOD" OUTPUT LOOKS LIKE:
//   BAD:  "Your team had 12 actions this week including 3 uploads and 2 comments."
//   GOOD: "The sss team had a strong week — 12 actions, with Alen accounting for 8
//          of them across uploads and comments, suggesting the rest of the team may
//          benefit from a nudge to stay engaged. The Shared Docs folder was the hub
//          of activity. Two files haven't been touched in over 3 weeks — it's worth
//          deciding if they're still relevant or can be archived."

import { callGemini } from './gemini'
import { getCachedResult, setCachedResult } from './aiCache.service'
import { assertTeamMember, AppError } from '../../utils/teamGuard'
import prisma from '../../config/database'

export async function generateDigest(
    teamId: number,
    userId: number,
    force = false
): Promise<{ digest: string; fromCache: boolean; cachedAt?: Date }> {

    // 1. Verify membership
    await assertTeamMember(userId, teamId)

    // 2. Return cached digest if still fresh — skip if force=true
    if (!force) {
        const cached = await getCachedResult(teamId, 'digest', null)
        if (cached) {
            return { digest: cached.result, fromCache: true, cachedAt: cached.cachedAt }
        }
    }

    // 3. Gather data — all queries run in parallel for performance
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const previousPeriodStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const previousPeriodEnd = sevenDaysAgo

    const [team, activityLogs, previousLogs, lockedFiles, staleFiles, totalFiles] = await Promise.all([
        prisma.team.findUnique({
            where: { id: teamId },
            select: { name: true, created_at: true }
        }),
        // This week's activity
        prisma.activityLog.findMany({
            where: { team_id: teamId, created_at: { gte: sevenDaysAgo } },
            include: { user: { select: { username: true } } },
            orderBy: { created_at: 'desc' },
            take: 500
        }),
        // Previous week — for trend comparison
        prisma.activityLog.findMany({
            where: { team_id: teamId, created_at: { gte: previousPeriodStart, lt: previousPeriodEnd } },
            select: { id: true },
        }),
        // Currently locked files
        prisma.file.findMany({
            where: {
                team_id: teamId,
                is_deleted: false,
                lockOwnerUserId: { not: null },
                lockExpiresAt: { gt: new Date() }
            },
            select: {
                original_name: true,
                lockOwner: { select: { username: true } },
                editingStartedAt: true,
            }
        }),
        // Stale files — not touched in 14+ days
        prisma.file.findMany({
            where: {
                team_id: teamId,
                is_deleted: false,
                updated_at: { lt: fourteenDaysAgo }
            },
            select: { original_name: true, updated_at: true },
            take: 5,
            orderBy: { updated_at: 'asc' }
        }),
        // Total files for team health context
        prisma.file.count({
            where: { team_id: teamId, is_deleted: false }
        })
    ])

    if (!team) throw new AppError('Team not found', 404)

    // 4. Compute statistics
    const actionCounts: Record<string, number> = {}
    activityLogs.forEach(log => {
        actionCounts[log.action] = (actionCounts[log.action] ?? 0) + 1
    })

    const userCounts: Record<string, number> = {}
    activityLogs.forEach(log => {
        const name = log.user.username
        userCounts[name] = (userCounts[name] ?? 0) + 1
    })

    const topContributors = Object.entries(userCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([username, count]) => ({ username, count }))

    const folderCounts: Record<string, number> = {}
    activityLogs.forEach(log => {
        const meta = (log.metadata ?? {}) as Record<string, unknown>
        const folderName = meta.folder_name as string | undefined
        if (folderName) {
            folderCounts[folderName] = (folderCounts[folderName] ?? 0) + 1
        }
    })
    const topFolders = Object.entries(folderCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([name, count]) => ({ name, count }))

    const mostActiveFolder = topFolders[0]?.name ?? null

    // Trend: compared to last week
    const thisWeekTotal = activityLogs.length
    const lastWeekTotal = previousLogs.length
    const trend = lastWeekTotal === 0
        ? 'first week of data'
        : thisWeekTotal > lastWeekTotal
            ? `up ${Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100)}% from last week (${lastWeekTotal} actions)`
            : thisWeekTotal < lastWeekTotal
                ? `down ${Math.round(((lastWeekTotal - thisWeekTotal) / lastWeekTotal) * 100)}% from last week (${lastWeekTotal} actions)`
                : 'same as last week'

    // Engagement spread — are contributions concentrated or distributed?
    const uniqueContributors = Object.keys(userCounts).length
    const engagementNote =
        uniqueContributors === 0 ? 'no contributors this week' :
        uniqueContributors === 1 ? `only 1 contributor (${topContributors[0]?.username}) — the rest of the team was quiet` :
        uniqueContributors <= 2 ? `${uniqueContributors} active contributors out of the team` :
        `${uniqueContributors} team members contributed`

    // Lock duration insight
    const lockedWithDuration = lockedFiles.map(f => {
        const hoursLocked = f.editingStartedAt
            ? Math.round((Date.now() - f.editingStartedAt.getTime()) / (1000 * 60 * 60))
            : null
        return { name: f.original_name, lockedBy: f.lockOwner?.username ?? 'unknown', hoursLocked }
    })

    const periodLabel = `${sevenDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

    // 5. Build the data block for Gemini
    const dataLines = [
        `Team: ${team.name}`,
        `Period: ${periodLabel}`,
        `Total actions this week: ${thisWeekTotal} (${trend})`,
        `Breakdown: ${actionCounts['file_uploaded'] ?? 0} uploads, ${actionCounts['comment_created'] ?? 0} comments, ${actionCounts['file_deleted'] ?? 0} deletions, ${actionCounts['file_renamed'] ?? 0} renames, ${actionCounts['file_moved'] ?? 0} moves, ${actionCounts['version_restored'] ?? 0} version restores`,
        `Team engagement: ${engagementNote}`,
        `Top contributors: ${topContributors.length > 0
            ? topContributors.map(c => `${c.username} (${c.count} actions, ${Math.round((c.count / Math.max(thisWeekTotal, 1)) * 100)}% of all activity)`).join('; ')
            : 'None'}`,
        `Most active folder(s): ${topFolders.length > 0 ? topFolders.map(f => `${f.name} (${f.count} actions)`).join(', ') : 'None'}`,
        `Total files in team: ${totalFiles}`,
        `Currently locked files: ${lockedWithDuration.length > 0
            ? lockedWithDuration.map(f => `${f.name} locked by ${f.lockedBy}${f.hoursLocked != null ? ` for ${f.hoursLocked}h` : ''}`).join('; ')
            : 'None'}`,
        `Stale files (14+ days untouched): ${staleFiles.length > 0
            ? staleFiles.map(f => {
                const days = Math.floor((Date.now() - f.updated_at.getTime()) / 86400000)
                return `${f.original_name} (${days} days old)`
            }).join('; ')
            : 'None'}`,
    ]

    const dataBlock = dataLines.join('\n')

    // 6. Build the prompt
    const prompt = buildDigestPrompt({
        teamName: team.name,
        dataBlock,
        hasActivity: thisWeekTotal > 0,
        topContributors,
        lockedFiles: lockedWithDuration,
        staleFiles,
        trend,
        engagementNote,
        uniqueContributors,
    })

    try {
        // 2000 tokens: ensuring full completion of the digest without mid-sentence truncation
        const digest = await callGemini(prompt, 2000, { temperature: 0.3 })
        await setCachedResult(teamId, 'digest', null, digest)
        return { digest, fromCache: false }
    } catch (err) {
        console.error('[generateDigest] Gemini error:', err)
        const topName = topContributors[0]
        const fallback = [
            `Week of ${periodLabel} — ${thisWeekTotal} total actions.`,
            ` Uploads: ${actionCounts['file_uploaded'] ?? 0} | Comments: ${actionCounts['comment_created'] ?? 0} | Deletes: ${actionCounts['file_deleted'] ?? 0}.`,
            topName ? ` Most active: ${topName.username} (${topName.count} actions).` : '',
            lockedWithDuration.length > 0 ? ` ⚠️ ${lockedWithDuration.length} file(s) currently locked.` : '',
            staleFiles.length > 0 ? ` ${staleFiles.length} file(s) untouched for 14+ days.` : ''
        ].join('')
        return { digest: fallback, fromCache: false }
    }
}

// ─── Prompt Builder ────────────────────────────────────────────────────────────

interface DigestPromptParams {
    teamName: string
    dataBlock: string
    hasActivity: boolean
    topContributors: { username: string; count: number }[]
    lockedFiles: { name: string; lockedBy: string; hoursLocked: number | null }[]
    staleFiles: { original_name: string; updated_at: Date }[]
    trend: string
    engagementNote: string
    uniqueContributors: number
}

function buildDigestPrompt(p: DigestPromptParams): string {
    // Build a tight, structured facts block
    const top3 = p.topContributors.slice(0, 3)
    const topLine = top3.length > 0
        ? top3.map((c, i) => `${i + 1}. ${c.username}: ${c.count} actions`).join(' | ')
        : 'No contributors this period'

    const attentionItems: string[] = []
    if (p.lockedFiles.length > 0) {
        attentionItems.push(`Locked files: ${p.lockedFiles.map(f => `${f.name} (${f.lockedBy}${f.hoursLocked != null ? `, ${f.hoursLocked}h` : ''})`).join(', ')}`)
    }
    if (p.staleFiles.length > 0) {
        const staleDays = p.staleFiles.map(f => {
            const days = Math.floor((Date.now() - f.updated_at.getTime()) / 86400000)
            return `${f.original_name} (${days}d)`
        })
        attentionItems.push(`Stale files: ${staleDays.join(', ')}`)
    }

    return `You are a team status reporter for CloudTeams. Write a concise weekly activity report.

DATA (use exact numbers — do not invent):
${p.dataBlock}

${!p.hasActivity ? '⚠️ NO ACTIVITY this week. Output one short encouraging sentence only.' : ''}

Write a SHORT status report in plain text — maximum 5 sentences total. Structure:

Sentence 1: State the week and total actions in one clear fact sentence. Include the trend (${p.trend}).
Sentence 2: List the top breakdown facts: uploads, comments, deletes, and unique contributors.
Sentence 3: Name the top contributor(s): ${topLine}. Mention the most active folder if there is one.
${attentionItems.length > 0
    ? `Sentence 4: Flag the following items that need attention — ${attentionItems.join('; ')}.`
    : `Sentence 4 (optional): Add one useful insight from the data only if it is non-obvious.`}

RULES:
- Plain text only. No markdown, no bullets, no bold, no headers.
- Never use phrases like "keep up the great work", "great job", or generic encouragement.
- Every sentence must be factually grounded in the data above.
- Do NOT write more than 5 sentences under any circumstances.`.trim()
}
