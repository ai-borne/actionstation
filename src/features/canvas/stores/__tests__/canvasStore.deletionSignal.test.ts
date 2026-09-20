import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCanvasStore } from '../canvasStore';
import { onNodesDeleted } from '../../services/nodeDeletionSignal';
import type { CanvasNode } from '../../types/node';

const node = (id: string): CanvasNode => ({
    id, workspaceId: 'ws', type: 'idea', data: { heading: id },
    position: { x: 0, y: 0 }, createdAt: new Date(), updatedAt: new Date(),
});

describe('canvasStore deletion signal (the single choke point)', () => {
    const listener = vi.fn();
    let off: () => void;

    beforeEach(() => {
        listener.mockClear();
        off = onNodesDeleted(listener);
        useCanvasStore.setState({ nodes: [node('a'), node('b'), node('c')], edges: [], selectedNodeIds: new Set() });
    });
    afterEach(() => { off(); });

    const deletedIds = () => (listener.mock.calls[0]?.[0] as CanvasNode[]).map((n) => n.id);

    it('deleteNode emits the removed node', () => {
        useCanvasStore.getState().deleteNode('b');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(deletedIds()).toEqual(['b']);
    });

    it('deleteNode of an unknown id emits nothing', () => {
        useCanvasStore.getState().deleteNode('zzz');
        expect(listener).not.toHaveBeenCalled();
    });

    it('deleteNodes emits every removed node in one signal', () => {
        useCanvasStore.getState().deleteNodes(['a', 'c']);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(deletedIds()).toEqual(['a', 'c']);
    });

    it('deleteAllNodes emits every node and empties the canvas', () => {
        useCanvasStore.getState().deleteAllNodes();
        expect(deletedIds()).toEqual(['a', 'b', 'c']);
        expect(useCanvasStore.getState().nodes).toEqual([]);
    });

    it('clearCanvas is an UNLOAD (workspace switch/new workspace): it never signals a deletion', () => {
        useCanvasStore.getState().clearCanvas();
        expect(listener).not.toHaveBeenCalled();
    });

    it('setNodes (workspace load/switch) never signals a deletion', () => {
        useCanvasStore.getState().setNodes([node('x')]);
        expect(listener).not.toHaveBeenCalled();
    });

    it('the removed node still carries its data (calendar event) for subscribers', () => {
        const event = { id: 'e1', type: 'event' as const, title: 't', date: 'd', status: 'synced' as const, calendarId: 'primary' };
        useCanvasStore.setState({ nodes: [{ ...node('a'), data: { heading: 'a', calendarEvent: event } }] });
        useCanvasStore.getState().deleteNode('a');
        expect((listener.mock.calls[0]?.[0] as CanvasNode[])[0]?.data.calendarEvent).toEqual(event);
    });
});
