/**
 * tabLeaderService — simultaneous-claim tie-break.
 * When the leader closes, every follower claims at once. Exactly one must win, or nobody edits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTabLeaderService } from '../tabLeaderService';

type BcListener = (e: { data: unknown }) => void;
const bus = new Set<BcListener>();

function makeMockBc() {
    let own: BcListener | null = null;
    return {
        postMessage: (data: unknown) => { bus.forEach((l) => { if (l !== own) queueMicrotask(() => l({ data })); }); },
        close: () => { if (own) bus.delete(own); },
        addEventListener: (_ev: string, handler: BcListener) => { own = handler; bus.add(handler); },
        removeEventListener: () => undefined,
    };
}

vi.stubGlobal('BroadcastChannel', vi.fn().mockImplementation(makeMockBc));

const LS_LEADER_ID = 'actionstation-leader-id';
const LS_HEARTBEAT_TS = 'actionstation-leader-hb';

describe('tabLeaderService tie-break', () => {
    beforeEach(() => {
        localStorage.clear();
        bus.clear();
        vi.useFakeTimers();
    });
    afterEach(() => { vi.useRealTimers(); });

    it('elects exactly one leader when two tabs claim before either sees the other', async () => {
        const a = createTabLeaderService();
        const b = createTabLeaderService();
        a.start();
        localStorage.clear(); // b starts before a's claim is visible to it: both become leader
        b.start();
        expect([a.getRole(), b.getRole()]).toEqual(['leader', 'leader']);

        // Each tab now receives the other's CLAIM (delivered in both directions).
        bus.forEach((l) => {
            l({ data: { type: 'CLAIM', tabId: a.tabId } });
            l({ data: { type: 'CLAIM', tabId: b.tabId } });
        });

        const roles = [a.getRole(), b.getRole()];
        expect(roles.filter((r) => r === 'leader')).toHaveLength(1);
        const winner = a.tabId < b.tabId ? a : b;
        expect(winner.getRole()).toBe('leader');
        a.stop();
        b.stop();
    });

    it('keeps the winner heartbeating so the loser stays a follower', async () => {
        localStorage.setItem(LS_LEADER_ID, 'dead-tab');
        localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now()));
        const a = createTabLeaderService();
        const b = createTabLeaderService();
        a.start();
        b.start();
        await vi.advanceTimersByTimeAsync(30_000);

        expect([a.getRole(), b.getRole()].filter((r) => r === 'leader')).toHaveLength(1);
        expect(Date.now() - Number(localStorage.getItem(LS_HEARTBEAT_TS))).toBeLessThan(6_000);
        a.stop();
        b.stop();
    });

    it('a leader ignores a CLAIM from a tab with a higher id', async () => {
        const svc = createTabLeaderService();
        svc.start();
        bus.forEach((l) => l({ data: { type: 'CLAIM', tabId: 'zzzzzzzz-higher-than-any-uuid' } }));
        expect(svc.getRole()).toBe('leader');
        svc.stop();
    });

    it('a leader ignores a HEARTBEAT from a tab with a higher id', () => {
        const svc = createTabLeaderService();
        svc.start();
        bus.forEach((l) => l({ data: { type: 'HEARTBEAT', tabId: 'zzzzzzzz-higher-than-any-uuid' } }));
        expect(svc.getRole()).toBe('leader');
        svc.stop();
    });

    it('a leader yields to a CLAIM from a tab with a lower id', async () => {
        const svc = createTabLeaderService();
        svc.start();
        bus.forEach((l) => l({ data: { type: 'CLAIM', tabId: '0' } }));
        expect(svc.getRole()).toBe('follower');
        svc.stop();
    });
});
