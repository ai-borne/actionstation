/**
 * PrivacySection — analytics consent controls (Settings → Privacy).
 */
import React, { useCallback } from 'react';
import { strings } from '@/shared/localization/strings';
import { useConsentState } from '@/features/legal/hooks/useConsentState';
import { SettingsGroup } from './SettingsGroup';
import { SP_SECTION, SP_SECTION_STYLE, SP_BTN_SECONDARY, SP_BTN_SECONDARY_STYLE } from '../settingsPanelStyles';

export const PrivacySection = React.memo(function PrivacySection() {
    const { choice, accept, reject } = useConsentState();
    const ls = strings.legal;
    const isEnabled = choice === 'accepted';

    const handleToggle = useCallback(() => {
        if (isEnabled) reject();
        else accept();
    }, [isEnabled, accept, reject]);

    return (
        <div className={SP_SECTION} style={SP_SECTION_STYLE}>
            <SettingsGroup title={ls.privacySettingsTitle}>
                <p
                    className="text-[var(--color-text-secondary)]"
                    style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-md)' }}
                >
                    {ls.privacySettingsDescription}
                </p>
                <p
                    className="font-medium text-[var(--color-text-primary)]"
                    style={{ fontSize: 'var(--font-size-sm)', marginBottom: 'var(--space-sm)' }}
                >
                    {isEnabled ? ls.privacyAnalyticsEnabled : ls.privacyAnalyticsDisabled}
                </p>
                <button
                    type="button"
                    className={SP_BTN_SECONDARY}
                    style={SP_BTN_SECONDARY_STYLE}
                    onClick={handleToggle}
                >
                    {isEnabled ? ls.privacyDisableAnalytics : ls.privacyEnableAnalytics}
                </button>
            </SettingsGroup>
        </div>
    );
});
