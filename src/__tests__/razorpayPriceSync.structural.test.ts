/**
 * Structural guard: client price, plan id and copy must equal the server SSOT.
 * The server (`functions/src/utils/razorpayPricing.ts`) decides what an order costs;
 * the client only displays it. A mismatch either overcharges or undersells silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';
import { PRO_ANNUAL_PRICE_INR, PRO_ANNUAL_PRICE_LABEL } from '@/features/subscription/types/pricing';
import { strings } from '@/shared/localization/strings';

const ROOT = resolve(__dirname, '../..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Razorpay price sync (client vs server)', () => {
    it('server annual price in paise equals the client rupee price x 100', () => {
        const match = /PRO_ANNUAL_INR_PAISE\s*=\s*([\d_]+)/.exec(read('functions/src/utils/razorpayPricing.ts'));
        const paise = Number((match?.[1] ?? '').replace(/_/g, ''));
        expect(paise).toBe(PRO_ANNUAL_PRICE_INR * 100);
    });

    it('client checkout sends the plan id the server treats as the annual INR plan', () => {
        const match = /pro_annual_inr:\s*process\.env\.\w+\s*\?\?\s*'([^']+)'/.exec(
            read('functions/src/utils/securityConstants.ts'),
        );
        expect(PRO_ANNUAL_PLAN_ID).toBe(match?.[1]);
    });

    it('price copy is derived from the price constant, not hand-typed', () => {
        expect(PRO_ANNUAL_PRICE_LABEL).toBe('₹2,999');
        expect(strings.subscription.upgradeAnnualCta).toContain(PRO_ANNUAL_PRICE_LABEL);
        expect(strings.landing.pricing.proPrice).toContain(PRO_ANNUAL_PRICE_LABEL);
    });
});
