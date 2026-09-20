/**
 * DangerZone — irreversible account deletion.
 * An active Pro plan is not refunded automatically, so the confirm dialog says so.
 */
import { useCallback, useState } from 'react';
import { strings } from '@/shared/localization/strings';
import { deleteAccount } from '@/features/auth/services/authService';
import { useSubscriptionStore } from '@/features/subscription/stores/subscriptionStore';
import { useConfirm } from '@/shared/stores/confirmStore';
import { toast } from '@/shared/stores/toastStore';
import { SettingsGroup } from './SettingsGroup';
import {
    SP_SETTING_DESC, SP_SETTING_DESC_STYLE,
    SP_BTN_DANGER, SP_BTN_DANGER_STYLE,
} from '../settingsPanelStyles';

export function DangerZone() {
    const confirm = useConfirm();
    const hasActivePro = useSubscriptionStore((s) => s.tier === 'pro' && s.isActive);
    const [isDeleting, setIsDeleting] = useState(false);
    const message = hasActivePro
        ? strings.settings.deleteAccountConfirmPro
        : strings.settings.deleteAccountConfirm;

    const handleDeleteAccount = useCallback(async () => {
        const confirmed = await confirm({
            title: strings.settings.deleteAccountTitle,
            message,
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
    }, [confirm, message]);

    return (
        <SettingsGroup title={strings.settings.dangerZone} variant="danger">
            <span className={SP_SETTING_DESC} style={SP_SETTING_DESC_STYLE}>
                {message}
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
