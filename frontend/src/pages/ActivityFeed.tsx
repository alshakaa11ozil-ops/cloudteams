// =============================================================================
// src/pages/ActivityFeed.tsx
// FIXES:
//   - HIDDEN_METADATA_KEYS constant now actually used in both filter calls
//   - Added lock_acquired, lock_released, lock_force_released, version_restored
//     to actionConfig so those events have icons + colors
//   - metadata targetName also checks 'file_name' from version_restored logs
// =============================================================================

import React, { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fetchActivity } from '@/api/files'
import type { ActivityAction, ActivityEntry } from '@/types'


// Which metadata keys are USEFUL to show (whitelist approach for sensitive actions)
// Only show these if they're present
const VISIBLE_METADATA_KEYS = new Set([
  'restored_to_version',  // "restored to version 3" — useful context
  'version_number',       // version context
])

const actionConfig: Record<string, { icon: React.ReactNode; bgColor: string; textColor: string }> = {
  file_uploaded: { icon: <UploadIcon />, bgColor: 'bg-green-100', textColor: 'text-green-600' },
  file_deleted: { icon: <DeleteIcon />, bgColor: 'bg-red-100', textColor: 'text-red-500' },
  file_renamed: { icon: <EditIcon />, bgColor: 'bg-purple-100', textColor: 'text-purple-600' },
  file_restored: { icon: <RestoreIcon />, bgColor: 'bg-indigo-100', textColor: 'text-indigo-600' },
  folder_created: { icon: <FolderIcon />, bgColor: 'bg-teal-100', textColor: 'text-teal-600' },
  folder_deleted: { icon: <DeleteIcon />, bgColor: 'bg-rose-100', textColor: 'text-rose-500' },
  folder_restored: { icon: <RestoreIcon />, bgColor: 'bg-indigo-100', textColor: 'text-indigo-600' },
  version_restored: { icon: <RestoreIcon />, bgColor: 'bg-blue-100', textColor: 'text-blue-600' },
  comment_created: { icon: <CommentIcon />, bgColor: 'bg-pink-100', textColor: 'text-pink-600' },
  // Lock events — added (were missing from original config)
  lock_acquired: { icon: <LockIcon />, bgColor: 'bg-amber-100', textColor: 'text-amber-600' },
  lock_released: { icon: <UnlockIcon />, bgColor: 'bg-gray-100', textColor: 'text-gray-600' },
  lock_force_released: { icon: <LockIcon />, bgColor: 'bg-red-100', textColor: 'text-red-600' },
  // Legacy keys that may exist in older log entries
  file_locked: { icon: <LockIcon />, bgColor: 'bg-amber-100', textColor: 'text-amber-600' },
  file_unlocked: { icon: <UnlockIcon />, bgColor: 'bg-gray-100', textColor: 'text-gray-600' },
  // Add these two entries to actionConfig in ActivityFeed.tsx:
  folder_moved: { icon: <FolderIcon />, bgColor: 'bg-teal-100', textColor: 'text-teal-600' },
  file_moved: { icon: <EditIcon />, bgColor: 'bg-purple-100', textColor: 'text-purple-600' },
  file_version_created: { icon: <UploadIcon />, bgColor: 'bg-blue-100', textColor: 'text-blue-600' },
}

// Human-readable sentence for each action
// WHY a map instead of split('_'): "lock_acquired" → "Lock Acquired" looks robotic.
// "started editing" is what a person would actually say.
const ACTION_SENTENCES: Record<string, string> = {
  file_uploaded: 'uploaded',
  file_deleted: 'deleted',
  file_renamed: 'renamed',
  file_restored: 'restored',
  folder_created: 'created folder',
  folder_deleted: 'deleted folder',
  folder_restored: 'restored folder',
  version_restored: 'restored a version of',
  comment_created: 'commented on',
  lock_acquired: 'started editing',
  lock_released: 'finished editing',
  lock_force_released: 'force-unlocked',
  file_locked: 'started editing',
  file_unlocked: 'finished editing',
  folder_moved: 'moved folder',
  file_moved: 'moved',
  file_version_created: 'uploaded a new version of',
}

