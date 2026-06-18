#!/usr/bin/env node
/**
 * One-time storage usage reconciliation — rebuild users/{uid}/usage/storage
 * from GCS object listings under users/{uid}/.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
 *   node scripts/reconcile-storage-usage.mjs [--dry-run] [--uid=USER_ID]
 *
 * Without --uid, reconciles all users found under the users/ prefix.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const BATCH_LIMIT = 450;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const uidArg = args.find((a) => a.startsWith('--uid='));
const singleUid = uidArg?.split('=')[1] ?? null;

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket();

function storagePathToDocId(filePath) {
    return Buffer.from(filePath, 'utf8').toString('base64url');
}

async function sumUserBytes(uid) {
    const prefix = `users/${uid}/`;
    const [files] = await bucket.getFiles({ prefix });
    let totalBytes = 0;
    const objects = [];

    for (const file of files) {
        const size = Number(file.metadata?.size ?? 0);
        if (!Number.isFinite(size) || size <= 0) continue;
        totalBytes += size;
        objects.push({ path: file.name, bytes: size });
    }

    return { totalBytes, objects };
}

async function commitBatches(writes) {
    for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of writes.slice(i, i + BATCH_LIMIT)) {
            op(batch);
        }
        await batch.commit();
    }
}

async function writeReconciledUsage(uid, totalBytes, objects) {
    if (dryRun) return;

    const writes = [
        (batch) => {
            batch.set(
                db.doc(`users/${uid}/usage/storage`),
                {
                    totalBytes,
                    updatedAt: FieldValue.serverTimestamp(),
                    reconciledAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        },
        ...objects.map((obj) => (batch) => {
            batch.set(
                db.doc(`users/${uid}/usage/storageObjects/${storagePathToDocId(obj.path)}`),
                {
                    bytes: obj.bytes,
                    path: obj.path,
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        }),
    ];

    await commitBatches(writes);
}

async function listUserIds() {
    if (singleUid) return [singleUid];

    const [, , apiResponse] = await bucket.getFiles({ prefix: 'users/', delimiter: '/' });
    const ids = new Set();
    for (const prefix of apiResponse?.prefixes ?? []) {
        const match = /^users\/([^/]+)\/$/.exec(prefix);
        if (match?.[1]) ids.add(match[1]);
    }
    return [...ids];
}

async function main() {
    const userIds = await listUserIds();
    if (userIds.length === 0) {
        console.log('No users found under users/ prefix.');
        return;
    }

    console.log(`Reconciling ${userIds.length} user(s)${dryRun ? ' (dry-run)' : ''}...`);

    for (const uid of userIds) {
        const { totalBytes, objects } = await sumUserBytes(uid);
        const usageSnap = await db.doc(`users/${uid}/usage/storage`).get();
        const previous = usageSnap.exists
            ? (usageSnap.data()?.totalBytes ?? 0)
            : 0;

        console.log(
            `  ${uid}: ${objects.length} objects, ${totalBytes} bytes (was ${previous})`,
        );

        await writeReconciledUsage(uid, totalBytes, objects);
    }

    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
