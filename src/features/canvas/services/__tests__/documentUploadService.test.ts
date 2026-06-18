/**
 * Document Upload Service Tests — validate, path-build, and upload flow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { strings } from '@/shared/localization/strings';

vi.mock('@/config/firebase', () => ({ storage: {} }));

const mockRef = vi.fn().mockReturnValue({ fullPath: 'mock-ref' });
const mockUploadBytes = vi.fn().mockResolvedValue(undefined);
const mockUploadString = vi.fn().mockResolvedValue(undefined);
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://cdn.example.com/doc.pdf');
vi.mock('firebase/storage', () => ({
    ref: (...args: unknown[]) => mockRef(...args),
    uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
    uploadString: (...args: unknown[]) => mockUploadString(...args),
    getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
}));

vi.mock('../../types/document', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../types/document')>();
    return {
        ...actual,
        validateMagicBytes: vi.fn().mockResolvedValue(true),
    };
});

vi.mock('@/features/subscription/services/storageGuardService', () => ({
    assertStorageWithinLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/features/subscription/services/storageUsageRefresh', () => ({
    refreshStorageUsageAfterUpload: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import-x/first -- Must import after vi.mock
import {
    validateDocumentFile,
    buildAttachmentPath,
    uploadDocumentArtifacts,
    dataUrlToBlob,
} from '../documentUploadService';

function makePdfFile(size: number): File {
    return new File([new ArrayBuffer(size)], 'report.pdf', { type: 'application/pdf' });
}

describe('validateDocumentFile', () => {
    it('passes for a valid PDF file', async () => {
        const file = makePdfFile(1024);
        await expect(validateDocumentFile(file)).resolves.toBeUndefined();
    });

    it('throws for oversized files', async () => {
        const file = makePdfFile(16 * 1024 * 1024);
        await expect(validateDocumentFile(file)).rejects.toThrow(strings.canvas.docFileTooLarge);
    });

    it('throws for unsupported MIME type', async () => {
        const file = new File([new ArrayBuffer(100)], 'app.exe', { type: 'application/octet-stream' });
        await expect(validateDocumentFile(file)).rejects.toThrow(strings.canvas.docUnsupportedType);
    });
});

describe('buildAttachmentPath', () => {
    it('builds correct storage path', () => {
        const path = buildAttachmentPath('u1', 'w1', 'n1', 'report.pdf');
        expect(path).toBe('users/u1/workspaces/w1/nodes/n1/attachments/report.pdf');
    });

    it('sanitizes path traversal in filename', () => {
        const path = buildAttachmentPath('u1', 'w1', 'n1', '../../etc/passwd');
        expect(path).not.toContain('..');
    });
});

describe('uploadDocumentArtifacts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRef.mockReturnValue({ fullPath: 'mock-ref' });
        let callCount = 0;
        mockGetDownloadURL.mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.resolve('https://cdn.example.com/doc.pdf');
            if (callCount === 2) return Promise.resolve('https://cdn.example.com/doc.txt');
            return Promise.resolve('https://cdn.example.com/doc.thumb.png');
        });
    });

    it('uploads document and returns URL', async () => {
        const file = makePdfFile(1024);
        const result = await uploadDocumentArtifacts('u1', 'w1', 'n1', file, '', undefined);
        expect(result.documentUrl).toBe('https://cdn.example.com/doc.pdf');
        expect(mockUploadBytes).toHaveBeenCalledTimes(1);
    });

    it('uploads parsed text as sidecar when provided', async () => {
        const file = makePdfFile(1024);
        const result = await uploadDocumentArtifacts('u1', 'w1', 'n1', file, 'Extracted text', undefined);
        expect(result.parsedTextUrl).toBe('https://cdn.example.com/doc.txt');
        expect(mockUploadString).toHaveBeenCalledTimes(1);
    });

    it('uploads thumbnail when provided', async () => {
        const file = makePdfFile(1024);
        const blob = new Blob(['thumb'], { type: 'image/png' });
        const result = await uploadDocumentArtifacts('u1', 'w1', 'n1', file, 'text', blob);
        expect(result.thumbnailUrl).toBe('https://cdn.example.com/doc.thumb.png');
        // uploadBytes: 1 for doc + 1 for thumb = 2
        expect(mockUploadBytes).toHaveBeenCalledTimes(2);
    });

    it('skips parsed text upload when text is empty', async () => {
        const file = makePdfFile(1024);
        const result = await uploadDocumentArtifacts('u1', 'w1', 'n1', file, '', undefined);
        expect(result.parsedTextUrl).toBeUndefined();
        expect(mockUploadString).not.toHaveBeenCalled();
    });
});

describe('dataUrlToBlob', () => {
    it('converts a data URL to a Blob with correct MIME type', () => {
        const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
        const blob = dataUrlToBlob(dataUrl);
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/png');
    });

    it('defaults to image/png when MIME is missing', () => {
        const dataUrl = 'data:;base64,AAAA';
        const blob = dataUrlToBlob(dataUrl);
        expect(blob.type).toBe('image/png');
    });
});
