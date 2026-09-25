/**
 * useIdeaCardEditor - Body editor lifecycle, blur guard, content sync for IdeaCard.
 * Slash commands and AI prompt input live in the heading editor only.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { useEditor } from '@tiptap/react';
import type { Extension } from '@tiptap/core';
import { EDIT_COMMIT_DELAY_MS } from '../config/editCommit';
import { useCanvasStore } from '../stores/canvasStore';
import { useTipTapEditor } from './useTipTapEditor';
import { SubmitKeymap, type SubmitKeymapHandler } from '../extensions/submitKeymap';
import { createFileHandlerExtension } from '../extensions/fileHandlerExtension';
import { AttachmentExtension } from '../extensions/attachmentExtension';
import type { ImageUploadFn, AfterImageInsertFn } from '../services/imageInsertService';
import type { DocumentInsertFn } from '../extensions/fileHandlerExtension';

interface UseIdeaCardEditorOptions {
    isEditing: boolean;
    output: string | undefined;
    getEditableContent: () => string;
    placeholder: string;
    saveContent: (markdown: string) => void;
    onExitEditing: () => void;
    imageUploadFn?: ImageUploadFn;
    /**
     * Ref to the document insert callback (from useDocumentInsert via useIdeaCard).
     * Using a ref breaks the circular dependency: useIdeaCardEditor needs the
     * function to configure FileHandlerExtension, but the function is produced
     * by useIdeaCardHandlers which in turn needs the editor from this hook.
     * The ref is always populated before any user interaction can trigger it.
     */
    documentInsertFnRef?: React.RefObject<DocumentInsertFn | null>;
    onAfterImageInsertRef?: React.RefObject<AfterImageInsertFn | null>;
}

interface UseIdeaCardEditorReturn {
    editor: ReturnType<typeof useEditor>;
    getMarkdown: () => string;
    setContent: (markdown: string) => void;
    /** Ref for Enter/Escape key handlers — populated by useNodeInput or useFocusOverlayActions */
    submitHandlerRef: React.MutableRefObject<SubmitKeymapHandler | null>;
}

export function useIdeaCardEditor(options: UseIdeaCardEditorOptions): UseIdeaCardEditorReturn {
    const {
        isEditing, output, getEditableContent, placeholder,
        saveContent, onExitEditing, imageUploadFn, documentInsertFnRef, onAfterImageInsertRef,
    } = options;
    const submitHandlerRef = useRef<SubmitKeymapHandler | null>(null);

    // Stable wrapper that reads from the ref at call time — allows FileHandlerExtension to
    // be configured once while still routing to the latest insertFileDirectly callback.
    const stableDocumentInsertFn = useCallback<DocumentInsertFn>(
        (ed, file) => documentInsertFnRef?.current?.(ed, file) ?? Promise.resolve(),
        [documentInsertFnRef],
    );

    const stableAfterImageInsert = useCallback<AfterImageInsertFn>(
        (file, url) => onAfterImageInsertRef?.current?.(file, url),
        [onAfterImageInsertRef],
    );

    const editorExtensions: Extension[] = useMemo(() => {
        const exts: Extension[] = [
            SubmitKeymap.configure({ handlerRef: submitHandlerRef }) as Extension,
            AttachmentExtension as unknown as Extension,
        ];
        if (imageUploadFn) {
            exts.push(createFileHandlerExtension(imageUploadFn, stableDocumentInsertFn, stableAfterImageInsert) as Extension);
        }
        return exts;
    }, [imageUploadFn, stableDocumentInsertFn, stableAfterImageInsert]);

    const blurRef = useRef<(md: string) => void>(() => undefined);
    const displayContent = isEditing ? getEditableContent() : (output ?? '');

    // Latest saveContent, read at fire time so the debounced commit never uses a stale closure.
    const saveContentRef = useRef(saveContent);
    saveContentRef.current = saveContent;
    const pendingBodyRef = useRef<string | null>(null);
    const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const commitPendingBody = useCallback(() => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        const pending = pendingBodyRef.current;
        pendingBodyRef.current = null;
        if (pending !== null) saveContentRef.current(pending);
    }, []);

    const onUpdate = useCallback((markdown: string) => {
        useCanvasStore.getState().updateDraft(markdown);
        pendingBodyRef.current = markdown;
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(commitPendingBody, EDIT_COMMIT_DELAY_MS);
    }, [commitPendingBody]);

    // Unmounting mid-typing (card removed, workspace switched) must not drop the pending text.
    useEffect(() => commitPendingBody, [commitPendingBody]);

    const { editor, getMarkdown, setContent } = useTipTapEditor({
        initialContent: displayContent, placeholder, editable: isEditing,
        onBlur: useCallback((md: string) => blurRef.current(md), []),
        onUpdate,
        extraExtensions: editorExtensions,
    });

    const handleBlur = useCallback((markdown: string) => {
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
        pendingBodyRef.current = null;
        saveContent(markdown);
        onExitEditing();
        setContent(markdown);
    }, [saveContent, onExitEditing, setContent]);

    useEffect(() => { blurRef.current = handleBlur; }, [handleBlur]);

    const prevOutputRef = useRef(output);
    useEffect(() => {
        if (output !== prevOutputRef.current && !isEditing) {
            setContent(output ?? '');
            prevOutputRef.current = output;
        }
    }, [output, isEditing, setContent]);

    const wasEditingRef = useRef(isEditing);
    useEffect(() => {
        if (isEditing && !wasEditingRef.current) {
            setContent(getEditableContent());
        }
        wasEditingRef.current = isEditing;
    }, [isEditing, getEditableContent, setContent]);

    return { editor, getMarkdown, setContent, submitHandlerRef };
}
