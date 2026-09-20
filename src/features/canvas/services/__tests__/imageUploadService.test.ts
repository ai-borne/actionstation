/**
 * Image Upload Service Tests — validate, path-build, and upload flow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strings } from '@/shared/localization/strings';

vi.mock('@/config/firebase', () => ({ storage: {} }));

const mockRef = vi.fn();
const mockUploadBytes = vi.fn().mockResolvedValue(undefined);
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
vi.mock('firebase/storage', () => ({
    ref: (...args: unknown[]) => mockRef(...args),
    uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
    getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
}));

const mockCompressImage = vi.fn().mockResolvedValue(new Blob(['compressed'], { type: 'image/jpeg' }));
vi.mock('@/features/knowledgeBank/utils/imageCompressor', () => ({
    compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));

vi.mock('@/features/subscription/services/storageGuardService', () => ({
    assertStorageWithinLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/subscription/services/storageUsageRefresh', () => ({
    refreshStorageUsageAfterUpload: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import {
    validateImageFile,
    buildNodeImagePath,
    uploadNodeImage,
    isAcceptedImageType,
} from '../imageUploadService';

function makeFile(name: string, size: number, type: string): File {
    const buffer = new ArrayBuffer(size);
    return new File([buffer], name, { type });
}

describe('isAcceptedImageType', () => {
    it('returns true for allowed MIME types', () => {
        expect(isAcceptedImageType('image/jpeg')).toBe(true);
        expect(isAcceptedImageType('image/png')).toBe(true);
        expect(isAcceptedImageType('image/gif')).toBe(true);
        expect(isAcceptedImageType('image/webp')).toBe(true);
    });

    it('returns false for disallowed MIME types', () => {
        expect(isAcceptedImageType('image/svg+xml')).toBe(false);
        expect(isAcceptedImageType('text/html')).toBe(false);
        expect(isAcceptedImageType('application/pdf')).toBe(false);
    });
});

describe('validateImageFile', () => {
    it('passes for a valid image file', () => {
        const file = makeFile('photo.jpg', 1024, 'image/jpeg');
        expect(() => validateImageFile(file)).not.toThrow();
    });

    it('throws localized error for oversized files', () => {
        const file = makeFile('huge.png', 6 * 1024 * 1024, 'image/png');
        expect(() => validateImageFile(file)).toThrow(strings.canvas.imageFileTooLarge);
    });

    it('throws localized error for unsupported MIME types', () => {
        const file = makeFile('doc.pdf', 1024, 'application/pdf');
        expect(() => validateImageFile(file)).toThrow(strings.canvas.imageUnsupportedType);
    });

    it('throws for SVG (potential XSS vector)', () => {
        const file = makeFile('icon.svg', 512, 'image/svg+xml');
        expect(() => validateImageFile(file)).toThrow(strings.canvas.imageUnsupportedType);
    });
});

describe('buildNodeImagePath', () => {
    it('builds correct storage path with sanitized filename', () => {
        const path = buildNodeImagePath('u1', 'w1', 'n1', 'photo.jpg');
        expect(path).toBe('users/u1/workspaces/w1/nodes/n1/images/photo.jpg');
    });

    it('sanitizes path traversal in filename', () => {
        const path = buildNodeImagePath('u1', 'w1', 'n1', '../../etc/passwd');
        expect(path).not.toContain('..');
        expect(path).not.toContain('/etc/');
    });

    it('sanitizes backslashes in filename', () => {
        const path = buildNodeImagePath('u1', 'w1', 'n1', '..\\secret.jpg');
        expect(path).not.toContain('..');
        expect(path).not.toContain('\\');
    });
});

describe('uploadNodeImage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRef.mockReturnValue({ fullPath: 'mock-ref' });
    });

    it('validates, compresses, uploads, and returns download URL', async () => {
        const file = makeFile('cat.png', 2048, 'image/png');
        const url = await uploadNodeImage('u1', 'w1', 'n1', file);

        expect(mockCompressImage).toHaveBeenCalledWith(file);
        expect(mockUploadBytes).toHaveBeenCalledTimes(1);
        expect(mockGetDownloadURL).toHaveBeenCalledTimes(1);
        expect(url).toBe('https://cdn.example.com/img.jpg');
    });

    it('rejects oversized files before compressing', async () => {
        const file = makeFile('big.jpg', 6 * 1024 * 1024, 'image/jpeg');
        await expect(uploadNodeImage('u1', 'w1', 'n1', file))
            .rejects.toThrow(strings.canvas.imageFileTooLarge);
        expect(mockCompressImage).not.toHaveBeenCalled();
    });

    it('rejects unsupported MIME types before compressing', async () => {
        const file = makeFile('bad.txt', 100, 'text/plain');
        await expect(uploadNodeImage('u1', 'w1', 'n1', file))
            .rejects.toThrow(strings.canvas.imageUnsupportedType);
        expect(mockCompressImage).not.toHaveBeenCalled();
    });
});
