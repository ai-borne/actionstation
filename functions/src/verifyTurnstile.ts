/**
 * verifyTurnstile — Cloudflare Turnstile server-side verification
 *
 * Clients complete the Turnstile widget (invisible or managed mode) and receive
 * a one-time token. They POST that token here; this function calls Cloudflare's
 * /siteverify API to confirm the challenge was genuinely solved.
 *
 * Use this endpoint BEFORE any login or sensitive mutation on the client:
 *
 *   // client-side (React example)
 *   const token = await turnstile.getResponse();      // from @cloudflare/turnstile-react
 *   const r = await fetch('/verifyTurnstile', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ token }),
 *   });
 *   if (!r.ok) throw new Error('Bot challenge failed');
 *   // proceed with Firebase signInWithEmailAndPassword / upload / etc.
 *
 * ─── reCAPTCHA v3 — same pattern ─────────────────────────────────────────
 *
 * For reCAPTCHA v3, use verifyRecaptchaToken() from utils/captchaValidator.ts
 * in the same way — create a second function or add a `provider` param:
 *
 *   import { verifyRecaptchaToken, recaptchaSecret } from './utils/captchaValidator.js';
 *
 *   const result = await verifyRecaptchaToken(token, recaptchaSecret.value(), 'login', ip);
 *
 * The reCAPTCHA secret name is RECAPTCHA_SECRET in Secret Manager.
 * Steps:
 *   1. Register site at console.cloud.google.com → Security → reCAPTCHA Enterprise
 *      (or www.google.com/recaptcha/admin for the free v3 API).
 *   2. Copy the Secret Key.
 *   3. gcloud secrets create RECAPTCHA_SECRET --replication-policy="automatic"
 *      echo -n "KEY" | gcloud secrets versions add RECAPTCHA_SECRET --data-file=-
 *   4. Add `secrets: [recaptchaSecret]` and call verifyRecaptchaToken() exactly
 *      as shown for Turnstile below.
 *
 * ─── Request / Response ──────────────────────────────────────────────────
 *
 * POST body:   { token: string }
 * 200 success: { success: true }
 * 400:         { error: "Missing or invalid token" }
 * 403:         { error: "Challenge failed" }
 * 405:         { error: "Method not allowed" }
 * 429:         { error: "Rate limit exceeded. Try again later." }
 *
 * ─── One-time secret setup ────────────────────────────────────────────────
 *
 *   1. Create a Turnstile site in the Cloudflare dashboard.
 *      Choose type "Managed" (shows a checkbox) or "Invisible" (background check).
 *      Copy the Secret Key.
 *   2. Store it in Secret Manager:
 *        gcloud secrets create TURNSTILE_SECRET --replication-policy="automatic"
 *        echo -n "YOUR_SECRET_FROM_CLOUDFLARE" | \
 *          gcloud secrets versions add TURNSTILE_SECRET --data-file=-
 *   3. Grant access to the default service account:
 *        gcloud secrets add-iam-policy-binding TURNSTILE_SECRET \
 *          --member="serviceAccount:actionstation-244f0@appspot.gserviceaccount.com" \
 *          --role="roles/secretmanager.secretAccessor"
 *   4. Deploy:  firebase deploy --only functions:verifyTurnstile
 */
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { extractClientIp } from './utils/botDetector.js';
import { checkIpRateLimit } from './utils/ipRateLimiter.js';
import { checkArcjetBrowser, arcjetKey } from './utils/arcjetClient.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import {
    IP_RATE_LIMIT_CAPTCHA,
    errorMessages,
} from './utils/securityConstants.js';
import { verifyTurnstileToken } from './utils/captchaValidator.js';

/** Cloudflare Turnstile secret — stored in Google Cloud Secret Manager. */
const turnstileSecret = defineSecret('TURNSTILE_SECRET');

export const verifyTurnstile = onRequest(
    {
        cors: ALLOWED_ORIGINS,
        secrets: [turnstileSecret, arcjetKey],
        minInstances: 0,
    },
    async (req, res) => {
        // Only POST is accepted — OPTIONS is handled automatically by the CORS layer.
        if (req.method !== 'POST') {
            res.status(405).json({ error: errorMessages.methodNotAllowed });
            return;
        }

        const clientIp = extractClientIp(req);

        // Arcjet WAF (shield + bot detection)
        const waf = await checkArcjetBrowser(req);
        if (waf.blocked) {
            logSecurityEvent({
                type: SecurityEventType.WAF_BLOCKED,
                ip: clientIp,
                endpoint: 'verifyTurnstile',
                message: `Arcjet blocked request (${waf.reason})`,
            });
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        // IP rate-limit before auth — this endpoint is public, so we rely on IP alone.
        // Limit: IP_RATE_LIMIT_CAPTCHA (default 10) requests per minute per IP.
        if (!(await checkIpRateLimit(clientIp, 'verifyTurnstile', IP_RATE_LIMIT_CAPTCHA))) {
            logSecurityEvent({
                type: SecurityEventType.RATE_LIMIT_VIOLATION,
                ip: clientIp,
                endpoint: 'verifyTurnstile',
                message: `IP rate limit exceeded for captcha verification: ${clientIp}`,
            });
            res.status(429).json({ error: errorMessages.rateLimited });
            return;
        }

        // Validate incoming token — max 4096 chars (Turnstile tokens are ~2 KB).
        const { token } = req.body as { token?: unknown };
        if (!token || typeof token !== 'string' || token.length > 4096) {
            res.status(400).json({ error: 'Missing or invalid token' });
            return;
        }

        // Call Cloudflare /siteverify with the client IP for extra entropy.
        const result = await verifyTurnstileToken(
            token,
            turnstileSecret.value(),
            clientIp,
        );

        if (!result.success) {
            logger.warn('Turnstile verification failed', {
                ip: clientIp,
                errorCodes: result.errorCodes,
            });
            logSecurityEvent({
                type: SecurityEventType.CAPTCHA_FAILED,
                ip: clientIp,
                endpoint: 'verifyTurnstile',
                message: `Turnstile challenge failed: ${(result.errorCodes ?? []).join(', ')}`,
            });
            res.status(403).json({ error: 'Challenge failed' });
            return;
        }

        logger.info('Turnstile verification passed', { ip: clientIp });
        res.status(200).json({ success: true });
    },
);
