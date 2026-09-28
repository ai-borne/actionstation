/**
 * Image Insert Service Tests — Security and edge cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureEditorFocus, insertImageIntoEditor } from '../imageInsertService';

vi.mock('@/shared/stores/toastStore', () => ({
    toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

beforeEach(() => {
    let counter = 0;
    URL.createObjectURL = vi.fn().mockImplementation(() => `blob:mock-${++counter}`);
    URL.revokeObjectURL = vi.fn();
});

function makeMockEditor(focused = true, destroyed = false) {
    const nodes: Array<{ type: { name: string }; attrs: Record<string, string>; nodeSize: number }> = [];
    return {
        isDestroyed: destroyed,
        isFocused: focused,
        state: {
            doc: {
                descendants: (cb: (node: typeof nodes[0], pos: number) => void) => {
                    nodes.forEach((n, i) => cb(n, i));
                },
            },
            tr: {
                setNodeMarkup: vi.fn(),
                delete: vi.fn(),
            },
        },
        view: { dispatch: vi.fn() },
        commands: {
            focus: vi.fn(),
        },
        chain: vi.fn().mockReturnValue({
            focus: vi.fn().mockReturnValue({
                setImage: vi.fn().mockReturnValue({
                    run: vi.fn(),
                }),
            }),
        }),
    };
}

describe('ensureEditorFocus — edge cases', () => {
    it('does not throw when editor is destroyed', () => {
        const editor = makeMockEditor(false, true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        expect(() => ensureEditorFocus(editor as any)).not.toThrow();
        expect(editor.commands.focus).not.toHaveBeenCalled();
    });
});

describe('insertImageIntoEditor — upload feedback', () => {
    it('shows uploading toast when upload starts', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        const { strings } = await import('@/shared/localization/strings');
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn);

        expect(toast.info).toHaveBeenCalledWith(strings.canvas.imageUploading);
    });
});

describe('insertImageIntoEditor — error handling', () => {
    it('shows generic toast on unknown upload failure', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        const { strings } = await import('@/shared/localization/strings');
        const editor = makeMockEditor(true);
        const failFn = vi.fn().mockRejectedValue(new Error('Network error'));
        const file = new File(['x'], 'fail.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, failFn);

        expect(toast.error).toHaveBeenCalledWith(strings.canvas.imageUploadFailed);
    });

    it('surfaces specific error for oversized files', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        const { strings } = await import('@/shared/localization/strings');
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const failFn = vi.fn().mockRejectedValue(new Error(strings.canvas.imageFileTooLarge));
        const file = new File(['x'], 'big.jpg', { type: 'image/jpeg' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, failFn);

        expect(toast.error).toHaveBeenCalledWith(strings.canvas.imageFileTooLarge);
    });

    it('surfaces specific error for unsupported type', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        const { strings } = await import('@/shared/localization/strings');
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const failFn = vi.fn().mockRejectedValue(new Error(strings.canvas.imageUnsupportedType));
        const file = new File(['x'], 'bad.svg', { type: 'image/svg+xml' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, failFn);

        expect(toast.error).toHaveBeenCalledWith(strings.canvas.imageUnsupportedType);
    });

    it('rejects unsafe permanent URL with security toast', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        const { strings } = await import('@/shared/localization/strings');
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('http://insecure.com/img.jpg');
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn);

        expect(toast.error).toHaveBeenCalledWith(strings.canvas.imageUnsafeUrl);
    });

    it('calls onAfterInsert with (file, permanentUrl) on successful upload', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const permanentUrl = 'https://cdn.example.com/img.jpg';
        const uploadFn = vi.fn().mockResolvedValue(permanentUrl);
        const onAfterInsert = vi.fn();
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn, onAfterInsert);

        expect(onAfterInsert).toHaveBeenCalledOnce();
        expect(onAfterInsert).toHaveBeenCalledWith(file, permanentUrl);
    });

    it('does not call onAfterInsert on upload failure', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const failFn = vi.fn().mockRejectedValue(new Error('fail'));
        const onAfterInsert = vi.fn();
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, failFn, onAfterInsert);

        expect(onAfterInsert).not.toHaveBeenCalled();
    });

    it('does not call onAfterInsert when URL is unsafe', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('http://insecure.com/img.jpg');
        const onAfterInsert = vi.fn();
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn, onAfterInsert);

        expect(onAfterInsert).not.toHaveBeenCalled();
    });

    it('does not show error toast when onAfterInsert throws', async () => {
        const { toast } = await import('@/shared/stores/toastStore');
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
        const onAfterInsert = vi.fn().mockImplementation(() => { throw new Error('callback failed'); });
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn, onAfterInsert);

        expect(onAfterInsert).toHaveBeenCalledOnce();
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('works without onAfterInsert (backward compat)', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await expect(insertImageIntoEditor(editor as any, file, uploadFn)).resolves.not.toThrow();
    });

    it('inserts a blob: preview, never a data: URI (CSP img-src does not include data:)', async () => {
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
        const file = new File(['x'], 'pic.png', { type: 'image/png' });
        const setImage = vi.fn().mockReturnValue({ run: vi.fn() });
        editor.chain = vi.fn().mockReturnValue({ focus: vi.fn().mockReturnValue({ setImage }) });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn);

        expect(setImage).toHaveBeenCalledWith(
            expect.objectContaining({ src: expect.stringMatching(/^blob:/) as unknown as string }),
        );
    });

    it('revokes the blob preview URL after a successful upload', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/img.jpg');
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn);

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    });

    it('revokes the blob preview URL after a failed upload', async () => {
        vi.clearAllMocks();
        const editor = makeMockEditor(true);
        const failFn = vi.fn().mockRejectedValue(new Error('network'));
        const file = new File(['x'], 'pic.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, failFn);

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    });

    it('does nothing when editor is destroyed', async () => {
        const editor = makeMockEditor(true, true);
        const uploadFn = vi.fn();
        const file = new File(['x'], 'img.png', { type: 'image/png' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        await insertImageIntoEditor(editor as any, file, uploadFn);

        expect(uploadFn).not.toHaveBeenCalled();
    });
});
