/**
 * Knowledge Bank Service — Firestore persistence
 * Handles CRUD operations for KB entries in a workspace subcollection
 */
import {
    doc, setDoc, getDocs, deleteDoc, collection, serverTimestamp,
    getCountFromServer, query, where, writeBatch, limit,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { KB_ENTRIES_CAP } from '@/config/firestoreQueryConfig';
import { logger } from '@/shared/services/logger';
import type { KnowledgeBankEntry, KnowledgeBankEntryInput } from '../types/knowledgeBank';
import {
    KB_MAX_DOCUMENTS, KB_MAX_CONTENT_SIZE,
    KB_MAX_TAGS_PER_ENTRY, KB_MAX_TAG_LENGTH, KB_MAX_TITLE_LENGTH,
} from '../types/knowledgeBank';
import { strings } from '@/shared/localization/strings';
import { sanitizeContent } from '../utils/sanitizer';

// ── Tag Sanitization ───────────────────────────────────

/** Sanitize, validate, and deduplicate an array of tags */
function sanitizeTags(tags: string[] | undefined): string[] | undefined {
    if (!tags) return undefined;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of tags) {
        const tag = sanitizeContent(raw.trim().toLowerCase()).slice(0, KB_MAX_TAG_LENGTH);
        if (tag.length > 0 && !seen.has(tag) && result.length < KB_MAX_TAGS_PER_ENTRY) {
            seen.add(tag);
            result.push(tag);
        }
    }
    return result;
}

// ── Firestore Paths ────────────────────────────────────

const getKBCollectionRef = (userId: string, workspaceId: string) =>
    collection(db, 'users', userId, 'workspaces', workspaceId, 'knowledgeBank');

const getKBDocRef = (userId: string, workspaceId: string, entryId: string) =>
    doc(db, 'users', userId, 'workspaces', workspaceId, 'knowledgeBank', entryId);

// ── Validation ─────────────────────────────────────────

function validateEntry(input: Readonly<KnowledgeBankEntryInput>): void {
    if (!input.title.trim()) {
        throw new Error(strings.knowledgeBank.errors.titleRequired);
    }
    if (input.content.length > KB_MAX_CONTENT_SIZE) {
        throw new Error(strings.knowledgeBank.errors.contentTooLarge);
    }
}

// ── Server-Side Count ───────────────────────────────────

/**
 * @deprecated Use getServerDocumentCount instead — entry count includes chunks,
 * document count excludes them. Kept only for backward compat with tests.
 */
export async function getServerEntryCount(
    userId: string,
    workspaceId: string
): Promise<number> {
    const colRef = getKBCollectionRef(userId, workspaceId);
    const snapshot = await getCountFromServer(colRef);
    return snapshot.data().count;
}

/** Get document count (entries without parentEntryId) from Firestore server */
export async function getServerDocumentCount(
    userId: string,
    workspaceId: string
): Promise<number> {
    const colRef = getKBCollectionRef(userId, workspaceId);
    const q = query(colRef, where('parentEntryId', '==', null));
    const snapshot = await getCountFromServer(q);
    return snapshot.data().count;
}

/** Update multiple entries atomically via Firestore writeBatch */
export async function updateKBEntryBatch(
    userId: string,
    workspaceId: string,
    updates: Array<{ entryId: string; enabled: boolean }>
): Promise<void> {
    const batch = writeBatch(db);
    for (const { entryId, enabled } of updates) {
        batch.set(
            getKBDocRef(userId, workspaceId, entryId),
            { enabled, updatedAt: serverTimestamp() },
            { merge: true }
        );
    }
    await batch.commit();
}

/** Delete multiple entries atomically via Firestore writeBatch */
export async function deleteKBEntryBatch(
    userId: string,
    workspaceId: string,
    entryIds: string[]
): Promise<void> {
    const batch = writeBatch(db);
    for (const entryId of entryIds) {
        batch.delete(getKBDocRef(userId, workspaceId, entryId));
    }
    await batch.commit();
}

// ── CRUD Operations ────────────────────────────────────

/** Add a new entry to the Knowledge Bank */
export async function addKBEntry(
    userId: string,
    workspaceId: string,
    input: KnowledgeBankEntryInput,
    preGeneratedId?: string,
    currentCount?: number
): Promise<KnowledgeBankEntry> {
    validateEntry(input);

    // Chunk children bypass the document limit
    if (!input.parentEntryId) {
        const count = currentCount ?? await getServerDocumentCount(userId, workspaceId);
        if (count >= KB_MAX_DOCUMENTS) {
            throw new Error(strings.knowledgeBank.errors.maxEntries);
        }
    }

    const entryId = preGeneratedId ?? `kb-${crypto.randomUUID()}`;
    const now = new Date();

    const entry: KnowledgeBankEntry = {
        id: entryId,
        workspaceId,
        type: input.type,
        title: sanitizeContent(input.title.trim().slice(0, KB_MAX_TITLE_LENGTH)),
        content: sanitizeContent(input.content),
        tags: sanitizeTags(input.tags),
        originalFileName: input.originalFileName,
        storedFileName: input.storedFileName,
        storageUrl: input.storageUrl,
        mimeType: input.mimeType,
        parentEntryId: input.parentEntryId ?? null,
        pinned: false,
        enabled: true,
        createdAt: now,
        updatedAt: now,
    };

    // Strip undefined fields — Firestore rejects undefined values
    const firestoreData = Object.fromEntries(
        Object.entries(entry).filter(([, v]) => v !== undefined)
    );
    await setDoc(getKBDocRef(userId, workspaceId, entryId), {
        ...firestoreData,
        updatedAt: serverTimestamp(),
    });

    return entry;
}

