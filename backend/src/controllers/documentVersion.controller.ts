import { Request, Response } from 'express'
import { createDocumentVersion, listDocumentVersions, restoreDocumentVersion } from '../services/documentVersion.service'
import { AppError } from '../utils/teamGuard'

export const createDocumentVersionHandler = async (req: Request, res: Response) => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10)
        const docId = parseInt(req.params.docId as string, 10)
        const { versionName } = req.body

        if (isNaN(teamId) || isNaN(docId)) {
            res.status(400).json({ error: 'Valid teamId and docId are required' })
            return
        }

        const version = await createDocumentVersion({
            documentId: docId,
            teamId,
            createdBy: req.user!.userId,
            versionName
        })

        res.status(201).json(version)
    } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (error instanceof Error && error.message === 'DOCUMENT_EMPTY') {
            res.status(422).json({ error: 'Cannot save a version of an empty document. Start typing first.' })
            return
        }
        console.error('[createDocumentVersionHandler]', error)
        res.status(500).json({ error: 'Internal server error' })
    }
}

export const listDocumentVersionsHandler = async (req: Request, res: Response) => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10)
        const docId = parseInt(req.params.docId as string, 10)

        if (isNaN(teamId) || isNaN(docId)) {
            res.status(400).json({ error: 'Valid teamId and docId are required' })
            return
        }

        const versions = await listDocumentVersions(docId, teamId)
        res.status(200).json({ versions })
    } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        console.error('[listDocumentVersionsHandler]', error)
        res.status(500).json({ error: 'Internal server error' })
    }
}

export const restoreDocumentVersionHandler = async (req: Request, res: Response) => {
    try {
        const teamId = parseInt(req.params.teamId as string, 10)
        const docId = parseInt(req.params.docId as string, 10)
        const versionId = parseInt(req.params.versionId as string, 10)

        if (isNaN(teamId) || isNaN(docId) || isNaN(versionId)) {
            res.status(400).json({ error: 'Valid teamId, docId, and versionId are required' })
            return
        }

        await restoreDocumentVersion(docId, versionId, teamId, req.user!.userId)

        res.status(200).json({ success: true, message: 'Document restored successfully' })
    } catch (error) {
        if (error instanceof Error && error.message === 'DOCUMENT_NOT_FOUND') {
            res.status(404).json({ error: 'Document not found' })
            return
        }
        if (error instanceof Error && error.message === 'VERSION_NOT_FOUND') {
            res.status(404).json({ error: 'Version not found' })
            return
        }
        console.error('[restoreDocumentVersionHandler]', error)
        res.status(500).json({ error: 'Internal server error' })
    }
}
