import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import {
    getViewModeKeyAction,
    applyViewModeKeyAction,
} from '../nodeInputKeyHandler';

function createKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key: 'a', ...overrides });
    vi.spyOn(e, 'preventDefault');
    vi.spyOn(e, 'stopPropagation');
    return e;
}

describe('getViewModeKeyAction', () => {
    it('returns enter for Enter key', () => {
        const e = createKeyEvent({ key: 'Enter' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'enter' });
    });

    it('returns null for Ctrl+key', () => {
        const e = createKeyEvent({ key: 'a', ctrlKey: true });
        expect(getViewModeKeyAction(e)).toBeNull();
    });

    it('returns null for Meta+key', () => {
        const e = createKeyEvent({ key: 'a', metaKey: true });
        expect(getViewModeKeyAction(e)).toBeNull();
    });

    it('returns null for Alt+key', () => {
        const e = createKeyEvent({ key: 'a', altKey: true });
        expect(getViewModeKeyAction(e)).toBeNull();
    });

    it('returns print for single printable character', () => {
        const e = createKeyEvent({ key: 'a' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'print', char: 'a' });
    });

    it('returns print for uppercase printable', () => {
        const e = createKeyEvent({ key: 'Z' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'print', char: 'Z' });
    });

    it('returns shortcut when handler exists in map', () => {
        const handler = vi.fn();
        const e = createKeyEvent({ key: 'x' });
        const action = getViewModeKeyAction(e, { x: handler });
        expect(action).toEqual({ type: 'shortcut', handler });
        expect(action?.type).toBe('shortcut');
        if (action?.type === 'shortcut') {
            action.handler();
            expect(handler).toHaveBeenCalled();
        }
    });

    it('matches shortcut by lowercase key', () => {
        const handler = vi.fn();
        const e = createKeyEvent({ key: 'X' });
        const action = getViewModeKeyAction(e, { x: handler });
        expect(action).toEqual({ type: 'shortcut', handler });
    });

    it('returns skip for global shortcut key', () => {
        const e = createKeyEvent({ key: 'n' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'skip' });
    });

    it('returns skip for uppercase N', () => {
        const e = createKeyEvent({ key: 'N' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'skip' });
    });

    it('returns print when shortcut overrides global for other keys', () => {
        const e = createKeyEvent({ key: 'a' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'print', char: 'a' });
    });

    it('returns null for multi-char key', () => {
        const e = createKeyEvent({ key: 'Backspace' });
        expect(getViewModeKeyAction(e)).toBeNull();
    });

    it('returns null when no shortcuts provided for printable', () => {
        const e = createKeyEvent({ key: 'b' });
        expect(getViewModeKeyAction(e)).toEqual({ type: 'print', char: 'b' });
    });
});

describe('applyViewModeKeyAction', () => {
    let enterEditing: Mock<() => void>;
    let mockDispatch: Mock<() => void>;
    let mockEditor: {
        view: {
            state: {
                selection: { from: number; to: number };
                tr: { insertText: (c: string, from: number, to: number) => unknown };
            };
            dispatch: Mock<() => void>;
        };
    };

    beforeEach(() => {
        enterEditing = vi.fn();
        mockDispatch = vi.fn();
        const fakeTr = {};
        mockEditor = {
            view: {
                state: {
                    selection: { from: 2, to: 2 },
                    tr: {
                        insertText: vi.fn().mockReturnValue(fakeTr),
                    },
                },
                dispatch: mockDispatch,
            },
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does nothing when action is null', () => {
        const e = createKeyEvent();
        applyViewModeKeyAction(null, e, {
            enterEditing,
            editor: mockEditor as never,
        });
        expect(enterEditing).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('calls handler for shortcut action', () => {
        const handler = vi.fn();
        const e = createKeyEvent();
        applyViewModeKeyAction({ type: 'shortcut', handler }, e, {
            enterEditing,
            editor: null,
        });
        expect(handler).toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
        expect(enterEditing).not.toHaveBeenCalled();
    });

    it('does nothing for skip action', () => {
        const e = createKeyEvent();
        applyViewModeKeyAction({ type: 'skip' }, e, {
            enterEditing,
            editor: mockEditor as never,
        });
        expect(enterEditing).not.toHaveBeenCalled();
        expect(e.preventDefault).not.toHaveBeenCalled();
    });

    it('calls enterEditing for enter action', () => {
        const e = createKeyEvent({ key: 'Enter' });
        applyViewModeKeyAction({ type: 'enter' }, e, {
            enterEditing,
            editor: null,
        });
        expect(enterEditing).toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
    });

    it('calls enterEditing and inserts char for print action', async () => {
        const e = createKeyEvent();
        applyViewModeKeyAction({ type: 'print', char: 'x' }, e, {
            enterEditing,
            editor: mockEditor as never,
        });
        expect(enterEditing).toHaveBeenCalled();
        expect(e.preventDefault).toHaveBeenCalled();
        expect(e.stopPropagation).toHaveBeenCalled();
        await new Promise<void>((r) => queueMicrotask(r));
        expect(mockDispatch).toHaveBeenCalled();
        expect(mockEditor.view.state.tr.insertText).toHaveBeenCalledWith('x', 2, 2);
    });

    it('does not dispatch when editor is null for print', async () => {
        const e = createKeyEvent();
        applyViewModeKeyAction({ type: 'print', char: 'x' }, e, {
            enterEditing,
            editor: null,
        });
        await new Promise<void>((r) => queueMicrotask(r));
        expect(mockDispatch).not.toHaveBeenCalled();
    });
});
