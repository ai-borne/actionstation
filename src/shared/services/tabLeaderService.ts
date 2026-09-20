/**
 * tabLeaderService — Cross-tab leader election via BroadcastChannel
 * with localStorage heartbeat and a storage-event fallback.
 *
 * Lifecycle:
 *   createTabLeaderService() → service.start() → service.stop()
 *
 * A tab is elected leader when no other tab has a fresh heartbeat (<6 s).
 * Leaders broadcast a HEARTBEAT every 3 s and a RESIGN on pagehide/stop.
 * Followers poll the heartbeat and take over if it goes stale (leader died silently).
 * Any follower that receives RESIGN will immediately re-run the election.
 */
import { generateUUID } from '@/shared/utils/uuid';
import { logger } from '@/shared/services/logger';

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_LEADER_ID = 'actionstation-leader-id';
const LS_HEARTBEAT_TS = 'actionstation-leader-hb';
const BC_CHANNEL = 'actionstation-tab-leader';
const HEARTBEAT_INTERVAL_MS = 3_000;
const HEARTBEAT_TIMEOUT_MS = 6_000;

// ─── Types ────────────────────────────────────────────────────────────────────
export type TabRole = 'leader' | 'follower' | 'pending';

type BcMessage =
    | { type: 'CLAIM'; tabId: string }
    | { type: 'RESIGN'; tabId: string }
    | { type: 'HEARTBEAT'; tabId: string };

export interface TabLeaderService {
    readonly tabId: string;
    getRole(): TabRole;
    start(): void;
    stop(): void;
    onRoleChange(cb: (role: TabRole) => void): () => void;
}

// ─── Module-level helpers (pure, ≤20 lines each) ─────────────────────────────
function isHeartbeatFresh(): boolean {
    const ts = localStorage.getItem(LS_HEARTBEAT_TS);
    if (!ts) return false;
    return Date.now() - parseInt(ts, 10) < HEARTBEAT_TIMEOUT_MS;
}

function safePost(channel: BroadcastChannel | null, msg: BcMessage): void {
    try {
        channel?.postMessage(msg);
    } catch (err) {
        logger.warn('tabLeaderService: BroadcastChannel postMessage failed', err);
    }
}

// A follower only re-elects on RESIGN. If the leader dies without sending one
// (reload, crash, bfcache), poll the heartbeat so the follower can take over.
function createStaleWatcher(onStale: () => void) {
    let timer: ReturnType<typeof setInterval> | null = null;
    return {
        start(): void {
            if (timer !== null) return;
            timer = setInterval(() => { if (!isHeartbeatFresh()) onStale(); }, HEARTBEAT_INTERVAL_MS);
        },
        stop(): void {
            if (timer !== null) clearInterval(timer);
            timer = null;
        },
    };
}

function releaseLeadership(channel: BroadcastChannel | null, tabId: string): void {
    localStorage.removeItem(LS_LEADER_ID);
    localStorage.removeItem(LS_HEARTBEAT_TS);
    safePost(channel, { type: 'RESIGN', tabId });
}

function startHeartbeat(channel: BroadcastChannel | null, tabId: string): ReturnType<typeof setInterval> {
    return setInterval(() => {
        localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now()));
        safePost(channel, { type: 'HEARTBEAT', tabId });
    }, HEARTBEAT_INTERVAL_MS);
}

// Returns an unbind function. bfcache restores fire pageshow with persisted=true.
function bindPageLifecycle(onHide: () => void, onRestore: () => void): () => void {
    const onShow = (e: PageTransitionEvent): void => { if (e.persisted) onRestore(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
    };
}

// ─── Factory ─────────────────────────────────────────────────────────────────
export function createTabLeaderService(): TabLeaderService {
    const tabId = generateUUID();
    let role: TabRole = 'pending';
    const listeners = new Set<(role: TabRole) => void>();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let channel: BroadcastChannel | null = null;
    let bcMessageHandler: ((e: MessageEvent<BcMessage>) => void) | null = null;

    let unbindPage: (() => void) | null = null;
    const staleWatch = createStaleWatcher(() => claimLeadership());

    function notify(next: TabRole): void {
        role = next;
        if (next === 'follower') staleWatch.start(); else staleWatch.stop();
        listeners.forEach((cb) => cb(role));
    }

    function stopHeartbeat(): void {
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    function handlePageHide(): void {
        if (role !== 'leader') return;
        stopHeartbeat();
        releaseLeadership(channel, tabId);
    }

    function claimLeadership(): void {
        localStorage.setItem(LS_LEADER_ID, tabId);
        localStorage.setItem(LS_HEARTBEAT_TS, String(Date.now()));
        notify('leader');
        safePost(channel, { type: 'CLAIM', tabId });
        heartbeatTimer = startHeartbeat(channel, tabId);
    }

    function tryClaimOrFollow(): void { if (isHeartbeatFresh()) notify('follower'); else claimLeadership(); }
    function handleBcMessage(msg: BcMessage): void {
        if (msg.tabId === tabId) return; // ignore self
        if (msg.type === 'RESIGN') { tryClaimOrFollow(); return; }
        stopHeartbeat();
        notify('follower');
    }

    // Fallback for environments without BroadcastChannel: translate storage events to messages.
    function handleStorageEvent(e: StorageEvent): void {
        if (e.key !== LS_LEADER_ID) return;
        if (e.newValue && e.newValue !== tabId) handleBcMessage({ type: 'CLAIM', tabId: e.newValue });
        else if (e.newValue === null) handleBcMessage({ type: 'RESIGN', tabId: '' });
    }

    function startChannel(): void {
        if (typeof BroadcastChannel !== 'undefined') {
            channel = new BroadcastChannel(BC_CHANNEL);
            bcMessageHandler = (e: MessageEvent<BcMessage>) => handleBcMessage(e.data);
            channel.addEventListener('message', bcMessageHandler);
        } else {
            window.addEventListener('storage', handleStorageEvent);
        }
    }

    function stopChannel(): void {
        if (role === 'leader') releaseLeadership(channel, tabId);
        if (channel && bcMessageHandler) {
            channel.removeEventListener('message', bcMessageHandler);
            bcMessageHandler = null;
        }
        channel?.close();
        channel = null;
        try {
            window.removeEventListener('storage', handleStorageEvent);
            unbindPage?.();
            unbindPage = null;
        } catch (err) { logger.warn('tabLeaderService: removeEventListener failed', err); }
    }

    return {
        tabId,
        getRole: () => role,
        start(): void {
            startChannel();
            unbindPage = bindPageLifecycle(handlePageHide, () => { if (role === 'leader') tryClaimOrFollow(); });
            tryClaimOrFollow();
        },
        stop(): void { stopHeartbeat(); staleWatch.stop(); stopChannel(); },
        onRoleChange(cb: (role: TabRole) => void): () => void {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
    };
}
