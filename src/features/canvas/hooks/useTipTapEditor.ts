/**
 * useTipTapEditor Hook - Encapsulates TipTap editor setup with markdown I/O
 * Bridges TipTap's document model with the store's string-based contract
 */
import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import type { Extension } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { NodeImage } from '../extensions/imageExtension';
import { FontSizeExtension } from '../extensions/fontSizeExtension';
import { markdownToHtml, htmlToMarkdown } from '../services/markdownConverter';
import { sanitizePastedHtml } from '../services/sanitizePastedHtml';
import { createDataImagePasteHandler } from '../services/pasteImageService';
import type { ImageUploadFn, AfterImageInsertFn } from '../services/imageInsertService';

interface UseTipTapEditorOptions {
    initialContent: string;
    placeholder: string;
    editable?: boolean;
    onBlur?: (markdown: string) => void;
    onUpdate?: (markdown: string) => void;
    extraExtensions?: Extension[];
    /** Enables uploading `data:` images embedded in rich-HTML pastes (see pasteImageService) */
    imageUploadFn?: ImageUploadFn;
    onAfterImageInsert?: AfterImageInsertFn;
}

interface UseTipTapEditorReturn {
    editor: ReturnType<typeof useEditor>;
    getMarkdown: () => string;
    getText: () => string;
    isEmpty: boolean;
    setContent: (markdown: string) => void;
}

/**
 * Pure guard: useEditor returns Editor | null at runtime despite TS types.
 * Module-level to avoid redefinition on every render and hook dep issues.
 */
function isEditorReady(e: ReturnType<typeof useEditor>): e is NonNullable<typeof e> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return e != null && !e.isDestroyed;
}

/**
 * Stable `handlePaste` for the data:-image-upload flow (pasteImageService).
 * editorProps are captured once at editor creation, so this keeps the upload
 * function and after-insert callback fresh via refs read at call time —
 * same pattern as placeholderRef below.
 */
function useDataImagePasteHandler(imageUploadFn?: ImageUploadFn, onAfterImageInsert?: AfterImageInsertFn) {
    const imageUploadFnRef = useRef(imageUploadFn);
    imageUploadFnRef.current = imageUploadFn;
    const onAfterImageInsertRef = useRef(onAfterImageInsert);
    onAfterImageInsertRef.current = onAfterImageInsert;
    return useRef(
        createDataImagePasteHandler(
            sanitizePastedHtml,
            () => imageUploadFnRef.current,
            () => onAfterImageInsertRef.current,
        ),
    ).current;
}

/** Hook for managing a TipTap editor with markdown serialization */
export function useTipTapEditor(options: UseTipTapEditorOptions): UseTipTapEditorReturn {
    const {
        initialContent, placeholder, editable = true, onBlur, onUpdate, extraExtensions = [],
        imageUploadFn, onAfterImageInsert,
    } = options;

    // Guard: skip onUpdate during programmatic setContent to avoid writing stale content back
    const skipNextUpdateRef = useRef(false);

    // Keep the placeholder in a ref so the Placeholder extension's decoration
    // function always reads the latest value (TipTap only captures options at
    // creation time, but supports a function callback that is invoked on each
    // decoration pass).
    const placeholderRef = useRef(placeholder);
    placeholderRef.current = placeholder;

    const handleDataImagePaste = useDataImagePasteHandler(imageUploadFn, onAfterImageInsert);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                link: {
                    openOnClick: false,
                    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
                    protocols: ['https', 'http', 'mailto'],
                },
            }),
            Placeholder.configure({ placeholder: () => placeholderRef.current }),
            Highlight.configure({ multicolor: true }),
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            NodeImage,
            FontSizeExtension,
            ...extraExtensions,
        ],
        content: initialContent ? markdownToHtml(initialContent) : '',
        editable,
        // Convert plain-text pastes through the markdown pipeline so that
        // pasted markdown (tables, headings, lists, etc.) renders as rich nodes
        // rather than raw pipe/hash characters.
        editorProps: {
            // Intercept `data:` images embedded in rich-HTML pastes and upload them
            // (see pasteImageService); returns false to fall through to the default
            // pipeline (transformPastedHTML below) for every other paste.
            handlePaste: handleDataImagePaste,
            // Sanitize unsafe attributes from rich HTML pastes (Google Docs, web pages, etc.)
            transformPastedHTML(html: string): string {
                return sanitizePastedHtml(html);
            },
            // Convert plain-text pastes (including markdown) to a ProseMirror Slice.
            // NOTE: transformPastedText was used here previously but it returns a plain string
            // that ProseMirror inserts as literal text — causing <p><a href> tags to appear
            // verbatim. clipboardTextParser returns a Slice directly, bypassing that path.
            clipboardTextParser(text: string, $context, _plain, view) {
                const html = markdownToHtml(text);
                const el = document.createElement('div');
                el.innerHTML = html;
                return PMDOMParser.fromSchema(view.state.schema).parseSlice(el, {
                    context: $context,
                });
            },
        },
        onBlur: ({ editor: e }) => { onBlur?.(htmlToMarkdown(e.getHTML())); },
        onUpdate: ({ editor: e }) => {
            if (skipNextUpdateRef.current) { skipNextUpdateRef.current = false; return; }
            onUpdate?.(htmlToMarkdown(e.getHTML()));
        },
    });

    // Keep a stable ref to the editor so the editable-sync effect can read
    // the current editor without listing it as a dep (which causes a cascade).
    const editorRef = useRef(editor);
    editorRef.current = editor;

    // Sync editable reactively — TipTap only reads it at creation time.
    // Depend only on [editable]: setEditable() dispatches a ProseMirror
    // transaction which would mutate editor state → re-render → effect re-fires
    // → "Maximum update depth exceeded" if editor is also a dep.
    useEffect(() => {
        const e = editorRef.current;
        if (isEditorReady(e) && e.isEditable !== editable) {
            e.setEditable(editable);
        }
    }, [editable]);

    const getMarkdown = useCallback((): string => {
        return isEditorReady(editor) ? htmlToMarkdown(editor.getHTML()) : '';
    }, [editor]);

    const getText = useCallback((): string => {
        return isEditorReady(editor) ? editor.getText() : '';
    }, [editor]);

    const setContent = useCallback((markdown: string): void => {
        if (!isEditorReady(editor)) return;
        skipNextUpdateRef.current = true;
        if (markdown) { editor.commands.setContent(markdownToHtml(markdown)); }
        else { editor.commands.clearContent(); }
    }, [editor]);

    return { editor, getMarkdown, getText, setContent, isEmpty: isEditorReady(editor) ? editor.isEmpty : true };
}
