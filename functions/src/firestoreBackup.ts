/**
 * Scheduled Firestore Backup — runs daily at 02:00 UTC.
 * Exports the entire Firestore database to a dedicated Cloud Storage bucket.
 * The export path is dated so each day's backup is a separate, restorable snapshot.
 *
 * ─── Setup (one-time, idempotent) ────────────────────────────────────────────
 *
 * Run scripts/setup-immutable-backups.sh. It creates the retention-protected
 * bucket below and grants roles/datastore.importExportAdmin to the DEFAULT
 * COMPUTE service account — the identity this gen2 function runs as. (Granting
 * the role to the appspot account instead fails with 403 PERMISSION_DENIED.)
 *
 * The 30-day retention policy is left unlocked; locking is irreversible and
 * documented in docs/runbooks/FIRESTORE-RESTORE.md.
 *
 * Failures are surfaced by the "HIGH: Firestore Backup Failed" alert
 * (scripts/setup-monitoring-alerts.sh).
 *
 * ─── Restore ─────────────────────────────────────────────────────────────────
 *
 * See docs/runbooks/FIRESTORE-RESTORE.md. Drill into a scratch database first;
 * an import into "(default)" merges over live documents.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { GoogleAuth } from 'google-auth-library';

const PROJECT_ID = 'actionstation-244f0';
const DEFAULT_IMMUTABLE_BUCKET = `${PROJECT_ID}-firestore-backups-immutable`;
const BACKUP_BUCKET = `gs://${process.env.BACKUP_BUCKET_NAME ?? DEFAULT_IMMUTABLE_BUCKET}`;
const FIRESTORE_EXPORT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default):exportDocuments`;

export const firestoreBackup = onSchedule(
    {
        schedule: '0 2 * * *', // 02:00 UTC daily
        timeZone: 'UTC',
        minInstances: 0,
        timeoutSeconds: 540, // 9 min — exports can be slow for large datasets
    },
    async () => {
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const outputUriPrefix = `${BACKUP_BUCKET}/${date}`;

        logger.info(`Starting Firestore export to ${outputUriPrefix}`);

        try {
            const auth = new GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/cloud-platform'],
            });
            const client = await auth.getClient();
            const token = await client.getAccessToken();

            const response = await fetch(FIRESTORE_EXPORT_URL, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ outputUriPrefix }),
            });

            if (!response.ok) {
                const body = await response.text();
                throw new Error(`Export failed (${response.status}): ${body}`);
            }

            const operation = (await response.json()) as { name?: string };
            logger.info(`Firestore export operation started: ${operation.name}`);
            logger.info(`Backup path: ${outputUriPrefix}`);
        } catch (err) {
            logger.error('Firestore backup failed', err);
            throw err; // Re-throw so Cloud Scheduler marks the job as failed
        }
    },
);
