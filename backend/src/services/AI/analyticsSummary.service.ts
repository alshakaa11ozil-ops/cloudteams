import { callGemini } from './gemini';
import { getTeamAnalytics } from '../analytics.service';
import { getCachedResult, setCachedResult } from './aiCache.service';

export async function generateAnalyticsSummary(teamId: number, startDate?: string, endDate?: string, force = false): Promise<string> {
    const useCache = !startDate && !endDate;

    if (useCache && !force) {
        const cached = await getCachedResult(teamId, 'analytics_summary', null);
        if (cached) {
            return cached.result;
        }
    }

    // 1. Fetch raw analytics data
    const data = await getTeamAnalytics(teamId, startDate, endDate);

    // 2. Format it into a compact JSON to save tokens
    const contextData = {
        totalFiles: data.storage.fileCount,
        totalStorage: data.storage.totalBytesFormatted,
        activeMembers: data.memberActivity.length,
        topContributors: data.memberActivity.slice(0, 3).map(m => ({ name: m.username, actions: m.action_count })),
        fileTypes: data.fileTypes.slice(0, 5),
        topFiles: data.largestFiles.map(f => ({ name: f.original_name, size: f.file_size_formatted })),
        activitySummary: data.activityByType.slice(0, 10)
    };

    // 3. Construct the prompt
    // IMPORTANT: explicitly request complete sentences to avoid truncation issues.
    const prompt = `You are an expert data analyst for a cloud file storage platform called CloudTeams.
Analyze the following team analytics data and write a concise Executive Summary of exactly 2-3 complete sentences.
CRITICAL: Every sentence must be fully complete. Do NOT cut off mid-sentence.
Highlight key trends such as most active members, storage usage, or file activity patterns.
Keep the tone conversational and professional. Do not mention JSON, data structures, or technical terms.
Output ONLY the summary text with no headers, bullets, or markdown formatting.

Analytics Data:
${JSON.stringify(contextData, null, 2)}`;

    // 4. Call Gemini
    // maxTokens: 500 gives ample room for 2-3 complete sentences (was 200 — caused truncation!)
    // temperature: 0.5 makes it read naturally
    try {
        const summary = await callGemini(prompt, 500, { temperature: 0.5 });
        if (useCache) {
            await setCachedResult(teamId, 'analytics_summary', null, summary);
        }
        return summary;
    } catch (error) {
        console.error('[generateAnalyticsSummary] AI error, using heuristic fallback:', error);

        // Fallback heuristic summary when AI is rate-limited/down
        if (data.storage.fileCount === 0) {
            return "Your team hasn't uploaded any files yet. Start collaborating by uploading some documents!";
        }

        const topUser = data.memberActivity.length > 0 ? data.memberActivity[0].username : 'your team members';
        const mainType = data.fileTypes.length > 0
            ? (data.fileTypes[0].mime_type.split('/').pop()?.toUpperCase() || 'files')
            : 'files';

        let fallback = `Your team is actively collaborating, with ${topUser} leading recent activity. You currently have ${data.storage.fileCount} files using ${data.storage.totalBytesFormatted} of storage, primarily consisting of ${mainType} files.`;

        if (data.topFolders && data.topFolders.length > 0) {
            fallback += ` The most active workspace is the "${data.topFolders[0].folder_name}" folder with ${data.topFolders[0].file_count} files.`;
        }

        return fallback;
    }
}
