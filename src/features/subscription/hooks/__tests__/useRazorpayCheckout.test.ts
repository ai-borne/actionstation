/**
 * useRazorpayCheckout Hook Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRazorpayCheckout } from '../useRazorpayCheckout';

const { mockGetAuthToken } = vi.hoisted(() => ({
    mockGetAuthToken: vi.fn<() => Promise<string | null>>(),
}));

let mockUserId: string | undefined = 'user-1';
vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ user: mockUserId ? { id: mockUserId, name: 'Test', email: 't@test.com' } : null }),
}));

vi.mock('@/features/auth/services/authTokenService', () => ({
    getAuthToken: mockGetAuthToken,
}));

vi.mock('@/features/subscription/utils/appCheckToken', () => ({
    getAppCheckToken: vi.fn().mockResolvedValue(null),
}));

const mockLoadSubscription = vi.fn();
vi.mock('@/features/subscription/stores/subscriptionStore', () => ({
    useSubscriptionStore: { getState: () => ({ loadSubscription: mockLoadSubscription }) },
}));

vi.mock('@/features/subscription/utils/razorpayScriptLoader', () => ({
    loadRazorpayScript: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/services/logger', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const mockRazorpayOpen = vi.fn();
class MockRazorpay {
    constructor(public options: Record<string, unknown>) {}
    open() { mockRazorpayOpen(this.options); }
}

describe('useRazorpayCheckout', () => {
    beforeEach(() => {
        mockUserId = 'user-1';
        mockGetAuthToken.mockReset().mockResolvedValue('tok_valid');
        mockLoadSubscription.mockReset().mockResolvedValue(undefined);
        mockRazorpayOpen.mockReset();
        vi.stubGlobal('fetch', vi.fn());
        vi.stubGlobal('Razorpay', MockRazorpay);
        Object.defineProperty(window, 'Razorpay', { writable: true, value: MockRazorpay });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('initial state: not loading, no error', () => {
        const { result } = renderHook(() => useRazorpayCheckout());
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('does nothing when user is not authenticated', async () => {
        mockUserId = undefined;
        const { result } = renderHook(() => useRazorpayCheckout());
        await act(async () => {
            await result.current.startCheckout('pro_annual_inr');
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('sets error when auth token is missing', async () => {
        mockGetAuthToken.mockResolvedValue(null);
        const { result } = renderHook(() => useRazorpayCheckout());
        await act(async () => {
            await result.current.startCheckout('pro_annual_inr');
        });
        expect(result.current.error).toBe('Authentication required');
    });

    it('opens Razorpay modal on successful order fetch', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                orderId: 'order_1',
                amount: 299900,
                currency: 'INR',
                keyId: 'rzp_test',
            }),
        }));
        const { result } = renderHook(() => useRazorpayCheckout());
        await act(async () => {
            await result.current.startCheckout('pro_annual_inr', 'INR');
        });
        expect(mockRazorpayOpen).toHaveBeenCalled();
        expect(result.current.error).toBeNull();
    });

    it('sets error on non-ok HTTP response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ error: 'Invalid plan' }),
        }));
        const { result } = renderHook(() => useRazorpayCheckout());
        await act(async () => {
            await result.current.startCheckout('bad_plan');
        });
        expect(result.current.error).toBe('Invalid plan');
    });
});
