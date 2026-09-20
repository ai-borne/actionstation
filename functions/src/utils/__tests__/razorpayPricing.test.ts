/**
 * razorpayPricing Tests — server-side price SSOT for Razorpay orders.
 * Only the annual INR plan is orderable at launch (H2 covers global billing).
 */
import { describe, it, expect } from 'vitest';
import { getOrderAmount, PRO_ANNUAL_INR_PAISE } from '../razorpayPricing.js';
import { RAZORPAY_PLAN_IDS } from '../securityConstants.js';

describe('razorpayPricing', () => {
    it('prices the annual INR plan at 2,999 rupees in paise', () => {
        expect(PRO_ANNUAL_INR_PAISE).toBe(299_900);
        expect(getOrderAmount(RAZORPAY_PLAN_IDS.pro_annual_inr, 'INR')).toBe(299_900);
    });

    it('refuses the monthly INR test plan', () => {
        expect(getOrderAmount(RAZORPAY_PLAN_IDS.pro_monthly_inr, 'INR')).toBeNull();
    });

    it('refuses USD plans', () => {
        expect(getOrderAmount(RAZORPAY_PLAN_IDS.pro_annual_usd, 'USD')).toBeNull();
        expect(getOrderAmount(RAZORPAY_PLAN_IDS.pro_monthly_usd, 'USD')).toBeNull();
    });

    it('refuses the annual plan in a non-INR currency', () => {
        expect(getOrderAmount(RAZORPAY_PLAN_IDS.pro_annual_inr, 'USD')).toBeNull();
    });

    it('refuses unknown plan ids', () => {
        expect(getOrderAmount('plan_made_up', 'INR')).toBeNull();
        expect(getOrderAmount('', 'INR')).toBeNull();
    });
});
