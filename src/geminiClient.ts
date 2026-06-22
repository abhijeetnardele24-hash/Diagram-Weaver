import * as https from 'https';

// Free-tier model fallback list — tries in order until one works.
// gemini-1.5-flash is guaranteed free globally; gemini-2.0-flash has limit=0 in some regions.
const FREE_TIER_MODELS = [
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash'
];

/**
 * Makes a single HTTP call to a specific Gemini model.
 */
function callGeminiModel(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody = JSON.stringify({
        contents: [
            {
                parts: [
                    { text: `${systemPrompt}\n\nUser request: ${userPrompt}` }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4096
        }
    });

    return new Promise((resolve, reject) => {
        const urlObj = new URL(apiUrl);
        const isNewFormat = apiKey.startsWith('AQ.');

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
                // New AQ. keys use Bearer auth; old AIza keys use ?key= param (already in URL)
                ...(isNewFormat ? { 'Authorization': `Bearer ${apiKey}` } : {})
            },
            timeout: 45000
        };


        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message || 'Gemini API error'));
                        return;
                    }
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) {
                        reject(new Error('Empty response from model'));
                        return;
                    }
                    resolve(text);
                } catch (e) {
                    reject(new Error(`Failed to parse Gemini response: ${data.substring(0, 200)}`));
                }
            });
        });

        // Hard timeout — kill the request if no response in 45s
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Gemini API request timed out after 45s. Check your internet and try again.'));
        });

        req.on('error', (err: Error) => {
            reject(new Error(`Network error: ${err.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Calls the Gemini API with automatic model fallback.
 * Tries gemini-1.5-flash first (guaranteed free tier globally),
 * then falls back through other free models if quota is exceeded.
 * No Copilot required.
 */
export async function callGemini(
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    let lastError: Error | undefined;

    for (const model of FREE_TIER_MODELS) {
        // Try each model up to 2 times (with a short wait on rate limit)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const result = await callGeminiModel(apiKey, model, systemPrompt, userPrompt);
                console.log(`Diagram Weaver: Using Gemini model — ${model}`);
                return result;
            } catch (err: any) {
                const msg: string = err.message || '';
                const isQuotaError = msg.includes('quota')
                    || msg.includes('RESOURCE_EXHAUSTED')
                    || msg.includes('rate')
                    || msg.includes('limit');

                // Extract retry delay if Google tells us how long to wait
                const retryMatch = msg.match(/(\d+\.?\d*)\s*s/);
                const waitMs = retryMatch ? Math.min(parseFloat(retryMatch[1]) * 1000, 8000) : 3000;

                if (isQuotaError && attempt === 0) {
                    console.log(`[Diagram Weaver] ${model} rate limited. Waiting ${Math.round(waitMs/1000)}s then retrying...`);
                    await new Promise(res => setTimeout(res, waitMs));
                    continue; // retry same model after waiting
                } else if (isQuotaError) {
                    console.log(`[Diagram Weaver] ${model} still limited after wait. Trying next model...`);
                    lastError = err;
                    break; // move to next model
                }

                // Non-quota error (bad key, network) — throw immediately
                throw err;
            }
        }
    }

    // All models exhausted
    throw new Error(
        `Gemini API quota exceeded for all models. Please wait 1 minute and try again.\n` +
        `This is a Google rate limit — your key is valid.\n\n` +
        `Check usage at: https://ai.dev/rate-limit`
    );
}

/**
 * Lightly validates a Gemini API key format — does NOT make an API call to save quota.
 * Accepts both old format (AIza...) and new format (AQ....) from Google AI Studio.
 */
export async function validateGeminiKey(apiKey: string): Promise<boolean> {
    const trimmed = apiKey.trim();
    // Accept both key formats:
    // Old format: AIzaSy... (39 chars)
    // New format: AQ.Ab8R... (Google AI Studio 2025 format)
    const isValidFormat = trimmed.startsWith('AIza') || trimmed.startsWith('AQ.');
    if (!isValidFormat || trimmed.length < 20) {
        throw new Error(
            'This does not look like a valid Gemini API key.\n' +
            'Please copy the key directly from aistudio.google.com using the "Copy key" button.'
        );
    }
    return true;
}
