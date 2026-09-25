/**
 * Integration tests for the slash command → AI generation pipeline.
 *
 * These tests exercise the REAL TipTap editor with REAL extensions
 * (SubmitKeymap, Placeholder) to catch cross-layer regressions that
 * unit tests with mocks cannot detect.
 *
 * Note: Slash commands now live in the heading editor only. Body editor
 * uses SubmitKeymap for Enter/Escape but has no slash command extension.
 *
 * Regressions these tests prevent:
 * - Enter to select slash command exits editing (duplicate handler race)
 * - SubmitKeymap not intercepting Enter before StarterKit
 * - suggestionActiveRef timing issues during command selection
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { SubmitKeymap, type SubmitKeymapHandler } from '../extensions/submitKeymap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a real TipTap editor with SubmitKeymap + Placeholder, wired to a
 * submitHandlerRef just like the production code does.
 */
function createEditorWithSubmitKeymap(opts: {
    placeholder?: string;
    handlerRef: React.MutableRefObject<SubmitKeymapHandler | null>;
}) {
    return renderHook(() =>
        useEditor({
            extensions: [
                StarterKit,
                Placeholder.configure({
                    placeholder: opts.placeholder ?? 'Type something...',
                }),
                SubmitKeymap.configure({ handlerRef: opts.handlerRef }),
            ],
            content: '',
        }),
    );
}

/** Simulate a keyboard shortcut through ProseMirror's keymap system */
function simulateKeyInEditor(
    editor: ReturnType<typeof useEditor>,
    key: string,
) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
    if (!editor) throw new Error('Editor is null');
    // ProseMirror editors process key events through their keymap plugins.
    // We simulate this by calling the editor's keyboard shortcut handler
    // which goes through the same priority chain as a real keypress.
    // Fallback: use the commands pathway which goes through keymaps
    if (key === 'Enter') {
        // TipTap processes keyboard shortcuts via the keymap plugin chain.
        // We trigger it the same way ProseMirror does internally.
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        const handled = editor.view.someProp('handleKeyDown', (f) =>
            f(editor.view, event),
        );
        return handled;
    }
    if (key === 'Escape') {
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        const handled = editor.view.someProp('handleKeyDown', (f) =>
            f(editor.view, event),
        );
        return handled;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubmitKeymap extension (real TipTap)', () => {
    let handlerRef: { current: SubmitKeymapHandler | null };
    let onEnterSpy: Mock<() => boolean>;
    let onEscapeSpy: Mock<() => boolean>;

    beforeEach(() => {
        onEnterSpy = vi.fn(() => true);
        onEscapeSpy = vi.fn(() => true);
        handlerRef = { current: { onEnter: onEnterSpy, onEscape: onEscapeSpy } };
    });

    it('Enter fires onEnter handler BEFORE StarterKit creates a paragraph', () => {
        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;
        expect(editor).not.toBeNull();

        // Type some content first
        act(() => { editor!.commands.insertContent('hello'); });

        // Simulate Enter through ProseMirror's keymap chain
        act(() => { simulateKeyInEditor(editor, 'Enter'); });

        // SubmitKeymap (priority 1000) should intercept it
        expect(onEnterSpy).toHaveBeenCalledTimes(1);
        // StarterKit should NOT have created a new paragraph
        expect(editor!.getHTML()).not.toContain('<p></p>');
    });

    it('Escape fires onEscape handler', () => {
        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { simulateKeyInEditor(editor, 'Escape'); });

        expect(onEscapeSpy).toHaveBeenCalledTimes(1);
    });

    it('Enter falls through to StarterKit when handler returns false', () => {
        onEnterSpy.mockReturnValue(false);
        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { editor!.commands.insertContent('line1'); });
        act(() => { simulateKeyInEditor(editor, 'Enter'); });

        // Handler returned false → StarterKit should create a new paragraph
        expect(onEnterSpy).toHaveBeenCalledTimes(1);
        // The editor should now have two block-level elements
        const html = editor!.getHTML();
        expect((html.match(/<p>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('Enter does nothing when handlerRef.current is null', () => {
        handlerRef.current = null;
        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { editor!.commands.insertContent('hello'); });

        // Should not throw, Enter falls through to StarterKit
        act(() => { simulateKeyInEditor(editor, 'Enter'); });
        expect(onEnterSpy).not.toHaveBeenCalled();
    });
});

describe('SubmitKeymap + suggestion-active guard (heading editor pattern)', () => {
    it('onEnter returns true (consumes event) when suggestion is active, preventing StarterKit fallthrough', () => {
        const suggestionActiveRef = { current: true };
        const onSubmitNote = vi.fn();
        const onEnterKey = vi.fn();
        const handlerRef: { current: SubmitKeymapHandler | null } = {
            current: {
                onEnter: () => {
                    if (suggestionActiveRef.current) return true;
                    onSubmitNote('content');
                    return true;
                },
                onEscape: () => true,
            },
        };

        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { editor!.commands.insertContent('/'); });
        const htmlBefore = editor!.getHTML();

        act(() => { simulateKeyInEditor(editor, 'Enter'); });

        expect(onSubmitNote).not.toHaveBeenCalled();
        expect(onEnterKey).not.toHaveBeenCalled();
        // StarterKit must NOT create a new paragraph
        expect(editor!.getHTML()).toBe(htmlBefore);
    });

    it('onEscape returns true without calling onEnterKey when suggestion is active', () => {
        const suggestionActiveRef = { current: true };
        const onEnterKey = vi.fn();
        const handlerRef: { current: SubmitKeymapHandler | null } = {
            current: {
                onEnter: () => {
                    if (suggestionActiveRef.current) return true;
                    return true;
                },
                onEscape: () => {
                    if (suggestionActiveRef.current) return true;
                    onEnterKey();
                    return true;
                },
            },
        };

        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { simulateKeyInEditor(editor, 'Escape'); });

        expect(onEnterKey).not.toHaveBeenCalled();
    });

    it('after suggestion closes (ref set to false), next Enter submits', () => {
        const suggestionActiveRef = { current: true };
        const onSubmitNote = vi.fn();
        const handlerRef: { current: SubmitKeymapHandler | null } = {
            current: {
                onEnter: () => {
                    if (suggestionActiveRef.current) return true;
                    onSubmitNote('content');
                    return true;
                },
                onEscape: () => true,
            },
        };

        const { result } = createEditorWithSubmitKeymap({ handlerRef });
        const editor = result.current;

        act(() => { editor!.commands.insertContent('my AI prompt'); });

        // Suggestion is now closed
        suggestionActiveRef.current = false;

        act(() => { simulateKeyInEditor(editor, 'Enter'); });
        expect(onSubmitNote).toHaveBeenCalledTimes(1);
    });
});

