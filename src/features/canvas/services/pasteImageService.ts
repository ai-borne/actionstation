/**
 * Paste Image Service — routes `data:` images embedded in rich-HTML pastes
 * (common when copying from web pages or Google Docs) through the same
 * upload-and-swap flow as a dropped/pasted file, so a `data:` URI never
 * needs to reach the DOM or Firestore. Reuses imageNodeOps (SSOT) for the
 * doc mutations and blob-preview lifecycle.
 */
import type { EditorView } from '@tiptap/pm/view';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { toast } from '@/shared/stores/toastStore';
import { strings } from '@/shared/localization/strings';
import { isSafeImageSrc } from '../extensions/imageExtension';
import {
    createObjectPreviewUrl,
    revokeObjectPreviewUrl,
    replaceImageSrc,
    removeImageBySrc,
    dataUrlToFile,
} from './imageNodeOps';
import type { ImageUploadFn, AfterImageInsertFn } from './imageInsertService';

interface PendingImage { file: File; previewUrl: string }

/**
 * Replace every `data:image/...` `<img src>` in `html` with a fresh blob-URL
 * preview, returning the doctored HTML plus the pending uploads. An `<img>`
 * with a malformed data URL is dropped rather than left unsafe.
 */
export function extractDataImagesForUpload(html: string): { html: string; pending: PendingImage[] } {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const pending: PendingImage[] = [];
    Array.from(doc.querySelectorAll('img')).forEach((img, i) => {
        const src = img.getAttribute('src') ?? '';
        if (!src.startsWith('data:image/')) return;
        const file = dataUrlToFile(src, `pasted-image-${i}.png`);
        if (!file) { img.remove(); return; }
        const previewUrl = createObjectPreviewUrl(file);
        img.setAttribute('src', previewUrl);
        pending.push({ file, previewUrl });
    });
    return { html: doc.body.innerHTML, pending };
}

/** Upload each pending image and swap its blob preview for the permanent URL (or remove it on failure) */
export function uploadPendingImages(
    view: EditorView,
    pending: readonly PendingImage[],
    uploadFn: ImageUploadFn,
    onAfterInsert?: AfterImageInsertFn,
): void {
    for (const { file, previewUrl } of pending) {
        uploadFn(file)
            .then((permanentUrl) => {
                if (!isSafeImageSrc(permanentUrl)) {
                    removeImageBySrc(view, previewUrl);
                    revokeObjectPreviewUrl(previewUrl);
                    toast.error(strings.canvas.imageUnsafeUrl);
                    return;
                }
                replaceImageSrc(view, previewUrl, permanentUrl);
                revokeObjectPreviewUrl(previewUrl);
                onAfterInsert?.(file, permanentUrl);
            })
            .catch(() => {
                removeImageBySrc(view, previewUrl);
                revokeObjectPreviewUrl(previewUrl);
                toast.error(strings.canvas.imageUploadFailed);
            });
    }
}

/**
 * Build a TipTap `editorProps.handlePaste` handler. Returns false (let the
 * default paste pipeline / transformPastedHTML run) whenever there is no
 * upload function configured or the clipboard HTML has no `data:` image to
 * intercept — so normal pastes are completely unaffected.
 */
export function createDataImagePasteHandler(
    sanitizeHtml: (html: string) => string,
    getUploadFn: () => ImageUploadFn | undefined,
    getOnAfterInsert: () => AfterImageInsertFn | undefined,
) {
    return (view: EditorView, event: ClipboardEvent): boolean => {
        const uploadFn = getUploadFn();
        if (!uploadFn) return false;

        const html = event.clipboardData?.getData('text/html');
        if (!html?.includes('data:image/')) return false;

        const { html: previewHtml, pending } = extractDataImagesForUpload(html);
        if (pending.length === 0) return false;

        const el = document.createElement('div');
        el.innerHTML = sanitizeHtml(previewHtml);
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(el);
        view.dispatch(view.state.tr.replaceSelection(slice));
        event.preventDefault();

        toast.info(strings.canvas.imageUploading);
        uploadPendingImages(view, pending, uploadFn, getOnAfterInsert());
        return true;
    };
}
