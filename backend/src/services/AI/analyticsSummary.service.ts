import { callGemini } from './gemini';
import { getTeamAnalytics } from '../analytics.service';

export async function generateAnalyticsSummary(teamId: number, startDate?: string, endDate?: string): Promise<string> {
    // 1. Fetch raw analytics data
    const data = await getTeamAnalytics(teamId, startDate, endDate);

    // 2. Format it into a compact JSON to save tokens
    const contextData = {
        totalFiles: data.storage.fileCount,
        totalStorage: data.storage.totalBytesFormatted,
        activeMembers: data.memberActivity.length,
        fileTypes: data.fileTypes,
        topFiles: data.largestFiles.map(f => ({ name: f.original_name, size: f.file_size_formatted })),
        activity: data.activityByType
    };

    // 3. Construct the prompt
    const prompt = `
You are an expert data analyst for a cloud file storage product called CloudTeams.
Analyze the following JSON analytics data for a specific team and write a 2-3 sentence "Executive Summary".
The summary should be actionable, highlighting any interesting trends, highly active members, or storage warnings.
Do not use technical jargon or mention JSON/data structures. Keep it conversational but professional.

Data:
${JSON.stringify(contextData, null, 2)}
`;

    // 4. Call Gemini
    // Use a slightly higher temperature (0.5) to make it read naturally, but not hallucinate
    try {
        const summary = await callGemini(prompt, 200, { temperature: 0.5 });
        return summary;
    } catch (error) {
        console.error('[generateAnalyticsSummary] Error:', error);
        
        // Fallback heuristic summary when AI is rate-limited/down
        if (data.storage.fileCount === 0) {
            return "Your team hasn't uploaded any files yet. Start collaborating by uploading some documents!";
        }
        
        const topUser = data.memberActivity.length > 0 ? data.memberActivity[0].username : 'your team members';
        const mainType = data.fileTypes.length > 0 ? (data.fileTypes[0].mime_type.split('/').pop()?.toUpperCase() || 'files') : 'files';
        
        let fallback = `Your team is actively collaborating, with ${topUser} leading recent activity. You have ${data.storage.fileCount} files taking up ${data.storage.totalBytesFormatted}, primarily consisting of ${mainType}.`;
        
        if (data.topFolders && data.topFolders.length > 0) {
            fallback += ` The most active workspace is currently the "${data.topFolders[0].folder_name}" folder.`;
        }
        
        return fallback;
    }
}
