/**
 * Callable: returns server-only GDPR export data (calendar + Storage inventory).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { loadGdprServerExportData } from './utils/gdprServerExportData.js';

export const gdprServerExport = onCall(
    { cors: ALLOWED_ORIGINS, enforceAppCheck: true },
    async (request) => {
        const uid = request.auth?.uid;
        if (!uid) {
            throw new HttpsError('unauthenticated', 'Authentication required.');
        }
        return loadGdprServerExportData(uid);
    },
);
