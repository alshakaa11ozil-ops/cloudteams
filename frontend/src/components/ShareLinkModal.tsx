import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { createFolderShareLink, createFileShareLink, SharedLink } from '@/api/shares'

interface ShareLinkModalProps {
    itemType: 'file' | 'folder'
    itemId: number
    teamId: number
    itemName: string
    onClose: () => void
}

export default function ShareLinkModal({ itemType, itemId, teamId, itemName, onClose }: ShareLinkModalProps) {
    const [step, setStep] = useState<'idle' | 'generated'>('idle')
    const [password, setPassword] = useState('')
    const [expiresInHours, setExpiresInHours] = useState<number | ''>('')
    const [downloadLimit, setDownloadLimit] = useState<number | ''>('')
    const [generatedLink, setGeneratedLink] = useState<SharedLink | null>(null)

    const createMutation = useMutation({
        mutationFn: () => {
            const options = {
                password: password.trim() || undefined,
                expiresInHours: expiresInHours === '' ? undefined : Number(expiresInHours),
                downloadLimit: downloadLimit === '' ? undefined : Number(downloadLimit)
            }
            if (itemType === 'folder') {
                return createFolderShareLink(itemId, teamId, options)
            } else {
                return createFileShareLink(itemId, teamId, options)
            }
        },
        onSuccess: (link) => {
            setGeneratedLink(link)
            setStep('generated')
            toast.success('Share link generated!')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error ?? 'Failed to create share link')
        }
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        createMutation.mutate()
    }

    const handleCopy = async () => {
        if (!generatedLink) return
        const url = `${window.location.origin}/share/${generatedLink.token}`
        try {
            await navigator.clipboard.writeText(url)
            toast.success('Link copied to clipboard')
        } catch {
            toast.error('Failed to copy link')
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div
                className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Share {itemType === 'folder' ? 'Folder' : 'File'}</h2>
                        <p className="text-sm font-medium text-blue-600 truncate max-w-[250px]">{itemName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 -mr-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5">
                    {step === 'idle' ? (
                        <form id="share-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                            {/* Password Protection */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                                    Password (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Leave empty for public link"
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                />
                                <p className="text-[11px] text-gray-400 mt-1">If set, anyone with the link must enter this password to download.</p>
                            </div>

                            {/* Expiry */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                                        Expires in
                                    </label>
                                    <select
                                        value={expiresInHours}
                                        onChange={e => setExpiresInHours(e.target.value === '' ? '' : Number(e.target.value))}
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                    >
                                        <option value="">Never</option>
                                        <option value={1}>1 Hour</option>
                                        <option value={24}>24 Hours</option>
                                        <option value={7 * 24}>7 Days</option>
                                        <option value={30 * 24}>30 Days</option>
                                    </select>
                                </div>

                                {/* Download Limit */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-900 mb-1.5">
                                        Max Downloads
                                    </label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={downloadLimit}
                                        onChange={e => setDownloadLimit(e.target.value === '' ? '' : Number(e.target.value))}
                                        placeholder="Unlimited"
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors text-sm"
                                    />
                                </div>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mx-auto mb-2">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <p className="text-center text-sm font-medium text-gray-900">
                                Your share link is ready!
                            </p>

                            <div className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                                <input
                                    type="text"
                                    readOnly
                                    value={`${window.location.origin}/share/${generatedLink?.token}`}
                                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium text-gray-600 px-2"
                                    onClick={(e) => e.currentTarget.select()}
                                />
                                <button
                                    onClick={() => void handleCopy()}
                                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-md text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                                >
                                    Copy
                                </button>
                            </div>

                            {password && (
                                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 text-center font-medium">
                                    Remember to share the password securely!
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                {step === 'idle' && (
                    <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            form="share-form"
                            type="submit"
                            disabled={createMutation.isPending}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm disabled:opacity-50"
                        >
                            {createMutation.isPending ? 'Generating...' : 'Create Link'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
