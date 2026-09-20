/**
 * Security Constants - Centralized limits, messages, and allowed values
 * SSOT for all security-related configuration in Cloud Functions
 */

/** Allowed URL schemes for link preview fetching */
export const ALLOWED_SCHEMES = ['http:', 'https:'] as const;

/** Maximum URL length to prevent abuse */
export const MAX_URL_LENGTH = 2048;

/** Maximum HTML response size in bytes (1 MB) */
export const MAX_HTML_SIZE_BYTES = 1_048_576;

/** Maximum image response size in bytes (5 MB) */
export const MAX_IMAGE_SIZE_BYTES = 5_242_880;

/** Fetch timeout for external requests in milliseconds */
export const FETCH_TIMEOUT_MS = 5000;

/** Fetch timeout for Gemini API calls — LLM inference needs more headroom */
export const GEMINI_FETCH_TIMEOUT_MS = 30_000;

/** Rate limit: max metadata requests per window per user */
export const META_RATE_LIMIT = 20;

/** Rate limit: max image proxy requests per window per user */
export const IMAGE_RATE_LIMIT = 30;

/** Rate limit window duration in milliseconds (1 minute) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Image proxy browser cache duration in seconds (24 hours) */
export const IMAGE_CACHE_MAX_AGE_SECONDS = 86_400;

/**
 * Allowed image MIME types for the proxy.
 * SVG is intentionally excluded — it can contain scripts/event handlers (XSS vector).
 */
export const ALLOWED_IMAGE_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
] as const;

/** Rate limit: max Gemini proxy requests per window per user */
export const GEMINI_RATE_LIMIT = 60;

/** Rate limit: max requests per IP per window (all endpoints combined) */
export const IP_RATE_LIMIT = 120;

/** Rate limit: max Gemini requests per IP per window (tighter — inference is expensive) */
export const IP_RATE_LIMIT_GEMINI = 30;

/** Rate limit: max upload requests per IP per window */
export const IP_RATE_LIMIT_UPLOAD = 20;

/** Rate limit: max captcha-verify requests per IP per window (pre-auth, so keep low) */
export const IP_RATE_LIMIT_CAPTCHA = 10;

/** Rate limit: max Google Calendar auth operations per window per user */
export const CALENDAR_AUTH_RATE_LIMIT = 10;

/** Rate limit: max Google Calendar event operations per window per user */
export const CALENDAR_EVENTS_RATE_LIMIT = 30;

/** Rate limit: max calendar requests per IP per window */
export const IP_RATE_LIMIT_CALENDAR = 20;

/** Rate limit: max checkout session creates per user per window */
export const CHECKOUT_RATE_LIMIT = 5;

/** Rate limit: max checkout session creates per IP per window */
export const IP_RATE_LIMIT_CHECKOUT = 10;

/** Rate limit: max billing portal creates per user per window */
export const BILLING_PORTAL_RATE_LIMIT = 10;

/** Rate limit: max billing portal creates per IP per window */
export const IP_RATE_LIMIT_BILLING_PORTAL = 20;

/** Daily AI generation limit for free tier users */
export const AI_DAILY_FREE_LIMIT = 60;

/** Pro tier daily AI cap — must match PRO_TIER_LIMITS.maxAiGenerationsPerDay on client */
export const AI_DAILY_PRO_LIMIT = 500;

/**
 * Razorpay plan IDs.
 * pro_monthly_inr: test plan at ₹100/month (test mode) — replace with ₹499 plan for production.
 * pro_annual_inr: not yet created — placeholder until production annual plan is set up.
 */
export const RAZORPAY_PLAN_IDS = {
    pro_monthly_inr: process.env.RAZORPAY_PLAN_PRO_MONTHLY_INR ?? 'plan_SWtIj1spzXCZbR',
    pro_annual_inr: process.env.RAZORPAY_PLAN_PRO_ANNUAL_INR ?? 'plan_pro_annual_inr',
    pro_monthly_usd: process.env.RAZORPAY_PLAN_PRO_MONTHLY_USD ?? 'plan_pro_monthly_usd',
    pro_annual_usd: process.env.RAZORPAY_PLAN_PRO_ANNUAL_USD ?? 'plan_pro_annual_usd',
} as const;

/** Maximum request body size for Gemini proxy (100 KB) */
export const GEMINI_MAX_BODY_BYTES = 102_400;

/** Maximum file upload size in bytes (50 MB hard ceiling before per-type checks) */
export const UPLOAD_MAX_BODY_BYTES = 52_428_800;

/** Maximum output tokens the client may request */
export const GEMINI_MAX_OUTPUT_TOKENS = 2048;

/** Gemini API base URL */
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Default Gemini model */
export const GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';

/** Base URL for Cloud Functions — used to construct signed proxy URLs */
export const FUNCTIONS_BASE_URL = (
    process.env.FUNCTIONS_BASE_URL ?? ''
).replace(/\/$/, '');

/** Error messages returned to clients */
export const errorMessages = {
    authRequired: 'Authentication required',
    invalidUrl: 'Invalid or missing URL',
    urlTooLong: 'URL exceeds maximum length',
    unsupportedScheme: 'Only HTTP and HTTPS URLs are allowed',
    ssrfBlocked: 'URL target is not allowed',
    rateLimited: 'Rate limit exceeded. Try again later.',
    fetchFailed: 'Failed to fetch the target URL',
    responseTooLarge: 'Response exceeds size limit',
    invalidContentType: 'Response is not a valid image type',
    methodNotAllowed: 'Method not allowed',
    geminiKeyMissing: 'Gemini API key is not configured on the server',
    geminiInvalidBody: 'Invalid request body: contents array is required',
    geminiBodyTooLarge: 'Request body exceeds maximum size',
    geminiUpstreamError: 'Gemini API returned an error',
    aiDailyLimitExceeded: 'Daily AI generation limit reached. Upgrade to Pro for unlimited.',
    invalidPriceId: 'Invalid or missing price ID',
    checkoutFailed: 'Failed to create checkout session',
    missingSignature: 'Missing stripe-signature header',
    invalidSignature: 'Invalid webhook signature',
    webhookProcessingFailed: 'Webhook processing failed',
    billingPortalFailed: 'Failed to create billing portal session',
} as const;
