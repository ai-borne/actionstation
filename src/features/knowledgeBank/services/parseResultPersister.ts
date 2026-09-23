/**
 * ParseResult Persister — Saves a ParseResult as KB entry/entries
 * Handles: image upload, document chunking (parent + children)
 * Single responsibility: ParseResult → KnowledgeBankEntry[]
 *
 * Document count is validated server-side via getServerDocumentCount before
 * persisting. Child chunks bypass the document limit check.
 */
import type { ParseResult } from '../parsers/types';
import type { KnowledgeBankEntry } from '../types/knowledgeBank';

/** Generate a unique KB entry ID */
function generateEntryId(): string {
    return `kb-${crypto.randomUUID()}`;
}

/** Persist a ParseResult to Firestore (and Firebase Storage if needed) */
export async function persistParseResult(
    userId: string,
    workspaceId: string,
    result: ParseResult,
): Promise<KnowledgeBankEntry[]> {
    const { getServerDocumentCount } = await import('./knowledgeBankService');
    const serverCount = await getServerDocumentCount(userId, workspaceId);

    // Chunked documents: persist parent + children
    if (result.chunks && result.chunks.length > 0) {
        return persistChunkedDocument(userId, workspaceId, result, serverCount);
    }

    // Single entry (text, image, small document)
    const entry = await persistSingleResult(userId, workspaceId, result, serverCount);
    return [entry];
}

/** Persist a single (non-chunked) ParseResult */
async function persistSingleResult(
    userId: string,
    workspaceId: string,
    result: ParseResult,
    currentEntryCount: number
): Promise<KnowledgeBankEntry> {
    const { addKBEntry } = await import('./knowledgeBankService');
    const count = currentEntryCount;
    let storageUrl: string | undefined;
    let storedFileName: string | undefined;
    let entryId: string | undefined;

    if (result.metadata?.requiresUpload === true && result.blob) {
        entryId = generateEntryId();
        storedFileName = `${result.title}.jpg`;
        const { uploadKBFile } = await import('./storageService');
        storageUrl = await uploadKBFile(
            userId, workspaceId, entryId, result.blob, storedFileName, 'image/jpeg'
        );
    }

    const entryType = resolveEntryType(result);

    return addKBEntry(userId, workspaceId, {
        type: entryType,
        title: result.title,
        content: result.content,
        originalFileName: result.originalFileName,
        storedFileName,
        storageUrl,
        mimeType: result.mimeType,
    }, entryId, count);
}

/** Persist a chunked document as parent entry + child entries */
async function persistChunkedDocument(
    userId: string,
    workspaceId: string,
    result: ParseResult,
    currentEntryCount: number
): Promise<KnowledgeBankEntry[]> {
    const { addKBEntry } = await import('./knowledgeBankService');
    const chunks = result.chunks ?? [];
    const entries: KnowledgeBankEntry[] = [];
    const [firstChunk, ...remainingChunks] = chunks;
    if (!firstChunk) return entries;

    // Parent entry: first chunk's content, linked by children
    const count = currentEntryCount;
    const parentEntry = await addKBEntry(userId, workspaceId, {
        type: 'document',
        title: firstChunk.title,
        content: firstChunk.content,
        originalFileName: result.originalFileName,
        mimeType: result.mimeType,
    }, undefined, count);
    entries.push(parentEntry);

    // Child entries: remaining chunks linked to parent
    for (const chunk of remainingChunks) {
        const childCount = count + entries.length;
        const childEntry = await addKBEntry(userId, workspaceId, {
            type: 'document',
            title: chunk.title,
            content: chunk.content,
            originalFileName: result.originalFileName,
            mimeType: result.mimeType,
            parentEntryId: parentEntry.id,
        }, undefined, childCount);
        entries.push(childEntry);
    }

    return entries;
}

/** MIME types that resolve to 'document' entry type */
const DOCUMENT_MIME_TYPES = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Resolve the KB entry type from a ParseResult */
function resolveEntryType(result: ParseResult): 'text' | 'image' | 'document' {
    if (result.metadata?.requiresUpload === true) return 'image';
    if (DOCUMENT_MIME_TYPES.has(result.mimeType)) return 'document';
    return 'text';
}
