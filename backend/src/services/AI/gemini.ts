// src/services/ai/gemini.ts
//
// PURPOSE: Single shared function for calling the Gemini Flash API.
//          All AI features in CloudTeams go through this one function.
//
// KEY IMPROVEMENTS:
//   - Retry logic: transient 500/503 errors auto-retry up to 2 times
//   - Lower temperature (0.3) for factual/analytical output — less hallucination
//   - Returns structured GeminiResult so callers can see finishReason
//   - Separates SAFETY errors (throw) from MAX_TOKENS (warn + continue)

export interface GeminiResult {
    text: string
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | 'unknown'
    truncated: boolean
}

export async function callGemini(
    prompt: string,
    maxTokens: number,
    options: { temperature?: number; retries?: number } = {}
): Promise<string> {
    const result = await callGeminiWithMeta(prompt, maxTokens, options)
    return result.text
}

// Extended version used internally — callers can use this for richer info
export async function callGeminiWithMeta(
    prompt: string,
    maxTokens: number,
    options: { temperature?: number; retries?: number } = {}
): Promise<GeminiResult> {
    let apiKey = process.env.GEMINI_API_KEY
    const backupKey = process.env.GEMINI_API_KEY2
    let usedBackup = false

    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
    const temperature = options.temperature ?? 0.3   // default: factual, low creativity
    const maxRetries = options.retries ?? 2           // retry transient errors twice

    if (!apiKey) {
        throw new Error('GEMINI_ERROR: GEMINI_API_KEY is not set in environment variables')
    }

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
            const body = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    maxOutputTokens: maxTokens,
                    temperature,
                    topP: 0.85,
                    candidateCount: 1,
                }
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })

            if (!response.ok) {
                const errorText = await response.text()
                console.error(`[Gemini] API error ${response.status} (attempt ${attempt}):`, errorText)

                // Handle Rate Limit (429) - Fallback to backup key if available
                if (response.status === 429 && backupKey && !usedBackup) {
                    console.warn('[Gemini] Rate limit hit on primary key. Switching to backup API key...')
                    apiKey = backupKey
                    usedBackup = true
                    // Retry immediately with the new key (or wait a bit if desired, but here we just continue the loop)
                    continue 
                }

                // Retry on server errors (500, 503) — these are usually transient
                if ([500, 503].includes(response.status) && attempt <= maxRetries) {
                    const backoff = attempt * 800
                    console.warn(`[Gemini] Retrying in ${backoff}ms...`)
                    await new Promise(r => setTimeout(r, backoff))
                    continue
                }

                // Parse error JSON if possible for a cleaner message
                let friendlyMsg = errorText
                try {
                    const parsed = JSON.parse(errorText)
                    if (parsed.error && parsed.error.message) {
                        friendlyMsg = parsed.error.message
                    }
                } catch {
                    // It's fine if it's not JSON
                }

                // Provide friendly messages for common HTTP errors
                if (response.status === 429) {
                    throw new Error('GEMINI_ERROR: AI rate limit exceeded (Google free tier allows 15 requests/min). Please wait 60 seconds and try again.')
                }
                if (response.status === 400) {
                    throw new Error('GEMINI_ERROR: The AI service rejected this request. The file might be too large or complex to analyze.')
                }
                if ([500, 502, 503, 504].includes(response.status)) {
                    throw new Error('GEMINI_ERROR: The Google AI service is temporarily down. Please try again later.')
                }

                throw new Error(`GEMINI_ERROR: AI service error — ${friendlyMsg}`)
            }

            const data = await response.json() as GeminiResponse
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text

            if (!text) {
                console.error('[Gemini] Empty response. Full data:', JSON.stringify(data))
                throw new Error('GEMINI_ERROR: Empty response from Gemini API')
            }

            const finishReason = (data.candidates?.[0]?.finishReason ?? 'unknown') as GeminiResult['finishReason']
            const truncated = finishReason === 'MAX_TOKENS'

            console.log(`[Gemini] ✅ ${model} | finish=${finishReason} | ~${Math.ceil(text.length / 4)} output tokens`)

            if (truncated) {
                console.warn(`[Gemini] ⚠️ Output TRUNCATED — increase maxTokens (currently ${maxTokens})`)
            }

            if (finishReason === 'SAFETY') {
                throw new Error('GEMINI_ERROR: Response blocked by safety filter')
            }

            return { text: text.trim(), finishReason, truncated }

        } catch (err) {
            lastError = err as Error
            // Only retry on network/transient errors, not GEMINI_ERROR throws
            if (lastError.message.startsWith('GEMINI_ERROR') || attempt > maxRetries) break
            const backoff = attempt * 800
            console.warn(`[Gemini] Network error (attempt ${attempt}), retrying in ${backoff}ms...`)
            await new Promise(r => setTimeout(r, backoff))
        }
    }

    throw lastError ?? new Error('GEMINI_ERROR: Unknown failure')
}

interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{ text: string }>
        }
        finishReason?: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER'
    }>
}
