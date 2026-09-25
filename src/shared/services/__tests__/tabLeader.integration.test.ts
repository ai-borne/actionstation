/**
 * tabLeader integration test — two service instances in one process.
 *
 * A shared BroadcastChannel bus routes messages between both instances,
 * simulating what happens across real browser tabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTabLeaderService } from '../tabLeaderService';

// ─── Shared channel bus ───────────────────────────────────────────────────────
type BcListener = (e: { data: unknown }) => void;
const channelBus = new Map<string, Set<BcListener>>();

vi.stubGlobal(
    'BroadcastChannel',
    vi.fn().mockImplementation(function MockBroadcastChannel(name: string) {
        if (!channelBus.has(name)) channelBus.set(name, new Set());
        const bus = channelBus.get(name)!;
        let ownListener: BcListener | null = null;
        return {
            postMessage: vi.fn((data: unknown) => {
                bus.forEach((l) => queueMicrotask(() => l({ data })));
            }),
            close: vi.fn(() => { if (ownListener) bus.delete(ownListener); }),
            addEventListener: vi.fn((ev: string, handler: BcListener) => {
                if (ev === 'message') { ownListener = handler; bus.add(handler); }
            }),
            removeEventListener: vi.fn(),
        };
    }),
);

// ─── Test helpers ─────────────────────────────────────────────────────────────
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

beforeEach(() => {
    localStorage.clear();
    channelBus.clear();
    vi.mocked(BroadcastChannel).mockClear();
});

afterEach(() => {
    vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('tabLeader integration — two service instances', () => {
    it('first service claims leadership; second becomes follower', () => {
        const svcA = createTabLeaderService();
        svcA.start();
        expect(svcA.getRole()).toBe('leader');

        const svcB = createTabLeaderService();
        svcB.start();
        expect(svcB.getRole()).toBe('follower');

        svcA.stop();
        svcB.stop();
    });

    it('follower claims leadership after leader resigns', async () => {
        const svcA = createTabLeaderService();
        const svcB = createTabLeaderService();

        const rolesB: string[] = [];
        svcB.onRoleChange((r) => rolesB.push(r));

        svcA.start();
        svcB.start();
        expect(svcA.getRole()).toBe('leader');
        expect(svcB.getRole()).toBe('follower');

        // Leader resigns — RESIGN message queued as microtask
        svcA.stop();
        await flushMicrotasks();
        await flushMicrotasks(); // two flushes: post + receive

        expect(svcB.getRole()).toBe('leader');
        expect(rolesB).toContain('leader');
        svcB.stop();
    });

    it('both services can coexist with onRoleChange callbacks firing only once per transition', () => {
        const callsA: string[] = [];
        const callsB: string[] = [];

        const svcA = createTabLeaderService();
        const svcB = createTabLeaderService();
        svcA.onRoleChange((r) => callsA.push(r));
        svcB.onRoleChange((r) => callsB.push(r));

        svcA.start();
        svcB.start();

        // Each service gets exactly one role transition on start
        expect(callsA).toHaveLength(1);
        expect(callsA[0]).toBe('leader');
        expect(callsB).toHaveLength(1);
        expect(callsB[0]).toBe('follower');

        svcA.stop();
        svcB.stop();
    });
});
