/**
 * useConsentState — manages analytics consent via pure useReducer.
 * Completely isolated from Zustand stores and the canvas store.
 * Dispatch chain: one-shot useReducer update → no cascade risk.
 */
import { useReducer, useEffect, useCallback } from 'react';
import type { ConsentChoice } from '../types/consent';
import { consentService } from '../services/consentService';
import { initAnalytics, optOutAnalytics } from '@/shared/services/analyticsService';

interface State {
    readonly choice: ConsentChoice;
}

type Action = { readonly type: 'ACCEPT' } | { readonly type: 'REJECT' };

function reducer(state: State, action: Action): State {
    switch (action.type) {
        case 'ACCEPT': return { choice: 'accepted' };
        case 'REJECT': return { choice: 'rejected' };
        default: return state;
    }
}

function init(): State {
    return { choice: consentService.getChoice() };
}

export interface ConsentState {
    readonly choice: ConsentChoice;
    readonly accept: () => void;
    readonly reject: () => void;
}

export function useConsentState(): ConsentState {
    const [state, dispatch] = useReducer(reducer, undefined, init);

    // Auto-reject on first visit when the browser Do Not Track signal is set.
    useEffect(() => {
        if (consentService.getChoice() === 'pending' && consentService.isDntEnabled()) {
            consentService.reject();
            dispatch({ type: 'REJECT' });
        }
    }, []);

    // Restore analytics for returning users who already consented.
    useEffect(() => {
        if (consentService.getChoice() === 'accepted') {
            initAnalytics();
        }
    }, []);

    const accept = useCallback(() => {
        consentService.accept();
        dispatch({ type: 'ACCEPT' });
        initAnalytics();
    }, []);

    const reject = useCallback(() => {
        consentService.reject();
        dispatch({ type: 'REJECT' });
        optOutAnalytics();
    }, []);

    return { choice: state.choice, accept, reject };
}
