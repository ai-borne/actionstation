/**
 * Account Section - User info, data export, sign out, and account deletion.
 * Organized into SettingsGroup cards with standardized button variants.
 */
import React, { useCallback, useState } from 'react';
import { strings } from '@/shared/localization/strings';
import { useAuthStore } from '@/features/auth/stores/authStore';
import { signOut, deleteAccount } from '@/features/auth/services/authService';
import { useConfirm } from '@/shared/stores/confirmStore';
import { useDataExport } from '@/features/workspace/hooks/useDataExport';
import { useGdprExport } from '@/features/workspace/hooks/useGdprExport';
import { toast } from '@/shared/stores/toastStore';
import { logger } from '@/shared/services/logger';
import { SettingsGroup } from './SettingsGroup';
import { SubscriptionBillingGroup } from './SubscriptionBillingGroup';
import { AccountUsageGroup } from './AccountUsageGroup';
import {
    SP_SECTION, SP_SECTION_STYLE,
    SP_SETTING_DESC, SP_SETTING_DESC_STYLE,
    SP_BTN_SECONDARY, SP_BTN_SECONDARY_STYLE,
    SP_BTN_DANGER, SP_BTN_DANGER_STYLE,
} from '../settingsPanelStyles';
import {
    ACCT_INFO, ACCT_INFO_STYLE, ACCT_AVATAR, ACCT_AVATAR_PLACEHOLDER,
    ACCT_AVATAR_PLACEHOLDER_STYLE, ACCT_DETAILS, ACCT_DETAILS_STYLE,
    ACCT_NAME, ACCT_NAME_STYLE, ACCT_EMAIL, ACCT_EMAIL_STYLE,
} from './accountSectionStyles';

function DangerZone() {
    const confirm = useConfirm();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDeleteAccount = useCallback(async () => {
        const confirmed = await confirm({
            title: strings.settings.deleteAccountTitle,
            message: strings.settings.deleteAccountConfirm,
            confirmText: strings.settings.deleteAccountButton,
            isDestructive: true,
        });
        if (!confirmed) return;

        setIsDeleting(true);
        try {
            await deleteAccount();
            toast.success(strings.settings.deleteAccountSuccess);
        } catch {
            toast.error(strings.settings.deleteAccountFailed);
        } finally {
            setIsDeleting(false);
        }
    }, [confirm]);

    return (
        <SettingsGroup title={strings.settings.dangerZone} variant="danger">
            <span className={SP_SETTING_DESC} style={SP_SETTING_DESC_STYLE}>
                {strings.settings.deleteAccountConfirm}
            </span>
            <button
                className={SP_BTN_DANGER}
                style={SP_BTN_DANGER_STYLE}
                onClick={handleDeleteAccount}
                disabled={isDeleting}
            >
                {strings.settings.deleteAccount}
            </button>
        </SettingsGroup>
    );
}

function DataExportGroup() {
    const { exportData } = useDataExport();
    const { exportAll, isExporting } = useGdprExport();
    const s = strings.settings;

    const handleExportWorkspace = useCallback(() => {
        try {
            exportData();
            toast.success(s.exportSuccess);
        } catch {
            toast.error(strings.errors.generic);
        }
    }, [exportData, s.exportSuccess]);

    const handleExportAll = useCallback(async () => {
        try {
            await exportAll();
            toast.success(s.exportAllSuccess);
        } catch (err) {
            logger.error('GDPR export failed', err as Error);
            toast.error(s.exportAllFailed);
        }
    }, [exportAll, s.exportAllSuccess, s.exportAllFailed]);

    return (
        <SettingsGroup title={s.dataGroup} description={s.exportDataDescription}>
            <button className={SP_BTN_SECONDARY} style={SP_BTN_SECONDARY_STYLE} onClick={handleExportWorkspace}>
                {s.exportData}
            </button>
            <button
                className={SP_BTN_SECONDARY}
                style={{ ...SP_BTN_SECONDARY_STYLE, marginTop: 8 }}
                onClick={() => { handleExportAll().catch(() => undefined); }}
                disabled={isExporting}
            >
                {isExporting ? s.exportAllLoading : s.exportAllData}
            </button>
        </SettingsGroup>
    );
}

export const AccountSection = React.memo(function AccountSection() {
    const user = useAuthStore((s) => s.user);

    const handleSignOut = useCallback(async () => {
        try {
            await signOut();
        } catch {
            // Error handled in service
        }
    }, []);

    if (!user) return null;

    return (
        <div className={SP_SECTION} style={SP_SECTION_STYLE}>
            <SettingsGroup title={strings.settings.profileGroup}>
                <div className={ACCT_INFO} style={ACCT_INFO_STYLE}>
                    {user.avatarUrl.length > 0 ? (
                        <img src={user.avatarUrl} alt={user.name} className={ACCT_AVATAR} />
                    ) : (
                        <div className={ACCT_AVATAR_PLACEHOLDER} style={ACCT_AVATAR_PLACEHOLDER_STYLE}>
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                    )}
                    <div className={ACCT_DETAILS} style={ACCT_DETAILS_STYLE}>
                        <span className={ACCT_NAME} style={ACCT_NAME_STYLE}>{user.name}</span>
                        <span className={ACCT_EMAIL} style={ACCT_EMAIL_STYLE}>{user.email}</span>
                    </div>
                </div>
                <button className={SP_BTN_SECONDARY} style={SP_BTN_SECONDARY_STYLE} onClick={() => { handleSignOut().catch(() => undefined); }}>
                    {strings.auth.signOut}
                </button>
            </SettingsGroup>

            <SubscriptionBillingGroup />

            <AccountUsageGroup />

            <DataExportGroup />

            <DangerZone />
        </div>
    );
});
