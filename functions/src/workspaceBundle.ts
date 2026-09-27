/**
 * Cloud Function: workspaceBundle
 * Generates a Firestore Bundle containing workspace list metadata for a user.
 * Clients call this to get a prepackaged, cacheable snapshot of workspace metadata.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { WORKSPACE_LIST_CAP } from './constants.js';
import { ALLOWED_ORIGINS } from './utils/corsConfig.js';
import { checkArcjetBrowser, arcjetKey } from './utils/arcjetClient.js';
import { logSecurityEvent, SecurityEventType } from './utils/securityLogger.js';
import { extractClientIp } from './utils/botDetector.js';

const WORKSPACE_LIST_QUERY = 'workspace-list';
const BUNDLE_MAX_AGE_S = 300;

export const workspaceBundle = onCall({ minInstances: 0, cors: ALLOWED_ORIGINS, enforceAppCheck: true, secrets: [arcjetKey] }, async (request) => {
    const waf = await checkArcjetBrowser(request.rawRequest);
    if (waf.blocked) {
        logSecurityEvent({
            type: SecurityEventType.WAF_BLOCKED,
            ip: extractClientIp(request.rawRequest),
            endpoint: 'workspaceBundle',
            message: `Arcjet blocked request (${waf.reason})`,
        });
        throw new HttpsError('permission-denied', 'Forbidden');
    }

    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const db = getFirestore();
    const workspacesRef = db.collection('users').doc(uid).collection('workspaces');
    const snapshot = await workspacesRef.limit(WORKSPACE_LIST_CAP).get();

    const bundle = db.bundle(`user-${uid}-workspaces`);
    bundle.add(WORKSPACE_LIST_QUERY, snapshot);

    const buffer = bundle.build();

    return {
        bundle: Buffer.from(buffer).toString('base64'),
        queryName: WORKSPACE_LIST_QUERY,
        maxAgeSeconds: BUNDLE_MAX_AGE_S,
        docCount: snapshot.size,
    };
});
