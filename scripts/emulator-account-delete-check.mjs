/**
 * Emulator integration check: onUserDeleted response matches actual Firestore/Storage cleanup.
 * Run via: npx firebase emulators:exec --only firestore,storage --project actionstation-244f0 "node scripts/emulator-account-delete-check.mjs"
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const functionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../functions');
const require = createRequire(path.join(functionsDir, 'package.json'));
const { initializeApp, getApps, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const PROJECT_ID = 'actionstation-244f0';
const BUCKET = `${PROJECT_ID}.appspot.com`;

process.env.STRIPE_SECRET_KEY ??= 'sk_test_emulator_fake';
process.env.RAZORPAY_KEY_ID ??= 'rzp_test_emulator_fake';
process.env.RAZORPAY_KEY_SECRET ??= 'emulator_fake_secret';

const { onUserDeleted } = await import(path.join(functionsDir, 'dist/onUserDeleted.js'));

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function initAdmin() {
    if (getApps().length > 0) return;
    initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET });
}

async function seedUserData(uid) {
    const db = getFirestore();
    await db.collection('users').doc(uid).collection('workspaces').doc('ws-emulator').set({
        id: 'ws-emulator',
        name: 'Emulator Test Workspace',
        nodeCount: 1,
    });
    await db.collection('users').doc(uid).collection('workspaces').doc('ws-emulator')
        .collection('nodes').doc('node-1').set({ id: 'node-1', type: 'idea' });

    const bucket = getStorage().bucket();
    await bucket.file(`users/${uid}/emulator-test.txt`).save('emulator payload', {
        metadata: { contentType: 'text/plain' },
    });
}

async function userDataExists(uid) {
    const db = getFirestore();
    const ws = await db.collection('users').doc(uid).collection('workspaces').doc('ws-emulator').get();
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
    return { firestore: ws.exists, storageCount: files.length };
}

async function callDelete(uid) {
    return onUserDeleted.run({ auth: { uid, token: {} }, data: undefined, rawRequest: {} });
}

async function testFullCleanup() {
    const uid = 'emu-delete-full';
    console.log('\n── Case 1: full cleanup (free user, Firestore + Storage) ──');
    await seedUserData(uid);

    const before = await userDataExists(uid);
    assert(before.firestore && before.storageCount > 0, 'seed data missing before delete');

    const result = await callDelete(uid);
    console.log('Response:', result);

    const after = await userDataExists(uid);
    assert(result.success === true, `expected success=true, got ${JSON.stringify(result)}`);
    assert(result.firestoreOk === true, 'firestoreOk should be true');
    assert(result.storageOk === true, 'storageOk should be true');
    assert(result.subscriptionCancelled === true, 'subscriptionCancelled should be true (no active sub)');
    assert(!after.firestore && after.storageCount === 0, `data still present after delete: ${JSON.stringify(after)}`);
    console.log('✓ Response matches actual cleanup');
}

async function testSubscriptionCancelAbortsDataDelete() {
    const uid = 'emu-delete-partial-sub';
    console.log('\n── Case 2: subscription cancel fails — data delete aborted ──');
    await seedUserData(uid);

    const db = getFirestore();
    await db.doc(`users/${uid}/subscription/current`).set({
        tier: 'pro',
        isActive: true,
        provider: 'stripe',
        gatewaySubscriptionId: 'sub_emulator_invalid',
    });

    const result = await callDelete(uid);
    console.log('Response:', result);

    const after = await userDataExists(uid);
    assert(result.success === false, `expected success=false, got ${JSON.stringify(result)}`);
    assert(result.firestoreOk === false, 'firestoreOk should be false (aborted)');
    assert(result.storageOk === false, 'storageOk should be false (aborted)');
    assert(result.subscriptionCancelled === false, 'subscriptionCancelled should be false when Stripe cancel fails');
    assert(after.firestore && after.storageCount > 0, `Firestore/Storage must remain when sub cancel fails: ${JSON.stringify(after)}`);
    console.log('✓ Data preserved when subscription cancel fails — safe to retry');
}

async function main() {
    console.log('Firebase emulators:', {
        firestore: process.env.FIRESTORE_EMULATOR_HOST ?? '(not set)',
        storage: process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '(not set)',
    });

    initAdmin();
    try {
        await testFullCleanup();
        await testSubscriptionCancelAbortsDataDelete();
        console.log('\n✅ All emulator account-delete checks passed\n');
    } finally {
        for (const app of getApps()) {
            await deleteApp(app);
        }
    }
}

main().catch((err) => {
    console.error('\n❌ Emulator account-delete check failed:', err);
    process.exit(1);
});
