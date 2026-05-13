// src/controllers/aiSummary.controller.ts
//
// PURPOSE: HTTP handler for POST /api/teams/:teamId/files/:fileId/summarize
//
// FLOW:
//   1. Verify team membership
//   2. Fetch file from DB, check it belongs to this team
//   3. Extract text content based on file type:
//      - DOCX  → mammoth (plain text extraction, preserves paragraph structure)
//      - PDF   → pdf-parse (text layer only — works for text PDFs, not scanned)
//      - XLSX  → read as CSV-like text via raw buffer scan
//      - Other → fs.readFile (TXT, JSON, code, CSV, Markdown)
//   4. Call summarizeFile service → Gemini → cached result
//   5. Return summary + cache metadata

import { Request, Response } from 'express'
import path from 'path'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import mammoth from 'mammoth'
import { assertTeamMember, AppError } from '../utils/teamGuard'
import prisma from '../config/database'
import { summarizeFile } from '../services/AI/fileSummary.service'
import { decryptFile, isEncryptionEnabled } from '../utils/fileEncryption'

// File types we can extract text from.
// WHY THIS LIST: Each type here has a working extraction strategy below.
// Images and binary formats (zip, exe, etc.) cannot be meaningfully summarized.
const SUMMARIZABLE_TYPES = new Set([
    // Documents
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword',                                                        // .doc (older)
    // NOTE: PDF removed — pdf-parse is unreliable for image-based PDFs (most real-world PDFs)

    // Spreadsheets (we extract as raw text — column values are readable)
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',         // .xlsx
    'application/vnd.ms-excel',                                                  // .xls

    // Structured text
    'text/plain',
    'text/csv',
    'application/json',
    'text/markdown',
    'text/x-markdown',

    // Code files — served as text/plain by most systems but MIME varies
    'application/javascript',
    'text/javascript',
    'text/javascript',
    'text/typescript',
    'application/typescript',
    'text/x-python',
    'text/x-java-source',
    'text/html',
    'text/css',
    'application/xml',
    'text/xml',
    'application/x-yaml',
    'text/yaml',
])

export async function summarizeFileHandler(req: Request, res: Response): Promise<void> {
    try {
        const teamId = parseInt((req.params.id || req.params.teamId) as string, 10)
        const fileId = parseInt(req.params.fileId as string, 10)
        const userId = req.user!.userId

        // 1. Verify membership
        await assertTeamMember(userId, teamId)

        // 2. Fetch file record
        const file = await prisma.file.findFirst({
            where: { id: fileId, team_id: teamId, is_deleted: false }
        })

        if (!file) throw new AppError('File not found', 404)

        // 3. Check if this file type is summarizable
        const mimeType = file.mime_type ?? ''
        const ext = file.original_name.split('.').pop()?.toLowerCase() ?? ''

        // Allow by MIME type OR by extension (browsers sometimes send generic MIME for code files)
        const isTextExtension = ['ts', 'js', 'py', 'java', 'cs', 'sql', 'yaml', 'yml', 'md', 'txt', 'csv', 'json', 'html', 'css', 'xml', 'env', 'sh'].includes(ext)
        const isDocx = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx'
        const isXlsx = mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx'
        const isPdf = mimeType === 'application/pdf' || ext === 'pdf'

        // PDF not supported — most PDFs are image-based and cannot be extracted reliably
        if (isPdf) {
            res.status(400).json({
                error: 'PDF summarization is not supported. PDFs often contain images or scanned text that cannot be read. Try converting to DOCX or TXT first.'
            })
            return
        }

        if (!SUMMARIZABLE_TYPES.has(mimeType) && !isTextExtension && !isDocx && !isXlsx) {
            res.status(400).json({
                error: 'This file type cannot be summarized. Supported: DOCX, XLSX, TXT, CSV, JSON, Markdown, and code files.'
            })
            return
        }

        // 4. Verify file exists on disk
        const absolutePath = path.resolve(file.storage_path)
        if (!existsSync(absolutePath)) {
            console.error(`[summarizeFileHandler] File missing from disk at: ${absolutePath}`)
            throw new AppError('File storage error: file missing from disk', 500)
        }

        // 5. Extract text based on type (Handling Encryption)
        let fileText = ''
        let fileBuffer: Buffer | null = null

        // Decrypt if needed
        if (file.encryption_iv && isEncryptionEnabled()) {
            try {
                fileBuffer = decryptFile(absolutePath, file.encryption_iv)
            } catch (err) {
                console.error(`[summarizeFileHandler] Decryption failed for file ${fileId}:`, err)
                throw new AppError('Failed to decrypt file for summarization', 500)
            }
        }

        if (isDocx) {
            // DOCX — mammoth converts to clean plain text
            const options = fileBuffer ? { buffer: fileBuffer } : { path: absolutePath }
            const result = await mammoth.extractRawText(options)
            fileText = result.value

        } else if (isXlsx) {
            // XLSX — raw text extraction from XML inside ZIP
            try {
                const buffer = fileBuffer || await fs.readFile(absolutePath)
                const rawStr = buffer.toString('latin1')
                const matches = rawStr.match(/<t[^>]*>([^<]+)<\/t>/g) ?? []
                fileText = matches
                    .map(m => m.replace(/<[^>]+>/g, '').trim())
                    .filter(v => v.length > 0)
                    .join(', ') || 'No readable text cells found in spreadsheet.'
            } catch {
                throw new AppError('Failed to extract text from XLSX file', 500)
            }

        } else {
            // Plain text, code, JSON, CSV, Markdown, etc.
            if (fileBuffer) {
                fileText = fileBuffer.toString('utf-8')
            } else {
                fileText = await fs.readFile(absolutePath, 'utf-8')
            }
        }

        if (!fileText.trim()) {
            res.status(400).json({ error: 'This file appears to be empty — nothing to summarize.' })
            return
        }

        // 6. Generate summary (cached for 24 hours per file)
        const { summary, fromCache, cachedAt } = await summarizeFile(teamId, fileId, fileText, file.original_name)

        res.json({
            summary,
            fromCache,
            cachedAt: cachedAt ?? null,
            fileName: file.original_name
        })

    } catch (err) {
        if (err instanceof AppError) {
            res.status(err.statusCode).json({ error: err.message })
            return
        }
        console.error('[summarizeFileHandler]', err)
        res.status(500).json({ error: 'Failed to generate summary' })
    }
}