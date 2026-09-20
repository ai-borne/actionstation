/**
 * Account usage meters — free tier limit visibility in Settings.
 */
import React from 'react';
import { strings } from '@/shared/localization/strings';
import { useSubscriptionStore } from '@/features/subscription/stores/subscriptionStore';
import { useTierLimits } from '@/features/subscription/hooks/useTierLimits';
import { UsageMeter } from '@/features/subscription/components/UsageMeter';
import { SettingsGroup } from './SettingsGroup';
import { FREE_TIER_LIMITS } from '@/features/subscription/types/tierLimits';

export const AccountUsageGroup = React.memo(function AccountUsageGroup() {
    const tier = useSubscriptionStore((s) => s.tier);
    const { check } = useTierLimits();
    const labels = strings.landing.pricing.labels;

    if (tier !== 'free') return null;

    const workspace = check('workspace');
    const node = check('node');
    const aiDaily = check('aiDaily');
    const storage = check('storage');

    return (
        <SettingsGroup title={strings.settings.usageGroup}>
            <UsageMeter current={workspace.current} max={FREE_TIER_LIMITS.maxWorkspaces} label={labels.workspaces} />
            <UsageMeter current={node.current} max={FREE_TIER_LIMITS.maxNodesPerWorkspace} label={labels.nodesPerWorkspace} />
            <UsageMeter current={aiDaily.current} max={FREE_TIER_LIMITS.maxAiGenerationsPerDay} label={labels.aiGenerationsPerDay} />
            <UsageMeter current={storage.current} max={FREE_TIER_LIMITS.maxStorageMb} label={labels.storage} />
        </SettingsGroup>
    );
});
