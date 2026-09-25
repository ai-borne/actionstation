/**
 * The heading is committed shortly after typing pauses, not only on blur, so a title typed just
 * before the tab closes is still saved. It must never commit per keystroke (see deferredSave test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHeadingEditor } from '../useHeadingEditor';
import { EDIT_COMMIT_DELAY_MS } from '../../config/editCommit';

let typed = '';
let updateListener: (() => void) | null = null;
let latestOnBlur: ((md: string) => void) | null = null;
const mockEditor = {
    on: (event: string, cb: () => void) => { if (event === 'update') updateListener = cb; },
    off: () => { updateListener = null; },
    view: { dom: document.createElement('div') },
};
const mockGetMarkdown = () => typed;
vi.mock('../useTipTapEditor', () => ({
    useTipTapEditor: (opts: { onBlur?: (md: string) => void }) => {
        latestOnBlur = opts.onBlur ?? null;
        return { editor: mockEditor, getMarkdown: mockGetMarkdown, setContent: vi.fn() };
    },
}));

/** Simulates the user typing: the editor's text changes, then TipTap emits `update`. */
const type = (text: string) => { typed = text; updateListener?.(); };

const options = () => ({
    heading: '', placeholder: 'Title', isEditing: true,
    onHeadingChange: vi.fn(),
});

describe('useHeadingEditor debounced commit', () => {
    beforeEach(() => { vi.useFakeTimers(); typed = ''; updateListener = null; latestOnBlur = null; });
    afterEach(() => { vi.useRealTimers(); });

    it('commits the latest heading once typing pauses, not per keystroke', () => {
        const opts = options();
        renderHook(() => useHeadingEditor(opts));

        act(() => { type('Hel'); });
        act(() => { type('Hello'); });
        expect(opts.onHeadingChange).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(EDIT_COMMIT_DELAY_MS); });
        expect(opts.onHeadingChange).toHaveBeenCalledTimes(1);
        expect(opts.onHeadingChange).toHaveBeenCalledWith('Hello');
    });

    it('blur commits immediately and does not commit again from the timer', () => {
        const opts = options();
        renderHook(() => useHeadingEditor(opts));

        act(() => { type('Done'); });
        act(() => { latestOnBlur?.('Done'); });
        act(() => { vi.advanceTimersByTime(EDIT_COMMIT_DELAY_MS * 2); });

        expect(opts.onHeadingChange).toHaveBeenCalledTimes(1);
    });

    it('commits a pending heading when the card unmounts mid-typing', () => {
        const opts = options();
        const { unmount } = renderHook(() => useHeadingEditor(opts));

        act(() => { type('Unsaved title'); });
        unmount();

        expect(opts.onHeadingChange).toHaveBeenCalledWith('Unsaved title');
    });
});
