/**
 * Image Node Ops — Shared ProseMirror doc-mutation and blob/data-URL helpers.
 * Single source used by both the file-drop/paste-file flow (imageInsertService)
 * and the rich-HTML-paste flow (pasteImageService) so there is one place that
 * knows how to swap an image node's src or decode a data: URL.
 */
import type { EditorView } from '@tiptap/pm/view';
import { logger } from '@/shared/services/logger';

/** Minimal shape both TipTap's Editor.view and a raw ProseMirror EditorView satisfy */
export type ImageDocView = Pick<EditorView, 'state' | 'dispatch'>;

/** Replace the src of every image node matching oldSrc with newSrc */
export function replaceImageSrc(view: ImageDocView, oldSrc: string, newSrc: string): void {
    const { doc, tr } = view.state;
    doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === oldSrc) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: newSrc });
        }
    });
    view.dispatch(tr);
}

/**
 * Remove image nodes matching the given src (cleanup on upload failure).
 * Collects positions first, then deletes bottom-to-top to avoid position shift.
 */
export function removeImageBySrc(view: ImageDocView, src: string): void {
    const { doc, tr } = view.state;
    const positions: Array<{ pos: number; size: number }> = [];
    doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === src) {
            positions.push({ pos, size: node.nodeSize });
        }
    });
    for (const { pos, size } of positions.reverse()) {
        tr.delete(pos, pos + size);
    }
    view.dispatch(tr);
}

/** Create a temporary object-URL preview for a file/blob (revoke with revokeObjectPreviewUrl) */
export function createObjectPreviewUrl(file: Blob): string {
    return URL.createObjectURL(file);
}

/** Revoke a previously created object-URL preview */
export function revokeObjectPreviewUrl(url: string): void {
    URL.revokeObjectURL(url);
}

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/;

/** Decode a `data:<mime>;base64,<payload>` URL into a Blob (sync, no network). Null if malformed. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) return null;
    const [, mime, base64] = match;
    if (mime === undefined || base64 === undefined) return null;
    let binary: string;
    try {
        binary = atob(base64);
    } catch (e: unknown) {
        logger.warn('Malformed base64 in data: URL', e);
        return null;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

/** Decode a `data:image/...;base64,...` URL into a File, or null if malformed */
export function dataUrlToFile(dataUrl: string, filename: string): File | null {
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;
    return new File([blob], filename, { type: blob.type });
}
