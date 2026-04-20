// src/pages/RecycleBin.tsx
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchRecycleBin, restoreFile, restoreFolder, hardDeleteFile, hardDeleteFolder, emptyRecycleBin } from '@/api/files'
import { format } from 'date-fns'
import type { CloudFile, Folder } from '@/types'

function formatBytes(bytes: number) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export default function RecycleBin() {
    const { id } = useParams<{ id: string }>()
    const teamId = parseInt(id || '0', 10)
    const queryClient = useQueryClient()

    const { data, isLoading, isError } = useQuery({
        queryKey: ['recycleBin', teamId],
        queryFn: () => fetchRecycleBin(teamId),
        enabled: teamId > 0,
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['recycleBin', teamId] })

    const restoreFileMut = useMutation({ mutationFn: (fid: number) => restoreFile(teamId, fid), onSuccess: invalidate })
    const restoreFolderMut = useMutation({ mutationFn: (fid: number) => restoreFolder(teamId, fid), onSuccess: invalidate })
    const hardDeleteFileMut = useMutation({ mutationFn: (fid: number) => hardDeleteFile(teamId, fid), onSuccess: invalidate })
    const hardDeleteFolderMut = useMutation({ mutationFn: (fid: number) => hardDeleteFolder(teamId, fid), onSuccess: invalidate })
    const emptyBinMut = useMutation({
        mutationFn: () => emptyRecycleBin(teamId),
        onSuccess: (res) => {
            alert(res.message)
            invalidate()
        }
    })

    const files: CloudFile[] = data?.files || []
    const folders: Folder[] = data?.folders || []

    const isEmpty = files.length === 0 && folders.length === 0

    return (
        <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-6 flex items-center justify-between flex-shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Recycle Bin</h1>
                    <p className="text-sm text-slate-500 mt-1">Items deleted from the team workspace</p>
                </div>
                <div>
                    <button
                        onClick={() => {
                            if (window.confirm('Are you sure you want to permanently delete ALL items in the Recycle Bin? This cannot be undone.')) {
                                emptyBinMut.mutate()
                            }
                        }}
                        disabled={isEmpty || emptyBinMut.isPending}
                        className="flex items-center gap-2 bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-lg text-sm font-bold border border-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        {emptyBinMut.isPending ? 'Emptying...' : 'Empty Recycle Bin'}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                ) : isError ? (
                    <div className="flex items-center justify-center h-full text-red-500 font-medium">
                        Failed to load recycle bin contents.
                    </div>
                ) : isEmpty ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                        <svg className="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                        <p className="text-lg">Recycle bin is empty.</p>
                    </div>
                ) : (
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="text-[11px] text-slate-500 uppercase bg-slate-50/80 border-b border-slate-200 tracking-wider">
                                <tr>
                                    <th className="px-6 py-4 font-bold">Item Name</th>
                                    <th className="px-6 py-4 font-bold">Type</th>
                                    <th className="px-6 py-4 font-bold hidden md:table-cell">Deleted On</th>
                                    <th className="px-6 py-4 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {/* Folders */}
                                {folders.map(folder => (
                                    <tr key={`folder-${folder.id}`} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <svg className="w-6 h-6 text-amber-400 fill-current" viewBox="0 0 20 20">
                                                    <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                                                </svg>
                                                <span className="font-semibold text-slate-800">{folder.name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 font-medium">Folder</td>
                                        <td className="px-6 py-4 text-slate-500 hidden md:table-cell">
                                            {format(new Date(folder.deleted_at || folder.created_at), 'MMM d, yyyy h:mm a')}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-20 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => restoreFolderMut.mutate(folder.id)}
                                                    disabled={restoreFolderMut.isPending}
                                                    className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 disabled:opacity-50 transition-colors"
                                                >
                                                    Restore
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`Permanently delete folder "${folder.name}"?`)) hardDeleteFolderMut.mutate(folder.id)
                                                    }}
                                                    disabled={hardDeleteFolderMut.isPending}
                                                    className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
                                                >
                                                    Delete Forever
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}

                                {/* Files */}
                                {files.map(file => (
                                    <tr key={`file-${file.id}`} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 border border-slate-200 bg-white text-slate-400 rounded flex items-center justify-center shrink-0">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-slate-800 truncate max-w-[200px] sm:max-w-xs">{file.original_name}</span>
                                                    <span className="text-[11px] font-medium text-slate-400 mt-0.5">{formatBytes(file.file_size)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 font-medium max-w-[120px] truncate">
                                            {file.mime_type.split('/').pop()?.toUpperCase() || 'FILE'}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 hidden md:table-cell">
                                            {format(new Date(file.deleted_at || file.created_at), 'MMM d, yyyy h:mm a')}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-20 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => restoreFileMut.mutate(file.id)}
                                                    disabled={restoreFileMut.isPending}
                                                    className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 disabled:opacity-50 transition-colors"
                                                >
                                                    Restore
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (window.confirm(`Permanently delete file "${file.original_name}"?`)) hardDeleteFileMut.mutate(file.id)
                                                    }}
                                                    disabled={hardDeleteFileMut.isPending}
                                                    className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-bold hover:bg-red-100 disabled:opacity-50 transition-colors"
                                                >
                                                    Delete Forever
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}