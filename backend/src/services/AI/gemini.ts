// src/services/ai/gemini.ts
//
// PURPOSE: Single shared function for calling the Gemini Flash API.
//          All AI features in CloudTeams go through this one function.
//
// KEY IMPROVEMENTS:
//   - DUAL API KEY ROUND-ROBIN: Both GEMINI_API_KEY and GEMINI_API_KEY2 are used
//     in rotation on every call, effectively doubling the rate limit capacity.
//   - Retry logic: transient 500/503 errors auto-retry up to 3 times
//   - On 429 with both keys exhausted: waits 10s then retries the primary key
//   - Lower temperature (0.3) for factual/analytical output — less hallucination
//   - Returns structured GeminiResult so callers can see finishReason
//   - Separates SAFETY errors (throw) from MAX_TOKENS (warn + continue)

export interface GeminiResult {
    text: string
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER' | 'unknown'
    truncated: boolean
}

// ── Round-robin key selector ──────────────────────────────────────────────
// Each call atomically picks the next key in sequence so load is spread
// evenly across both keys, doubling the effective per-minute quota.
let _keyIndex = 0
function pickApiKey(): { primary: string; backup: string | null } {
    const key1 = (process.env.GEMINI_API_KEY || '').trim()
    const key2 = (process.env.GEMINI_API_KEY2 || '').trim()
    if (!key2) return { primary: key1, backup: null }
    // Alternate between keys on successive calls
    const usePrimary = (_keyIndex++ % 2) === 0
    return usePrimary
        ? { primary: key1, backup: key2 }
        : { primary: key2, backup: key1 }
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
    const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
    const temperature = options.temperature ?? 0.3   // default: factual, low creativity
    const maxRetries = options.retries ?? 3           // retry transient errors up to 3 times

    // Pick the starting key using round-robin (alternates between key1 and key2)
    const { primary, backup } = pickApiKey()
    if (!primary) {
        throw new Error('GEMINI_ERROR: GEMINI_API_KEY is not set in environment variables')
    }

    // Build key rotation list: [primary, backup] so we try both before giving up
    const keyPool: string[] = backup ? [primary, backup] : [primary]
    let keyPoolIndex = 0      // which key in pool we are currently using
    let apiKey = keyPool[0]

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
                console.error(`[Gemini] API error ${response.status} (attempt ${attempt}, key #${keyPoolIndex + 1}):`, errorText)

                // Handle Rate Limit (429)
                // Strategy: rotate to the next key in the pool first.
                // If we've exhausted all keys, wait 10s then start over with key #1.
                if (response.status === 429) {
                    keyPoolIndex++
                    if (keyPoolIndex < keyPool.length) {
                        // Switch to next available key immediately
                        apiKey = keyPool[keyPoolIndex]
                        console.warn(`[Gemini] Rate limit on key #${keyPoolIndex}. Switching to key #${keyPoolIndex + 1}...`)
                        continue
                    } else if (attempt <= maxRetries) {
                        // All keys exhausted — wait 10s for quota window to partially reset
                        console.warn('[Gemini] All API keys rate-limited. Waiting 10s before retry...')
                        await new Promise(r => setTimeout(r, 10_000))
                        keyPoolIndex = 0
                        apiKey = keyPool[0]
                        continue
                    } else {
                        throw new Error('GEMINI_ERROR: AI rate limit exceeded on all API keys. Please wait a minute and try again.')
                    }
                }

                // Retry on server errors (500, 503) — these are usually transient
                if ([500, 503].includes(response.status) && attempt <= maxRetries) {
                    const backoff = attempt * 800
                    console.warn(`[Gemini] Server error, retrying in ${backoff}ms...`)
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
                    throw new Error('GEMINI_ERROR: AI rate limit exceeded on all API keys. Please wait a minute and try again.')
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

            console.log(`[Gemini] ✅ ${model} | key#${keyPoolIndex + 1} | finish=${finishReason} | ~${Math.ceil(text.length / 4)} output tokens`)

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
