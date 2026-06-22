import * as https from 'https';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Groq free-tier models in priority order (fastest first)
const GROQ_MODELS = [
    'llama-3.3-70b-versatile',   // Best quality, current Groq standard
    'llama-3.1-8b-instant',      // Ultra fast fallback
    'mixtral-8x7b-32768',        // Great for structured output
    'gemma2-9b-it'               // Last resort
];

/**
 * Calls the Groq API (OpenAI-compatible format).
 * Groq is the fastest AI inference API available — free tier, no card needed.
 */
function callGroqModel(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    const requestBody = JSON.stringify({
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4096
    });

    return new Promise((resolve, reject) => {
        const urlObj = new URL(GROQ_API_URL);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 30000 // 30s — Groq is fast, if no response in 30s something is wrong
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: string) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) {
                        reject(new Error(parsed.error.message || 'Groq API error'));
                        return;
                    }
                    const text = parsed.choices?.[0]?.message?.content;
                    if (!text) {
                        reject(new Error('Groq returned empty response'));
                        return;
                    }
                    resolve(text);
                } catch (e) {
                    reject(new Error(`Failed to parse Groq response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Groq request timed out after 30s.'));
        });

        req.on('error', (err: Error) => {
            reject(new Error(`Network error calling Groq: ${err.message}`));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Calls the Groq API with automatic model fallback.
 * Groq is the fastest AI inference API — typically responds in 1-3 seconds.
 */
export async function callGroq(
    apiKey: string,
    systemPrompt: string,
    userPrompt: string
): Promise<string> {
    let lastError: Error | undefined;

    for (const model of GROQ_MODELS) {
        try {
            const result = await callGroqModel(apiKey, model, systemPrompt, userPrompt);
            console.log(`[Diagram Weaver] Using Groq model — ${model}`);
            return result;
        } catch (err: any) {
            const msg: string = err.message || '';
            const isRateLimit = msg.includes('rate') || msg.includes('quota') || msg.includes('limit') || msg.includes('429');

            if (isRateLimit) {
                console.log(`[Diagram Weaver] Groq model ${model} rate limited — trying next...`);
                lastError = err;
                continue;
            }

            // Auth or network errors — throw immediately
            throw err;
        }
    }

    throw new Error(
        `Groq rate limit hit on all models. Please wait 1 minute and try again.\n` +
        `Your key is valid — this is just a temporary rate limit.`
    );
}

/**
 * Validates a Groq API key format.
 * Groq keys always start with 'gsk_'
 */
export function validateGroqKey(apiKey: string): boolean {
    const trimmed = apiKey.trim();
    if (!trimmed.startsWith('gsk_') || trimmed.length < 20) {
        throw new Error(
            'This does not look like a valid Groq API key.\n' +
            'Groq keys start with "gsk_". Get yours free at console.groq.com/keys'
        );
    }
    return true;
}
