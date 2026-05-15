import { useState, useEffect } from 'react'
import { History, X, Clock, Loader2, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { fetchDocumentVersions, createDocumentVersion, restoreDocumentVersion } from '../../api/documents'
import type { DocumentVersion } from '../../api/documents'

interface VersionHistoryPanelProps {
  teamId: string
  docId: string
  onClose: () => void
}

export default function VersionHistoryPanel({ teamId, docId, onClose }: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [newVersionName, setNewVersionName] = useState('')
  const [showNameInput, setShowNameInput] = useState(false)

  useEffect(() => {
    loadVersions()
  }, [teamId, docId])

  const loadVersions = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await fetchDocumentVersions(teamId, docId)
      setVersions(data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load versions')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateVersion = async () => {
    setIsCreating(true)
    setError(null)
    try {
      await createDocumentVersion(teamId, docId, newVersionName || undefined)
      await loadVersions()
      setNewVersionName('')
      setShowNameInput(false)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save version')
    } finally {
      setIsCreating(false)
    }
  }

  const handleRestore = async (versionId: number) => {
    if (!confirm('Are you sure you want to restore this version? All current unsaved changes will be overwritten.')) return

    setIsRestoring(true)
    setError(null)
    try {
      await restoreDocumentVersion(teamId, docId, versionId)
      // The backend emits a socket event to reload the document state in CollaborativeEditor
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to restore version')
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <div className="w-80 border-l border-slate-700 bg-slate-800 flex flex-col h-full shadow-xl">
      <div className="p-4 border-b border-slate-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <History className="w-4 h-4 text-indigo-400" />
          <h2>Version History</h2>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 border-b border-slate-700 shrink-0">
        {!showNameInput ? (
          <button 
            onClick={() => setShowNameInput(true)}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Save Current State
          </button>
        ) : (
          <div className="space-y-2">
            <input 
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              placeholder="Name this version (optional)"
              className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-1.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button 
                onClick={handleCreateVersion}
                disabled={isCreating}
                className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
              <button 
                onClick={() => {
                  setShowNameInput(false)
                  setNewVersionName('')
                }}
                className="flex-1 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-md text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 text-red-400 text-sm rounded-md border border-red-500/20">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center p-8 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center p-8 text-slate-500 text-sm">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="font-medium text-slate-400">No versions yet.</p>
            <p className="mt-2 text-xs leading-relaxed">
              Version 1 will be created automatically the first time you start typing in this document.
              Use <span className="text-indigo-400 font-medium">Save Current State</span> above to save additional snapshots at any time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((version, idx) => (
              <div key={version.id} className="p-3 bg-slate-900/50 border border-slate-700 rounded-lg group hover:border-indigo-500/50 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">
                      {version.versionName || (idx === 0 ? 'Latest Auto-save' : `Version ${versions.length - idx}`)}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white font-bold">
                      {(version.creatorName || '?')[0].toUpperCase()}
                    </span>
                    {version.creatorName || 'System'}
                  </span>
                  
                  <button 
                    onClick={() => handleRestore(version.id)}
                    disabled={isRestoring}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
