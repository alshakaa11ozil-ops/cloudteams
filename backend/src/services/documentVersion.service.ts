import prisma from '../config/database'
import { emitToTeam } from '../socket'
import { SOCKET_EVENTS } from '../config/socketEvents'
import { forceReconnectDocument } from '../collaboration/hocuspocus'

export interface CreateDocumentVersionInput {
    documentId: number
    teamId: number
    createdBy: number
    versionName?: string // user-provided name for manual snapshots
}

export async function createDocumentVersion(input: CreateDocumentVersionInput) {
    const { documentId, teamId, createdBy, versionName } = input

    // Verify document exists and belongs to team
    const doc = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: false },
        select: { yjs_state: true }
    })
    
    if (!doc) throw new Error('DOCUMENT_NOT_FOUND')
    if (!doc.yjs_state) throw new Error('DOCUMENT_EMPTY')

    const version = await prisma.documentVersion.create({
        data: {
            document_id: documentId,
            created_by: createdBy,
            version_name: versionName || null,
            yjs_state: doc.yjs_state,
        },
        select: {
            id: true,
            document_id: true,
            version_name: true,
            created_by: true,
            created_at: true,
            creator: {
                select: { full_name: true, username: true }
            }
        }
    })

    emitToTeam(teamId, SOCKET_EVENTS.DOCUMENT_VERSION_CREATED, {
        documentId: version.document_id,
        versionId: version.id
    })

    return {
        id: version.id,
        documentId: version.document_id,
        versionName: version.version_name,
        createdBy: version.created_by,
        creatorName: version.creator.full_name ?? version.creator.username,
        createdAt: version.created_at
    }
}

export async function listDocumentVersions(documentId: number, teamId: number) {
    // Verify document exists and belongs to team
    const doc = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: false },
        select: { id: true }
    })
    if (!doc) throw new Error('DOCUMENT_NOT_FOUND')

    const versions = await prisma.documentVersion.findMany({
        where: { document_id: documentId },
        select: {
            id: true,
            document_id: true,
            version_name: true,
            created_by: true,
            created_at: true,
            creator: {
                select: { full_name: true, username: true }
            }
        },
        orderBy: { created_at: 'desc' }
    })

    return versions.map(v => ({
        id: v.id,
        documentId: v.document_id,
        versionName: v.version_name,
        createdBy: v.created_by,
        creatorName: v.creator.full_name ?? v.creator.username,
        createdAt: v.created_at
    }))
}

export async function restoreDocumentVersion(documentId: number, versionId: number, teamId: number, userId: number) {
    const doc = await prisma.documents.findFirst({
        where: { id: documentId, team_id: teamId, is_deleted: false },
        select: { id: true, title: true }
    })
    if (!doc) throw new Error('DOCUMENT_NOT_FOUND')

    const version = await prisma.documentVersion.findFirst({
        where: { id: versionId, document_id: documentId }
    })
    if (!version) throw new Error('VERSION_NOT_FOUND')

    // Restore the yjs_state of the document in the DB
    await prisma.documents.update({
        where: { id: documentId },
        data: {
            yjs_state: version.yjs_state,
            updated_at: new Date(),
            last_saved: new Date()
        }
    })

    // Kick all currently connected editors so they reconnect and load the
    // restored state fresh from DB. Without this, connected editors keep the
    // old in-memory state and their next keystroke overwrites the restore.
    forceReconnectDocument(documentId)

    // Notify all team members so UIs can show a toast/banner
    emitToTeam(teamId, SOCKET_EVENTS.DOCUMENT_RESTORED, {
        documentId,
        versionId,
        restoredBy: userId
    })

    return { success: true }
}
