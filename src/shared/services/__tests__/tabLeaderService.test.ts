/**
 * tabLeaderService — TDD tests (written BEFORE implementation).
 *
 * Uses BroadcastChannel mock and shared localStorage (jsdom).
 * vi.useFakeTimers() is scoped to individual tests that need heartbeat control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTabLeaderService } from '../tabLeaderService';

// ─── BroadcastChannel mock ────────────────────────────────────────────────────
type BcListener = (e: { data: unknown }) => void;
const channelBus = new Map<string, Set<BcListener>>();

function makeMockBc(name: string) {
    if (!channelBus.has(name)) channelBus.set(name, new Set());
    const bus = channelBus.get(name)!;
    const instance = {
        postMessage: vi.fn((data: unknown) => {
            bus.forEach((l) => queueMicrotask(() => l({ data })));
        }),
        close: vi.fn(() => { if (instance._listener) bus.delete(instance._listener); }),
        addEventListener: vi.fn((ev: string, handler: BcListener) => {
            if (ev === 'message') {
                instance._listener = handler;
                bus.add(handler);
            }
        }),
        removeEventListener: vi.fn(),
        _listener: null as BcListener | null,
    };
    return instance;
}

vi.stubGlobal('BroadcastChannel', vi.fn().mockImplementation(makeMockBc));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const LS_LEADER_ID = 'actionstation-leader-id';
const LS_HEARTBEAT_TS = 'actionstation-leader-hb';

function setFreshLeader(otherId = 'other-tab') {
    localStorage.setItem(LS_LEADER_ID, otherId);
    localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now()));
}

function setStaleLeader(otherId = 'old-tab') {
    localStorage.setItem(LS_LEADER_ID, otherId);
    localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now() - 10_000));
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('createTabLeaderService', () => {
    beforeEach(() => {
        localStorage.clear();
        channelBus.clear();
        vi.mocked(BroadcastChannel).mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts as pending before start() is called', () => {
        const svc = createTabLeaderService();
        expect(svc.getRole()).toBe('pending');
    });

    it('claims leadership when no existing leader heartbeat', () => {
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('leader');
        expect(localStorage.getItem(LS_LEADER_ID)).toBe(svc.tabId);
        svc.stop();
    });

    it('becomes follower when another leader has a fresh heartbeat', () => {
        setFreshLeader('other-tab');
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('follower');
        svc.stop();
    });

    it('claims leadership when the existing heartbeat is stale', () => {
        setStaleLeader('old-tab');
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('leader');
        svc.stop();
    });

    it('calls onRoleChange when role transitions from pending to leader', () => {
        const cb = vi.fn();
        const svc = createTabLeaderService();
        const unsub = svc.onRoleChange(cb);
        svc.start();
        expect(cb).toHaveBeenCalledWith('leader');
        unsub();
        svc.stop();
    });

    it('calls onRoleChange when role transitions from pending to follower', () => {
        setFreshLeader();
        const cb = vi.fn();
        const svc = createTabLeaderService();
        const unsub = svc.onRoleChange(cb);
        svc.start();
        expect(cb).toHaveBeenCalledWith('follower');
        unsub();
        svc.stop();
    });

    it('unsubscribes onRoleChange when the returned function is called', () => {
        const cb = vi.fn();
        const svc = createTabLeaderService();
        const unsub = svc.onRoleChange(cb);
        unsub();
        svc.start();
        expect(cb).not.toHaveBeenCalled();
        svc.stop();
    });

    it('broadcasts RESIGN and clears localStorage on stop() when leader', () => {
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('leader');

        const [bcInstance] = vi.mocked(BroadcastChannel).mock.results.map((r) => r.value);
        svc.stop();

        expect(bcInstance.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'RESIGN', tabId: svc.tabId }),
        );
        expect(localStorage.getItem(LS_LEADER_ID)).toBeNull();
    });

    it('does NOT broadcast RESIGN on stop() when follower', () => {
        setFreshLeader();
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('follower');

        const [bcInstance] = vi.mocked(BroadcastChannel).mock.results.map((r) => r.value);
        svc.stop();

        const resignCalls = (bcInstance.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
            ([msg]) => (msg as { type: string }).type === 'RESIGN',
        );
        expect(resignCalls).toHaveLength(0);
    });

    it('becomes follower when a CLAIM message arrives from another tab', async () => {
        const svc = createTabLeaderService();
        svc.start();
        expect(svc.getRole()).toBe('leader');

        // Get the BC listener
        const [bcInstance] = vi.mocked(BroadcastChannel).mock.results.map((r) => r.value);
        const addListenerCall = (bcInstance.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
            ([ev]) => ev === 'message',
        );
        const listener = addListenerCall?.[1] as BcListener;

        listener({ data: { type: 'CLAIM', tabId: '0-lower-than-any-uuid' } });
        expect(svc.getRole()).toBe('follower');
        svc.stop();
    });

    it('fires heartbeat interval while leader', () => {
        vi.useFakeTimers();
        try {
            const svc = createTabLeaderService();
            svc.start();
            const tsBefore = localStorage.getItem(LS_HEARTBEAT_TS);
            vi.advanceTimersByTime(4_000);
            const tsAfter = localStorage.getItem(LS_HEARTBEAT_TS);
            expect(Number(tsAfter)).toBeGreaterThan(Number(tsBefore));
            svc.stop();
        } finally {
            vi.useRealTimers();
        }
    });
    describe('reload and stale-leader recovery', () => {
        it('leader releases leadership on pagehide so a reload can re-claim it', () => {
            const svc = createTabLeaderService();
            svc.start();
            const [bc] = vi.mocked(BroadcastChannel).mock.results.map((r) => r.value);

            window.dispatchEvent(new Event('pagehide'));

            expect(localStorage.getItem(LS_LEADER_ID)).toBeNull();
            expect(localStorage.getItem(LS_HEARTBEAT_TS)).toBeNull();
            expect(bc.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: 'RESIGN', tabId: svc.tabId }),
            );
            svc.stop();
        });

        it('follower does not write to localStorage on pagehide', () => {
            setFreshLeader('other-tab');
            const svc = createTabLeaderService();
            svc.start();

            window.dispatchEvent(new Event('pagehide'));

            expect(localStorage.getItem(LS_LEADER_ID)).toBe('other-tab');
            svc.stop();
        });

        it('follower takes over when the leader heartbeat goes stale', () => {
            vi.useFakeTimers();
            try {
                setFreshLeader('dead-tab');
                const svc = createTabLeaderService();
                svc.start();
                expect(svc.getRole()).toBe('follower');

                vi.advanceTimersByTime(10_000);

                expect(svc.getRole()).toBe('leader');
                expect(localStorage.getItem(LS_LEADER_ID)).toBe(svc.tabId);
                svc.stop();
            } finally {
                vi.useRealTimers();
            }
        });

        it('follower stays follower while the leader keeps heartbeating', () => {
            vi.useFakeTimers();
            try {
                setFreshLeader('live-tab');
                const svc = createTabLeaderService();
                svc.start();
                for (let i = 0; i < 5; i++) {
                    vi.advanceTimersByTime(3_000);
                    localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now()));
                }
                expect(svc.getRole()).toBe('follower');
                svc.stop();
            } finally {
                vi.useRealTimers();
            }
        });

        it('stop() cancels the stale-heartbeat watcher and pagehide listener', () => {
            vi.useFakeTimers();
            try {
                setFreshLeader('dead-tab');
                const svc = createTabLeaderService();
                svc.start();
                svc.stop();

                vi.advanceTimersByTime(20_000);

                expect(svc.getRole()).toBe('follower');
                expect(vi.getTimerCount()).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
