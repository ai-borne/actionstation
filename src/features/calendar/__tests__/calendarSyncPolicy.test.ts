import { describe, it, expect } from 'vitest';
import {
    decideCalendarOp,
    deliveryFor,
    resolveEventPatch,
    type NodeSnapshot,
} from '../policy/calendarSyncPolicy';
import { TITLE_MAX_LENGTH, NOTES_MAX_LENGTH } from '../types/calendarEvent';
import type { CalendarEventMetadata } from '../types/calendarEvent';

const snap = (over: Partial<NodeSnapshot> = {}): NodeSnapshot => ({
    heading: 'Call mom', output: 'body', isGenerating: false, ...over,
});

const event = (over: Partial<CalendarEventMetadata> = {}): CalendarEventMetadata => ({
    id: 'evt1', type: 'event', title: 'Call mom', date: '2030-01-01T10:00:00Z',
    status: 'synced', calendarId: 'primary', ...over,
});

describe('decideCalendarOp — edits', () => {
    it('does nothing when the node has no calendar event', () => {
        expect(decideCalendarOp({ kind: 'edited', prev: snap(), next: snap({ heading: 'X' }) }, undefined))
            .toEqual({ kind: 'none' });
    });

    it('maps a heading change to the title field', () => {
        expect(decideCalendarOp({ kind: 'edited', prev: snap(), next: snap({ heading: 'New' }) }, event()))
            .toEqual({ kind: 'update', fields: ['title'] });
    });

    it('maps a content change to the notes field', () => {
        expect(decideCalendarOp({ kind: 'edited', prev: snap(), next: snap({ output: 'new body' }) }, event()))
            .toEqual({ kind: 'update', fields: ['notes'] });
    });

    it('maps a change to both sources to both fields', () => {
        const next = snap({ heading: 'A', output: 'B' });
        expect(decideCalendarOp({ kind: 'edited', prev: snap(), next }, event()))
            .toEqual({ kind: 'update', fields: ['title', 'notes'] });
    });

    it('does nothing when neither source changed', () => {
        expect(decideCalendarOp({ kind: 'edited', prev: snap(), next: snap() }, event()))
            .toEqual({ kind: 'none' });
    });

    it('ignores changes while AI is generating (confirmation text is not a user edit)', () => {
        const next = snap({ output: 'Created!', isGenerating: true });
        expect(decideCalendarOp({ kind: 'edited', prev: snap({ isGenerating: true }), next }, event()))
            .toEqual({ kind: 'none' });
    });

    it('ignores the change that ends generation', () => {
        const prev = snap({ isGenerating: true });
        expect(decideCalendarOp({ kind: 'edited', prev, next: snap({ output: 'streamed' }) }, event()))
            .toEqual({ kind: 'none' });
    });

});

describe('deliveryFor', () => {
    it('goes to the network for a created event while Google is reachable', () => {
        expect(deliveryFor(event(), true)).toBe('network');
    });

    it('stays local when the event was never created in Google', () => {
        expect(deliveryFor(event({ id: '', status: 'pending' }), true)).toBe('local');
    });

    it('stays local when offline or not connected', () => {
        expect(deliveryFor(event(), false)).toBe('local');
    });
});

describe('decideCalendarOp — removal and restore', () => {
    it('deletes the Google event when a node with a synced event is removed', () => {
        expect(decideCalendarOp({ kind: 'deleted' }, event())).toEqual({ kind: 'delete', eventId: 'evt1' });
    });

    it('also deletes for failed events that still have an id', () => {
        expect(decideCalendarOp({ kind: 'deleted' }, event({ status: 'failed' })))
            .toEqual({ kind: 'delete', eventId: 'evt1' });
    });

    it('does nothing on removal without an event or without a Google id', () => {
        expect(decideCalendarOp({ kind: 'deleted' }, undefined)).toEqual({ kind: 'none' });
        expect(decideCalendarOp({ kind: 'deleted' }, event({ id: '', status: 'pending' }))).toEqual({ kind: 'none' });
    });

    it('cancels a queued delete when the node is restored inside the grace window', () => {
        expect(decideCalendarOp({ kind: 'restored', isDeletePending: true, isEventDeleted: false }, event()))
            .toEqual({ kind: 'cancelDelete', eventId: 'evt1' });
    });

    it('resets a restored node to pending once its Google event is already gone', () => {
        expect(decideCalendarOp({ kind: 'restored', isDeletePending: false, isEventDeleted: true }, event()))
            .toEqual({ kind: 'resetToPending' });
    });

    it('does nothing for a restored node whose event was never touched', () => {
        expect(decideCalendarOp({ kind: 'restored', isDeletePending: false, isEventDeleted: false }, event()))
            .toEqual({ kind: 'none' });
    });
});

describe('resolveEventPatch', () => {
    const source = { heading: 'New title', output: 'New notes' };

    it('builds a patch from the fields that changed', () => {
        expect(resolveEventPatch(['title', 'notes'], source, event()))
            .toEqual({ title: 'New title', notes: 'New notes' });
    });

    it('only includes requested fields', () => {
        expect(resolveEventPatch(['title'], source, event())).toEqual({ title: 'New title' });
    });

    it('never sends an empty title (Google requires one): keeps the existing title', () => {
        expect(resolveEventPatch(['title'], { heading: '   ', output: '' }, event())).toBeNull();
    });

    it('trims the title and truncates it to the validation maximum', () => {
        const patch = resolveEventPatch(['title'], { heading: `  ${'a'.repeat(TITLE_MAX_LENGTH + 50)} `, output: '' }, event());
        expect(patch?.title).toHaveLength(TITLE_MAX_LENGTH);
    });

    it('truncates notes to the validation maximum', () => {
        const patch = resolveEventPatch(['notes'], { heading: 'h', output: 'n'.repeat(NOTES_MAX_LENGTH + 10) }, event());
        expect(patch?.notes).toHaveLength(NOTES_MAX_LENGTH);
    });

    it('allows clearing notes', () => {
        expect(resolveEventPatch(['notes'], { heading: 'h', output: '' }, event({ notes: 'old' }))).toEqual({ notes: '' });
    });

    it('returns null when the resolved values equal what Google already has', () => {
        expect(resolveEventPatch(['title', 'notes'], { heading: 'Call mom', output: 'x' }, event({ notes: 'x' }))).toBeNull();
    });

    it('treats missing notes and empty notes as equal', () => {
        expect(resolveEventPatch(['notes'], { heading: 'h', output: '' }, event())).toBeNull();
    });
});
