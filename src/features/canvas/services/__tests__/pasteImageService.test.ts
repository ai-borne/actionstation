/**
 * Paste Image Service Tests — uploading data: images embedded in rich-HTML pastes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    extractDataImagesForUpload,
    uploadPendingImages,
    createDataImagePasteHandler,
} from '../pasteImageService';

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
    let counter = 0;
    URL.createObjectURL = vi.fn().mockImplementation(() => `blob:mock-${++counter}`);
    URL.revokeObjectURL = vi.fn();
});

describe('extractDataImagesForUpload', () => {
    it('replaces a data: image src with a blob preview and returns it as pending', () => {
        const html = '<p>hi</p><img src="data:image/png;base64,iVBORw0KGgo=" alt="x">';
        const { html: out, pending } = extractDataImagesForUpload(html);

        expect(pending).toHaveLength(1);
        expect(pending[0]?.file.type).toBe('image/png');
        expect(out).toContain('src="blob:mock-1"');
        expect(out).not.toContain('data:image');
    });

    it('leaves non-data image srcs untouched', () => {
        const html = '<img src="https://cdn.example.com/a.png">';
        const { html: out, pending } = extractDataImagesForUpload(html);
        expect(pending).toHaveLength(0);
        expect(out).toContain('src="https://cdn.example.com/a.png"');
    });

    it('removes an img with a malformed data: src instead of leaving it unsafe', () => {
        const html = '<img src="data:image/png;notbase64,garbage">';
        const { html: out, pending } = extractDataImagesForUpload(html);
        expect(pending).toHaveLength(0);
        expect(out).not.toContain('<img');
    });

    it('handles multiple data: images in one paste', () => {
        const html = '<img src="data:image/png;base64,aaa"><img src="data:image/jpeg;base64,bbb">';
        const { pending } = extractDataImagesForUpload(html);
        expect(pending).toHaveLength(2);
    });
});

describe('uploadPendingImages', () => {
    function makeMockView() {
        return {
            state: { doc: { descendants: vi.fn() }, tr: { setNodeMarkup: vi.fn(), delete: vi.fn() } },
            dispatch: vi.fn(),
        };
    }

    it('replaces the blob preview with the permanent URL on success', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView() as any;
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/a.png');
        const onAfterInsert = vi.fn();

        uploadPendingImages(view, [{ file, previewUrl: 'blob:mock-1' }], uploadFn, onAfterInsert);
        await vi.waitFor(() => expect(onAfterInsert).toHaveBeenCalledWith(file, 'https://cdn.example.com/a.png'));

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    });

    it('removes the preview and shows an error toast when the upload rejects', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView() as any;
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        const uploadFn = vi.fn().mockRejectedValue(new Error('network'));

        uploadPendingImages(view, [{ file, previewUrl: 'blob:mock-1' }], uploadFn);
        await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1'));

        expect(toast.error).toHaveBeenCalled();
    });

    it('removes the preview when the resolved URL is unsafe', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView() as any;
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        const uploadFn = vi.fn().mockResolvedValue('http://insecure.com/a.png');
        const onAfterInsert = vi.fn();

        uploadPendingImages(view, [{ file, previewUrl: 'blob:mock-1' }], uploadFn, onAfterInsert);
        await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1'));

        expect(toast.error).toHaveBeenCalled();
        expect(onAfterInsert).not.toHaveBeenCalled();
    });
});

describe('createDataImagePasteHandler', () => {
    function makeEvent(html?: string): ClipboardEvent {
        return {
            clipboardData: html === undefined ? null : { getData: () => html },
            preventDefault: vi.fn(),
        } as unknown as ClipboardEvent;
    }

    it('returns false when no upload function is configured', () => {
        const handler = createDataImagePasteHandler((h) => h, () => undefined, () => undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const result = handler({} as any, makeEvent('<img src="data:image/png;base64,abc">'));
        expect(result).toBe(false);
    });

    it('returns false when the clipboard HTML has no data: image', () => {
        const handler = createDataImagePasteHandler((h) => h, () => vi.fn(), () => undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const result = handler({} as any, makeEvent('<p>plain text</p>'));
        expect(result).toBe(false);
    });

    it('returns false when there is no clipboard HTML at all', () => {
        const handler = createDataImagePasteHandler((h) => h, () => vi.fn(), () => undefined);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const result = handler({} as any, makeEvent(undefined));
        expect(result).toBe(false);
    });
});
