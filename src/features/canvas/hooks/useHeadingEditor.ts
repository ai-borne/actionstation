/** useHeadingEditor - Heading editor with slash command + submit keymap support */
/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { useEditor } from '@tiptap/react';
import type { Extension } from '@tiptap/core';
import { EDIT_COMMIT_DELAY_MS } from '../config/editCommit';
import { useCanvasStore } from '../stores/canvasStore';
import { useTipTapEditor } from './useTipTapEditor';
import { SlashCommandSuggestion, createSlashSuggestionRender } from '../extensions/slashCommandSuggestion';
import { SubmitKeymap, type SubmitKeymapHandler } from '../extensions/submitKeymap';

function buildHeadingExtensions(
    hasSlashHandler: boolean,
    submitHandlerRef: React.MutableRefObject<SubmitKeymapHandler | null>,
    slashCommandRef: React.MutableRefObject<((id: string) => void) | undefined>,
    suggestionActiveRef: React.MutableRefObject<boolean>,
    slashJustSelectedRef: React.MutableRefObject<boolean>,
): Extension[] {
    const base: Extension[] = [SubmitKeymap.configure({ handlerRef: submitHandlerRef })];
    if (hasSlashHandler) {
        base.push(SlashCommandSuggestion.configure({
            suggestion: {
                render: createSlashSuggestionRender({
                    onSelect: (id) => { slashCommandRef.current?.(id); },
                    onActiveChange: (active) => {
                        suggestionActiveRef.current = active;
                        if (!active) slashJustSelectedRef.current = true;
                    },
                })
            }
        }));
    }
    return base;
}

function createSubmitHandler(
    suggestionActiveRef: React.RefObject<boolean>,
    getMarkdown: () => string,
    commitHeading: (h: string) => void,
    onSubmitAI?: (prompt: string) => void,
    onEnterKey?: () => void,
): SubmitKeymapHandler {
    return {
        onEnter: () => {
            if (suggestionActiveRef.current) return true;
            const currentHeading = getMarkdown().trim();
            commitHeading(currentHeading);
            const mode = useCanvasStore.getState().inputMode;
            if (mode === 'ai') onSubmitAI?.(currentHeading);
            else onEnterKey?.();
            return true;
        },
        onEscape: () => {
            if (suggestionActiveRef.current) return true;
            onEnterKey?.();
            return true;
        },
    };
}

export interface UseHeadingEditorOptions {
    heading: string; placeholder: string; isEditing: boolean;
    onHeadingChange: (h: string) => void; onBlur?: (h: string) => void;
    onEnterKey?: () => void; onSlashCommand?: (id: string) => void;
    onSubmitAI?: (prompt: string) => void;
}

export function useHeadingEditor(opts: UseHeadingEditorOptions): {
    editor: ReturnType<typeof useEditor>; suggestionActiveRef: React.RefObject<boolean>;
    getHeading: () => string;
} {
    const { heading, placeholder, isEditing, onHeadingChange, onBlur, onEnterKey, onSlashCommand, onSubmitAI } = opts;
    const suggestionActiveRef = useRef(false);
    const slashJustSelectedRef = useRef(false);
    const submitHandlerRef = useRef<SubmitKeymapHandler | null>(null);
    const blurRef = useRef<(md: string) => void>(() => undefined);
    const slashCommandRef = useRef(onSlashCommand);

    // Track last committed heading to avoid redundant store writes on blur.
    const lastCommittedRef = useRef(heading);

    // Commit heading to store only when value changed — called on blur and
    // before AI submit, NOT on every keystroke. Per-keystroke updateNodeHeading
    // caused O(N) re-renders across all canvas nodes (new nodes[] array each time).
    const pendingHeadingRef = useRef<string | null>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const commitHeading = useCallback((h: string) => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        pendingHeadingRef.current = null;
        if (h !== lastCommittedRef.current) {
            lastCommittedRef.current = h;
            onHeadingChange(h);
        }
    }, [onHeadingChange]);

    // Also commit once typing pauses, so a title typed just before the tab closes is not lost.
    // Debounced, so it never writes per keystroke. Skipped while the slash menu is open (the
    // text is a command, not a title); blur commits it.
    const scheduleHeadingCommit = useCallback((md: string) => {
        pendingHeadingRef.current = md;
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(() => {
            const pending = pendingHeadingRef.current;
            if (pending !== null && !suggestionActiveRef.current) commitHeading(pending);
        }, EDIT_COMMIT_DELAY_MS);
    }, [commitHeading]);

    // Unmounting mid-typing (card removed, workspace switched) must not drop the pending title.
    useEffect(() => () => {
        if (pendingHeadingRef.current !== null) commitHeading(pendingHeadingRef.current);
    }, [commitHeading]);

    // Keep lastCommittedRef in sync with external heading changes (undo/redo,
    // AI generation) so commitHeading doesn't produce a spurious write.
    useEffect(() => {
        if (!isEditing) lastCommittedRef.current = heading;
    }, [heading, isEditing]);

    useEffect(() => { slashCommandRef.current = onSlashCommand; }, [onSlashCommand]);

    const hasSlashHandler = Boolean(onSlashCommand);
    const extensions = useMemo(
        () => buildHeadingExtensions(hasSlashHandler, submitHandlerRef, slashCommandRef, suggestionActiveRef, slashJustSelectedRef),
        [hasSlashHandler],
    );

    const { editor, getMarkdown, setContent } = useTipTapEditor({
        initialContent: heading, placeholder, editable: isEditing,
        onBlur: useCallback((md: string) => blurRef.current(md), []),
        // Heading is committed on blur/submit or after a typing pause, NOT per keystroke.
        onUpdate: scheduleHeadingCommit,
        extraExtensions: extensions,
    });

    // Sync editor content when heading prop changes externally (e.g. focus mode
    // committed a heading update to the store) while this editor is NOT editing.
    // Mirrors useIdeaCardEditor's prevOutputRef content-sync pattern.
    const prevHeadingRef = useRef(heading);
    useEffect(() => {
        if (heading !== prevHeadingRef.current && !isEditing) {
            setContent(heading);
            prevHeadingRef.current = heading;
        }
    }, [heading, isEditing, setContent]);

    useEffect(() => {
        submitHandlerRef.current = createSubmitHandler(
            suggestionActiveRef, getMarkdown, commitHeading, onSubmitAI, onEnterKey,
        );
        return () => { submitHandlerRef.current = null; };
    }, [getMarkdown, onEnterKey, onSubmitAI, commitHeading]);

    const handleBlur = useCallback((md: string) => {
        if (suggestionActiveRef.current) return;
        if (slashJustSelectedRef.current) {
            slashJustSelectedRef.current = false;
            queueMicrotask(() => { editor?.commands.focus(); }); return;
        }
        commitHeading(md);
        onBlur?.(md);
    }, [onBlur, editor, commitHeading]);
    useEffect(() => { blurRef.current = handleBlur; }, [handleBlur]);

    // Trigger placeholder re-render when text changes (e.g. switching to AI mode)
    const prevPH = useRef(placeholder);
    useEffect(() => {
        if (editor == null || placeholder === prevPH.current) return;
        prevPH.current = placeholder;
        editor.view.dispatch(editor.state.tr.setMeta('placeholderUpdate', true));
    }, [editor, placeholder]);

    return { editor, suggestionActiveRef, getHeading: getMarkdown };
}
