/**
 * useSwRegistration Hook Tests
 * TDD: Verifies SW registration lifecycle and update state management
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwRegistration } from '../useSwRegistration';

// Mock the virtual:pwa-register module
let mockOnNeedRefresh: (() => void) | undefined;
let mockOnOfflineReady: (() => void) | undefined;
let mockOnRegisteredSW: ((url: string, reg?: ServiceWorkerRegistration) => void) | undefined;
const mockStopChecks = vi.fn();
const mockScheduleChecks = vi.fn((_reg: ServiceWorkerRegistration) => mockStopChecks);
vi.mock('@/shared/services/swUpdateScheduler', () => ({
    scheduleSwUpdateChecks: (reg: ServiceWorkerRegistration) => mockScheduleChecks(reg),
}));
const mockUpdateSw = vi.fn().mockResolvedValue(undefined);

vi.mock('virtual:pwa-register', () => ({
    registerSW: (options?: {
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
        onRegisteredSW?: (url: string, reg?: ServiceWorkerRegistration) => void;
    }) => {
        mockOnRegisteredSW = options?.onRegisteredSW;
        mockOnNeedRefresh = options?.onNeedRefresh;
        mockOnOfflineReady = options?.onOfflineReady;
        return mockUpdateSw;
    },
}));

describe('useSwRegistration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockOnNeedRefresh = undefined;
        mockOnOfflineReady = undefined;
        mockOnRegisteredSW = undefined;
    });

    it('schedules periodic update checks once the SW is registered, and stops them on unmount', async () => {
        const { unmount } = renderHook(() => useSwRegistration());
        await act(async () => { await vi.dynamicImportSettled(); });
        const registration = { update: vi.fn() } as unknown as ServiceWorkerRegistration;

        act(() => { mockOnRegisteredSW?.('/sw.js', registration); });
        expect(mockScheduleChecks).toHaveBeenCalledWith(registration);

        unmount();
        expect(mockStopChecks).toHaveBeenCalledTimes(1);
    });

    it('does not schedule checks when registration is unavailable', async () => {
        renderHook(() => useSwRegistration());
        await act(async () => { await vi.dynamicImportSettled(); });
        act(() => { mockOnRegisteredSW?.('/sw.js', undefined); });
        expect(mockScheduleChecks).not.toHaveBeenCalled();
    });

    it('should initialize with needRefresh=false and offlineReady=false', () => {
        const { result } = renderHook(() => useSwRegistration());
        expect(result.current.needRefresh).toBe(false);
        expect(result.current.offlineReady).toBe(false);
    });

    it('should set needRefresh=true when SW signals update available', async () => {
        const { result } = renderHook(() => useSwRegistration());

        // Wait for the dynamic import to resolve
        await act(async () => {
            await vi.dynamicImportSettled();
        });

        // Simulate SW signaling an update
        act(() => {
            mockOnNeedRefresh?.();
        });

        expect(result.current.needRefresh).toBe(true);
    });

    it('should set offlineReady=true when SW signals offline ready', async () => {
        const { result } = renderHook(() => useSwRegistration());

        await act(async () => {
            await vi.dynamicImportSettled();
        });

        act(() => {
            mockOnOfflineReady?.();
        });

        expect(result.current.offlineReady).toBe(true);
    });

    it('should call updateSw(true) when acceptUpdate is invoked', async () => {
        const { result } = renderHook(() => useSwRegistration());

        await act(async () => {
            await vi.dynamicImportSettled();
        });

        act(() => {
            result.current.acceptUpdate();
        });

        expect(mockUpdateSw).toHaveBeenCalledWith(true);
    });

    it('should set needRefresh=false when dismissUpdate is invoked', async () => {
        const { result } = renderHook(() => useSwRegistration());

        await act(async () => {
            await vi.dynamicImportSettled();
        });

        // Trigger update availability
        act(() => {
            mockOnNeedRefresh?.();
        });
        expect(result.current.needRefresh).toBe(true);

        // Dismiss
        act(() => {
            result.current.dismissUpdate();
        });
        expect(result.current.needRefresh).toBe(false);
    });
});
