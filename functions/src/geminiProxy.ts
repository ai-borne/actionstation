/**
 * geminiProxy Cloud Function — Server-side Gemini API proxy
 * Hides the API key from client-side code (resolves S1 limitation)
 * Validates auth, enforces rate limits, caps output tokens, forwards to Gemini
 *
 * Security layers (in order):
 *  1. Bot detection       — reject scanners / headless browsers immediately
 *  2. IP rate limit       — per-IP ceiling to stop distributed multi-account abuse
 *  3. Auth verification   — Firebase ID token
 *  4. User rate limit     — per-user Firestore-backed sliding window
 *  5. Body size cap       — 100 KB hard limit on raw JSON
 *  6. Prompt injection    — pattern-based input filter
 *  7. Token cap           — maxOutputTokens ceiling
 *  8. Output filter       — scan response for leaked secrets
 *  9. Security logging    — every event written to Cloud Logging
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAppCheckToken } from './utils/appCheckVerifier.js';
import { verifyAuthToken } from './utils/authVerifier.js';
import { checkRateLimit } from './utils/rateLimiter.js';
import { checkIpRateLimit } from './utils/ipRateLimiter.js';
import { detectBot, extractClientIp } from './utils/botDetector.js';
import { filterPromptInput, filterPromptOutput } from './utils/promptFilter.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { recordThreatEvent } from './utils/threatMonitor.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { checkAndIncrementDailyAi } from './utils/dailyAiLimiter.js';
import {
    errorMessages,
    GEMINI_RATE_LIMIT,
    GEMINI_MAX_BODY_BYTES,
    GEMINI_MAX_OUTPUT_TOKENS,
    GEMINI_API_BASE,
    GEMINI_MODEL,
    GEMINI_FETCH_TIMEOUT_MS,
    IP_RATE_LIMIT_GEMINI,
    AI_DAILY_FREE_LIMIT,
    AI_DAILY_PRO_LIMIT,
} from './utils/securityConstants.js';

/** Secret managed via Google Cloud Secret Manager */
const geminiApiKey = defineSecret('GEMINI_API_KEY');

/** Shape of the incoming request body from the client */
export interface GeminiProxyRequest {
    contents?: Array<{ parts?: Array<Record<string, unknown>> }>;
    generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
    };
}

/** Result returned by the core handler */
export interface GeminiProxyResult {
    status: number;
    data: Record<string, unknown>;
}

/**
 * Core handler logic extracted for testability.
 * Validates the request, forwards to Gemini, returns the response.
 */
export async function handleGeminiProxy(
    body: GeminiProxyRequest,
    uid: string,
    apiKey: string,
): Promise<GeminiProxyResult> {
    // Validate API key is configured
    if (!apiKey) {
        return { status: 500, data: { error: errorMessages.geminiKeyMissing } };
    }

    // Rate limit
    if (!await checkRateLimit(uid, 'geminiProxy', GEMINI_RATE_LIMIT)) {
        recordThreatEvent('429_spike', { uid, endpoint: 'geminiProxy' });
        logSecurityEvent({
            type: SecurityEventType.RATE_LIMIT_VIOLATION,
            uid,
            endpoint: 'geminiProxy',
            message: `User rate limit exceeded`,
        });
        return { status: 429, data: { error: errorMessages.rateLimited } };
    }

    // Check daily AI limit (free vs pro caps)
    const tierSnap = await getFirestore().doc(`users/${uid}/subscription/current`).get();
    const tier = (tierSnap.data() as Record<string, unknown> | undefined)?.tier as string | undefined;
    const dailyLimit = tier === 'pro' ? AI_DAILY_PRO_LIMIT : AI_DAILY_FREE_LIMIT;
    const allowed = await checkAndIncrementDailyAi(uid, dailyLimit);
    if (!allowed) {
        logSecurityEvent({
            type: SecurityEventType.RATE_LIMIT_VIOLATION,
            uid,
            endpoint: 'geminiProxy',
            message: 'Daily AI generation limit exceeded',
            metadata: { reason: 'daily_ai_limit', tier: tier ?? 'free' },
        });
        return { status: 429, data: { error: errorMessages.aiDailyLimitExceeded } };
    }

    // Validate request body
    if (!body.contents || !Array.isArray(body.contents) || body.contents.length === 0) {
        return { status: 400, data: { error: errorMessages.geminiInvalidBody } };
    }

    // Enforce body size (serialized JSON)
    const serialized = JSON.stringify(body);
    if (serialized.length > GEMINI_MAX_BODY_BYTES) {
        return { status: 400, data: { error: errorMessages.geminiBodyTooLarge } };
    }

    // Prompt injection / exfiltration filter
    const promptCheck = filterPromptInput(body.contents);
    if (!promptCheck.allowed) {
        logSecurityEvent({
            type: SecurityEventType.PROMPT_INJECTION,
            uid,
            endpoint: 'geminiProxy',
            message: promptCheck.reason ?? 'Prompt filter rejected request',
        });
        return { status: 400, data: { error: 'Request blocked by content policy' } };
    }

    // Log accepted prompt (hash only — never log raw user text)
    logSecurityEvent({
        type: SecurityEventType.AI_PROMPT,
        uid,
        endpoint: 'geminiProxy',
        message: 'Prompt accepted',
        metadata: {
            parts_count: body.contents.length,
        },
    });

    // Cap output tokens
    const sanitizedBody = capOutputTokens(body);

    // Forward to Gemini API
    const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEMINI_FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sanitizedBody),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok) {
            recordThreatEvent('500_spike', { uid, endpoint: 'geminiProxy' });
            return { status: response.status, data: { error: errorMessages.geminiUpstreamError, details: data } };
        }

        // Output secret scan
        const outputCheck = filterPromptOutput(data);
        if (!outputCheck.safe) {
            logSecurityEvent({
                type: SecurityEventType.RULE_DENIAL,
                uid,
                endpoint: 'geminiProxy',
                message: `Output filter blocked response: ${outputCheck.reason}`,
            });
            return { status: 502, data: { error: 'Response blocked by content policy' } };
        }

        return { status: 200, data };
    } catch {
        recordThreatEvent('500_spike', { uid, endpoint: 'geminiProxy' });
        return { status: 502, data: { error: errorMessages.geminiUpstreamError } };
    }
}

