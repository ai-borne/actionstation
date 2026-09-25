import { describe, it, expect, vi } from 'vitest';

import { connectAuthEmulator } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectStorageEmulator } from 'firebase/storage';
import { connectFunctionsEmulator } from 'firebase/functions';
import { EMULATOR_MODE, EMULATOR_PORTS, connectEmulatorsIfE2e } from '../firebaseEmulators';

vi.mock('firebase/auth', () => ({ connectAuthEmulator: vi.fn() }));
vi.mock('firebase/firestore', () => ({ connectFirestoreEmulator: vi.fn() }));
vi.mock('firebase/storage', () => ({ connectStorageEmulator: vi.fn() }));
vi.mock('firebase/functions', () => ({ connectFunctionsEmulator: vi.fn() }));

const services = {
    auth: { name: 'auth' },
    db: { name: 'db' },
    storage: { name: 'storage' },
    functions: { name: 'functions' },
} as never;

describe('connectEmulatorsIfE2e', () => {
    it('does nothing outside the e2e mode (production and development builds)', () => {
        for (const mode of ['production', 'development', 'preview', 'test']) {
            expect(connectEmulatorsIfE2e(mode, services)).toBe(false);
        }
        expect(connectAuthEmulator).not.toHaveBeenCalled();
        expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    });

    it('connects auth, firestore, storage and functions to localhost in e2e mode', () => {
        expect(connectEmulatorsIfE2e(EMULATOR_MODE, services)).toBe(true);
        expect(connectAuthEmulator).toHaveBeenCalledWith(
            expect.anything(),
            `http://127.0.0.1:${EMULATOR_PORTS.auth}`,
            { disableWarnings: true },
        );
        expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', EMULATOR_PORTS.firestore);
        expect(connectStorageEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', EMULATOR_PORTS.storage);
        expect(connectFunctionsEmulator).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', EMULATOR_PORTS.functions);
    });
});
