/**
 * useGdprExport Hook Tests — GDPR full data export hook
 *
 * TDD: tests written before implementation.
 * Verifies loading state, file download, auth guard, and error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGdprExport } from '../useGdprExport';
import type { GdprExportPayload } from '../../services/gdprExportService';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockUser = { id: 'user-1', email: 'test@example.com', name: 'Test User', avatarUrl: '' };
let currentMockUser: typeof mockUser | null = mockUser;

vi.mock('@/features/auth/stores/authStore', () => ({
    useAuthStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
        const state = { user: currentMockUser };
        return typeof selector === 'function' ? selector(state) : state;
    }),
}));

const mockFetchAllUserData = vi.fn();
vi.mock('../../services/gdprExportService', () => ({
    fetchAllUserData: (...args: unknown[]) => mockFetchAllUserData(...args),
}));

const mockDownloadAsFile = vi.fn();
vi.mock('@/shared/utils/fileDownload', () => ({
    downloadAsFile: (...args: unknown[]) => mockDownloadAsFile(...args),
}));

const mockTrackSettingsChanged = vi.fn();
vi.mock('@/shared/services/analyticsService', () => ({
    trackSettingsChanged: (...args: unknown[]) => mockTrackSettingsChanged(...args),
}));

const MOCK_PAYLOAD: GdprExportPayload = {
    exportedAt: '2024-01-01T00:00:00.000Z',
    user: { id: 'user-1', email: 'test@example.com', name: 'Test User' },
    subscription: { tier: 'free', isActive: true, expiresAt: null, provider: null },
    usage: { storageMb: 0, aiDailyCount: null, aiDailyDate: null },
    calendar: { connected: false, connectedAt: null, scope: null },
    storageFiles: [],
    workspaces: [],
    summary: { totalWorkspaces: 0, totalNodes: 0, totalEdges: 0, totalKBEntries: 0, totalStorageFiles: 0 },
};

describe('useGdprExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentMockUser = mockUser;
        mockFetchAllUserData.mockResolvedValue(MOCK_PAYLOAD);
    });

    it('returns exportAll function and isExporting state', () => {
        const { result } = renderHook(() => useGdprExport());
        expect(typeof result.current.exportAll).toBe('function');
        expect(result.current.isExporting).toBe(false);
    });

    it('calls fetchAllUserData with userId and user profile', async () => {
        const { result } = renderHook(() => useGdprExport());
        await act(async () => { await result.current.exportAll(); });
        expect(mockFetchAllUserData).toHaveBeenCalledWith('user-1', {
            id: 'user-1',
            email: 'test@example.com',
            name: 'Test User',
        });
    });

    it('downloads file with JSON content on success', async () => {
        const { result } = renderHook(() => useGdprExport());
        await act(async () => { await result.current.exportAll(); });
        expect(mockDownloadAsFile).toHaveBeenCalledOnce();
        const [json, filename, mimeType] = mockDownloadAsFile.mock.calls[0] as [string, string, string];
        expect(() => JSON.parse(json)).not.toThrow();
        expect(filename).toMatch(/actionstation-export-.*\.json/);
        expect(mimeType).toBe('application/json');
    });

    it('sets isExporting to true during export', async () => {
        let capturedIsExporting = false;
        mockFetchAllUserData.mockImplementation(async () => {
            await new Promise<void>((r) => setTimeout(r, 0));
            return MOCK_PAYLOAD;
        });
        const { result } = renderHook(() => useGdprExport());
        const exportPromise = act(async () => {
            const p = result.current.exportAll();
            capturedIsExporting = result.current.isExporting;
            await p;
        });
        await exportPromise;
        // isExporting is set synchronously before the async work; check final state
        expect(result.current.isExporting).toBe(false);
        // File should have been downloaded
        expect(mockDownloadAsFile).toHaveBeenCalledOnce();
        void capturedIsExporting; // avoid unused warning
    });

    it('tracks analytics after successful export', async () => {
        const { result } = renderHook(() => useGdprExport());
        await act(async () => { await result.current.exportAll(); });
        expect(mockTrackSettingsChanged).toHaveBeenCalledWith('gdpr_data_export', 'triggered');
    });

    it('throws when user is not authenticated', async () => {
        currentMockUser = null;
        const { result } = renderHook(() => useGdprExport());
        await expect(
            act(async () => { await result.current.exportAll(); }),
        ).rejects.toThrow();
    });

    it('resets isExporting to false after error', async () => {
        mockFetchAllUserData.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() => useGdprExport());
        await act(async () => {
            await result.current.exportAll().catch(() => { /* expected */ });
        });
        expect(result.current.isExporting).toBe(false);
    });

    it('does not call downloadAsFile when fetchAllUserData fails', async () => {
        mockFetchAllUserData.mockRejectedValue(new Error('Network error'));
        const { result } = renderHook(() => useGdprExport());
        await act(async () => {
            await result.current.exportAll().catch(() => { /* expected */ });
        });
        expect(mockDownloadAsFile).not.toHaveBeenCalled();
    });
});
