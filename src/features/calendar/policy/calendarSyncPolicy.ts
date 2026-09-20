/**
 * calendarSyncPolicy — SSOT for "which node mutation requires which Calendar operation".
 * Pure and table-driven: no IO, no store access, no timers. The sync controller executes
 * whatever operation this module decides.
 */
import { TITLE_MAX_LENGTH, NOTES_MAX_LENGTH } from '../types/calendarEvent';
import type { CalendarEventMetadata } from '../types/calendarEvent';

/** Event fields that follow the card. Date and time are not card-editable (AI intent only). */
export type SyncedEventField = 'title' | 'notes';

/** The card data a synced field is derived from. */
export interface NodeSnapshot {
    readonly heading: string;
    readonly output: string;
    readonly isGenerating: boolean;
}

export type EventSource = Pick<NodeSnapshot, 'heading' | 'output'>;

export type EventPatch = Partial<Record<SyncedEventField, string>>;

/** Which card field feeds which event field, and the validation ceiling of the event field. */
const FIELD_TABLE: ReadonlyArray<{
    readonly field: SyncedEventField;
    readonly source: keyof EventSource;
    readonly maxLength: number;
}> = [
    { field: 'title', source: 'heading', maxLength: TITLE_MAX_LENGTH },
    { field: 'notes', source: 'output', maxLength: NOTES_MAX_LENGTH },
];

export type NodeMutation =
    | { readonly kind: 'edited'; readonly prev: NodeSnapshot; readonly next: NodeSnapshot }
    | { readonly kind: 'deleted' }
    | { readonly kind: 'restored'; readonly isDeletePending: boolean; readonly isEventDeleted: boolean };

export type CalendarOp =
    | { readonly kind: 'none' }
    | { readonly kind: 'update'; readonly fields: readonly SyncedEventField[] }
    | { readonly kind: 'delete'; readonly eventId: string }
    | { readonly kind: 'cancelDelete'; readonly eventId: string }
    | { readonly kind: 'resetToPending' };

const NONE: CalendarOp = { kind: 'none' };

function changedFields(prev: NodeSnapshot, next: NodeSnapshot): SyncedEventField[] {
    return FIELD_TABLE.filter((row) => prev[row.source] !== next[row.source]).map((row) => row.field);
}

function decideEdit(prev: NodeSnapshot, next: NodeSnapshot): CalendarOp {
    // AI generation writes confirmation text and streams output: never a user edit.
    if (prev.isGenerating || next.isGenerating) return NONE;
    const fields = changedFields(prev, next);
    if (fields.length === 0) return NONE;
    return { kind: 'update', fields };
}

function decideRestore(
    mutation: Extract<NodeMutation, { kind: 'restored' }>, event: CalendarEventMetadata,
): CalendarOp {
    if (!event.id) return NONE;
    if (mutation.isDeletePending) return { kind: 'cancelDelete', eventId: event.id };
    return mutation.isEventDeleted ? { kind: 'resetToPending' } : NONE;
}

/** Decide the Calendar operation for a node mutation. */
export function decideCalendarOp(
    mutation: NodeMutation, event: CalendarEventMetadata | undefined,
): CalendarOp {
    if (!event) return NONE;
    switch (mutation.kind) {
        case 'edited': return decideEdit(mutation.prev, mutation.next);
        case 'deleted': return event.id ? { kind: 'delete', eventId: event.id } : NONE;
        case 'restored': return decideRestore(mutation, event);
    }
}

export type Delivery = 'network' | 'local';

/**
 * How an update is delivered. No Google id yet (never created) or Google unreachable
 * (offline / calendar not connected) → 'local': the snapshot is patched and marked pending so
 * the sync badge's retry delivers the latest values later.
 */
export function deliveryFor(event: CalendarEventMetadata, isReachable: boolean): Delivery {
    return event.id && isReachable ? 'network' : 'local';
}

/**
 * Resolve the values to send for the given fields from the node's CURRENT content.
 * Returns null when nothing would change (empty title, or values equal to what Google has).
 */
export function resolveEventPatch(
    fields: readonly SyncedEventField[], source: EventSource, event: CalendarEventMetadata,
): EventPatch | null {
    const patch: EventPatch = {};
    for (const row of FIELD_TABLE) {
        if (!fields.includes(row.field)) continue;
        const raw = row.field === 'title' ? source[row.source].trim() : source[row.source];
        if (row.field === 'title' && raw === '') continue;
        const value = raw.slice(0, row.maxLength);
        if (value !== (event[row.field] ?? '')) patch[row.field] = value;
    }
    return Object.keys(patch).length > 0 ? patch : null;
}
