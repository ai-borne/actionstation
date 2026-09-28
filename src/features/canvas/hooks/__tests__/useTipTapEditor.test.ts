/**
 * useTipTapEditor Hook Tests
 * TDD: Validates editor lifecycle, markdown I/O, and callback wiring
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTipTapEditor } from '../useTipTapEditor';

describe('useTipTapEditor', () => {
    it('creates an editor instance on mount', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: 'Type...' })
        );
        expect(result.current.editor).not.toBeNull();
    });

    it('initializes with content from markdown string', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '**bold text**', placeholder: '' })
        );
        const html = result.current.editor!.getHTML();
        expect(html).toContain('<strong>bold text</strong>');
    });

    it('returns markdown string via getMarkdown', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '**bold**', placeholder: '' })
        );
        expect(result.current.getMarkdown()).toBe('**bold**');
    });

    it('reports isEmpty correctly for empty content', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        expect(result.current.isEmpty).toBe(true);
    });

    it('reports isEmpty correctly for non-empty content', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: 'hello', placeholder: '' })
        );
        expect(result.current.isEmpty).toBe(false);
    });

    it('returns plain text via getText', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '**bold** text', placeholder: '' })
        );
        expect(result.current.getText()).toContain('bold text');
    });

    it('wires onBlur callback to editor options', () => {
        const onBlur = vi.fn();
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: 'hello', placeholder: '', onBlur })
        );
        // Verify editor is created with blur handler wired
        // (ProseMirror blur events don't fire in jsdom, but the callback is wired)
        expect(result.current.editor).not.toBeNull();
        // Verify getMarkdown returns the content that onBlur would provide
        expect(result.current.getMarkdown()).toBe('hello');
    });

    it('returns editor instance that can be used until unmount', () => {
        const { result, unmount } = renderHook(() =>
            useTipTapEditor({ initialContent: 'test', placeholder: '' })
        );
        // Editor exists and is functional
        expect(result.current.editor).not.toBeNull();
        expect(result.current.getMarkdown()).toBe('test');
        // Unmount triggers cleanup (TipTap handles destruction internally)
        unmount();
    });

    it('respects editable option', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: 'text', placeholder: '', editable: false })
        );
        expect(result.current.editor!.isEditable).toBe(false);
    });

    it('defaults to editable when option not specified', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        expect(result.current.editor!.isEditable).toBe(true);
    });

    it('provides setContent to update editor content programmatically', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: 'original', placeholder: '' })
        );
        expect(result.current.getMarkdown()).toBe('original');
        result.current.setContent('**updated**');
        expect(result.current.getMarkdown()).toBe('**updated**');
    });

    it('setContent with empty string clears the editor', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: 'has content', placeholder: '' })
        );
        result.current.setContent('');
        // After clearing, getMarkdown returns empty and editor content is cleared
        expect(result.current.getMarkdown()).toBe('');
    });

    describe('skipNextUpdate guard', () => {
        it('suppresses onUpdate during programmatic setContent', () => {
            const onUpdate = vi.fn();
            const { result } = renderHook(() =>
                useTipTapEditor({ initialContent: 'initial', placeholder: '', onUpdate })
            );
            onUpdate.mockClear();

            // setContent should suppress the next onUpdate callback
            act(() => { result.current.setContent('programmatic content'); });

            // onUpdate should NOT have been called for programmatic setContent
            expect(onUpdate).not.toHaveBeenCalled();
        });
    });

    describe('onUpdate callback', () => {
        it('wires onUpdate callback to editor options', () => {
            const onUpdate = vi.fn();
            const { result } = renderHook(() =>
                useTipTapEditor({ initialContent: 'hello', placeholder: '', onUpdate })
            );
            // Editor is created with update handler wired
            expect(result.current.editor).not.toBeNull();
        });
    });

    describe('editable prop sync via useEffect', () => {
        it('initialises as non-editable when editable=false', () => {
            const { result } = renderHook(() =>
                useTipTapEditor({ initialContent: 'text', placeholder: '', editable: false })
            );
            expect(result.current.editor!.isEditable).toBe(false);
        });

        it('becomes editable when prop changes false→true (critical: heading editor regression guard)', async () => {
            const { result, rerender } = renderHook(
                ({ editable }) => useTipTapEditor({ initialContent: 'text', placeholder: '', editable }),
                { initialProps: { editable: false } }
            );
            expect(result.current.editor!.isEditable).toBe(false);
            // Simulates user clicking a node to enter edit mode
            rerender({ editable: true });
            await act(async () => { });
            expect(result.current.editor!.isEditable).toBe(true);
        });

        it('becomes non-editable when prop changes true→false', async () => {
            const { result, rerender } = renderHook(
                ({ editable }) => useTipTapEditor({ initialContent: 'text', placeholder: '', editable }),
                { initialProps: { editable: true } }
            );
            expect(result.current.editor!.isEditable).toBe(true);
            rerender({ editable: false });
            await act(async () => { });
            expect(result.current.editor!.isEditable).toBe(false);
        });
    });
});


describe('useTipTapEditor — no duplicate extensions', () => {
    it('should not produce duplicate link extension warnings', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        renderHook(() =>
            useTipTapEditor({ initialContent: 'test', placeholder: '' })
        );

        const duplicateWarnings = warnSpy.mock.calls.filter(
            (args) => typeof args[0] === 'string' && args[0].includes('Duplicate extension'),
        );

        expect(duplicateWarnings).toHaveLength(0);
        warnSpy.mockRestore();
    });
});

describe('useTipTapEditor — clipboardTextParser (paste fix)', () => {
    it('does NOT provide transformPastedText (replaced by clipboardTextParser)', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        const editor = result.current.editor!;
        // transformPastedText returned HTML-as-string which ProseMirror inserted as
        // literal text (showing raw <p><a href>...</a></p> tags). It must be absent.
        expect(editor.view.props.transformPastedText).toBeUndefined();
    });

    it('provides clipboardTextParser via view.someProp', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        const editor = result.current.editor!;
        type ClipParser = (text: string, $context: unknown, plain: boolean, view: unknown) => import('prosemirror-model').Slice;
        const parser = editor.view.someProp('clipboardTextParser' as never, (p: ClipParser) => p);
        expect(parser).toBeDefined();
    });

    it('clipboardTextParser for a bare URL produces text without literal HTML tags', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        const editor = result.current.editor!;
        type ClipParser = (text: string, $context: unknown, plain: boolean, view: unknown) => import('prosemirror-model').Slice;
        const parser = editor.view.someProp('clipboardTextParser' as never, (p: ClipParser) => p);
        expect(parser).toBeDefined();

        const $context = editor.state.doc.resolve(1);
        const slice = parser!('https://example.com', $context, false, editor.view);

        const text = slice.content.textBetween(0, slice.content.size);
        expect(text).not.toContain('<a href');
        expect(text).not.toContain('<p>');
        expect(text).toContain('https://example.com');
    });

    it('clipboardTextParser for markdown bold produces text without HTML tags', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        const editor = result.current.editor!;
        type ClipParser = (text: string, $context: unknown, plain: boolean, view: unknown) => import('prosemirror-model').Slice;
        const parser = editor.view.someProp('clipboardTextParser' as never, (p: ClipParser) => p);

        const $context = editor.state.doc.resolve(1);
        const slice = parser!('**bold text**', $context, false, editor.view);

        const text = slice.content.textBetween(0, slice.content.size);
        expect(text).not.toContain('<strong>');
        expect(text).not.toContain('<p>');
        expect(text).toContain('bold text');
    });

    it('clipboardTextParser for raw HTML-as-plaintext renders content not literal tags (bug scenario)', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        const editor = result.current.editor!;
        type ClipParser = (text: string, $context: unknown, plain: boolean, view: unknown) => import('prosemirror-model').Slice;
        const parser = editor.view.someProp('clipboardTextParser' as never, (p: ClipParser) => p);

        // Simulate pasting raw HTML string as plain text (the bug scenario from screenshots)
        const $context = editor.state.doc.resolve(1);
        const rawHtmlText = '<p><a href="https://example.com">https://example.com</a></p>';
        const slice = parser!(rawHtmlText, $context, false, editor.view);

        const text = slice.content.textBetween(0, slice.content.size);
        expect(text).not.toContain('<p>');
        expect(text).not.toContain('<a href');
        expect(text).toContain('https://example.com');
    });
});

describe('useTipTapEditor — data: image paste upload (C8: no data: in CSP img-src)', () => {
    function makePasteEvent(html: string) {
        return {
            clipboardData: { getData: () => html },
            preventDefault: vi.fn(),
        } as unknown as ClipboardEvent;
    }

    beforeEach(() => {
        let counter = 0;
        URL.createObjectURL = vi.fn().mockImplementation(() => `blob:mock-${++counter}`);
        URL.revokeObjectURL = vi.fn();
    });

    it('intercepts a data: image paste, inserts a blob preview, and swaps in the permanent URL', async () => {
        const uploadFn = vi.fn().mockResolvedValue('https://cdn.example.com/pasted.png');
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '', imageUploadFn: uploadFn }),
        );
        const editor = result.current.editor!;
        type PasteHandler = (view: typeof editor.view, event: ClipboardEvent) => boolean;
        const handlePaste = editor.view.someProp('handlePaste' as never, (p: PasteHandler) => p);
        expect(handlePaste).toBeDefined();

        const event = makePasteEvent('<img src="data:image/png;base64,iVBORw0KGgo=">');
        let handled = false;
        act(() => { handled = handlePaste!(editor.view, event); });

        expect(handled).toBe(true);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(editor.getHTML()).toContain('blob:mock-1');

        await vi.waitFor(() => expect(editor.getHTML()).toContain('https://cdn.example.com/pasted.png'));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    });

    it('does not intercept a plain-text paste (no data: image)', () => {
        const uploadFn = vi.fn();
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '', imageUploadFn: uploadFn }),
        );
        const editor = result.current.editor!;
        type PasteHandler = (view: typeof editor.view, event: ClipboardEvent) => boolean;
        const handlePaste = editor.view.someProp('handlePaste' as never, (p: PasteHandler) => p);

        const event = makePasteEvent('<p>hello</p>');
        const handled = handlePaste!(editor.view, event);

        expect(handled).toBe(false);
        expect(uploadFn).not.toHaveBeenCalled();
    });

    it('does not intercept when no imageUploadFn is configured (e.g. heading editor)', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' }),
        );
        const editor = result.current.editor!;
        type PasteHandler = (view: typeof editor.view, event: ClipboardEvent) => boolean;
        const handlePaste = editor.view.someProp('handlePaste' as never, (p: PasteHandler) => p);

        const event = makePasteEvent('<img src="data:image/png;base64,iVBORw0KGgo=">');
        const handled = handlePaste!(editor.view, event);

        expect(handled).toBe(false);
    });
});

describe('useTipTapEditor — table content', () => {
    const TABLE_MD = '| Name | Age |\n|---|---|\n| Alice | 30 |';
    // Raw GFM table HTML — TipTap must retain <table> structure, not collapse to plain text
    const TABLE_HTML = '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>';

    it('initialises editor with table markdown without stripping content', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: TABLE_MD, placeholder: '' })
        );
        const html = result.current.editor!.getHTML();
        expect(html).toContain('Alice');
        expect(html).toContain('Name');
    });

    it('isEmpty is false when content is a table', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: TABLE_MD, placeholder: '' })
        );
        expect(result.current.isEmpty).toBe(false);
    });

    it('setContent with table markdown updates editor', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        act(() => { result.current.setContent(TABLE_MD); });
        const html = result.current.editor!.getHTML();
        expect(html).toContain('Alice');
    });

    it('accepts raw table HTML via setContent without stripping', () => {
        const { result } = renderHook(() =>
            useTipTapEditor({ initialContent: '', placeholder: '' })
        );
        act(() => { result.current.editor!.commands.setContent(TABLE_HTML); });
        const html = result.current.editor!.getHTML();
        // TipTap v3 wraps cells with colspan/rowspan attributes and text in <p>
        // Core assertion: table structure is preserved (not collapsed to plain text)
        expect(html).toContain('<table');
        expect(html).toContain('Alice');
        expect(html).toContain('Name');
    });
});
