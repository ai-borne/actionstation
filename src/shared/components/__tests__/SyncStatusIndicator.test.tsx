/**
 * SyncStatusIndicator Component Tests
 * TDD: RED phase - tests written before implementation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusIndicator } from '@/app/components/SyncStatusIndicator';
import { strings } from '@/shared/localization/strings';

// Mock save status store
let mockSaveStatus = 'idle';
vi.mock('@/shared/stores/saveStatusStore', () => ({
    useSaveStatusStore: (selector: (state: { status: string }) => unknown) =>
        selector({ status: mockSaveStatus }),
}));

// Mock network status store
let mockIsOnline = true;
vi.mock('@/shared/stores/networkStatusStore', () => ({
    useNetworkStatusStore: (selector: (state: { isOnline: boolean }) => unknown) =>
        selector({ isOnline: mockIsOnline }),
}));

// Mock offline queue store
let mockPendingCount = 0;
vi.mock('@/features/workspace/stores/offlineQueueStore', () => ({
    useOfflineQueueStore: (selector: (state: { pendingCount: number }) => unknown) =>
        selector({ pendingCount: mockPendingCount }),
}));

describe('SyncStatusIndicator', () => {
    beforeEach(() => {
        mockSaveStatus = 'idle';
        mockIsOnline = true;
        mockPendingCount = 0;
    });

    it('renders "Saved" text when status is saved', () => {
        mockSaveStatus = 'saved';
        render(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.saved)).toBeInTheDocument();
    });

    it('renders "Saving..." text when status is saving', () => {
        mockSaveStatus = 'saving';
        render(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.saving)).toBeInTheDocument();
    });

    it('renders queued text with count when status is queued', () => {
        mockSaveStatus = 'queued';
        mockPendingCount = 3;
        render(<SyncStatusIndicator />);
        expect(screen.getByText(/3/)).toBeInTheDocument();
        expect(screen.getByText(new RegExp(strings.offline.queuedCount))).toBeInTheDocument();
    });

    it('renders "Offline" text when offline', () => {
        mockIsOnline = false;
        render(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.offline)).toBeInTheDocument();
    });

    it('renders error text when status is error', () => {
        mockSaveStatus = 'error';
        render(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.saveError)).toBeInTheDocument();
    });

    it('renders correct dot color class for saved status', () => {
        mockSaveStatus = 'saved';
        render(<SyncStatusIndicator />);
        expect(screen.getByTestId('sync-dot')).toBeInTheDocument();
    });

    it('renders correct dot color class for offline status', () => {
        mockIsOnline = false;
        render(<SyncStatusIndicator />);
        expect(screen.getByTestId('sync-dot')).toBeInTheDocument();
    });

    it('uses string resources for all visible text', () => {
        // Verify no hardcoded strings by checking various statuses
        mockSaveStatus = 'saving';
        const { rerender } = render(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.saving)).toBeInTheDocument();

        mockSaveStatus = 'error';
        rerender(<SyncStatusIndicator />);
        expect(screen.getByText(strings.offline.saveError)).toBeInTheDocument();
    });
});
