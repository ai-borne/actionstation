/**
 * useNodeGeneration AI guard tests — verifies daily AI limit guard
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';
import { useNodeGeneration } from '../useNodeGeneration';
import { TierLimitsProvider } from '@/features/subscription/contexts/TierLimitsContext';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';

let mockAiDailyAllowed = true;
const mockToastWithAction = vi.fn();

vi.mock('@/features/subscription/hooks/useTierLimits', () => ({
    useTierLimits: () => ({
        check: (kind: string) => ({
            allowed: kind !== 'aiDaily' || mockAiDailyAllowed,
        }),
        dispatch: () => {
            // Mock dispatch for AI_GENERATED action
        },
    }),
}));

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
    toastWithAction: (...args: unknown[]) => mockToastWithAction(...args),
}));

vi.mock('@/features/canvas/stores/canvasStore', () => ({
    useCanvasStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) =>
            selector({ nodes: [], getUpstreamNodes: () => [], setNodeGenerating: vi.fn(), updateNodeOutput: vi.fn() }),
        { getState: () => ({ nodes: [], getUpstreamNodes: () => [], setNodeGenerating: vi.fn(), updateNodeOutput: vi.fn() }) },
    ),
    getNodeMap: () => new Map(),
}));

vi.mock('@/features/ai/stores/aiStore', () => ({
    useAIStore: Object.assign(
        (selector: (s: Record<string, unknown>) => unknown) =>
            selector({ startGeneration: vi.fn(), completeGeneration: vi.fn(), setError: vi.fn() }),
        { getState: () => ({ startGeneration: vi.fn(), completeGeneration: vi.fn(), setError: vi.fn() }) },
    ),
}));

vi.mock('@/features/ai/services/geminiService', () => ({
    generateContentWithContext: vi.fn().mockResolvedValue('AI output'),
}));

vi.mock('@/features/ai/services/contextChainBuilder', () => ({
    buildContextChain: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/features/canvas/contexts/PanToNodeContext', () => ({
    usePanToNodeContext: () => ({ panToPosition: vi.fn() }),
}));

vi.mock('@/features/knowledgeBank/hooks/useKnowledgeBankContext', () => ({
    useKnowledgeBankContext: () => ({ getKBContext: vi.fn().mockReturnValue([]) }),
}));

vi.mock('./useNodePoolContext', () => ({
    useNodePoolContext: () => ({ getPoolContext: vi.fn().mockResolvedValue([]) }),
}));

vi.mock('@/features/calendar/services/calendarIntentHandler', () => ({
    processCalendarIntent: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/features/subscription/hooks/useNodeCreationGuard', () => ({
    useNodeCreationGuard: () => ({ guardNodeCreation: vi.fn().mockReturnValue(true) }),
}));

const mockStartCheckout = vi.fn().mockResolvedValue(undefined);

vi.mock('@/features/subscription/hooks/useRazorpayCheckout', () => ({
    useRazorpayCheckout: () => ({ startCheckout: mockStartCheckout, isLoading: false, error: null }),
}));

function wrapper({ children }: { children: ReactNode }) {
    return React.createElement(TierLimitsProvider, null, children);
}

describe('useNodeGeneration — AI guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAiDailyAllowed = true;
    });

    it('blocks generation when AI daily limit exceeded', async () => {
        mockAiDailyAllowed = false;
        const { result } = renderHook(() => useNodeGeneration(), { wrapper });

        act(() => {
            result.current.generateFromPrompt('node-1');
        });

        expect(mockToastWithAction).toHaveBeenCalled();
    });

    it('toast upgrade action triggers Razorpay checkout', async () => {
        mockAiDailyAllowed = false;
        const { result } = renderHook(() => useNodeGeneration(), { wrapper });

        act(() => {
            result.current.generateFromPrompt('node-1');
        });

        const action = mockToastWithAction.mock.calls[0]?.[2] as { onClick: () => void };
        await act(async () => {
            action.onClick();
        });

        expect(mockStartCheckout).toHaveBeenCalledWith(PRO_ANNUAL_PLAN_ID, 'INR');
    });

    it('allows generation when AI daily limit not exceeded', async () => {
        mockAiDailyAllowed = true;
        const { result } = renderHook(() => useNodeGeneration(), { wrapper });

        // This will attempt generation
        act(() => {
            const promise = result.current.generateFromPrompt('node-1');
            expect(promise).toBeDefined();
        });
    });
});

