/**
 * Razorpay pricing — server-side SSOT for what an order costs.
 * Only the annual INR plan is purchasable at launch; monthly and USD plans stay
 * unorderable until global billing is in scope (checklist H2).
 * The client price copy (`PRO_ANNUAL_PRICE_INR`) must equal this in rupees;
 * `src/__tests__/razorpayPriceSync.structural.test.ts` enforces it.
 */
import { RAZORPAY_PLAN_IDS } from './securityConstants.js';

/** Annual Pro price in paise: ₹2,999 */
export const PRO_ANNUAL_INR_PAISE = 299_900;

/** Days of Pro access granted by one annual payment */
export const PRO_ANNUAL_ACCESS_DAYS = 365;

/**
 * Amount in paise for an orderable plan/currency pair, or null when the pair
 * cannot be purchased.
 */
export function getOrderAmount(planId: string, currency: string): number | null {
    if (planId === RAZORPAY_PLAN_IDS.pro_annual_inr && currency === 'INR') {
        return PRO_ANNUAL_INR_PAISE;
    }
    return null;
}
