/**
 * PinWorkspaceButton - Toggle pin for offline workspace availability
 * Gated behind subscription: free users see upgrade prompt.
 * All text from strings.pinning.* -- no hardcoded strings.
 */
import React, { useCallback } from 'react';
import { usePinWorkspaceButton } from '../hooks/usePinWorkspaceButton';
import { UpgradePrompt } from '@/shared/components/UpgradePrompt';
import { useRazorpayCheckout } from '@/features/subscription/hooks/useRazorpayCheckout';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';
import { logger } from '@/shared/services/logger';
import { strings } from '@/shared/localization/strings';

interface PinWorkspaceButtonProps {
    workspaceId: string;
}

/** Toggle button to pin a workspace for offline availability; shows upgrade prompt for free users. */
export const PinWorkspaceButton = React.memo(function PinWorkspaceButton({ workspaceId }: PinWorkspaceButtonProps) {
    const { isPinned, showUpgrade, setShowUpgrade, storageLabel, handleToggle } = usePinWorkspaceButton(workspaceId);
    const { startCheckout } = useRazorpayCheckout();

    const handleUpgrade = useCallback(() => {
        setShowUpgrade(false);
        void startCheckout(PRO_ANNUAL_PLAN_ID, 'INR').catch(
            (e: unknown) => logger.error('Razorpay checkout failed', e as Error),
        );
    }, [setShowUpgrade, startCheckout]);

    const label = isPinned ? strings.pinning.unpin : strings.pinning.pin;
    const storageInfo = isPinned && storageLabel
        ? ` (${strings.pinning.storageUsage}: ${storageLabel})`
        : '';
    const title = isPinned
        ? `${strings.pinning.unpinTooltip}${storageInfo}`
        : strings.pinning.pinTooltip;

    return (
        <>
            <button
                className={`flex items-center justify-center rounded shrink-0 transition-[color,background-color,opacity] duration-150 ease-in-out ${
                    isPinned
                        ? 'text-[var(--color-warning)] opacity-100 hover:text-[var(--color-error)]'
                        : 'text-[var(--color-text-muted)] opacity-0 hover:text-[var(--color-primary)] hover:opacity-100'
                }`}
                style={{ background: 'transparent', padding: 4, marginLeft: 4 }}
                onClick={handleToggle}
                title={title}
                aria-label={label}
            >
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill={isPinned ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                </svg>
            </button>
            {showUpgrade && (
                <UpgradePrompt
                    featureName={strings.pinning.pin}
                    onDismiss={() => setShowUpgrade(false)}
                    onUpgrade={handleUpgrade}
                />
            )}
        </>
    );
});
