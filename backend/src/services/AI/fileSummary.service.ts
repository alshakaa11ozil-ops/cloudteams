// src/services/ai/fileSummary.service.ts
//
// PURPOSE: Generate an intelligent AI summary of a file's content.
//          Produces analyst-quality output — specific, actionable, team-relevant.
//
// WHAT "GOOD" OUTPUT LOOKS LIKE:
//   BAD: "This document contains information about the project."
//   GOOD: "This is the Q2 budget proposal for Project Falcon, authored by Sarah Chen,
//          covering a $240K infrastructure spend across 3 phases. The largest line item
//          is cloud infrastructure at $95K, flagged as requiring VP approval by June 1.
//          Finance and project leads should review before the budget lock date."

import { callGemini } from './gemini'
import { getCachedResult, setCachedResult } from './aiCache.service'
import { AppError } from '../../utils/teamGuard'

export async function summarizeFile(
    teamId: number,
    fileId: number,
    fileText: string,
    fileName: string
): Promise<{ summary: string; fromCache: boolean; cachedAt?: Date }> {

    const cached = await getCachedResult(teamId, 'file_summary', fileId)
    if (cached) {
        return { summary: cached.result, fromCache: true, cachedAt: cached.cachedAt }
    }

    // Aggressively clean text — DOCX/mammoth output has lots of whitespace noise
    const cleanedText = fileText
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/^\s+|\s+$/gm, '')
        .trim()

    // Smart chunking — for large files, take from 3 zones rather than just the start.
    // WHY: A flat slice(0, 5000) for a 100-page PDF only shows the cover page and intro.
    // By sampling from start + middle + end, we capture context, body, and conclusions.
    const totalLen = cleanedText.length
    const MAX_CHARS = 6000  // ~1500 input tokens — safe for Gemini Flash

    let contentSample: string
    let wasTruncated = false

    if (totalLen <= MAX_CHARS) {
        contentSample = cleanedText
    } else {
        wasTruncated = true
        // 50% from start (intro, abstract, context)
        const startChunk = cleanedText.slice(0, Math.floor(MAX_CHARS * 0.50))
        // 25% from middle (body / main content)
        const midStart = Math.floor(totalLen / 2) - Math.floor(MAX_CHARS * 0.125)
        const midChunk = cleanedText.slice(midStart, midStart + Math.floor(MAX_CHARS * 0.25))
        // 25% from end (conclusions, recommendations, summary)
        const endChunk = cleanedText.slice(totalLen - Math.floor(MAX_CHARS * 0.25))
        contentSample = [
            startChunk,
            '\n\n[... middle of document ...]\n\n',
            midChunk,
            '\n\n[... near end of document ...]\n\n',
            endChunk
        ].join('')
    }

    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'txt'
    const { role, focusInstructions } = getFileProfile(ext)

    const prompt = buildSummaryPrompt({
        fileName,
        ext,
        role,
        focusInstructions,
        content: contentSample,
        wasTruncated,
        charCount: totalLen,
    })

    try {
        // temperature=0.15: analyst output should be precise, not creative
        // 2000 tokens: ensuring full completion without truncation
        const summary = await callGemini(prompt, 2000, { temperature: 0.15 })
        await setCachedResult(teamId, 'file_summary', fileId, summary)
        return { summary, fromCache: false }
    } catch (err: any) {
        console.error('[summarizeFile] Gemini error:', err)
        const friendlyMsg = err.message ? err.message.replace('GEMINI_ERROR: ', '') : 'AI summary temporarily unavailable'
        throw new AppError(friendlyMsg, 500)
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface FileProfile {
    role: string
    focusInstructions: string
}

function getFileProfile(ext: string): FileProfile {
    const profiles: Record<string, FileProfile> = {
        docx: {
            role: 'document analyst',
            focusInstructions: 'Extract: document title/subject, author if mentioned, dates, key decisions or outcomes, and any specific numbers, deadlines, or action items visible in the content.',
        },
        doc: {
            role: 'document analyst',
            focusInstructions: 'Extract: document title/subject, author if mentioned, dates, key decisions or outcomes, and any specific numbers, deadlines, or action items.',
        },
        pdf: {
            role: 'document analyst',
            focusInstructions: 'Extract: document title/subject, key findings or arguments, specific numbers or data points, and conclusions or recommendations.',
        },
        txt: {
            role: 'content analyst',
            focusInstructions: 'Identify the purpose of this text, its main topics, and any specific facts, instructions, or conclusions.',
        },
        md: {
            role: 'technical writer analyst',
            focusInstructions: 'Extract: document purpose, main sections and their topics, any technical instructions, version info, or project names mentioned.',
        },
        csv: {
            role: 'data analyst',
            focusInstructions: 'Identify: what entity/topic each row represents, what the columns track, visible date ranges, approximate row count if determinable, and any notable values or patterns.',
        },
        xlsx: {
            role: 'data/spreadsheet analyst',
            focusInstructions: 'Extract: what data this spreadsheet tracks, any formulas or calculations visible, totals or summary figures, and any notable trends in the numbers.',
        },
        json: {
            role: 'data structure analyst',
            focusInstructions: 'Identify: what type of data this JSON stores, its top-level structure/keys, how many records (if array), and what system likely produces or consumes this data.',
        },
        js: {
            role: 'code reviewer',
            focusInstructions: 'Identify: what this module does (its purpose, not implementation), what functions or classes it exports, what external dependencies it uses, and what part of an application it belongs to.',
        },
        ts: {
            role: 'code reviewer',
            focusInstructions: 'Identify: what this module does, what it exports, key interfaces or types defined, and what system it is part of.',
        },
        py: {
            role: 'code reviewer',
            focusInstructions: 'Identify: what this script does, any key functions or classes, what libraries it depends on, and whether it is a utility, model, API, or script.',
        },
        java: {
            role: 'code reviewer',
            focusInstructions: 'Identify: what this class does, what interface it implements, key methods, and its role in the application.',
        },
        cs: {
            role: 'code reviewer',
            focusInstructions: 'Identify: what this class does, any notable patterns (service, controller, model), and its role in the application.',
        },
        sql: {
            role: 'database analyst',
            focusInstructions: 'Identify: whether this is a migration, query, or schema definition; what tables are created or modified; and what data operation is performed.',
        },
        html: {
            role: 'web content analyst',
            focusInstructions: 'Identify: what page this is (login, dashboard, form, etc.), its main content or purpose, and any key UI components or user interactions.',
        },
        yaml: {
            role: 'DevOps/config analyst',
            focusInstructions: 'Identify: what system this configures (Docker, CI/CD, Kubernetes, etc.), the environment it targets, and the most important settings or jobs defined.',
        },
        yml: {
            role: 'DevOps/config analyst',
            focusInstructions: 'Identify: what system this configures, the environment it targets, and the most important settings or jobs defined.',
        },
    }

    return profiles[ext] ?? {
        role: 'document analyst',
        focusInstructions: 'Extract: what this file is about, its main purpose, and the most important specific detail visible in the content.',
    }
}

interface SummaryPromptParams {
    fileName: string
    ext: string
    role: string
    focusInstructions: string
    content: string
    wasTruncated: boolean
    charCount: number
}

function buildSummaryPrompt(p: SummaryPromptParams): string {
    return `You are an expert ${p.role} working for a software team that uses CloudTeams for file collaboration.

A team member clicked "Summarize" on this ${p.ext.toUpperCase()} file: "${p.fileName}"
${p.wasTruncated ? `Note: Only the first ~${Math.round(p.charCount / 1000)}K characters are shown. If content appears to cut off, note this briefly.` : ''}

${p.focusInstructions}

File content:
---
${p.content}
---

Write a summary of exactly 3 sentences. Each sentence must be dense with specific information from the content — no padding:

Sentence 1 — WHAT: What is this file specifically? Include the exact subject, project name, document type, author name, or topic visible in the content. Never start with "This file" or "This document" — start with the actual subject (e.g., "The Q2 roadmap for...", "A Python module that...", "Budget projections for...").

Sentence 2 — KEY DETAIL: What is the single most important number, decision, finding, deadline, function, or data point in this file? Be specific — quote exact values if present.

Sentence 3 — WHO/ACTION: Which team role should care about this (e.g., "The engineering lead", "Finance team", "Project manager"), and what specific action or decision does this file support?

Rules:
- Plain text only. No markdown, no bullets, no labels.
- Never use vague filler phrases: "provides information about", "contains details", "covers various aspects".
- If you cannot find specific details (e.g., file is empty or binary noise), say so honestly in sentence 1.`.trim()
}