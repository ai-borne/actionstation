/**
 * Pricing — display constants for the annual Pro plan.
 * The server (`functions/src/utils/razorpayPricing.ts`) decides what is actually charged;
 * `src/__tests__/razorpayPriceSync.structural.test.ts` keeps the two equal.
 * Kept apart from `subscription.ts` so copy modules can import it without pulling in tier logic.
 */

/** Annual Pro price in rupees, for display only. */
export const PRO_ANNUAL_PRICE_INR = 2999;

/** Days after payment in which an annual plan is refunded in full on request. */
export const REFUND_WINDOW_DAYS = 7;

/** Localised price label, e.g. "\u20B92,999" */
export const PRO_ANNUAL_PRICE_LABEL = `\u20B9${PRO_ANNUAL_PRICE_INR.toLocaleString('en-IN')}`;

/** Free plan price label, kept in the same currency as PRO_ANNUAL_PRICE_LABEL. */
export const FREE_PRICE_LABEL = '\u20B90';
