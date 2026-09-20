/**
 * Knowledge Bank Storage Service — Firebase Storage for file uploads
 */
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/config/firebase';
import { KB_MAX_FILE_SIZE, KB_ACCEPTED_MIME_TYPES } from '../types/knowledgeBank';
import { strings } from '@/shared/localization/strings';
import { sanitizeFilename } from '@/shared/utils/sanitize';
import { assertStorageWithinLimit } from '@/features/subscription/services/storageGuardService';
import { refreshStorageUsageAfterUpload } from '@/features/subscription/services/storageUsageRefresh';

export { sanitizeFilename };

/** Build storage path for a KB file */
function getStoragePath(
    userId: string, workspaceId: string, entryId: string, filename: string
): string {
    const safeName = sanitizeFilename(filename);
    return `users/${userId}/workspaces/${workspaceId}/knowledge-bank/${entryId}/${safeName}`;
}

/** Validate file before upload. overrideMimeType bypasses auto-detection for compressed blobs. */
function validateFile(file: File | Blob, overrideMimeType?: string): void {
    if (file.size > KB_MAX_FILE_SIZE) {
        throw new Error(strings.knowledgeBank.errors.fileTooLarge);
    }
    const mimeType = overrideMimeType ?? file.type;
    const isAccepted = KB_ACCEPTED_MIME_TYPES.some((t) => t === mimeType);
    if (!isAccepted) {
        throw new Error(strings.knowledgeBank.errors.unsupportedType);
    }
}

/** Upload file to Firebase Storage, return download URL */
export async function uploadKBFile(
    userId: string,
    workspaceId: string,
    entryId: string,
    file: File | Blob,
    filename: string,
    mimeType?: string
): Promise<string> {
    validateFile(file, mimeType);
    await assertStorageWithinLimit(userId, file.size);
    const storageRef = ref(storage, getStoragePath(userId, workspaceId, entryId, filename));
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await refreshStorageUsageAfterUpload(userId);

    return url;
}

/** Delete file from Firebase Storage */
export async function deleteKBFile(
    userId: string,
    workspaceId: string,
    entryId: string,
    filename: string
): Promise<void> {
    const storageRef = ref(storage, getStoragePath(userId, workspaceId, entryId, filename));
    try {
        await deleteObject(storageRef);
    } catch {
        // File may not exist — safe to ignore
    }
}
