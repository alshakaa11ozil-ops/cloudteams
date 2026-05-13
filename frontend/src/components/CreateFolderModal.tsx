// src/components/CreateFolderModal.tsx
// PURPOSE: Modal dialog to create a new folder inside a team.
//          Optionally nested under a parent folder.
// INPUTS:
//   teamId         — which team to create the folder in
//   parentFolderId — (optional) makes this a subfolder
//   onSuccess      — called after folder is created (parent invalidates query)
//   onClose        — called when user dismisses modal without creating

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createFolder } from '../api/files'
import toast from 'react-hot-toast'

interface CreateFolderModalProps {
  teamId: number
  parentFolderId?: number
  onSuccess: () => void
  onClose: () => void
}

export default function CreateFolderModal({
  teamId,
  parentFolderId,
  onSuccess,
  onClose,
}: CreateFolderModalProps) {
  const [name, setName] = useState('')

  const mutation = useMutation({
    mutationFn: () => createFolder(teamId, name.trim(), parentFolderId),
    onSuccess: () => {
      // Toast fires before modal closes so the user sees confirmation
      toast.success(`Folder "${name.trim()}" created`)
      onSuccess()  // parent handles cache invalidation + modal close
    },
    // onError is omitted — global axios interceptor shows the red toast
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      // Validation error — show via toast since local error state was removed
      toast.error('Folder name is required')
      return
    }
    mutation.mutate()
  }

  return (
    // Backdrop — clicking outside closes modal
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          {parentFolderId ? 'Create subfolder' : 'Create folder'}
        </h2>

        <form onSubmit={handleSubmit}>
          <input
            id="folder-name-input"
            type="text"
            placeholder="Folder name"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
            maxLength={100}
            className="
              w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              mb-1
            "
          />
          {/* Character counter */}
          <p className="text-xs text-gray-400 text-right mb-3">{name.length}/100</p>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              id="create-folder-submit"
              type="submit"
              disabled={mutation.isPending || !name.trim()}
              className="
                px-4 py-2 rounded-lg text-sm font-medium
                bg-blue-600 text-white hover:bg-blue-700
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors
              "
            >
              {mutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
