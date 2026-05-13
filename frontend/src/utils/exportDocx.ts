// =============================================================================
// src/utils/exportDocx.ts
//
// PURPOSE: Convert a TipTap editor's content to a .docx file and trigger
//          a browser download. Runs entirely client-side — no server call.
//
// WHY TIPTAP JSON (not getHTML):
//   Problem 5 from the Day 5 review — the docx library doesn't parse HTML.
//   You must walk a DOM tree manually, which is fragile.
//   TipTap's getJSON() returns a structured node tree:
//     { type: 'doc', content: [{ type: 'heading', attrs: {...}, content: [...] }] }
//   This maps cleanly to docx Paragraph/TextRun constructors.
//
// SUPPORTED ELEMENTS:
//   heading (level 1-3) → Heading 1/2/3
//   paragraph           → Normal paragraph
//   bulletList          → Bullet list items (via list recursion)
//   orderedList         → Numbered list items
//   listItem            → list item content
//   text                → TextRun with marks (bold, italic, underline, strikethrough, code)
//   hardBreak           → line break within a paragraph
//   blockquote          → Indented paragraph in italic
//   codeBlock           → Monospace paragraph
//   horizontalRule      → Horizontal line (page break-style)
//
// LIMITATIONS:
//   - Images not supported (TipTap image extension is not installed)
//   - Nested lists render as flat indented items (docx v9 limitation)
//   - Highlight marks are stripped (no native Word highlight color)
// =============================================================================

import {
    Document, Paragraph, TextRun, HeadingLevel, Packer,
    AlignmentType, BorderStyle, ShadingType,
    convertMillimetersToTwip, LevelFormat
} from 'docx'
import type { JSONContent } from '@tiptap/react'

// ---------------------------------------------------------------------------
// TYPES — subset of TipTap JSON node types we handle
// ---------------------------------------------------------------------------
type Mark = {
    type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'link'
    attrs?: { href?: string }
}

// ---------------------------------------------------------------------------
// HELPER: convertTextNode
// ---------------------------------------------------------------------------
// Converts a TipTap 'text' leaf node into a docx TextRun.
// WHY EXPLICIT MARK CHECK: docx TextRun options are additive — bold + italic
// can be set together. We iterate marks and apply each one.
// ---------------------------------------------------------------------------
function convertTextNode(node: JSONContent): TextRun {
    const marks: Mark[] = (node.marks ?? []) as Mark[]
    const hasCode = marks.some(m => m.type === 'code')

    return new TextRun({
        text: node.text ?? '',
        bold: marks.some(m => m.type === 'bold'),
        italics: marks.some(m => m.type === 'italic'),
        underline: marks.some(m => m.type === 'underline') ? {} : undefined,
        strike: marks.some(m => m.type === 'strike'),
        // Code mark: monospace font, light grey background
        font: hasCode ? 'Courier New' : undefined,
        size: hasCode ? 18 : undefined,  // 18 half-points = 9pt for code
        shading: hasCode ? {
            type: ShadingType.SOLID,
            color: 'F3F4F6',
            fill: 'F3F4F6',
        } : undefined,
    })
}

// ---------------------------------------------------------------------------
// HELPER: convertInlineChildren
// ---------------------------------------------------------------------------
// Recursively converts all inline children (text + hardBreak) within a block.
// ---------------------------------------------------------------------------
function convertInlineChildren(nodes: JSONContent[]): (TextRun)[] {
    const runs: TextRun[] = []
    for (const node of nodes) {
        if (node.type === 'text') {
            runs.push(convertTextNode(node))
        } else if (node.type === 'hardBreak') {
            runs.push(new TextRun({ break: 1 }))
        }
        // Other inline types (images, etc.) are skipped gracefully
    }
    return runs
}

