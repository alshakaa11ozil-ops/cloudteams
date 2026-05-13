// src/components/FileUploadZone.tsx
// PURPOSE: Drag-and-drop + click-to-select upload area with a progress bar.
//          Calls uploadFile() from the API layer and shows real-time progress.
// INPUTS:
//   teamId          — team to upload into
//   folderId        — optional folder to place the file in
//   onUploadComplete — called when upload finishes (parent re-fetches file list)
//   onCancel        — called when user clicks cancel

import { useState, useRef, useCallback } from 'react'
import { uploadFile } from '../api/files'
// toast for upload result feedback
import toast from 'react-hot-toast'

interface FileUploadZoneProps {
  teamId: number
  folderId?: number
  onUploadComplete: () => void
  onCancel: () => void
}

export default function FileUploadZone({
  teamId,
  folderId,
  onUploadComplete,
  onCancel,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [duplicateInfo, setDuplicateInfo] = useState<string | null>(null)


  // Core upload logic — shared by drag-and-drop and click-to-select
  const handleUpload = useCallback(async (file: File) => {
    setIsUploading(true)
    setProgress(0)
    setStatusMessage(`Uploading ${file.name}...`)

    try {
      const result = await uploadFile(teamId, file, folderId, (pct) => {
        setProgress(pct)  // updates progress bar in real time
      })

      setProgress(100)

      // Show different toast messages for new upload vs. deduplication.
      // WHY different messages: deduplication is a feature — the user should
      // know their file was recognized and a reference was added, not re-stored.
      if (result.isDuplicate) {
        setStatusMessage(`"${file.name}" already exists — reference added`)
        // @ts-ignore
        setDuplicateInfo(result.duplicateReason ?? result.explanation ?? 'This file already exists.')
        toast('Duplicate detected — see details below', { icon: '📋', duration: 3000 })
        // Do NOT auto-close — let the user read the AI explanation first.
        // They close manually via the banner X or the Cancel button.
        setIsUploading(false)
      } else {
        setStatusMessage(`"${file.name}" uploaded successfully`)
        toast.success(`"${file.name}" uploaded!`)
        // Auto-close after a short delay so the user sees the success state
        setTimeout(() => { onUploadComplete() }, 1500)
      }

    } catch {
      // Global axios interceptor already shows the red error toast.
      // We just need to reset local UI state.
      setStatusMessage('')
      setIsUploading(false)
      setProgress(0)
    }
  }, [teamId, folderId, onUploadComplete])

  // Drag event handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()  // required to allow drop
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void handleUpload(file)
  }

  // Click-to-select handler
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleUpload(file)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">

      {/* Drop zone */}
      <div
        id="upload-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isUploading && inputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors
          ${isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }
          ${isUploading ? 'cursor-not-allowed' : ''}
        `}
      >
        {/* Hidden file input — triggered by clicking the zone */}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          disabled={isUploading}
        />

        {!isUploading ? (
          <>
            <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <p className="text-sm text-gray-600 mb-1">
              <span className="text-blue-600 font-medium">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-gray-400">Maximum file size: 50 MB</p>
          </>
        ) : (
          <div className="py-2">
            <p className="text-sm text-gray-700 mb-3">{statusMessage}</p>
            {/* Progress bar */}
            <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{progress}%</p>
          </div>
        )}
      </div>

      {duplicateInfo && (
        <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
          {/* Info icon */}
          <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1">
              📋 Duplicate File Detected
            </p>
            <p className="text-sm text-blue-800 leading-relaxed whitespace-pre-wrap font-mono">
              {duplicateInfo}
            </p>
            {/* Dismiss + done — clicking this closes the whole upload zone */}
            <button
              onClick={() => { setDuplicateInfo(null); onUploadComplete() }}
              className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
            >
              Got it — close
            </button>
          </div>
          {/* X button just hides the banner but keeps zone open */}
          <button
            onClick={() => setDuplicateInfo(null)}
            className="text-blue-400 hover:text-blue-600 flex-shrink-0"
            title="Dismiss explanation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}


      {/* Cancel button — only shown when not uploading */}
      {!isUploading && (
        <div className="flex justify-end mt-3">
          <button
            onClick={onCancel}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
