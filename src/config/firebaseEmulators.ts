/**
 * Firebase emulator wiring for the Playwright E2E suite (checklist G12).
 *
 * Only Vite's `e2e` mode connects the emulators (`vite --mode e2e`). Production builds run in
 * `production` mode, so no env var or URL can point a real user's session at an emulator.
 */
import type { Auth } from 'firebase/auth';
import { connectAuthEmulator } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { connectFirestoreEmulator } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { connectStorageEmulator } from 'firebase/storage';
import type { Functions } from 'firebase/functions';
import { connectFunctionsEmulator } from 'firebase/functions';

export const EMULATOR_MODE = 'e2e';
const HOST = '127.0.0.1';

/** Must match the `emulators` block in firebase.json. */
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, storage: 9199, functions: 5001 } as const;

interface EmulatorServices {
    readonly auth: Auth;
    readonly db: Firestore;
    readonly storage: FirebaseStorage;
    readonly functions: Functions;
}

/** Connects every Firebase service to its local emulator when `mode` is `e2e`. */
export function connectEmulatorsIfE2e(mode: string, services: EmulatorServices): boolean {
    if (mode !== EMULATOR_MODE) return false;
    connectAuthEmulator(services.auth, `http://${HOST}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(services.db, HOST, EMULATOR_PORTS.firestore);
    connectStorageEmulator(services.storage, HOST, EMULATOR_PORTS.storage);
    connectFunctionsEmulator(services.functions, HOST, EMULATOR_PORTS.functions);
    return true;
}
