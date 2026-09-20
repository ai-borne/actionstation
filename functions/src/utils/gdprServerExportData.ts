/**
 * Server-side GDPR export helpers — calendar metadata + Storage inventory.
 * Never exposes OAuth tokens or signed download URLs.
 */
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export interface GdprCalendarExport {
    connected: boolean;
    connectedAt: string | null;
    scope: string | null;
}

export interface GdprStorageFileExport {
    path: string;
    sizeBytes: number;
    contentType: string | null;
    updatedAt: string | null;
}

export interface GdprServerExportData {
    calendar: GdprCalendarExport;
    storageFiles: readonly GdprStorageFileExport[];
}

function toIso(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const ts = value as { toDate?: () => Date };
    return ts.toDate?.()?.toISOString() ?? null;
}

export async function loadGdprServerExportData(uid: string): Promise<GdprServerExportData> {
    const [calendarSnap, storageFiles] = await Promise.all([
        loadCalendarExport(uid),
        listUserStorageFiles(uid),
    ]);
    return { calendar: calendarSnap, storageFiles };
}

async function loadCalendarExport(uid: string): Promise<GdprCalendarExport> {
    const snap = await getFirestore()
        .collection('users').doc(uid)
        .collection('integrations').doc('calendar')
        .get();

    if (!snap.exists) {
        return { connected: false, connectedAt: null, scope: null };
    }

    const data = snap.data() as { connectedAt?: unknown; scope?: string };
    return {
        connected: true,
        connectedAt: toIso(data.connectedAt),
        scope: data.scope ?? null,
    };
}

async function listUserStorageFiles(uid: string): Promise<readonly GdprStorageFileExport[]> {
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
    return files.map((file) => ({
        path: file.name,
        sizeBytes: Number(file.metadata.size ?? 0),
        contentType: file.metadata.contentType ?? null,
        updatedAt: file.metadata.updated ?? null,
    }));
}
