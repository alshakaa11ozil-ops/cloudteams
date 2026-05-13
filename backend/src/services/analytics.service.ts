// ============================================================
// analytics.service.ts
// PURPOSE: Compute team metrics for the analytics dashboard.
//          Five independent queries run in parallel via
//          Promise.all and are assembled into one response.
// WHY THIS FILE EXISTS: Analytics is read-only and involves
//          aggregation SQL that doesn't belong in a CRUD
//          service. Keeping it isolated makes it easy to
//          extend later (e.g. add weekly trends, charts).
// ============================================================

import prisma from '../config/database';
import { Prisma } from '@prisma/client';

// ─────────────────────────────────────────────────────────────
// TYPE: AnalyticsResult
// PURPOSE: The exact shape returned to the controller.
//          Typed explicitly so the controller and frontend
//          both know exactly what fields exist.
// ─────────────────────────────────────────────────────────────
export interface AnalyticsResult {
  storage: {
    totalBytes: number;           // raw bytes — for programmatic use
    totalBytesFormatted: string;  // "500.0 MB" — for display
    fileCount: number;            // active (non-deleted) files
  };
  fileTypes: FileTypeRow[];       // breakdown by MIME type
  memberActivity: MemberActivityRow[]; // leaderboard by action count
  uploadsPerDay: UploadsPerDayRow[];   // upload counts over time
  topFolders: TopFolderRow[];          // folders with most files
  largestFiles: LargestFileRow[];      // Top 5 largest files
  activityByType: ActivityByTypeRow[]; // Action breakdown over time
}

// Raw SQL result rows — Prisma returns unknown[] from $queryRaw,
// so we define the expected shape and cast carefully.

interface FileTypeRow {
  mime_type: string;
  count: number;   // BigInt from PostgreSQL COUNT — we convert to number
}

interface MemberActivityRow {
  user_id: number;
  username: string;
  email: string;
  action_count: number;  // BigInt from COUNT — converted
}

interface UploadsPerDayRow {
  day: string;    // ISO date string "2026-04-07"
  count: number;  // BigInt from COUNT — converted
}

interface TopFolderRow {
  folder_id: number;
  folder_name: string;
  file_count: number;  // BigInt from COUNT — converted
}

interface LargestFileRow {
  file_id: number;
  original_name: string;
  file_size: number;
  file_size_formatted: string;
}

interface ActivityByTypeRow {
  day: string;
  action: string;
  count: number;
}

// ════════════════════════════════════════════════════════════
// UTILITY: formatBytes
// PURPOSE: Convert a raw byte count into a human-readable
//          string with appropriate unit (KB, MB, GB).
// INPUTS:  bytes — number of bytes (from SUM aggregate)
// OUTPUTS: string like "500.0 MB" or "1.2 GB"
// WHY HERE: Pure utility with no dependencies — easy to test,
//           easy to move if needed.
// ════════════════════════════════════════════════════════════
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  // Define units in ascending order
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  // Math.floor(Math.log(bytes) / Math.log(1024)) finds which
  // unit tier the number falls into.
  // e.g. 524288000 bytes → index 2 → MB
  const unitIndex = Math.floor(Math.log(bytes) / Math.log(1024));

  // Clamp to the largest unit we have (TB)
  const clampedIndex = Math.min(unitIndex, units.length - 1);

  // Divide down to the right unit and round to 1 decimal
  const value = bytes / Math.pow(1024, clampedIndex);

  return `${value.toFixed(1)} ${units[clampedIndex]}`;
}

// ════════════════════════════════════════════════════════════
// UTILITY: toNumber
// PURPOSE: PostgreSQL COUNT and SUM return BigInt in Node.js
//          via Prisma $queryRaw. BigInt cannot be serialized
//          to JSON (JSON.stringify throws on BigInt values).
//          This converts BigInt → number safely.
// WHY THIS MATTERS: If you forget this conversion,
//   res.json() will throw: "Do not know how to serialize BigInt"
//   This is a very common gotcha with raw SQL + Prisma.
// ════════════════════════════════════════════════════════════
function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  // Fallback: parse string (defensive, shouldn't normally happen)
  return parseInt(String(value), 10);
}