export default function ActivityFeed() {
  const { id } = useParams<{ id: string }>()
  const teamId = parseInt(id || '0', 10)
  const [page, setPage] = useState(1)
  const [filterAction, setFilterAction] = useState<ActivityAction | ''>('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['activity', teamId, page, filterAction],
    queryFn: () => fetchActivity(teamId, { page, limit: 20, action: filterAction || undefined }),
    enabled: teamId > 0,
    staleTime: 30_000,
  })

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-8 py-6 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Activity Feed</h1>
        <select
          value={filterAction}
          onChange={e => { setFilterAction(e.target.value as ActivityAction | ''); setPage(1) }}
          className="border-gray-200 rounded-lg text-sm bg-white focus:ring-blue-500 focus:border-blue-500 px-3 py-2 shadow-sm border"
        >
          <option value="">All Types</option>
          <option value="file_uploaded">File Uploads</option>
          <option value="lock_acquired">Edits (Lock)</option>
          <option value="file_deleted">Deletions</option>
          <option value="file_restored">Restores</option>
          <option value="file_renamed">Renames</option>
          <option value="folder_created">Folder Created</option>
          <option value="folder_deleted">Folder Deleted</option>
          <option value="version_restored">Version Restored</option>
          <option value="comment_created">Comments</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
        {isLoading && <Spinner />}
        {isError && <ErrorMsg text="Failed to load activity feed." />}
        {!isLoading && !isError && (!data?.data || data.data.length === 0) && (
          <EmptyState text="No activity recorded yet." />
        )}

        {data?.data && data.data.length > 0 && (
          <div className="max-w-3xl space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[8.5rem] md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-gray-200 before:to-transparent">
            {data.data.map((entry: ActivityEntry) => {
              const config = actionConfig[entry.action] ?? { icon: <UploadIcon />, bgColor: 'bg-gray-100', textColor: 'text-gray-600' }
              const metadata = (entry.metadata ?? {}) as Record<string, unknown>

              // Extract the display name — check all possible keys in priority order
              const targetName = String(
                metadata.file_name ??     // Default key for uploads/deletions/locks
                metadata.folder_name ??   // Default key for folders
                metadata.oldName ??       // Specific key for renames
                metadata.name ??          // Legacy/Fallback
                `item #${entry.target_id ?? '?'}`
              )

              const sentence = ACTION_SENTENCES[entry.action] ?? entry.action.replace(/_/g, ' ')

              // Only show metadata box for whitelisted keys that add real context
              const visibleMeta = Object.entries(metadata).filter(
                ([k]) => VISIBLE_METADATA_KEYS.has(k)
              )

              return (
                <div key={entry.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group select-none">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-gray-50 shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 bg-white relative z-10">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center ${config.bgColor} ${config.textColor}`}>
                      {config.icon}
                    </span>
                  </div>

                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-4 rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <span className="text-sm font-bold text-gray-900">{entry.user.username}</span>
                      <span className="text-xs font-semibold text-gray-500">
                        {format(new Date(entry.created_at), 'h:mm a · MMM d, yyyy')}
                      </span>
                    </div>

                    <p className="text-sm text-gray-700 leading-relaxed">
                      {sentence}{' '}
                      <span className="font-semibold text-blue-700">'{targetName}'</span>
                    </p>

                    {/* Only show the detail box when there's genuinely useful context */}
                    {visibleMeta.length > 0 && (
                      <div className="mt-2 bg-gray-50 p-2 rounded text-xs text-gray-500 border border-gray-100">
                        {visibleMeta.map(([k, v]) => (
                          <span key={k} className="mr-3">
                            {k.replace(/_/g, ' ')}: <span className="font-medium text-gray-700">{String(v)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {data?.pagination && data.pagination.totalPages > 1 && (
          <div className="mt-8 flex justify-center gap-2 pb-8 max-w-3xl">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-4 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-50 font-medium text-gray-700">Previous</button>
            <div className="px-4 py-2 text-sm text-gray-500 font-medium">Page {page} of {data.pagination.totalPages}</div>
            <button onClick={() => setPage(p => Math.min(data.pagination.totalPages, p + 1))} disabled={page === data.pagination.totalPages} className="px-4 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-50 font-medium text-gray-700">Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

function UploadIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg> }
function DeleteIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> }
function LockIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg> }
function UnlockIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg> }
function EditIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg> }
function RestoreIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> }
function FolderIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg> }
function CommentIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg> }
function Spinner() { return <div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div> }
function ErrorMsg({ text }: { text: string }) { return <div className="flex items-center justify-center h-full text-red-500 font-medium">{text}</div> }
function EmptyState({ text }: { text: string }) { return <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4"><svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><p className="text-lg">{text}</p></div> }