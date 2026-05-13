// src/components/FolderTree.tsx
// PURPOSE: Left-panel recursive folder hierarchy navigation.
//          Converts flat adjacency-list from backend into a rendered tree.
// INPUTS:
//   folders        — flat array of ALL team folders with breadcrumb
//   activeFolderId — currently viewed folder (null = root)
//   onFolderClick  — navigate to a folder
//   onDeleteFolder — soft-delete a folder

import { useState } from 'react'
import type { FolderWithBreadcrumb } from '../types'

interface FolderTreeProps {
  folders: FolderWithBreadcrumb[]
  activeFolderId: number | null
  onFolderClick: (folderId: number | null) => void
  onDeleteFolder: (folderId: number) => void
  onRenameFolder: (folderId: number, newName: string) => void
  onMoveFolderRequest: (folderId: number, folderName: string) => void
  pickerMode?: boolean   // ← when true, hides rename/move/delete buttons (used in MoveModal)
}

interface FolderNode extends FolderWithBreadcrumb {
  children: FolderNode[]
}

// ─── Build nested tree from flat array ────────────────────────────────────────
// Two-pass O(n) algorithm:
// Pass 1 — Map every folder by id
// Pass 2 — Attach each to its parent's children array, or push to roots
function buildTree(folders: FolderWithBreadcrumb[]): FolderNode[] {
  const map = new Map<number, FolderNode>()
  folders.forEach(f => map.set(f.id, { ...f, children: [] }))

  const roots: FolderNode[] = []
  folders.forEach(f => {
    const node = map.get(f.id)!
    if (f.parent_folder_id === null) {
      roots.push(node)
    } else {
      const parent = map.get(f.parent_folder_id)
      if (parent) parent.children.push(node)
      else roots.push(node) // orphan (parent deleted) → show at root
    }
  })
  return roots
}

// ─── Single folder row (recursive) ────────────────────────────────────────────
interface FolderNodeProps {
  node: FolderNode
  depth: number
  activeFolderId: number | null
  onFolderClick: (id: number | null) => void
  onDeleteFolder: (id: number) => void
  onRenameFolder: (id: number, newName: string) => void
  onMoveFolderRequest: (id: number, name: string) => void
  pickerMode?: boolean   // ← propagated down the tree recursively
}

function FolderTreeNode({ node, depth, activeFolderId, onFolderClick, onDeleteFolder, onRenameFolder, onMoveFolderRequest, pickerMode }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const isActive = node.id === activeFolderId
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        className={`
          group flex items-center gap-1.5 py-1.5 pr-2 rounded-lg mx-1 cursor-pointer
          text-sm transition-colors
          ${isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-700 hover:bg-gray-100'}
        `}
        onClick={() => onFolderClick(node.id)}
      >
        {/* Chevron — only shown if has children */}
        {hasChildren ? (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(p => !p) }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 flex-shrink-0"
          >
            <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <span className="w-4 flex-shrink-0" /> // spacer keeps icon aligned
        )}

        {/* Folder icon */}
        <svg className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-blue-500' : 'text-gray-400'}`}
          fill={isActive ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>

        <span className="flex-1 truncate min-w-0">{node.name}</span>

        {/* Actions container — hidden in pickerMode (e.g. MoveModal) */}
        {!pickerMode && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 flex-shrink-0">
            {/* Rename */}
            <button
              onClick={e => {
                e.stopPropagation()
                const newName = window.prompt('Enter new folder name:', node.name)
                if (newName && newName.trim() !== '' && newName !== node.name) {
                  onRenameFolder(node.id, newName.trim())
                }
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-blue-500 transition-colors"
              title="Rename Folder"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>

            {/* Move */}
            <button
              onClick={e => {
                e.stopPropagation()
                onMoveFolderRequest(node.id, node.name)
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-amber-500 transition-colors"
              title="Move Folder"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </button>

            {/* Delete */}
            <button
              id={`delete-folder-${node.id}`}
              onClick={e => {
                e.stopPropagation()
                onDeleteFolder(node.id)
              }}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-500 transition-colors"
              title="Delete Folder"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Children — rendered recursively if expanded */}
      {hasChildren && expanded && node.children.map(child => (
        <FolderTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          onFolderClick={onFolderClick}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onMoveFolderRequest={onMoveFolderRequest}
          pickerMode={pickerMode}   // ← propagate down to all child nodes
        />
      ))}
    </div>
  )
}

// ─── Root component ────────────────────────────────────────────────────────────
export default function FolderTree({ folders, activeFolderId, onFolderClick, onDeleteFolder, onRenameFolder, onMoveFolderRequest, pickerMode }: FolderTreeProps) {
  const tree = buildTree(folders)

  return (
    <div className="py-1">
      {/* "All Files" root entry */}
      <div
        id="folder-tree-root"
        onClick={() => onFolderClick(null)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-lg mx-1 cursor-pointer
          text-sm transition-colors mb-1
          ${activeFolderId === null
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-700 hover:bg-gray-100'}
        `}
      >
        <svg className={`w-4 h-4 flex-shrink-0 ${activeFolderId === null ? 'text-blue-500' : 'text-gray-400'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <span>All Files</span>
      </div>

      <div className="mx-4 border-t border-gray-100 mb-1" />

      {tree.length === 0 ? (
        <p className="px-5 py-2 text-xs text-gray-400 italic">
          No folders yet. Click + to create one.
        </p>
      ) : (
        tree.map(node => (
          <FolderTreeNode
            key={node.id}
            node={node}
            depth={0}
            activeFolderId={activeFolderId}
            onFolderClick={onFolderClick}
            onDeleteFolder={onDeleteFolder}
            onRenameFolder={onRenameFolder}
            onMoveFolderRequest={onMoveFolderRequest}
            pickerMode={pickerMode}   // ← propagate to all root-level nodes
          />
        ))
      )}
    </div>
  )
}
