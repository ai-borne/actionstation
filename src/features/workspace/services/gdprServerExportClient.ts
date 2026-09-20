/**
 * Client fetcher for server-only GDPR export fields.
 */
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface GdprCalendarExport {
    readonly connected: boolean;
    readonly connectedAt: string | null;
    readonly scope: string | null;
}

export interface GdprStorageFileExport {
    readonly path: string;
    readonly sizeBytes: number;
    readonly contentType: string | null;
    readonly updatedAt: string | null;
}

export interface GdprServerExportData {
    readonly calendar: GdprCalendarExport;
    readonly storageFiles: readonly GdprStorageFileExport[];
}

export async function fetchGdprServerExportData(): Promise<GdprServerExportData> {
    const fn = httpsCallable<undefined, GdprServerExportData>(getFunctions(), 'gdprServerExport');
    const result = await fn();
    return result.data;
}
