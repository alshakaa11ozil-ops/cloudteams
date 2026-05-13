import prisma from '../config/database'
import { emitToTeam } from '../socket'
import { SOCKET_EVENTS } from '../config/socketEvents'

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

    // Restore the yjs_state of the document
    await prisma.documents.update({
        where: { id: documentId },
        data: {
            yjs_state: version.yjs_state,
            updated_at: new Date(),
            last_saved: new Date()
        }
    })

    // To make sure all connected clients reload the new yjs_state,
    // we need to tell them. Emitting a socket event works well for this.
    emitToTeam(teamId, 'document:restored', {
        documentId,
        versionId
    })

    return { success: true }
}
