// src/services/ai/duplicateExplain.service.ts
//
// PURPOSE: When a duplicate file is uploaded, return a clear, fact-based message
//          showing the existing file's info and who originally uploaded it.
//
// WHY NO AI: The user wants simple, direct info — filename, size, location, uploader.
//             Formatting this directly from DB data is faster, never truncates,
//             and never fails due to API errors or cached bad responses.

import prisma from '../../config/database'

export async function explainDuplicate(
    teamId: number,
    uploadedName: string,
    existingFileId: number
): Promise<string> {

    // Fetch the existing file record with uploader and folder info
    const existing = await prisma.file.findUnique({
        where: { id: existingFileId },
        include: {
            uploader: { select: { username: true, email: true } },
            folder: { select: { name: true } }
        }
    })

    if (!existing) {
        return `"${uploadedName}" already exists in this team's storage. No duplicate was created.`
    }

    // Build readable file info
    const fileSizeKB = (existing.file_size / 1024).toFixed(1)
    const fileSizeMB = existing.file_size > 1024 * 1024
        ? ` (${(existing.file_size / (1024 * 1024)).toFixed(1)} MB)`
        : ` (${fileSizeKB} KB)`

    const location = existing.folder
        ? `📁 ${existing.folder.name}`
        : '📁 Root folder'

    const uploadedDate = existing.created_at.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    })
    const uploadedTime = existing.created_at.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit'
    })

    const isDifferentName = uploadedName.toLowerCase() !== existing.original_name.toLowerCase()

    // Format the output as clear structured text
    const lines = [
        `Your file is identical to an existing file in this team.`,
        ``,
        `Existing file info:`,
        `• Name: ${existing.original_name}${isDifferentName ? ` (you uploaded it as "${uploadedName}")` : ''}`,
        `• Size: ${fileSizeMB.trim()}`,
        `• Location: ${location}`,
        `• First uploaded: ${uploadedDate} at ${uploadedTime}`,
        ``,
        `Uploaded by:`,
        `• ${existing.uploader.username} (${existing.uploader.email})`,
    ]

    return lines.join('\n')
}
