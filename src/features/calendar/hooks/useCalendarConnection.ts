/**
 * useCalendarConnection — ViewModel for the Settings "Google Calendar" card.
 * Owns the connection status, the busy flag and the confirm → disconnect → toast flow;
 * the View only renders it and the service does the work.
 */
import { useCallback, useRef, useState } from 'react';
import { useAuthStore } from '@/features/auth/stores/authStore';
import {
    connectGoogleCalendar,
    disconnectGoogleCalendarConfirmed,
} from '@/features/auth/services/calendarAuthService';
import { useConfirm } from '@/shared/stores/confirmStore';
import { toast } from '@/shared/stores/toastStore';
import { calendarStrings as cs } from '../localization/calendarStrings';
import { AUTOSAVE_YIELD_MS } from '../config/connectTiming';

export function useCalendarConnection() {
    const isConnected = useAuthStore((s) => s.isCalendarConnected);
    const confirm = useConfirm();
    const [isBusy, setIsBusy] = useState(false);
    const busyRef = useRef(false);

    const connect = useCallback(async (): Promise<void> => {
        // Let any in-flight autosave flush before the browser navigates to Google.
        await new Promise<void>((resolve) => setTimeout(resolve, AUTOSAVE_YIELD_MS));
        connectGoogleCalendar();
    }, []);

    const disconnect = useCallback(async (): Promise<void> => {
        if (busyRef.current) return;
        const confirmed = await confirm({
            title: cs.connection.disconnectConfirmTitle,
            message: cs.connection.disconnectConfirmMessage,
            confirmText: cs.connection.disconnectConfirmButton,
        });
        if (!confirmed) return;

        busyRef.current = true;
        setIsBusy(true);
        try {
            const ok = await disconnectGoogleCalendarConfirmed();
            if (ok) toast.success(cs.connection.disconnectSuccess);
            else toast.error(cs.connection.disconnectFailed);
        } finally {
            busyRef.current = false;
            setIsBusy(false);
        }
    }, [confirm]);

    return { isConnected, isBusy, connect, disconnect };
}