/** Cap maxOutputTokens to prevent excessive usage */
function capOutputTokens(body: GeminiProxyRequest): GeminiProxyRequest {
    const config = body.generationConfig;
    if (!config) return body;

    const capped = Math.min(config.maxOutputTokens ?? GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MAX_OUTPUT_TOKENS);
    return {
        ...body,
        generationConfig: { ...config, maxOutputTokens: capped },
    };
}

/**
 * Cloud Function entry point.
 * POST /geminiProxy { contents, generationConfig }
 * Requires Firebase Auth token in Authorization header.
 */
export const geminiProxy = onRequest(
    { cors: ALLOWED_ORIGINS, maxInstances: 10, secrets: [geminiApiKey] },
    async (req, res) => {
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        const ip = extractClientIp(req);

        // Layer 1: Bot detection
        const bot = detectBot(req);
        if (bot.isBot && bot.confidence !== 'low') {
            logSecurityEvent({
                type: SecurityEventType.BOT_DETECTED,
                ip,
                endpoint: 'geminiProxy',
                message: bot.reason ?? 'Bot detected',
                metadata: { confidence: bot.confidence },
            });
            recordThreatEvent('bot_spike', { ip, endpoint: 'geminiProxy' });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // Layer 1.5: App Check
        if (!await verifyAppCheckToken(req)) {
            logSecurityEvent({
                type: SecurityEventType.APP_CHECK_FAILURE,
                ip,
                endpoint: 'geminiProxy',
                message: 'Missing or invalid App Check token',
            });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        // Layer 2: IP rate limit
        if (!await checkIpRateLimit(ip, 'geminiProxy', IP_RATE_LIMIT_GEMINI)) {
            logSecurityEvent({
                type: SecurityEventType.IP_BLOCKED,
                ip,
                endpoint: 'geminiProxy',
                message: `IP rate limit exceeded`,
            });
            recordThreatEvent('429_spike', { ip, endpoint: 'geminiProxy' });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Layer 3: Auth
        const uid = await verifyAuthToken(req.headers.authorization);
        if (!uid) {
            logSecurityEvent({
                type: SecurityEventType.AUTH_FAILURE,
                ip,
                endpoint: 'geminiProxy',
                message: 'Missing or invalid auth token',
            });
            recordThreatEvent('auth_failure_spike', { ip, endpoint: 'geminiProxy' });
            res.status(401).json({ error: errorMessages.authRequired });
            return;
        }

        const result = await handleGeminiProxy(
            req.body as GeminiProxyRequest,
            uid,
            geminiApiKey.value(),
        );
        res.status(result.status).json(result.data);
    },
);
