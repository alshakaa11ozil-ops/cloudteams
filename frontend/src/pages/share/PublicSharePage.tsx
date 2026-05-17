import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSharedLinkMetadata, downloadSharedFile, getSharedTeamContent, getSharedDocumentContent } from '../../api/shares'

// ─── Icons ────────────────────────────────────────────────────────────────────
const FolderIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
)
const FileIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
)
const DocIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
)
const DownloadIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
)
const ChevronRight = () => (
    <svg className="w-3.5 h-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
    </svg>
)

// ─── Types ────────────────────────────────────────────────────────────────────
interface BreadcrumbEntry { id: number | null; name: string }

export default function PublicSharePage() {
    const { token } = useParams<{ token: string }>()
    const [password, setPassword] = useState('')
    const [isPasswordVerified, setIsPasswordVerified] = useState(false)
    const [isDownloading, setIsDownloading] = useState<number | 'main' | false>(false)
    const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
    const [documentPreview, setDocumentPreview] = useState<{ html: string; title: string } | null>(null)
    const [isDocumentLoading, setIsDocumentLoading] = useState(false)

    // Folder navigation state
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(null)
    const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([{ id: null, name: 'Home' }])

    // ── 1. Fetch metadata ───────────────────────────────────────────────────
    const { data: metadata, isLoading: isMetadataLoading, error: metadataError } = useQuery({
        queryKey: ['share', token],
        queryFn: () => getSharedLinkMetadata(token!),
        enabled: !!token,
        retry: false
    })

    const hasAccess = metadata && (!metadata.requiresPassword || isPasswordVerified)

    // ── 2. Fetch folder/team content ────────────────────────────────────────
    const { data: sharedContent, isLoading: isContentLoading } = useQuery({
        queryKey: ['shareContent', token, isPasswordVerified, currentFolderId],
        queryFn: () => getSharedTeamContent(token!, password || undefined, currentFolderId),
        // Only fires for folder/team shares — NOT for file or document shares.
        // Document tokens are rejected by getTeamContent with 404, causing a spurious error.
        enabled: !!token && !!metadata && metadata.type !== 'file' && metadata.type !== 'document' && hasAccess,
        retry: false
    })

    // ── Helpers ─────────────────────────────────────────────────────────────
    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    const navigateToFolder = (id: number, name: string) => {
        setCurrentFolderId(id)
        setBreadcrumbs(prev => [...prev, { id, name }])
        setPreviewBlob(null)
    }

    const navigateToBreadcrumb = (entry: BreadcrumbEntry, index: number) => {
        setCurrentFolderId(entry.id)
        setBreadcrumbs(prev => prev.slice(0, index + 1))
        setPreviewBlob(null)
        setDocumentPreview(null)
    }

    // ── Password verification for folder/team/document shares ─────────────────
    // WHY separate from handleDownload: downloading with no fileId causes the backend
    // to throw "Missing file selection". For non-file shares we just need to verify
    // the password by pinging the content endpoint with it.
    const handleVerifyPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!password) { toast.error('Password is required'); return }
        setIsDownloading('main')
        try {
            if (metadata?.type === 'document') {
                // For document shares, verify + pre-load content in one call
                const content = await getSharedDocumentContent(token!, password)
                setDocumentPreview(content)
            } else {
                // For folder/team shares, just probe with password — throws 401 if wrong
                await getSharedTeamContent(token!, password, null)
            }
            setIsPasswordVerified(true)
        } catch (err: any) {
            const status = err.response?.status
            if (status === 401) {
                toast.error('Incorrect password. Please try again.')
            } else {
                toast.error(err.response?.data?.error || 'Failed to verify password.')
            }
        } finally {
            setIsDownloading(false)
        }
    }

    const handleDownload = async (e?: React.FormEvent, fileId?: number) => {
        if (e) e.preventDefault()
        if (metadata?.requiresPassword && !password && !isPasswordVerified) {
            toast.error('Password is required')
            return
        }
        setIsDownloading(fileId ?? 'main')
        try {
            const { blob, filename } = await downloadSharedFile(token!, password || undefined, fileId)
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.style.display = 'none'
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
            setIsPasswordVerified(true)
            toast.success('Download started')
        } catch (err: any) {
            const status = err.response?.status
            if (status === 410) {
                toast.error('This link has reached its download limit or has expired.')
            } else if (status === 401) {
                toast.error('Incorrect password. Please try again.')
            } else {
                toast.error(err.response?.data?.error || 'Failed to download file.')
            }
        } finally {
            setIsDownloading(false)
        }
    }

    const handlePreview = async () => {
        if (metadata?.requiresPassword && !isPasswordVerified) return
        try {
            const { blob } = await downloadSharedFile(token!, password || undefined)
            setPreviewBlob(blob)
        } catch (err: any) {
            const status = err.response?.status
            if (status === 410) {
                toast.error('This link has reached its download limit or has expired.')
            } else {
                toast.error('Failed to load preview')
            }
        }
    }

    const handleViewDocument = async (documentId?: number) => {
        if (metadata?.requiresPassword && !isPasswordVerified) return
        setIsDocumentLoading(true)
        try {
            const content = await getSharedDocumentContent(token!, password || undefined, documentId)
            setDocumentPreview(content)
        } catch (err: any) {
            const status = err.response?.status
            if (status === 410) {
                toast.error('This link has reached its download limit or has expired.')
            } else {
                toast.error(err.response?.data?.error || 'Failed to load document')
            }
        } finally {
            setIsDocumentLoading(false)
        }
    }

    // Auto-load document content when access is granted
    useEffect(() => {
        if (hasAccess && metadata?.type === 'document' && !documentPreview && !isDocumentLoading) {
            void handleViewDocument()
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasAccess, metadata?.type])

    // ── Loading ──────────────────────────────────────────────────────────────
    if (isMetadataLoading || ((metadata?.type === 'folder' || metadata?.type === 'team') && hasAccess && isContentLoading)) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                    <p className="text-gray-500 font-medium">Loading secure link...</p>
                </div>
            </div>
        )
    }

    // ── Error ────────────────────────────────────────────────────────────────
    if (metadataError) {
        const status = (metadataError as any).response?.status
        const isGone = status === 410

        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-gray-100">
                    <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 mb-2">
                        {isGone ? 'Link Expired' : 'Link Unavailable'}
                    </h2>
                    <p className="text-gray-600">
                        {isGone
                            ? 'This link has reached its download limit or has expired.'
                            : 'The link you followed may be expired, deleted, or invalid.'
                        }
                    </p>
                </div>
            </div>
        )
    }

    if (!metadata) return null

    // ── Password gate ────────────────────────────────────────────────────────
    if (metadata.requiresPassword && !isPasswordVerified) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-gray-100">
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-center">
                        <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-bold text-white">Protected Link</h2>
                    </div>
                    <form
                        onSubmit={(e) =>
                            // File shares: download immediately verifies the password.
                            // Folder/team/document shares: verify only — no file to download.
                            metadata?.type === 'file'
                                ? void handleDownload(e)
                                : void handleVerifyPassword(e)
                        }
                        className="p-6"
                    >
                        <p className="text-sm text-gray-500 mb-5 text-center">
                            This link is password protected. Enter the password to continue.
                        </p>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Enter password"
                            required
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all font-medium"
                        />
                        <button
                            type="submit"
                            disabled={isDownloading !== false || !password}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
                        >
                            {isDownloading ? 'Verifying...' : 'Unlock & View'}
                        </button>
                    </form>
                </div>
            </div>
        )
    }

    // ── Single file share ────────────────────────────────────────────────────
    const isImage = metadata.type === 'file' && metadata.mimeType?.startsWith('image/')
    const isPdf = metadata.type === 'file' && metadata.mimeType === 'application/pdf'
    const canPreview = isImage || isPdf

    if (metadata.type === 'file') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-md w-full overflow-hidden">
                    <div className="p-8 text-center">
                        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-blue-100">
                            <FileIcon />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900 mb-2 truncate px-4"
                            title={metadata.filename}>{metadata.filename || 'Shared File'}</h1>
                        {metadata.fileSize !== undefined && (
                            <p className="text-sm text-gray-500 mb-6 bg-gray-50 inline-block px-3 py-1 rounded-full border border-gray-200">
                                {formatBytes(metadata.fileSize)}
                            </p>
                        )}
                        <div className="px-4 space-y-3">
                            <button
                                onClick={() => void handleDownload()}
                                disabled={isDownloading !== false}
                                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isDownloading === 'main'
                                    ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><span>Downloading...</span></>
                                    : <><DownloadIcon /><span>Download File</span></>
                                }
                            </button>
                            {canPreview && !previewBlob && (
                                <button onClick={() => void handlePreview()}
                                    className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors">
                                    Preview in Browser
                                </button>
                            )}
                            {previewBlob && (
                                <div className="mt-4 border border-gray-200 rounded-xl overflow-hidden">
                                    {isImage && <img src={window.URL.createObjectURL(previewBlob)} alt="Preview" className="w-full h-auto" />}
                                    {isPdf && <iframe src={window.URL.createObjectURL(previewBlob)} className="w-full h-96" />}
                                </div>
                            )}
                        </div>
                    </div>
                    <Footer />
                </div>
            </div>
        )
    }

    // ── Single document share ────────────────────────────────────────────────
    if (metadata.type === 'document') {
        // Helper: export document as an HTML file
        const handleExport = () => {
            if (!documentPreview) return
            const blob = new Blob(
                [`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${documentPreview.title}</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}</style></head><body>${documentPreview.html}</body></html>`],
                { type: 'text/html' }
            )
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${documentPreview.title || 'document'}.html`
            a.click()
            URL.revokeObjectURL(url)
        }

        return (
            <div className="min-h-screen bg-gray-50 flex flex-col p-4">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-100 max-w-4xl w-full mx-auto overflow-hidden flex-1 flex flex-col">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100">
                                <DocIcon />
                            </div>
                            <div>
                                <h1 className="text-xl font-bold text-gray-900 truncate max-w-lg" title={metadata.title}>
                                    {metadata.title || 'Shared Document'}
                                </h1>
                                <p className="text-xs text-gray-500">Read Only</p>
                            </div>
                        </div>
                        {/* Export button — downloads rendered HTML */}
                        <button
                            onClick={handleExport}
                            disabled={!documentPreview}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-40"
                            title="Export as HTML file"
                        >
                            <DownloadIcon />
                            Export
                        </button>
                    </div>
                    <div className="flex-1 bg-white overflow-y-auto p-8 relative">
                        {isDocumentLoading ? (
                            <div className="flex justify-center items-center h-64 text-gray-400">
                                <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                            </div>
                        ) : documentPreview ? (
                            <div
                                className="prose prose-sm max-w-none prose-slate"
                                dangerouslySetInnerHTML={{ __html: documentPreview.html }}
                            />
                        ) : (
                            <div className="flex justify-center items-center h-64 text-red-500">
                                Failed to load document content.
                            </div>
                        )}
                    </div>
                    <Footer />
                </div>
            </div>
        )
    }

    // ── Folder / Team share ──────────────────────────────────────────────────
    const totalItems =
        (sharedContent?.folders?.length ?? 0) +
        (sharedContent?.files?.length ?? 0) +
        (sharedContent?.documents?.length ?? 0)

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 w-full max-w-lg overflow-hidden">

                {/* Header */}
                <div className="p-6 border-b border-gray-100">
                    <div className="flex items-center gap-3 mb-1">
                        <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center border border-indigo-100 flex-shrink-0">
                            <FolderIcon />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-gray-900 truncate">
                                {metadata.folderName || metadata.teamName || 'Shared Folder'}
                            </h1>
                            <p className="text-xs text-gray-500">{totalItems} item{totalItems !== 1 ? 's' : ''}</p>
                        </div>
                    </div>

                    {/* Breadcrumbs — only show when navigating */}
                    {breadcrumbs.length > 1 && (
                        <nav className="flex items-center gap-1 mt-3 flex-wrap">
                            {breadcrumbs.map((crumb, i) => (
                                <span key={i} className="flex items-center gap-1">
                                    {i > 0 && <ChevronRight />}
                                    <button
                                        onClick={() => navigateToBreadcrumb(crumb, i)}
                                        className={`text-xs font-medium px-2 py-0.5 rounded-md transition-colors ${i === breadcrumbs.length - 1
                                            ? 'text-indigo-600 bg-indigo-50'
                                            : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                                            }`}
                                    >
                                        {crumb.name}
                                    </button>
                                </span>
                            ))}
                        </nav>
                    )}
                </div>

                {/* Document Modal inside Team Share */}
                {documentPreview && (
                    <div className="absolute inset-0 bg-white z-10 flex flex-col">
                        <div className="p-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                                <DocIcon />
                                <h2 className="font-semibold text-gray-900 truncate max-w-[250px]">{documentPreview.title}</h2>
                                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full ml-2">Read Only</span>
                            </div>
                            <button onClick={() => setDocumentPreview(null)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 bg-white">
                            <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: documentPreview.html }} />
                        </div>
                    </div>
                )}

                {/* Content list */}
                <div className="max-h-[420px] overflow-y-auto relative">
                    {isDocumentLoading && !documentPreview && (
                        <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
                            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                        </div>
                    )}
                    {totalItems === 0 ? (
                        <div className="py-12 text-center text-gray-400">
                            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                                <FolderIcon />
                            </div>
                            <p className="text-sm font-medium">This folder is empty</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-50">
                            {/* Folders */}
                            {sharedContent?.folders?.map(folder => (
                                <li key={`folder-${folder.id}`}>
                                    <button
                                        onClick={() => navigateToFolder(folder.id, folder.name)}
                                        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left group"
                                    >
                                        <span className="text-amber-500 flex-shrink-0"><FolderIcon /></span>
                                        <span className="flex-1 min-w-0">
                                            <span className="text-sm font-medium text-gray-900 truncate block">{folder.name}</span>
                                            <span className="text-xs text-gray-400">Folder</span>
                                        </span>
                                        <ChevronRight />
                                    </button>
                                </li>
                            ))}

                            {/* Native documents (read-only, no download) */}
                            {sharedContent?.documents?.map(doc => (
                                <li key={`doc-${doc.id}`}>
                                    <button
                                        onClick={() => void handleViewDocument(doc.id)}
                                        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left group"
                                    >
                                        <span className="text-indigo-500 flex-shrink-0"><DocIcon /></span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">{doc.title}</p>
                                            <p className="text-xs text-gray-400">Document</p>
                                        </div>
                                        <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">Click to view</span>
                                    </button>
                                </li>
                            ))}

                            {/* Files */}
                            {sharedContent?.files?.map(file => (
                                <li key={`file-${file.id}`}>
                                    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                                        <span className="text-blue-400 flex-shrink-0"><FileIcon /></span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate" title={file.original_name}>
                                                {file.original_name}
                                            </p>
                                            <p className="text-xs text-gray-400">{formatBytes(file.file_size)}</p>
                                        </div>
                                        <button
                                            onClick={() => void handleDownload(undefined, file.id)}
                                            disabled={isDownloading !== false}
                                            title="Download"
                                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
                                        >
                                            {isDownloading === file.id
                                                ? <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                                                : <DownloadIcon />
                                            }
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <Footer />
            </div>
        </div>
    )
}

function Footer() {
    return (
        <div className="bg-gray-50 py-3 border-t border-gray-100 flex items-center justify-center gap-2">
            <span className="text-xs font-semibold text-gray-400 tracking-wider">SECURELY SHARED VIA</span>
            <span className="text-xs font-bold text-gray-600 tracking-tight">CloudTeams</span>
        </div>
    )
}
