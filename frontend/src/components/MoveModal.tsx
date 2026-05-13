// src/components/MoveModal.tsx
// PURPOSE: Unified modal for moving either a file or a folder to a new destination folder.
//          Reuses FolderTree UI to select the destination.
//
// INPUTS:
//   teamId        — context for API calls
//   folders       — flat array of team folders (passed from FileBrowser)
//   itemType      — 'file' | 'folder'
//   itemId        — ID of the item being moved
//   itemName      — name of the item being moved (display only)
//   currentParentId — currently where the item lives (so we don't show it as a destination)
//   onMove        — callback executing the actual move mutation
//   onClose       — callback to dismiss modal

import { useState } from 'react'
import type { FolderWithBreadcrumb } from '@/types'
import FolderTree from './FolderTree'

interface MoveModalProps {
  teamId: number
  folders: FolderWithBreadcrumb[]
  itemType: 'file' | 'folder' | 'document'
  itemId: number
  itemName: string
  currentParentId: number | null
  onMove: (targetFolderId: number | null) => void
  onClose: () => void
}

export default function MoveModal({
  folders,
  itemType,
  itemId,
  itemName,
  currentParentId,
  onMove,
  onClose,
}: MoveModalProps) {
  // Local state for the currently selected destination in the picker
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(currentParentId)

  // We must filter out the item itself (if it's a folder) to prevent circular moves.
  // We don't want a folder to be moved into itself, or its children.
  // Since we already have a flat list, we can filter out the subtree.
  const isValidTarget = (targetId: number | null) => {
    // Cannot move to its own current location
    if (targetId === currentParentId) return true // It's valid to select, but "Move" button will be disabled
    
    // If moving a file or document, any folder is valid
    if (itemType === 'file' || itemType === 'document') return true

    // If moving a folder, ensure we don't move it into itself
    if (targetId === itemId) return false

    // And don't move into descendants (prevent circular reference)
    if (targetId !== null) {
      // Find the ancestors of the target. If itemId is in the ancestors, it's invalid.
      let current = folders.find(f => f.id === targetId)
      while (current) {
        if (current.id === itemId) return false
        if (current.parent_folder_id === null) break
        current = folders.find(f => f.id === current!.parent_folder_id)
      }
    }
    return true
  }

  // Filter the folders BEFORE passing them to FolderTree so invalid targets don't even render
  // (We actually render them but maybe disable selection. Wait, our FolderTree takes a flat list
  // and builds a tree. If we filter out the folder itself, its children also vanish. This is perfect!)
  const filteredFolders = itemType === 'folder' 
    ? folders.filter(f => {
        // Exclude the folder being moved and all its descendants
        let current: any = f
        while (current) {
          if (current.id === itemId) return false
          if (current.parent_folder_id === null) break
          current = folders.find((parent) => parent.id === current.parent_folder_id)
        }
        return true
      })
    : folders

  const canMove = selectedTargetId !== currentParentId && isValidTarget(selectedTargetId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            Move {itemType === 'file' ? 'File' : itemType === 'folder' ? 'Folder' : 'Document'}
          </h2>
          <p className="text-sm text-gray-500 truncate mt-1">"{itemName}"</p>
        </div>

        {/* Scrollable Folder Picker */}
        <div className="p-2 overflow-y-auto grow">
          <p className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wider">
            Select Destination
          </p>
          <div className="border border-gray-200 rounded-lg overflow-hidden pb-2 mx-2">
             {/* We use FolderTree but override the onFolderClick to select, not navigate.
                 We also pass dummy functions for actions since we don't want action buttons here. */}
             <FolderTree
               folders={filteredFolders}
               activeFolderId={selectedTargetId}
               onFolderClick={(id) => {
                 if (isValidTarget(id)) setSelectedTargetId(id)
               }}
               onDeleteFolder={() => {}} // No-op in picker mode
               onRenameFolder={() => {}} // No-op in picker mode
               onMoveFolderRequest={() => {}} // No-op in picker mode
             />
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex justify-end gap-2 bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onMove(selectedTargetId)}
            disabled={!canMove}
            className="
              px-4 py-2 rounded-lg text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-700
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            Move Here
          </button>
        </div>
      </div>
    </div>
  )
}