// ════════════════════════════════════════════════════════════
// FUNCTION: getTeamAnalytics
// PURPOSE:  Run 5 parallel queries to build the analytics
//           dashboard payload for one team.
// INPUTS:   teamId — which team to compute metrics for
// OUTPUTS:  AnalyticsResult — fully assembled dashboard data
// WHY PARALLEL: All 5 queries are independent. Running them
//           with Promise.all means total time = slowest query,
//           not the sum of all queries.
// ════════════════════════════════════════════════════════════
export async function getTeamAnalytics(
  teamId: number,
  startDateStr?: string,
  endDateStr?: string
): Promise<AnalyticsResult> {

  const defaultStart = new Date();
  defaultStart.setDate(defaultStart.getDate() - 30); // Default to last 30 days
  const start = startDateStr ? new Date(startDateStr) : defaultStart;
  const end = endDateStr ? new Date(endDateStr) : new Date();

  // ── QUERY 1: Storage totals ─────────────────────────────
  // Prisma aggregate handles SUM and COUNT cleanly for
  // simple cases — no need for raw SQL here.
  // _sum.file_size = total bytes used across all active files
  // _count._all   = number of active files
  const storagePromise = prisma.file.aggregate({
    where: {
      team_id: teamId,
      is_deleted: false,  // exclude soft-deleted files
    },
    _sum: { file_size: true },  // SUM(file_size)
    _count: { _all: true },       // COUNT(*)
  });

  // ── QUERY 2: File type breakdown ────────────────────────
  // We need GROUP BY mime_type with COUNT per group.
  // Prisma's query builder doesn't support this cleanly
  // so we use $queryRaw.
  // COALESCE handles NULL mime_type → shows as 'unknown'
  const fileTypesPromise = prisma.$queryRaw<FileTypeRow[]>`
    SELECT
      COALESCE(mime_type, 'unknown') AS mime_type,
      COUNT(*)                       AS count
    FROM files
    WHERE team_id   = ${teamId}
      AND is_deleted = false
    GROUP BY mime_type
    ORDER BY count DESC
    LIMIT 10
  `;
  // LIMIT 10: We only want the top 10 types for the pie chart.
  // A team could theoretically have 100 MIME types — showing
  // all of them would be unreadable.

  // ── QUERY 3: Member activity leaderboard ────────────────
  // Count activity log entries per user, join to users table
  // to get their name, order by most active first.
  // This shows who is contributing most to the team.
  const memberActivityPromise = prisma.$queryRaw<MemberActivityRow[]>`
    SELECT
      u.id         AS user_id,
      u.username   AS username,
      u.email      AS email,
      COUNT(al.id) AS action_count
    FROM activity_logs al
    JOIN users u ON u.id = al.user_id
    WHERE al.team_id = ${teamId}
      AND al.created_at >= ${start}
      AND al.created_at <= ${end}
    GROUP BY u.id, u.username, u.email
    ORDER BY action_count DESC
    LIMIT 10
  `;
  // We join users directly in SQL here because $queryRaw
  // doesn't support Prisma's include — so we do the join
  // ourselves in the query.

  // ── QUERY 4: Uploads per day (last 7 days) ──────────────
  // DATE_TRUNC('day', created_at) collapses each timestamp
  // to midnight — so all uploads on April 7th become
  // "2026-04-07 00:00:00" and GROUP BY treats them as one group.
  // NOW() - INTERVAL '6 days' gives us the last 7 days
  // including today (day 0 through day 6 = 7 days).
  const uploadsPerDayPromise = prisma.$queryRaw<UploadsPerDayRow[]>`
    SELECT
      DATE_TRUNC('day', created_at)::date AS day,
      COUNT(*)                            AS count
    FROM files
    WHERE team_id   = ${teamId}
      AND is_deleted = false
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY day
    ORDER BY day ASC
  `;
  // ::date casts the result to a plain date (no time component)
  // so it serializes as "2026-04-07" not "2026-04-07T00:00:00Z"
  // which is cleaner for the frontend to display.

  // ── QUERY 5: Most active folders ───────────────────────
  // Count files per folder, join to get folder name.
  // Files with no folder (folder_id IS NULL) are excluded
  // because they live in the team root — not a named folder.
  const topFoldersPromise = prisma.$queryRaw<TopFolderRow[]>`
    SELECT
      f.id          AS folder_id,
      f.name        AS folder_name,
      COUNT(fi.id)  AS file_count
    FROM folders f
    JOIN files fi ON fi.folder_id = f.id
    WHERE f.team_id    = ${teamId}
      AND f.is_deleted  = false
      AND fi.is_deleted = false
    GROUP BY f.id, f.name
    ORDER BY file_count DESC
    LIMIT 5
  `;

  // ── QUERY 6: Largest files ─────────────────────────────
  const largestFilesPromise = prisma.$queryRaw<any[]>`
    SELECT
      id AS file_id,
      original_name,
      file_size
    FROM files
    WHERE team_id = ${teamId}
      AND is_deleted = false
    ORDER BY file_size DESC
    LIMIT 5
  `;

  // ── QUERY 7: Activity by Type ──────────────────────────
  const activityByTypePromise = prisma.$queryRaw<any[]>`
    SELECT
      DATE_TRUNC('day', created_at)::date AS day,
      action,
      COUNT(*) AS count
    FROM activity_logs
    WHERE team_id = ${teamId}
      AND created_at >= ${start}
      AND created_at <= ${end}
    GROUP BY day, action
    ORDER BY day ASC
  `;

  // ── Run all queries simultaneously ──────────────────
  const [
    storageResult,
    fileTypesRaw,
    memberActivityRaw,
    uploadsPerDayRaw,
    topFoldersRaw,
    largestFilesRaw,
    activityByTypeRaw,
  ] = await Promise.all([
    storagePromise,
    fileTypesPromise,
    memberActivityPromise,
    uploadsPerDayPromise,
    topFoldersPromise,
    largestFilesPromise,
    activityByTypePromise,
  ]);

  // ── Process storage result ─────────────────────────────
  // _sum.file_size is null if there are zero files — default to 0
  const totalBytes = toNumber(storageResult._sum.file_size ?? 0);
  const fileCount = toNumber(storageResult._count._all);

  // ── Convert BigInt fields from raw SQL results ─────────
  // Every COUNT(*) from $queryRaw comes back as BigInt.
  // We map each array and convert with toNumber().
  // If we skip this step, res.json() throws at runtime.

  const fileTypes: FileTypeRow[] = fileTypesRaw.map(row => ({
    mime_type: row.mime_type,
    count: toNumber(row.count),
  }));

  const memberActivity: MemberActivityRow[] = memberActivityRaw.map(row => ({
    user_id: toNumber(row.user_id),
    username: row.username,
    email: row.email,
    action_count: toNumber(row.action_count),
  }));

  const uploadsPerDay: UploadsPerDayRow[] = uploadsPerDayRaw.map(row => ({
    // PostgreSQL returns ::date as a JS Date object — convert to ISO string
    // String(row.day) safely converts both a JS Date object and a
    // plain date string to string first. new Date(...) then parses
    // it, and .split('T')[0] extracts just "2026-04-07".
    // This avoids instanceof on unknown, which TypeScript rejects.
    day: new Date(String(row.day)).toISOString().split('T')[0],
    count: toNumber(row.count),
  }));

  const topFolders: TopFolderRow[] = topFoldersRaw.map(row => ({
    folder_id: toNumber(row.folder_id),
    folder_name: row.folder_name,
    file_count: toNumber(row.file_count),
  }));

  const largestFiles: LargestFileRow[] = largestFilesRaw.map(row => ({
    file_id: toNumber(row.file_id),
    original_name: row.original_name,
    file_size: toNumber(row.file_size),
    file_size_formatted: formatBytes(toNumber(row.file_size)),
  }));

  const activityByType: ActivityByTypeRow[] = activityByTypeRaw.map(row => ({
    day: new Date(String(row.day)).toISOString().split('T')[0],
    action: row.action,
    count: toNumber(row.count),
  }));

  // ── Assemble and return final result ───────────────────
  return {
    storage: {
      totalBytes,
      totalBytesFormatted: formatBytes(totalBytes),
      fileCount,
    },
    fileTypes,
    memberActivity,
    uploadsPerDay,
    topFolders,
    largestFiles,
    activityByType,
  };
}
