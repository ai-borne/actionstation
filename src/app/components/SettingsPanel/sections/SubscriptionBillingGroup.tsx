/**
 * Subscription billing controls — Razorpay checkout (free) or provider-aware manage UI (pro).
 */
import React, { useCallback, useEffect } from 'react';
import { strings } from '@/shared/localization/strings';
import { useSubscriptionStore } from '@/features/subscription/stores/subscriptionStore';
import { useBillingPortal } from '@/features/subscription/hooks/useBillingPortal';
import { useRazorpayCheckout } from '@/features/subscription/hooks/useRazorpayCheckout';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';
import { toast } from '@/shared/stores/toastStore';
import { logger } from '@/shared/services/logger';
import { SettingsGroup } from './SettingsGroup';
import { SP_BTN_SECONDARY, SP_BTN_SECONDARY_STYLE, SP_SETTING_DESC, SP_SETTING_DESC_STYLE } from '../settingsPanelStyles';

export const SubscriptionBillingGroup = React.memo(function SubscriptionBillingGroup() {
    const tier = useSubscriptionStore((s) => s.tier);
    const isActive = useSubscriptionStore((s) => s.isActive);
    const provider = useSubscriptionStore((s) => s.provider);
    const { openBillingPortal, isLoading: portalLoading, error: portalError } = useBillingPortal();
    const { startCheckout, isLoading: checkoutLoading, error: checkoutError } = useRazorpayCheckout();
    const s = strings.subscription;
    const isPro = tier === 'pro';
    const useStripePortal = isPro && provider === 'stripe';

    useEffect(() => {
        if (checkoutError) toast.error(checkoutError);
    }, [checkoutError]);

    useEffect(() => {
        if (portalError) toast.error(portalError);
    }, [portalError]);

    const handleUpgrade = useCallback(() => {
        void startCheckout(PRO_ANNUAL_PLAN_ID, 'INR').catch(
            (e: unknown) => logger.error('Razorpay checkout failed', e as Error),
        );
    }, [startCheckout]);

    let billingAction: React.ReactNode;
    if (isPro && useStripePortal) {
        billingAction = (
            <button
                className={SP_BTN_SECONDARY}
                style={SP_BTN_SECONDARY_STYLE}
                onClick={openBillingPortal}
                disabled={portalLoading}
            >
                {portalLoading ? strings.common.loading : s.manageBilling}
            </button>
        );
    } else if (isPro) {
        billingAction = (
            <span className={SP_SETTING_DESC} style={SP_SETTING_DESC_STYLE}>
                {s.razorpayManageBilling}
            </span>
        );
    } else {
        billingAction = (
            <button
                className={SP_BTN_SECONDARY}
                style={SP_BTN_SECONDARY_STYLE}
                onClick={handleUpgrade}
                disabled={checkoutLoading}
            >
                {checkoutLoading ? s.upgradeLoading : s.upgradeAnnualCta}
            </button>
        );
    }

    return (
        <SettingsGroup title={s.subscriptionGroup}>
            <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
                <span className="font-medium text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-sm)' }}>
                    {s.currentPlan}:
                </span>
                <span
                    className="font-semibold rounded-md"
                    style={{
                        fontSize: 'var(--font-size-sm)',
                        color: isPro ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                        background: isPro ? 'var(--color-primary-faint)' : 'var(--color-surface)',
                        padding: '2px 8px',
                    }}
                >
                    {isPro ? s.pro : s.free}
                </span>
                <span className="text-xs" style={{ color: isActive ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {isActive ? s.active : s.inactive}
                </span>
            </div>
            {billingAction}
        </SettingsGroup>
    );
});
