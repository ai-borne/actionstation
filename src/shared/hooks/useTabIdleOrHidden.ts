/**
 * useTabIdleOrHidden - true while the tab is hidden, or the user has given no
 * input for `idleMs`. Used to pick a safe moment to apply an app update.
 */
import { useEffect, useState } from 'react';

/** How long without input before an open, visible tab counts as idle. */
export const TAB_IDLE_MS = 5 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function useTabIdleOrHidden(idleMs: number = TAB_IDLE_MS): boolean {
    const [isIdleOrHidden, setIsIdleOrHidden] = useState(() => document.visibilityState === 'hidden');

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const clear = (): void => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
        };
        const arm = (): void => {
            clear();
            timer = setTimeout(() => setIsIdleOrHidden(true), idleMs);
        };
        const onActivity = (): void => {
            setIsIdleOrHidden(false);
            arm();
        };
        const onVisibility = (): void => {
            if (document.visibilityState === 'hidden') {
                clear();
                setIsIdleOrHidden(true);
            } else {
                onActivity();
            }
        };

        if (document.visibilityState !== 'hidden') arm();
        ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            clear();
            ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [idleMs]);

    return isIdleOrHidden;
}
