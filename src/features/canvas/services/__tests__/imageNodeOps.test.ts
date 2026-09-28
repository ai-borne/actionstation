/**
 * Image Node Ops Tests — doc-mutation helpers and blob/data-URL conversion
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    replaceImageSrc,
    removeImageBySrc,
    createObjectPreviewUrl,
    revokeObjectPreviewUrl,
    dataUrlToBlob,
    dataUrlToFile,
} from '../imageNodeOps';

function makeMockView(nodes: Array<{ type: { name: string }; attrs: Record<string, string>; nodeSize: number }>) {
    return {
        state: {
            doc: {
                descendants: (cb: (node: typeof nodes[0], pos: number) => void) => {
                    nodes.forEach((n, i) => cb(n, i));
                },
            },
            tr: { setNodeMarkup: vi.fn(), delete: vi.fn() },
        },
        dispatch: vi.fn(),
    };
}

describe('replaceImageSrc', () => {
    it('replaces the src of a matching image node and dispatches', () => {
        const node = { type: { name: 'image' }, attrs: { src: 'blob:old' }, nodeSize: 1 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView([node]) as any;

        replaceImageSrc(view, 'blob:old', 'https://cdn.example.com/a.png');

        expect(view.state.tr.setNodeMarkup).toHaveBeenCalledWith(
            0, undefined, { src: 'https://cdn.example.com/a.png' },
        );
        expect(view.dispatch).toHaveBeenCalledWith(view.state.tr);
    });

    it('ignores non-matching nodes', () => {
        const node = { type: { name: 'image' }, attrs: { src: 'blob:other' }, nodeSize: 1 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView([node]) as any;

        replaceImageSrc(view, 'blob:old', 'https://cdn.example.com/a.png');

        expect(view.state.tr.setNodeMarkup).not.toHaveBeenCalled();
        expect(view.dispatch).toHaveBeenCalled();
    });
});

describe('removeImageBySrc', () => {
    it('deletes matching image nodes bottom-to-top', () => {
        const nodes = [
            { type: { name: 'image' }, attrs: { src: 'blob:old' }, nodeSize: 1 },
            { type: { name: 'image' }, attrs: { src: 'blob:old' }, nodeSize: 1 },
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView(nodes) as any;

        removeImageBySrc(view, 'blob:old');

        expect(view.state.tr.delete).toHaveBeenCalledTimes(2);
        expect(view.state.tr.delete).toHaveBeenNthCalledWith(1, 1, 2);
        expect(view.state.tr.delete).toHaveBeenNthCalledWith(2, 0, 1);
        expect(view.dispatch).toHaveBeenCalledWith(view.state.tr);
    });

    it('does nothing when no node matches', () => {
        const node = { type: { name: 'image' }, attrs: { src: 'blob:other' }, nodeSize: 1 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const view = makeMockView([node]) as any;

        removeImageBySrc(view, 'blob:old');

        expect(view.state.tr.delete).not.toHaveBeenCalled();
    });
});

describe('createObjectPreviewUrl / revokeObjectPreviewUrl', () => {
    beforeEach(() => {
        URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
        URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('delegates to URL.createObjectURL', () => {
        const file = new File(['x'], 'a.png', { type: 'image/png' });
        expect(createObjectPreviewUrl(file)).toBe('blob:mock-url');
        expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    });

    it('delegates to URL.revokeObjectURL', () => {
        revokeObjectPreviewUrl('blob:mock-url');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
});

describe('dataUrlToBlob', () => {
    it('decodes a valid base64 data URL into a Blob with the right mime type', () => {
        const dataUrl = `data:image/png;base64,${btoa('hello')}`;
        const blob = dataUrlToBlob(dataUrl);
        expect(blob).not.toBeNull();
        expect(blob?.type).toBe('image/png');
        expect(blob?.size).toBe('hello'.length);
    });

    it('returns null for a malformed data URL', () => {
        expect(dataUrlToBlob('not-a-data-url')).toBeNull();
        expect(dataUrlToBlob('data:image/png,not-base64-marker')).toBeNull();
    });

    it('returns null when the base64 payload cannot be decoded', () => {
        expect(dataUrlToBlob('data:image/png;base64,***not valid base64***')).toBeNull();
    });
});

describe('dataUrlToFile', () => {
    it('wraps a decoded blob into a File with the given name', () => {
        const dataUrl = `data:image/jpeg;base64,${btoa('abc')}`;
        const file = dataUrlToFile(dataUrl, 'pasted.jpg');
        expect(file).not.toBeNull();
        expect(file?.name).toBe('pasted.jpg');
        expect(file?.type).toBe('image/jpeg');
    });

    it('returns null for a malformed data URL', () => {
        expect(dataUrlToFile('data:garbage', 'x.png')).toBeNull();
    });
});
