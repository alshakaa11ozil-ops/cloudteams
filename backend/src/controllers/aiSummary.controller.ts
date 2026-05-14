// src/controllers/aiSummary.controller.ts
import { Request, Response } from 'express'
import mammoth from 'mammoth'
import { assertTeamMember, AppError } from '../utils/teamGuard'
import prisma from '../config/database'
import { summarizeFile } from '../services/AI/fileSummary.service'
import { decryptBuffer, isEncryptionEnabled } from '../utils/fileEncryption'
import { getFileStream } from '../services/storage.service'

const SUMMARIZABLE_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain', 'text/csv', 'application/json', 'text/markdown',
    'text/x-markdown', 'application/javascript', 'text/javascript',
    'text/typescript', 'application/typescript', 'text/x-python',
    'text/x-java-source', 'text/html', 'text/css', 'application/xml',
    'text/xml', 'application/x-yaml', 'text/yaml',
])

// PURPOSE: Fetch file bytes from R2 into a Buffer.
// WHY: All file operations now go through R2, not local disk.
async function fetchBufferFromR2(storagePath: string): Promise<Buffer> {
    const stream = await getFileStream(storagePath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function summarizeFileHandler(req: Request, res: Response): Promise<void> {
    try {
        const teamId = parseInt((req.params.id || req.params.teamId) as string, 10)
        const fileId = parseInt(req.params.fileId as string, 10)
        const userId = req.user!.userId

        await assertTeamMember(userId, teamId)

        const file = await prisma.file.findFirst({
            where: { id: fileId, team_id: teamId, is_deleted: false }
        })

        if (!file) throw new AppError('File not found', 404)

        const mimeType = file.mime_type ?? ''
        const ext = file.original_name.split('.').pop()?.toLowerCase() ?? ''

        const isTextExtension = ['ts', 'js', 'py', 'java', 'cs', 'sql', 'yaml', 'yml', 'md', 'txt', 'csv', 'json', 'html', 'css', 'xml', 'env', 'sh'].includes(ext)
        const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx'
        const isXlsx = mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx'
        const isPdf = mimeType === 'application/pdf' || ext === 'pdf'

        if (isPdf) {
            res.status(400).json({ error: 'PDF summarization is not supported. Try converting to DOCX or TXT first.' })
            return
        }

        if (!SUMMARIZABLE_TYPES.has(mimeType) && !isTextExtension && !isDocx && !isXlsx) {
            res.status(400).json({ error: 'This file type cannot be summarized.' })
            return
        }

        // ── Fetch from R2 (replaces disk read) ──────────────────────────────
        // WHY: Files are stored in Cloudflare R2, not on local disk.
        // storage_path is the R2 object key, not a filesystem path.
        let fileBuffer = await fetchBufferFromR2(file.storage_path);

        // ── Decrypt if encrypted ─────────────────────────────────────────────
        const encryptionIv = (file as any).encryption_iv as string | null;
        if (encryptionIv && isEncryptionEnabled()) {
            try {
                fileBuffer = decryptBuffer(fileBuffer, encryptionIv)
            } catch (err) {
                console.error(`[summarizeFileHandler] Decryption failed:`, err)
                throw new AppError('Failed to decrypt file for summarization', 500)
            }
        }

        // ── Extract text ─────────────────────────────────────────────────────
        let fileText = ''

        if (isDocx) {
            const result = await mammoth.extractRawText({ buffer: fileBuffer })
            fileText = result.value
        } else if (isXlsx) {
            const rawStr = fileBuffer.toString('latin1')
            const matches = rawStr.match(/<t[^>]*>([^<]+)<\/t>/g) ?? []
            fileText = matches
                .map(m => m.replace(/<[^>]+>/g, '').trim())
                .filter(v => v.length > 0)
                .join(', ') || 'No readable text cells found.'
        } else {
            fileText = fileBuffer.toString('utf-8')
        }

        if (!fileText.trim()) {
            res.status(400).json({ error: 'This file appears to be empty — nothing to summarize.' })
            return
        }

        const { summary, fromCache, cachedAt } = await summarizeFile(teamId, fileId, fileText, file.original_name)

        res.json({ summary, fromCache, cachedAt: cachedAt ?? null, fileName: file.original_name })

    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        console.error('[summarizeFileHandler]', err)
        res.status(500).json({ error: 'Failed to generate summary' })
    }
}