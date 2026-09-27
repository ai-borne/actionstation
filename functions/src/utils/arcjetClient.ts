/**
 * Arcjet WAF wrapper — Shield (SQLi/XSS/RCE signature blocking) and bot
 * detection, running inside the Cloud Function itself.
 *
 * This is the SDK-based alternative to Cloud Armor (C6 launch decision):
 * no HTTPS load balancer or DNS change required, free tier, same rule
 * categories (shield, bot detection) as Cloud Armor's managed WAF rules.
 *
 * Two client configs:
 *  - "browser" — endpoints called by the ActionStation SPA. Bot detection
 *    blocks live (a real user's browser is never mistaken for a bot).
 *  - "server" — webhooks, health checks, and other server-to-server callers
 *    (Razorpay, Stripe, Cloud Monitoring). These are non-browser callers by
 *    design, so bot detection only logs (DRY_RUN) — only Shield can block.
 */
import arcjet, { shield, detectBot, type ArcjetDecision, type ArcjetBotCategory } from '@arcjet/node';
import { defineSecret } from 'firebase-functions/params';
import type { Request } from 'firebase-functions/v2/https';

// Re-derive type from defineSecret return, mirroring utils/razorpayClient.ts
type SecretParam = ReturnType<typeof defineSecret>;

/** Secret managed via Google Cloud Secret Manager */
export const arcjetKey: SecretParam = defineSecret('ARCJET_KEY');

/** Automated callers that are expected and must never be blocked */
const ALLOWED_BOT_CATEGORIES: ArcjetBotCategory[] = [
    'CATEGORY:SEARCH_ENGINE', // Google, Bing, etc
    'CATEGORY:MONITOR', // Cloud Monitoring uptime checks hit /health
    'CATEGORY:PREVIEW', // Slack/Discord link previews
];

type ArcjetClient = ReturnType<typeof arcjet>;

let browserClient: ArcjetClient | null = null;
let serverClient: ArcjetClient | null = null;

function getBrowserClient(): ArcjetClient {
    if (!browserClient) {
        browserClient = arcjet({
            key: arcjetKey.value(),
            rules: [
                shield({ mode: 'LIVE' }),
                detectBot({ mode: 'LIVE', allow: ALLOWED_BOT_CATEGORIES }),
            ],
        });
    }
    return browserClient;
}

function getServerClient(): ArcjetClient {
    if (!serverClient) {
        serverClient = arcjet({
            key: arcjetKey.value(),
            rules: [
                shield({ mode: 'LIVE' }),
                detectBot({ mode: 'DRY_RUN', allow: ALLOWED_BOT_CATEGORIES }),
            ],
        });
    }
    return serverClient;
}

/** Shape of an Arcjet decision this app cares about */
export interface ArcjetCheckResult {
    blocked: boolean;
    reason: string | null;
}

function toCheckResult(decision: ArcjetDecision): ArcjetCheckResult {
    if (!decision.isDenied()) return { blocked: false, reason: null };
    const reason = decision.reason.isBot()
        ? 'bot'
        : decision.reason.isShield()
            ? 'shield'
            : 'denied';
    return { blocked: true, reason };
}

/** Run Arcjet for an endpoint called directly by the ActionStation SPA. */
export async function checkArcjetBrowser(req: Request): Promise<ArcjetCheckResult> {
    const decision = await getBrowserClient().protect(req);
    return toCheckResult(decision);
}

/** Run Arcjet for a webhook, health check, or other server-to-server endpoint. */
export async function checkArcjetServer(req: Request): Promise<ArcjetCheckResult> {
    const decision = await getServerClient().protect(req);
    return toCheckResult(decision);
}