// ---------------------------------------------------------------------------
// HELPER: convertNode
// ---------------------------------------------------------------------------
// Converts a single block-level TipTap node to one or more docx Paragraphs.
// Returns an array because list items can contain multiple blocks.
// ---------------------------------------------------------------------------
function convertNode(node: JSONContent, listLevel = 0): Paragraph[] {
    const children = node.content ?? []

    switch (node.type) {
        case 'heading': {
            const level = node.attrs?.level ?? 1
            const headingMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
                1: HeadingLevel.HEADING_1,
                2: HeadingLevel.HEADING_2,
                3: HeadingLevel.HEADING_3,
            }
            return [new Paragraph({
                heading: headingMap[level] ?? HeadingLevel.HEADING_1,
                children: convertInlineChildren(children),
            })]
        }

        case 'paragraph': {
            if (children.length === 0) {
                // Empty paragraph = blank line spacer
                return [new Paragraph({ children: [new TextRun('')] })]
            }
            return [new Paragraph({
                spacing: { after: 120 },  // 120 twips ≈ 6pt after paragraph
                children: convertInlineChildren(children),
            })]
        }

        case 'blockquote': {
            // Render blockquote children as indented italic paragraphs
            return children.flatMap(child =>
                convertNode(child, 0).map(() => {
                    return new Paragraph({
                        indent: { left: convertMillimetersToTwip(10) },
                        border: {
                            left: {
                                style: BorderStyle.SINGLE,
                                size: 6,
                                color: '94A3B8',
                                space: 8,
                            }
                        },
                        children: convertInlineChildren(child.content ?? []),
                    })
                })
            )
        }

        case 'codeBlock': {
            const code = children.map(c => c.text ?? '').join('')
            const lines = code.split('\n')
            
            return [new Paragraph({
                spacing: { before: 120, after: 120 },
                shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
                children: lines.flatMap((line, i) => [
                    new TextRun({ text: line, font: 'Courier New', size: 18 }),
                    ...(i < lines.length - 1 ? [new TextRun({ break: 1 })] : [])
                ]),
            })]
        }

        case 'bulletList': {
            return children.flatMap(listItem => {
                const paragraphNodes = listItem.content ?? []
                return paragraphNodes.map(para => new Paragraph({
                    bullet: { level: listLevel },
                    spacing: { after: 60 },
                    children: convertInlineChildren(para.content ?? []),
                }))
            })
        }

        case 'orderedList': {
            return children.flatMap(listItem => {
                const paragraphNodes = listItem.content ?? []
                return paragraphNodes.map(para => new Paragraph({
                    numbering: { reference: 'numbered-list', level: listLevel },
                    spacing: { after: 60 },
                    children: convertInlineChildren(para.content ?? []),
                }))
            })
        }

        case 'horizontalRule': {
            return [new Paragraph({
                border: {
                    bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' }
                },
                children: [new TextRun('')],
            })]
        }

        case 'taskList': {
            return children.flatMap(item => {
                const checked = item.attrs?.checked ?? false
                const textNodes = (item.content ?? []).flatMap(c => c.content ?? [])
                return [new Paragraph({
                    children: [
                        new TextRun({ text: checked ? '☑ ' : '☐ ' }),
                        ...convertInlineChildren(textNodes),
                    ],
                })]
            })
        }

        default:
            // Unknown node type — skip gracefully
            return []
    }
}

// ---------------------------------------------------------------------------
// MAIN: exportToDocx
// ---------------------------------------------------------------------------
// Converts the editor JSON to a .docx Blob and triggers download.
//
// WHY Packer.toBlob (not toBuffer):
//   toBuffer is Node.js-only. toBlob works in browsers because it resolves
//   to a Blob object that can be passed to file-saver's saveAs().
// ---------------------------------------------------------------------------
export async function exportToDocx(
    json: JSONContent,
    filename: string
): Promise<void> {
    const topLevelNodes = json.content ?? []
    const paragraphs = topLevelNodes.flatMap(node => convertNode(node))

    console.log('[exportToDocx] Creating document structure...', { filename, paragraphsCount: paragraphs.length })
    const doc = new Document({
        numbering: {
            config: [{
                reference: 'numbered-list',
                levels: [0, 1, 2, 3].map(i => ({
                    level: i,
                    format: LevelFormat.DECIMAL,
                    text: `%${i + 1}.`,
                    alignment: AlignmentType.LEFT,
                    style: {
                        paragraph: {
                            indent: { left: 720 + (i * 360), hanging: 260 }
                        }
                    }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                }) as any),
            }],
        },
        sections: [{
            properties: {},
            children: paragraphs,
        }],
    })

    console.log('[exportToDocx] Calling Packer.toBlob(doc)...')
    const blob = await Packer.toBlob(doc)
    console.log('[exportToDocx] Blob created successfully, size:', blob.size)
    const safeFilename = filename.replace(/[/\\?%*:|"<>]/g, '-')
    
    // Use native browser download instead of file-saver
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safeFilename}.docx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
