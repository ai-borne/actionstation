/**
 * Document Upload Service — Validates, uploads documents + artifacts to Firebase Storage
 * Mirrors imageUploadService patterns (DRY). Uploads three artifacts:
 *   1. Raw document file
 *   2. Thumbnail image (PDF only)
 *   3. Parsed text as .txt file (for AI consumption)
 */
import { ref, uploadBytes, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/config/firebase';
import { sanitizeFilename } from '@/shared/utils/sanitize';
import { strings } from '@/shared/localization/strings';
import {
    isAcceptedDocumentType,
    validateMagicBytes,
    DOCUMENT_MAX_FILE_SIZE,
    type AttachmentMeta,
} from '../types/document';
import { attachmentTextCache } from '@/features/ai/services/attachmentTextCache';
import { storagePathFromDownloadUrl } from './storagePathUtils';
import { assertStorageWithinLimit } from '@/features/subscription/services/storageGuardService';
import { refreshStorageUsageAfterUpload } from '@/features/subscription/services/storageUsageRefresh';

/** URLs returned after a successful document upload */
export interface DocumentUploadResult {
    /** Download URL for the raw document */
    documentUrl: string;
    /** Download URL for the thumbnail image (PDF only) */
    thumbnailUrl?: string;
    /** Download URL for the extracted plain-text file */
    parsedTextUrl?: string;
}

/**
 * Validate a document file before upload.
 * Checks size, MIME type, and magic bytes (anti-spoofing).
 * Throws localized error on failure.
 */
export async function validateDocumentFile(file: File): Promise<void> {
    if (file.size > DOCUMENT_MAX_FILE_SIZE) {
        throw new Error(strings.canvas.docFileTooLarge);
    }
    if (!isAcceptedDocumentType(file.type)) {
        throw new Error(strings.canvas.docUnsupportedType);
    }
    const magicValid = await validateMagicBytes(file);
    if (!magicValid) {
        throw new Error(strings.canvas.docMagicByteMismatch);
    }
}

/** Build the Firebase Storage path for a node attachment */
export function buildAttachmentPath(
    userId: string,
    workspaceId: string,
    nodeId: string,
    filename: string,
): string {
    const safeName = sanitizeFilename(filename);
    return `users/${userId}/workspaces/${workspaceId}/nodes/${nodeId}/attachments/${safeName}`;
}

/**
 * Upload a document and its artifacts to Firebase Storage.
 * @param userId - Authenticated user ID
 * @param workspaceId - Current workspace ID
 * @param nodeId - Target node ID
 * @param file - Original document file
 * @param parsedText - Extracted plain text (for AI consumption)
 * @param thumbnailBlob - Optional thumbnail image blob (PDF first page)
 * @returns URLs for all uploaded artifacts
 */
export async function uploadDocumentArtifacts(
    userId: string,
    workspaceId: string,
    nodeId: string,
    file: File,
    parsedText: string,
    thumbnailBlob?: Blob,
): Promise<DocumentUploadResult> {
    const basePath = buildAttachmentPath(userId, workspaceId, nodeId, file.name);
    const textBytes = new TextEncoder().encode(parsedText).length;
    const thumbBytes = thumbnailBlob?.size ?? 0;
    await assertStorageWithinLimit(userId, file.size + textBytes + thumbBytes);

    // 1. Upload the raw document
    const docRef = ref(storage, basePath);
    await uploadBytes(docRef, file);
    const documentUrl = await getDownloadURL(docRef);

    const result: DocumentUploadResult = { documentUrl };

    // 2. Upload parsed text as .txt sidecar (contentType must match storage.rules)
    if (parsedText.length > 0) {
        const txtPath = `${basePath}.parsed.txt`;
        const txtRef = ref(storage, txtPath);
        await uploadString(txtRef, parsedText, 'raw', { contentType: 'text/plain' });
        result.parsedTextUrl = await getDownloadURL(txtRef);
    }

    // 3. Upload thumbnail image (PDF only)
    if (thumbnailBlob) {
        const thumbPath = `${basePath}.thumb.png`;
        const thumbRef = ref(storage, thumbPath);
        await uploadBytes(thumbRef, thumbnailBlob);
        result.thumbnailUrl = await getDownloadURL(thumbRef);
    }

    await refreshStorageUsageAfterUpload(userId);
    return result;
}

/**
 * Delete all Storage artifacts for a list of attachments and invalidate the
 * attachment text LRU cache. Individual Storage failures are suppressed to
 * avoid blocking node deletion when a file is already missing.
 *
 * @param attachments - Attachment metadata array from IdeaNodeData.attachments
 */
export async function deleteNodeAttachments(attachments: AttachmentMeta[]): Promise<void> {
    // Invalidate cached text before deleting so stale content is never served
    attachments.forEach((att) => {
        if (att.parsedTextUrl) attachmentTextCache.invalidate(att.parsedTextUrl);
    });

    const urls = attachments.flatMap((att) => [att.url, att.thumbnailUrl, att.parsedTextUrl])
        .filter((u): u is string => Boolean(u));

    await Promise.allSettled(
        urls.map((url) => {
            const path = storagePathFromDownloadUrl(url);
            if (!path) return Promise.resolve();
            return deleteObject(ref(storage, path));
        })
    );
}

/** Convert a base64 data URL to a Blob for upload */
export function dataUrlToBlob(dataUrl: string): Blob {
    const commaIdx = dataUrl.indexOf(',');
    const header = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : '';
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const mimeMatch = /:([^;]+);/.exec(header);
    const mime = mimeMatch?.[1] ?? 'image/png';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}
