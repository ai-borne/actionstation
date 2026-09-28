/**
 * Image Insert Service — Progressive image insertion into TipTap editors
 * Pure functions (no React hooks) for focus restoration and image lifecycle
 */
import type { Editor } from '@tiptap/core';
import { strings } from '@/shared/localization/strings';
import { toast } from '@/shared/stores/toastStore';
import { isSafeImageSrc } from '../extensions/imageExtension';
import { sanitizeFilename } from '@/shared/utils/sanitize';
import { captureError } from '@/shared/services/sentryService';
import {
    replaceImageSrc as replaceImageSrcInDoc,
    removeImageBySrc as removeImageBySrcInDoc,
    createObjectPreviewUrl,
    revokeObjectPreviewUrl,
    type ImageDocView,
} from './imageNodeOps';

export type ImageUploadFn = (file: File) => Promise<string>;

export type AfterImageInsertFn = (file: File, permanentUrl: string) => void;

/** Adapt a TipTap Editor to the minimal {state, dispatch} shape imageNodeOps needs */
function docView(editor: Editor): ImageDocView {
    return { state: editor.state, dispatch: (tr) => editor.view.dispatch(tr) };
}

/**
 * Restore focus to the TipTap editor if it is blurred.
 * Places cursor at end so inserted content appends naturally.
 * No-op when the editor already has focus (preserves cursor position).
 */
export function ensureEditorFocus(editor: Editor | null): void {
    if (!editor || editor.isDestroyed) return;
    if (!editor.isFocused) {
        editor.commands.focus('end');
    }
}

/** Known localized error messages that should be shown as-is */
const KNOWN_ERROR_MESSAGES = new Set([
    strings.canvas.imageFileTooLarge,
    strings.canvas.imageUnsupportedType,
    strings.canvas.imageReadFailed,
]);

/** Extract a user-facing message from an upload error */
function getUploadErrorMessage(error: unknown): string {
    if (error instanceof Error && KNOWN_ERROR_MESSAGES.has(error.message)) {
        return error.message;
    }
    return strings.canvas.imageUploadFailed;
}

/**
 * Insert an image into the editor using progressive upload:
 * 1. Insert a local blob-URL preview immediately (never a `data:` URI — CSP img-src forbids it)
 * 2. Upload to permanent storage
 * 3. Replace the blob preview with the permanent URL and revoke it
 */
export async function insertImageIntoEditor(
    editor: Editor | null,
    file: File,
    uploadFn: ImageUploadFn,
    onAfterInsert?: AfterImageInsertFn,
): Promise<void> {
    if (!editor || editor.isDestroyed) return;

    ensureEditorFocus(editor);

    const previewUrl = createObjectPreviewUrl(file);
    editor.chain().focus().setImage({ src: previewUrl, alt: sanitizeFilename(file.name) }).run();

    try {
        toast.info(strings.canvas.imageUploading);
        const permanentUrl = await uploadFn(file);
        if (!isSafeImageSrc(permanentUrl)) {
            removeImageBySrcInDoc(docView(editor), previewUrl);
            revokeObjectPreviewUrl(previewUrl);
            toast.error(strings.canvas.imageUnsafeUrl);
            return;
        }
        replaceImageSrcInDoc(docView(editor), previewUrl, permanentUrl);
        revokeObjectPreviewUrl(previewUrl);
        try { onAfterInsert?.(file, permanentUrl); } catch (e: unknown) { captureError(e instanceof Error ? e : new Error(String(e))); }
    } catch (error: unknown) {
        removeImageBySrcInDoc(docView(editor), previewUrl);
        revokeObjectPreviewUrl(previewUrl);
        toast.error(getUploadErrorMessage(error));
    }
}
