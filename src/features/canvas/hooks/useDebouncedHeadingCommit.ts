/**
 * Commits a card's heading shortly after typing pauses, so a title typed just before the tab
 * closes is still saved. Debounced, so it never writes to the store per keystroke (see
 * useHeadingEditor.deferredSave.test.ts); subscribes through the editor's `update` event rather
 * than useTipTapEditor's `onUpdate`, which the structural test forbids for headings.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { EDIT_COMMIT_DELAY_MS } from '../config/editCommit';

interface PendingHeading {
    /** Latest uncommitted heading text, or null. */
    readonly textRef: React.MutableRefObject<string | null>;
    readonly timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    /** Drops any scheduled commit (blur or submit already committed the text). */
    readonly cancel: () => void;
}

export function usePendingHeading(): PendingHeading {
    const textRef = useRef<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancel = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        textRef.current = null;
    }, []);
    return { textRef, timerRef, cancel };
}

interface Options {
    readonly editor: Editor | null;
    readonly getMarkdown: () => string;
    readonly commitHeading: (h: string) => void;
    readonly pending: PendingHeading;
    /** While the slash menu is open the text is a command, not a title. */
    readonly suggestionActiveRef: React.RefObject<boolean>;
}

export function useDebouncedHeadingCommit(opts: Options): void {
    const { editor, getMarkdown, commitHeading, pending, suggestionActiveRef } = opts;
    const { textRef, timerRef } = pending;

    useEffect(() => {
        if (editor == null) return;
        const onUpdate = () => {
            textRef.current = getMarkdown();
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                const text = textRef.current;
                if (text !== null && !suggestionActiveRef.current) commitHeading(text);
            }, EDIT_COMMIT_DELAY_MS);
        };
        editor.on('update', onUpdate);
        return () => { editor.off('update', onUpdate); };
    }, [editor, getMarkdown, commitHeading, textRef, timerRef, suggestionActiveRef]);

    // Unmounting mid-typing (card removed, workspace switched) must not drop the pending title.
    useEffect(() => () => {
        if (textRef.current !== null) commitHeading(textRef.current);
    }, [commitHeading, textRef]);
}
