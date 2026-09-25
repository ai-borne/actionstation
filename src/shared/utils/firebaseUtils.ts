/**
 * Firebase/Firestore utilities shared across the application.
 */
import type { CollectionReference, DocumentReference } from 'firebase/firestore';
import { getDocs, writeBatch, query, limit } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { FIRESTORE_BATCH_DELETE_CAP } from '@/config/firestoreQueryConfig';

/** Firestore error codes that must NOT be retried — fail fast for security. */
const NON_RETRYABLE_CODES = new Set(['permission-denied', 'unauthenticated']);

/** Firestore / network error codes considered transient and safe to retry. */
const TRANSIENT_CODES = new Set(['unavailable', 'deadline-exceeded', 'internal', 'resource-exhausted']);

interface RetryOptions {
    /** Maximum number of additional attempts after the first failure. Default: 3. */
    maxRetries?: number;
    /** Base delay in ms; doubled on each retry (exponential backoff). Default: 1000. */
    baseDelayMs?: number;
}

/**
 * Wraps an async operation with exponential-backoff retry for transient Firestore /
 * network errors. Auth errors (PERMISSION_DENIED, UNAUTHENTICATED) are never retried.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
    const maxRetries = opts.maxRetries ?? 3;
    const baseDelayMs = opts.baseDelayMs ?? 1000;
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        } catch (err: unknown) {
            const code = (err as Record<string, unknown>).code;
            const isNonRetryable =
                typeof code === 'string' && NON_RETRYABLE_CODES.has(code);
            if (isNonRetryable || attempt >= maxRetries) throw err;

            const isTransient =
                (typeof code === 'string' && TRANSIENT_CODES.has(code)) ||
                typeof code !== 'string'; // plain network/JS errors have no Firestore code
            if (!isTransient) throw err;

            const delay = baseDelayMs * Math.pow(2, attempt);
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
            attempt++;
        }
    }
}

/** True for `{}` literals and `Object.create(null)`; false for class instances (Firestore values, Dates). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const proto = Object.getPrototypeOf(value) as unknown;
    return proto === Object.prototype || proto === null;
}

/**
 * Recursively removes undefined values from objects for Firestore compatibility.
 * Firebase rejects undefined at ANY depth.
 * Recurses into plain objects only. Arrays, Dates and Firestore value classes
 * (serverTimestamp(), Timestamp, GeoPoint, deleteField()...) pass through by
 * reference: copying them into a plain object stores a map instead of the value.
 */
export function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
    return Object.fromEntries(
        Object.entries(obj)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, isPlainObject(v) ? removeUndefined(v) : v])
    ) as T;
}

/** Delete all documents in a collection using capped batch iterations */
export async function batchDeleteCollection(colRef: CollectionReference): Promise<void> {
    let snapshot = await getDocs(query(colRef, limit(FIRESTORE_BATCH_DELETE_CAP)));
    while (snapshot.size > 0) {
        const batch = writeBatch(db);
        snapshot.docs.forEach((d) => batch.delete(d.ref));
        await withRetry(() => batch.commit());
        if (snapshot.size < FIRESTORE_BATCH_DELETE_CAP) break;
        snapshot = await getDocs(query(colRef, limit(FIRESTORE_BATCH_DELETE_CAP)));
    }
}

type BatchOp =
    | { type: 'set'; ref: DocumentReference; data: Record<string, unknown> }
    | { type: 'delete'; ref: DocumentReference };

/**
 * Execute an array of write operations in chunked batches of 500.
 * Safe for any number of operations (Firestore limit: 500 per batch).
 */
export async function chunkedBatchWrite(ops: BatchOp[]): Promise<void> {
    const CHUNK = FIRESTORE_BATCH_DELETE_CAP;
    for (let i = 0; i < ops.length; i += CHUNK) {
        const chunk = ops.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        for (const op of chunk) {
            if (op.type === 'set') batch.set(op.ref, op.data);
            else batch.delete(op.ref);
        }
        await withRetry(() => batch.commit());
    }
}
