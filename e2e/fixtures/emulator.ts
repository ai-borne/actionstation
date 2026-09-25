import type { APIRequestContext } from '@playwright/test';

const PROJECT_ID = 'demo-actionstation';
const AUTH_URL = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`;
const FIRESTORE_URL = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/** Deletes every emulator account and Firestore document so each test starts from a blank slate. */
export async function resetEmulators(request: APIRequestContext): Promise<void> {
    await request.delete(AUTH_URL);
    await request.delete(FIRESTORE_URL);
}

const DOCUMENTS_URL = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const RUN_QUERY_URL = `${DOCUMENTS_URL}:runQuery`;

/**
 * Returns every persisted card document (any workspace, any tile) as one JSON string, read
 * straight from the Firestore emulator. Lets a test prove a save reached the database, not
 * just the browser cache. The `owner` token bypasses security rules on the emulator.
 */
export async function readPersistedNodes(request: APIRequestContext): Promise<string> {
    const response = await request.post(RUN_QUERY_URL, {
        headers: { Authorization: 'Bearer owner' },
        data: { structuredQuery: { from: [{ collectionId: 'nodes', allDescendants: true }] } },
    });
    return JSON.stringify(await response.json());
}

const ACCOUNTS_QUERY_URL = `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`;
const OWNER = { Authorization: 'Bearer owner' } as const;

type FieldValue = string | number | boolean;

function toFirestoreFields(data: Readonly<Record<string, FieldValue>>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') fields[key] = { stringValue: value };
        else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
        else fields[key] = { integerValue: String(value) };
    }
    return fields;
}

/** The uid of the single account the sign-in flow created in the Auth emulator. */
export async function getEmulatorUserId(request: APIRequestContext): Promise<string> {
    const response = await request.post(ACCOUNTS_QUERY_URL, { headers: OWNER, data: {} });
    const body = (await response.json()) as { userInfo?: ReadonlyArray<{ localId: string }> };
    const uid = body.userInfo?.[0]?.localId;
    if (!uid) throw new Error('No account exists in the Auth emulator yet');
    return uid;
}

/** Writes a document straight into the Firestore emulator, bypassing security rules. */
export async function seedDocument(
    request: APIRequestContext,
    path: string,
    data: Readonly<Record<string, FieldValue>>,
): Promise<void> {
    const response = await request.patch(`${DOCUMENTS_URL}/${path}`, {
        headers: OWNER,
        data: { fields: toFirestoreFields(data) },
    });
    if (!response.ok()) throw new Error(`Seeding ${path} failed: ${response.status()} ${await response.text()}`);
}

/** How many card documents are persisted. Counts the database, because the canvas only renders visible cards. */
export async function countPersistedNodes(request: APIRequestContext): Promise<number> {
    const body = JSON.parse(await readPersistedNodes(request)) as ReadonlyArray<{ document?: unknown }>;
    return body.filter((row) => row.document !== undefined).length;
}
