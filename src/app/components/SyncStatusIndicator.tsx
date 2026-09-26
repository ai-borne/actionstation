/**
 * SyncStatusIndicator - Shows sync/save status with colored dot
 * Reads from saveStatusStore + networkStatusStore + backgroundSyncStatus.
 * All text from strings.offline.* / strings.backgroundSync.* — no hardcoded strings.
 */
import { useSaveStatusStore } from '@/shared/stores/saveStatusStore';
import { useNetworkStatusStore } from '@/shared/stores/networkStatusStore';
import { useOfflineQueueStore } from '@/features/workspace/stores/offlineQueueStore';
import { useBackgroundSyncStatus } from '@/app/hooks/useBackgroundSyncStatus';
import { strings } from '@/shared/localization/strings';

type DotVariant = 'green' | 'spinner' | 'yellow' | 'gray' | 'red' | 'blue';

/** Derives the status dot variant and label from current save/network/sync state. */
function getIndicatorState(
    status: string,
    isOnline: boolean,
    pendingCount: number,
    hasPendingBgSync: boolean
): { variant: DotVariant; label: string } {
    if (!isOnline) {
        return { variant: 'gray', label: strings.offline.offline };
    }

    // Background sync label only when queued data exists; a stale sync tag alone is not unsynced data
    if (hasPendingBgSync && pendingCount > 0) {
        return { variant: 'blue', label: strings.backgroundSync.syncing };
    }

    switch (status) {
        case 'saving':
            return { variant: 'spinner', label: strings.offline.saving };
        case 'saved':
            return { variant: 'green', label: strings.offline.saved };
        case 'queued':
            return {
                variant: 'yellow',
                label: `${pendingCount} ${strings.offline.queuedCount}`,
            };
        case 'error':
            return { variant: 'red', label: strings.offline.saveError };
        default:
            return { variant: 'green', label: strings.offline.saved };
    }
}

const DOT_CLASSES: Record<DotVariant, string> = {
    green:   'bg-[var(--color-success)] animate-[sync-fade_150ms_ease]',
    spinner: 'bg-[var(--color-primary)] animate-[sync-pulse_1s_ease-in-out_infinite]',
    yellow:  'bg-[var(--color-warning)]',
    gray:    'bg-[var(--color-text-muted)]',
    red:     'bg-[var(--color-error)]',
    blue:    'bg-[var(--color-primary)] animate-[sync-pulse_1.2s_ease-in-out_infinite]',
};

/** Displays a coloured status dot and label reflecting current save/sync/network state. */
export function SyncStatusIndicator() {
    const status = useSaveStatusStore((s) => s.status);
    const lastError = useSaveStatusStore((s) => s.lastError);
    const isOnline = useNetworkStatusStore((s) => s.isOnline);
    const pendingCount = useOfflineQueueStore((s) => s.pendingCount);
    const { hasPendingSync } = useBackgroundSyncStatus();

    const { variant, label } = getIndicatorState(
        status, isOnline, pendingCount, hasPendingSync
    );

    const tooltip = status === 'error' && lastError ? lastError : undefined;

    return (
        <div
            className="flex items-center text-xs text-[var(--color-text-secondary)] select-none min-w-[145px]"
            style={{ gap: 'var(--sync-indicator-gap, 6px)', padding: '4px 8px' }}
            title={tooltip}
        >
            <span
                data-testid="sync-dot"
                className={`rounded-full shrink-0 ${DOT_CLASSES[variant]}`}
                style={{ width: 'var(--sync-dot-size, 8px)', height: 'var(--sync-dot-size, 8px)' }}
            />
            <span className="whitespace-nowrap leading-none">{label}</span>
        </div>
    );
}
