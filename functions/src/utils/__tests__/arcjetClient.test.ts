/**
 * arcjetClient Tests
 * Validates browser/server client separation and decision mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeDecision(opts: { denied: boolean; isBot?: boolean; isShield?: boolean }) {
    return {
        isDenied: () => opts.denied,
        reason: {
            isBot: () => Boolean(opts.isBot),
            isShield: () => Boolean(opts.isShield),
        },
    };
}

const protectMock = vi.fn();
const shieldMock = vi.fn((cfg: unknown) => ({ type: 'shield', cfg }));
const detectBotMock = vi.fn((cfg: unknown) => ({ type: 'detectBot', cfg }));
const arcjetFactory = vi.fn(() => ({ protect: protectMock }));

vi.mock('@arcjet/node', () => ({
    default: (cfg: unknown) => arcjetFactory(cfg),
    shield: (cfg: unknown) => shieldMock(cfg),
    detectBot: (cfg: unknown) => detectBotMock(cfg),
}));

vi.mock('firebase-functions/params', () => ({
    defineSecret: (name: string) => ({
        value: () => `mock-${name}`,
    }),
}));

const fakeReq = { headers: {}, method: 'GET' } as never;

describe('arcjetClient', () => {
    beforeEach(() => {
        vi.resetModules();
        arcjetFactory.mockClear();
        protectMock.mockReset();
        shieldMock.mockClear();
        detectBotMock.mockClear();
    });

    it('allows a clean request through on the browser client', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: false }));
        const { checkArcjetBrowser } = await import('../arcjetClient.js');
        const result = await checkArcjetBrowser(fakeReq);
        expect(result).toEqual({ blocked: false, reason: null });
    });

    it('blocks and reports "bot" when the browser client denies for a bot', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: true, isBot: true }));
        const { checkArcjetBrowser } = await import('../arcjetClient.js');
        const result = await checkArcjetBrowser(fakeReq);
        expect(result).toEqual({ blocked: true, reason: 'bot' });
    });

    it('blocks and reports "shield" when a shield rule denies', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: true, isShield: true }));
        const { checkArcjetServer } = await import('../arcjetClient.js');
        const result = await checkArcjetServer(fakeReq);
        expect(result).toEqual({ blocked: true, reason: 'shield' });
    });

    it('configures the browser client with bot detection in LIVE mode', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: false }));
        const { checkArcjetBrowser } = await import('../arcjetClient.js');
        await checkArcjetBrowser(fakeReq);
        expect(detectBotMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'LIVE' }));
    });

    it('configures the server client with bot detection in DRY_RUN mode (never blocks webhooks/health)', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: false }));
        const { checkArcjetServer } = await import('../arcjetClient.js');
        await checkArcjetServer(fakeReq);
        expect(detectBotMock).toHaveBeenCalledWith(expect.objectContaining({ mode: 'DRY_RUN' }));
    });

    it('reuses the same client instance across calls (singleton per type)', async () => {
        protectMock.mockResolvedValue(makeDecision({ denied: false }));
        const { checkArcjetBrowser } = await import('../arcjetClient.js');
        await checkArcjetBrowser(fakeReq);
        await checkArcjetBrowser(fakeReq);
        expect(arcjetFactory).toHaveBeenCalledTimes(1);
    });
});
