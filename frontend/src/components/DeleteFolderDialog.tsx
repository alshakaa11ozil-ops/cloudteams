// src/components/DeleteFolderDialog.tsx
// PURPOSE: Modal for confirming folder deletion when the folder contains files.
//          Gives the user the choice to delete everything or keep the files.
//
// INPUTS:
//   folderName — name of the folder being deleted
//   onConfirm  — callback executing the delete mutation with the chosen mode
//   onClose    — callback to dismiss dialog

interface DeleteFolderDialogProps {
  folderName: string
  onConfirm: (mode: 'files' | 'true') => void
  onClose: () => void
}

export default function DeleteFolderDialog({ folderName, onConfirm, onClose }: DeleteFolderDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm shadow-2xl"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center gap-3 mb-4 text-red-600">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-lg font-bold text-gray-900">Delete Folder</h2>
        </div>

        <p className="text-sm text-gray-600 mb-6">
          The folder <strong>"{folderName}"</strong> contains files. What would you like to do with them?
        </p>

        <div className="space-y-3 mb-6">
          <button
            onClick={() => onConfirm('files')}
            className="w-full text-left p-4 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors group"
          >
            <p className="font-semibold text-gray-900 group-hover:text-blue-700">Keep files</p>
            <p className="text-sm text-gray-500 mt-1">Delete the folder, but move all files inside to the root folder.</p>
          </button>

          <button
            onClick={() => onConfirm('true')}
            className="w-full text-left p-4 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 transition-colors group"
          >
            <p className="font-semibold text-red-700">Delete everything</p>
            <p className="text-sm text-red-600/80 mt-1">Delete the folder and move all files inside to the Recycle Bin.</p>
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 font-medium rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
