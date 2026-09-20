import { describe, it, expect, vi } from 'vitest';
import { onNodesDeleted, emitNodesDeleted } from '../nodeDeletionSignal';
import type { CanvasNode } from '../../types/node';

const node = (id: string): CanvasNode => ({
    id, workspaceId: 'ws', type: 'idea', data: { heading: id },
    position: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date(),
});

describe('nodeDeletionSignal', () => {
    it('delivers deleted nodes to every subscriber', () => {
        const a = vi.fn();
        const b = vi.fn();
        const offA = onNodesDeleted(a);
        const offB = onNodesDeleted(b);
        const nodes = [node('n1'), node('n2')];
        emitNodesDeleted(nodes);
        expect(a).toHaveBeenCalledWith(nodes);
        expect(b).toHaveBeenCalledWith(nodes);
        offA(); offB();
    });

    it('stops delivering after unsubscribe', () => {
        const a = vi.fn();
        onNodesDeleted(a)();
        emitNodesDeleted([node('n1')]);
        expect(a).not.toHaveBeenCalled();
    });

    it('does not emit for an empty list', () => {
        const a = vi.fn();
        const off = onNodesDeleted(a);
        emitNodesDeleted([]);
        expect(a).not.toHaveBeenCalled();
        off();
    });

    it('a throwing subscriber never breaks the deletion or other subscribers', () => {
        const bad = vi.fn(() => { throw new Error('boom'); });
        const good = vi.fn();
        const offBad = onNodesDeleted(bad);
        const offGood = onNodesDeleted(good);
        expect(() => emitNodesDeleted([node('n1')])).not.toThrow();
        expect(good).toHaveBeenCalledTimes(1);
        offBad(); offGood();
    });
});
