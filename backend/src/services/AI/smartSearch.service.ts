import { callGemini } from './gemini';
import prisma from '../../config/database';

export interface SmartSearchParams {
    query: string; // The remaining keyword to search for, or empty
    mimeType?: string; // 'application/pdf', 'image/', 'video/', etc.
    uploadedBy?: number; // User ID
}

export async function parseSmartQuery(rawQuery: string, teamId: number, currentUserId: number): Promise<SmartSearchParams> {
    // 1. Get all users in the team to help the AI map names to IDs
    const members = await prisma.teamMember.findMany({
        where: { team_id: teamId },
        include: { user: { select: { id: true, username: true, email: true } } }
    });

    const userList = members.map(m => `ID: ${m.user.id}, Name: ${m.user.username}, Email: ${m.user.email}`).join('\n');

    // 2. Build the prompt
    const prompt = `
You are an intelligent search query parser for a cloud file storage product.
Convert the user's natural language query into a structured JSON search filter.
The user might ask for specific file types, or files uploaded by specific people.

Available Team Members:
${userList}

The current user making this request is User ID: ${currentUserId}. If the query says "by me", "my files", or similar, use this ID for uploadedBy.

Instructions:
1. Extract the core search keyword if there is one. For example, in "images of cats by Alen", the core keyword is "cats". 
   CRITICAL: If the entire query is just describing filters (e.g. "by me", "my files", "images", "pdfs"), you MUST set "query" strictly to an empty string "". Do NOT put "by me" or "images" in the query field.
2. If they ask for images, set mimeType to "image/". If pdfs, "application/pdf". If videos, "video/". If audio, "audio/".
3. If they specify a person who uploaded it, find the closest matching user ID from the list above and set uploadedBy.
4. Output strictly valid JSON with no markdown wrapping or extra text.

JSON Schema:
{
  "query": "string (the core keyword, or empty string)",
  "mimeType": "string (or null)",
  "uploadedBy": "number (or null)"
}

User Query: "${rawQuery}"
`;

    try {
        // 3. Call AI
        const resultText = await callGemini(prompt, 300, { temperature: 0.1 });
        
        // 4. Parse JSON safely
        const cleaned = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        
        return {
            query: parsed.query || '',
            mimeType: parsed.mimeType || undefined,
            uploadedBy: parsed.uploadedBy || undefined
        };
    } catch (e) {
        console.warn('[parseSmartQuery] Fallback to normal search due to AI error:', e instanceof Error ? e.message : e);
        // Fallback to normal search
        return { query: rawQuery };
    }
}
