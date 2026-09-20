/**
 * gdprServerExportData tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCalendarGet = vi.fn();
const mockGetFiles = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
    getFirestore: () => ({
        collection: vi.fn(() => ({
            doc: vi.fn(() => ({
                collection: vi.fn(() => ({
                    doc: vi.fn(() => ({ get: mockCalendarGet })),
                })),
            })),
        })),
    }),
}));

vi.mock('firebase-admin/storage', () => ({
    getStorage: () => ({
        bucket: () => ({
            getFiles: mockGetFiles,
        }),
    }),
}));

describe('loadGdprServerExportData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCalendarGet.mockResolvedValue({ exists: false });
        mockGetFiles.mockResolvedValue([[]]);
    });

    it('returns disconnected calendar when integration missing', async () => {
        const { loadGdprServerExportData } = await import('../gdprServerExportData.js');
        const result = await loadGdprServerExportData('user-1');
        expect(result.calendar).toEqual({
            connected: false,
            connectedAt: null,
            scope: null,
        });
        expect(result.storageFiles).toEqual([]);
    });

    it('lists storage files without tokens', async () => {
        mockGetFiles.mockResolvedValue([[
            {
                name: 'users/user-1/workspaces/ws/a.png',
                metadata: { size: '1024', contentType: 'image/png', updated: '2026-01-01T00:00:00Z' },
            },
        ]]);
        const { loadGdprServerExportData } = await import('../gdprServerExportData.js');
        const result = await loadGdprServerExportData('user-1');
        expect(result.storageFiles).toHaveLength(1);
        expect(result.storageFiles[0]?.path).toContain('users/user-1/');
    });
});
