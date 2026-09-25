/**
 * The heading is committed shortly after typing pauses, not only on blur, so a title typed just
 * before the tab closes is still saved. It must never commit per keystroke (see deferredSave test).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHeadingEditor } from '../useHeadingEditor';
import { EDIT_COMMIT_DELAY_MS } from '../../config/editCommit';

let latestOnUpdate: ((md: string) => void) | null = null;
let latestOnBlur: ((md: string) => void) | null = null;
vi.mock('../useTipTapEditor', () => ({
    useTipTapEditor: (opts: { onUpdate?: (md: string) => void; onBlur?: (md: string) => void }) => {
        latestOnUpdate = opts.onUpdate ?? null;
        latestOnBlur = opts.onBlur ?? null;
        return { editor: null, getMarkdown: () => '', setContent: vi.fn() };
    },
}));

const options = () => ({
    heading: '', placeholder: 'Title', isEditing: true,
    onHeadingChange: vi.fn(),
});

describe('useHeadingEditor debounced commit', () => {
    beforeEach(() => { vi.useFakeTimers(); latestOnUpdate = null; latestOnBlur = null; });
    afterEach(() => { vi.useRealTimers(); });

    it('commits the latest heading once typing pauses, not per keystroke', () => {
        const opts = options();
        renderHook(() => useHeadingEditor(opts));

        act(() => { latestOnUpdate?.('Hel'); });
        act(() => { latestOnUpdate?.('Hello'); });
        expect(opts.onHeadingChange).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(EDIT_COMMIT_DELAY_MS); });
        expect(opts.onHeadingChange).toHaveBeenCalledTimes(1);
        expect(opts.onHeadingChange).toHaveBeenCalledWith('Hello');
    });

    it('blur commits immediately and does not commit again from the timer', () => {
        const opts = options();
        renderHook(() => useHeadingEditor(opts));

        act(() => { latestOnUpdate?.('Done'); });
        act(() => { latestOnBlur?.('Done'); });
        act(() => { vi.advanceTimersByTime(EDIT_COMMIT_DELAY_MS * 2); });

        expect(opts.onHeadingChange).toHaveBeenCalledTimes(1);
    });

    it('commits a pending heading when the card unmounts mid-typing', () => {
        const opts = options();
        const { unmount } = renderHook(() => useHeadingEditor(opts));

        act(() => { latestOnUpdate?.('Unsaved title'); });
        unmount();

        expect(opts.onHeadingChange).toHaveBeenCalledWith('Unsaved title');
    });
});