/** Update an existing entry */
export async function updateKBEntry(
    userId: string,
    workspaceId: string,
    entryId: string,
    updates: Partial<Pick<KnowledgeBankEntry, 'title' | 'content' | 'enabled' | 'summary' | 'tags' | 'pinned' | 'documentSummaryStatus'>>
): Promise<void> {
    if (updates.title !== undefined && !updates.title.trim()) {
        throw new Error(strings.knowledgeBank.errors.titleRequired);
    }
    if (updates.content !== undefined && updates.content.length > KB_MAX_CONTENT_SIZE) {
        throw new Error(strings.knowledgeBank.errors.contentTooLarge);
    }

    const sanitizedUpdates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) sanitizedUpdates.title = sanitizeContent(updates.title.trim());
    if (updates.content !== undefined) sanitizedUpdates.content = sanitizeContent(updates.content);
    if (updates.enabled !== undefined) sanitizedUpdates.enabled = updates.enabled;
    if (updates.summary !== undefined) sanitizedUpdates.summary = sanitizeContent(updates.summary);
    if (updates.tags !== undefined) sanitizedUpdates.tags = sanitizeTags(updates.tags);
    if (updates.pinned !== undefined) sanitizedUpdates.pinned = updates.pinned;
    if (updates.documentSummaryStatus !== undefined) {
        sanitizedUpdates.documentSummaryStatus = updates.documentSummaryStatus;
    }

    await setDoc(getKBDocRef(userId, workspaceId, entryId), sanitizedUpdates, { merge: true });
}

/** Delete an entry */
export async function deleteKBEntry(
    userId: string,
    workspaceId: string,
    entryId: string
): Promise<void> {
    await deleteDoc(getKBDocRef(userId, workspaceId, entryId));
}

/** Load all entries for a workspace */
export async function loadKBEntries(
    userId: string,
    workspaceId: string
): Promise<KnowledgeBankEntry[]> {
    const q = query(getKBCollectionRef(userId, workspaceId), limit(KB_ENTRIES_CAP));
    const snapshot = await getDocs(q);
    if (snapshot.size >= KB_ENTRIES_CAP) {
        logger.warn('[knowledgeBankService] KB entries cap reached', { cap: KB_ENTRIES_CAP, workspaceId });
    }
    return snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Firestore DocumentData */
        return {
            id: docSnapshot.id,
            workspaceId,
            type: data.type,
            title: data.title,
            content: data.content,
            summary: data.summary,
            tags: data.tags,
            originalFileName: data.originalFileName,
            storedFileName: data.storedFileName,
            storageUrl: data.storageUrl,
            mimeType: data.mimeType,
            parentEntryId: data.parentEntryId ?? null,
            documentSummaryStatus: data.documentSummaryStatus,
            pinned: data.pinned ?? false,
            enabled: data.enabled ?? true,
            createdAt: data.createdAt?.toDate?.() ?? new Date(),
            updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
        } as KnowledgeBankEntry;
        /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
    });
}

/** Delete ALL entries for a workspace (used on workspace deletion) */
export async function deleteAllKBEntries(
    userId: string,
    workspaceId: string
): Promise<void> {
    const colRef = getKBCollectionRef(userId, workspaceId);
    const { FIRESTORE_BATCH_DELETE_CAP } = await import('@/config/firestoreQueryConfig');
    let snapshot = await getDocs(query(colRef, limit(FIRESTORE_BATCH_DELETE_CAP)));
    while (snapshot.size > 0) {
        const batch = writeBatch(db);
        for (const d of snapshot.docs) {
            const data = d.data();
            const fileName = (data.storedFileName ?? data.originalFileName) as string | undefined;
            if (fileName && data.type === 'image') {
                const { deleteKBFile } = await import('./storageService');
                await deleteKBFile(userId, workspaceId, d.id, fileName);
            }
            batch.delete(d.ref);
        }
        await batch.commit();
        if (snapshot.size < FIRESTORE_BATCH_DELETE_CAP) break;
        snapshot = await getDocs(query(colRef, limit(FIRESTORE_BATCH_DELETE_CAP)));
    }
}
