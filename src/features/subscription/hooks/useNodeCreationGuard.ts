/**
 * useNodeCreationGuard — Guards user-initiated node creation against
 * the free tier node-per-workspace limit.
 *
 * Shows a toast with upgrade CTA when the limit is reached.
 * Internal operations (canvas load, undo/redo, onboarding seed) bypass this guard.
 */
import { useCallback } from 'react';
import { useTierLimits } from './useTierLimits';
import { useRazorpayCheckout } from './useRazorpayCheckout';
import { toastWithAction } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { logger } from '@/shared/services/logger';
import { PRO_ANNUAL_PLAN_ID } from '../types/subscription';

export function useNodeCreationGuard() {
    const { check } = useTierLimits();
    const { startCheckout } = useRazorpayCheckout();

    const guardNodeCreation = useCallback((): boolean => {
        const result = check('node');
        if (!result.allowed) {
            toastWithAction(
                strings.subscription.limits.nodeLimit,
                'warning',
                {
                    label: strings.subscription.upgradeCta,
                    onClick: () => {
                        void startCheckout(PRO_ANNUAL_PLAN_ID, 'INR').catch(
                            (e: unknown) => logger.error('[useNodeCreationGuard] Checkout failed', e as Error),
                        );
                    },
                },
            );
            return false;
        }
        return true;
    }, [check, startCheckout]);

    return { guardNodeCreation };
}

