import { useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchTeamShareLinks, revokeShareLink } from '../api/shares'
import { useAuth } from '../hooks/useAuth'
import { fetchTeamMembers } from '../api/teams'
import type { SharedLink } from '../api/shares'
import { FileText, Folder, Link as LinkIcon, Trash2, Globe, Clock } from 'lucide-react'

type FilterType = 'all' | 'files' | 'folders' | 'documents' | 'team'

export default function SharingPage() {
    const { id } = useParams<{ id: string }>()
    const teamId = parseInt(id ?? '0', 10)
    const { user } = useAuth()
    const queryClient = useQueryClient()

    const [searchParams, setSearchParams] = useSearchParams()
    const activeFilter = (searchParams.get('type') as FilterType) ?? 'all'
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'expiring'>('newest')

    const setFilter = (type: FilterType) => setSearchParams({ type }, { replace: true })

    // Fetch team members to determine current user's role
    const { data: members = [] } = useQuery({
        queryKey: ['team-members', teamId],
        queryFn: () => fetchTeamMembers(teamId),
        enabled: teamId > 0,
    })

    const myRole = members.find(m => m.user_id === user?.id)?.role

    // Fetch share links
    const { data: links = [], isLoading } = useQuery({
        queryKey: ['team-share-links', teamId],
        queryFn: () => fetchTeamShareLinks(teamId),
        enabled: teamId > 0 && !!myRole && myRole !== 'viewer', // viewers blocked
    })

    const revokeMutation = useMutation({
        mutationFn: (token: string) => revokeShareLink(token),
        onSuccess: (_, token) => {
            queryClient.setQueryData<SharedLink[]>(['team-share-links', teamId], old =>
                old?.filter(link => link.token !== token) ?? []
            )
            toast.success('Share link revoked')
        },
        onError: (err: any) => {
            toast.error(err.response?.data?.error || 'Failed to revoke link')
        }
    })

    // Filter and Sort
    const filteredAndSortedLinks = useMemo(() => {
        let result = links

        if (activeFilter !== 'all') {
            result = result.filter(link => {
                if (activeFilter === 'files') return !!link.files
                if (activeFilter === 'folders') return !!link.folders
                if (activeFilter === 'documents') return !!link.documents
                if (activeFilter === 'team') return !link.files && !link.folders && !link.documents
                return true
            })
        }

        return result.sort((a, b) => {
            if (sortOrder === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            if (sortOrder === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            if (sortOrder === 'expiring') {
                if (!a.expiration_date) return 1
                if (!b.expiration_date) return -1
                return new Date(a.expiration_date).getTime() - new Date(b.expiration_date).getTime()
            }
            return 0
        })
    }, [links, activeFilter, sortOrder])

    // Safety guard
    if (myRole === 'viewer') {
        return (
            <div className="p-8 text-center">
                <p className="text-red-500 font-medium">You do not have permission to view share links.</p>
            </div>
        )
    }

    const renderLinkTarget = (link: SharedLink) => {
        if (link.files) return (
            <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-gray-900 truncate">{link.files.original_name}</span>
            </div>
        )
        if (link.folders) return (
            <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-yellow-500" />
                <span className="font-medium text-gray-900 truncate">{link.folders.name}</span>
            </div>
        )
        if (link.documents) return (
            <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-500" />
                <span className="font-medium text-gray-900 truncate">{link.documents.title}</span>
            </div>
        )
        return (
            <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-green-500" />
                <span className="font-medium text-gray-900 truncate">Entire Team</span>
            </div>
        )
    }

    const getLinkTypeBadge = (link: SharedLink) => {
        if (link.files) return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">File</span>
        if (link.folders) return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded-full font-medium">Folder</span>
        if (link.documents) return <span className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full font-medium">Document</span>
        return <span className="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded-full font-medium">Team</span>
    }

    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <LinkIcon className="w-6 h-6 text-gray-500" />
                    Share Links
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                    Manage all active share links for this team.
                    {myRole === 'editor' && " (Showing only your links)"}
                </p>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
                <div className="flex p-1 bg-gray-100 rounded-lg shrink-0 overflow-x-auto w-full sm:w-auto">
                    {[
                        { id: 'all', label: 'All Links' },
                        { id: 'files', label: 'Files' },
                        { id: 'folders', label: 'Folders' },
                        { id: 'documents', label: 'Documents' },
                        { id: 'team', label: 'Team' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id as FilterType)}
                            className={`px-4 py-1.5 text-sm font-medium rounded-md whitespace-nowrap transition-colors ${activeFilter === tab.id
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <select
                        value={sortOrder}
                        onChange={e => setSortOrder(e.target.value as any)}
                        className="text-sm border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500"
                    >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="expiring">Expiring soon</option>
                    </select>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {isLoading ? (
                    <div className="p-12 text-center text-gray-500">Loading share links...</div>
                ) : filteredAndSortedLinks.length === 0 ? (
                    <div className="p-16 text-center">
                        <LinkIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-1">No share links found</h3>
                        <p className="text-sm text-gray-500">
                            {activeFilter === 'all'
                                ? "There are no active share links."
                                : `There are no active share links for ${activeFilter}.`}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                                <tr>
                                    <th className="px-6 py-4 font-semibold w-1/3">Target</th>
                                    <th className="px-6 py-4 font-semibold">Type</th>
                                    <th className="px-6 py-4 font-semibold">Created By</th>
                                    <th className="px-6 py-4 font-semibold">Uses</th>
                                    <th className="px-6 py-4 font-semibold">Expires</th>
                                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredAndSortedLinks.map(link => {
                                    const isOwner = link.created_by === user?.id
                                    const canRevoke = myRole === 'admin' || isOwner

                                    return (
                                        <tr key={link.id} className="hover:bg-gray-50">
                                            <td className="px-6 py-4 max-w-xs truncate">
                                                {renderLinkTarget(link)}
                                            </td>
                                            <td className="px-6 py-4">
                                                {getLinkTypeBadge(link)}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                                                        {(link.creator?.full_name ?? link.creator?.username ?? '?')[0].toUpperCase()}
                                                    </div>
                                                    <span className="text-gray-700 truncate max-w-[120px]">
                                                        {link.creator?.full_name ?? link.creator?.username ?? 'Unknown'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-gray-500">
                                                {link.download_limit ? `${link.downloads_count} / ${link.download_limit}` : link.downloads_count}
                                            </td>
                                            <td className="px-6 py-4">
                                                {link.expiration_date ? (
                                                    <span className={`${new Date(link.expiration_date) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                                        {new Date(link.expiration_date).toLocaleDateString()}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">Never</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => {
                                                        if (confirm('Are you sure you want to revoke this link? Anyone using it will immediately lose access.')) {
                                                            revokeMutation.mutate(link.token)
                                                        }
                                                    }}
                                                    disabled={!canRevoke || revokeMutation.isPending}
                                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                                                        ${canRevoke 
                                                            ? 'text-red-600 hover:bg-red-50' 
                                                            : 'text-gray-400 cursor-not-allowed'
                                                        }`}
                                                    title={!canRevoke ? 'Only admins or the creator can revoke this link' : 'Revoke link'}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    Revoke
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
