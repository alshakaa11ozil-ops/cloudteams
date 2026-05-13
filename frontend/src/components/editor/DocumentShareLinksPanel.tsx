// =============================================================================
// src/components/editor/DocumentShareLinksPanel.tsx
//
// PURPOSE: Side panel showing all share links for the open document.
//   - Editors: see all links, can delete their own
//   - Admins: see all links, can delete any
// =============================================================================

import { useEffect, useState, useCallback } from 'react'
import { fetchDocumentShares } from '../../api/shares'
import { deleteDocumentShareLink } from '../../api/documents'
import type { TeamRole } from '../../types'

interface SharedLink {
  id: number
  token: string
  created_at: string
  expiration_date: string | null
  downloads_count: number
  download_limit: number | null
  created_by: number
}

interface Props {
  teamId: string
  docId: string
  currentUserId: number
  userRole: TeamRole
  onClose: () => void
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function copyLink(token: string) {
  const url = `${window.location.origin}/share/${token}`
  navigator.clipboard.writeText(url).catch(() => {})
}

export default function DocumentShareLinksPanel({ teamId, docId, currentUserId, userRole, onClose }: Props) {
  const [links, setLinks] = useState<SharedLink[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [deletingToken, setDeletingToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = userRole === 'admin'

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await fetchDocumentShares(parseInt(docId, 10), parseInt(teamId, 10))
      setLinks(result)
    } catch {
      setError('Failed to load share links.')
    } finally {
      setIsLoading(false)
    }
  }, [teamId, docId])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (token: string) => {
    setDeletingToken(token)
    try {
      await deleteDocumentShareLink(teamId, docId, token)
      setLinks(prev => prev.filter(l => l.token !== token))
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete link.')
    } finally {
      setDeletingToken(null)
    }
  }

  const handleCopy = (token: string) => {
    copyLink(token)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="flex flex-col h-full bg-slate-850 border-l border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 bg-slate-800">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <h3 className="text-sm font-semibold text-white">Share Links</h3>
          {links.length > 0 && (
            <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full">{links.length}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
          title="Close panel"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Role badge */}
      <div className="px-4 py-2 border-b border-slate-700/50 bg-slate-800/50">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          isAdmin ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
        }`}>
          {isAdmin ? '👑 Admin — can delete any link' : 'Editor — can delete your own links'}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {error && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-24 text-slate-500 text-xs">
            <div className="w-4 h-4 border-2 border-slate-600 border-t-indigo-500 rounded-full animate-spin mr-2" />
            Loading links...
          </div>
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 gap-2 text-slate-500">
            <svg className="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <p className="text-xs">No share links yet</p>
          </div>
        ) : (
          links.map(link => {
            const isExpired = link.expiration_date ? new Date(link.expiration_date) < new Date() : false
            const isLimitReached = link.download_limit !== null && link.downloads_count >= link.download_limit
            const canDelete = isAdmin || link.created_by === currentUserId
            const isActive = !isExpired && !isLimitReached

            return (
              <div
                key={link.token}
                className={`p-3 rounded-xl border text-xs transition-all ${
                  isActive
                    ? 'bg-slate-800 border-slate-700'
                    : 'bg-slate-800/40 border-slate-700/40 opacity-60'
                }`}
              >
                {/* Token + status */}
                <div className="flex items-center gap-2 mb-2">
                  <code className="font-mono text-indigo-300 bg-indigo-500/10 px-1.5 py-0.5 rounded truncate flex-1 max-w-[110px]">
                    {link.token.substring(0, 12)}…
                  </code>
                  {isExpired && (
                    <span className="text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">Expired</span>
                  )}
                  {isLimitReached && !isExpired && (
                    <span className="text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded-full">Limit reached</span>
                  )}
                  {isActive && (
                    <span className="text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded-full">Active</span>
                  )}
                </div>

                {/* Meta */}
                <div className="space-y-0.5 text-slate-400 mb-2">
                  <div>Created: {formatDate(link.created_at)}</div>
                  <div>Expires: {link.expiration_date ? formatDate(link.expiration_date) : 'Never'}</div>
                  <div>Views: {link.downloads_count}{link.download_limit ? ` / ${link.download_limit}` : ''}</div>
                  {!isAdmin && link.created_by !== currentUserId && (
                    <div className="text-slate-500 italic">Created by another user</div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleCopy(link.token)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white transition-colors"
                  >
                    {copied === link.token ? (
                      <>
                        <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>

                  {canDelete && (
                    <button
                      onClick={() => void handleDelete(link.token)}
                      disabled={deletingToken === link.token}
                      className="flex items-center justify-center gap-1 px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-40 disabled:cursor-wait"
                    >
                      {deletingToken === link.token ? (
                        <div className="w-3 h-3 border border-red-400/40 border-t-red-400 rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Refresh */}
      <div className="px-3 py-2 border-t border-slate-700 bg-slate-800/60">
        <button
          onClick={() => void load()}
          className="w-full text-xs text-slate-400 hover:text-white transition-colors flex items-center justify-center gap-1.5 py-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>
    </div>
  )
}
