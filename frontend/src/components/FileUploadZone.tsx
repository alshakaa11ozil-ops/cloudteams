// src/components/FileUploadZone.tsx
// PURPOSE: Drag-and-drop + click-to-select upload area with a progress bar.
//          Calls uploadFile() from the API layer and shows real-time progress.
// INPUTS:
//   teamId          — team to upload into
//   folderId        — optional folder to place the file in
//   onUploadComplete — called when upload finishes (parent re-fetches file list)
//   onCancel        — called when user clicks cancel

import { useState, useRef, useCallback } from 'react'
import { uploadFile } from '@/api/files'

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
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Core upload logic — shared by drag-and-drop and click-to-select
  const handleUpload = useCallback(async (file: File) => {
    setError('')
    setIsUploading(true)
    setProgress(0)
    setStatusMessage(`Uploading ${file.name}...`)

    try {
      const result = await uploadFile(teamId, file, folderId, (pct) => {
        setProgress(pct)  // onProgress callback — updates progress bar
      })

      setProgress(100)
      setStatusMessage(
        result.isDuplicate
          ? `"${file.name}" already exists — reference added`
          : `"${file.name}" uploaded successfully`
      )

      // Wait a bit longer so the user has time to read "already exists" before UI jumps
      setTimeout(() => {
        onUploadComplete()
      }, 2500)

    } catch (err: unknown) {
      let msg = 'Upload failed';
      if (err && typeof err === 'object') {
        const axErr = err as any;
        if (axErr.response?.data?.error) {
          msg = axErr.response.data.error;
        } else if (axErr.message) {
          msg = axErr.message;
        }
      }
      setError(msg)
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

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-600 mt-2 px-1">{error}</p>
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
