/**
 * Toast Store - State management for notifications
 */
import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface Toast {
    id: string;
    message: string;
    type: ToastType;
    action?: ToastAction;
}

interface ToastStore {
    toasts: Toast[];
    addToast: (message: string, type: ToastType) => void;
    addToastWithAction: (message: string, type: ToastType, action: ToastAction, durationMs?: number) => void;
    removeToast: (id: string) => void;
}

/** How long an actionable toast (e.g. Undo) stays up: the user's undo window for one-click recovery. */
export const ACTION_TOAST_DURATION_MS = 6000;

/** Monotonic counter — eliminates ID collisions when two toasts fire within the same millisecond */
let _toastSeq = 0;
function nextToastId(): string { return `toast-${++_toastSeq}`; }

export const useToastStore = create<ToastStore>()((set) => ({
    toasts: [],

    addToast: (message: string, type: ToastType) => {
        const id = nextToastId();
        set((state) => ({
            toasts: [...state.toasts, { id, message, type }],
        }));
        // Auto-remove after 4 seconds
        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter((t) => t.id !== id),
            }));
        }, 4000);
    },

    addToastWithAction: (message: string, type: ToastType, action: ToastAction, durationMs = ACTION_TOAST_DURATION_MS) => {
        const id = nextToastId();
        set((state) => ({
            toasts: [...state.toasts, { id, message, type, action }],
        }));
        // Actionable toasts stay longer — more time to decide
        setTimeout(() => {
            set((state) => ({
                toasts: state.toasts.filter((t) => t.id !== id),
            }));
        }, durationMs);
    },

    removeToast: (id: string) => {
        set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id),
        }));
    },
}));

// Convenience functions
export const toast = {
    success: (message: string) => useToastStore.getState().addToast(message, 'success'),
    error: (message: string) => useToastStore.getState().addToast(message, 'error'),
    info: (message: string) => useToastStore.getState().addToast(message, 'info'),
    warning: (message: string) => useToastStore.getState().addToast(message, 'warning'),
};

/** Show an actionable toast with an inline button (e.g. Undo). Defaults to 6s auto-dismiss. */
export const toastWithAction = (
    message: string,
    type: ToastType,
    action: ToastAction,
    durationMs?: number,
): void => useToastStore.getState().addToastWithAction(message, type, action, durationMs);
