/**
 * TierLimitsContext — Provides usage limit state and dispatch to the component tree.
 * Uses useReducer (NOT Zustand) for complete isolation from canvas/workspace stores.
 * Follows the PanToNodeContext pattern: single provider, lightweight consumer hooks.
 */
import { createContext, useContext, useReducer, useMemo, useEffect, type ReactNode, type Dispatch } from 'react';
import { tierLimitsReducer } from '../stores/tierLimitsReducer';
import { registerStorageUsageDispatch } from '../services/storageUsageRefresh';
import {
    INITIAL_TIER_LIMITS_STATE,
    type TierLimitsState,
    type TierLimitsAction,
} from '../types/tierLimits';

interface TierLimitsContextValue {
    readonly state: TierLimitsState;
    readonly dispatch: Dispatch<TierLimitsAction>;
}

const TierLimitsCtx = createContext<TierLimitsContextValue | null>(null);

export function TierLimitsProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(tierLimitsReducer, INITIAL_TIER_LIMITS_STATE);
    const value = useMemo(() => ({ state, dispatch }), [state]);

    useEffect(() => {
        registerStorageUsageDispatch(dispatch);
        return () => registerStorageUsageDispatch(null);
    }, [dispatch]);

    return <TierLimitsCtx.Provider value={value}>{children}</TierLimitsCtx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTierLimitsState(): TierLimitsState {
    const ctx = useContext(TierLimitsCtx);
    if (!ctx) throw new Error('useTierLimitsState must be used within TierLimitsProvider');
    return ctx.state;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTierLimitsDispatch(): Dispatch<TierLimitsAction> {
    const ctx = useContext(TierLimitsCtx);
    if (!ctx) throw new Error('useTierLimitsDispatch must be used within TierLimitsProvider');
    return ctx.dispatch;
}
