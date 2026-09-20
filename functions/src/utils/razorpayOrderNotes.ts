/**
 * Order notes — the marker that separates ActionStation's Razorpay objects from those of
 * other products sharing the same Razorpay account (SSBMax has its own webhook and plans).
 * Razorpay delivers EVERY account event to EVERY registered webhook, so a handler must
 * prove an order/subscription is ours before acting on it. `createRazorpayOrder` stamps
 * the marker server-side; clients cannot set order notes.
 */

/** Value of `notes.source` on every ActionStation order. */
export const ORDER_SOURCE = 'actionstation';

/** Returned as a string map because the Razorpay SDK types `notes` that way. */
export function buildOrderNotes(userId: string, planId: string): Record<string, string> {
    return { userId, planId, source: ORDER_SOURCE };
}

/** True only for notes stamped with the ActionStation source marker. */
export function isActionStationNotes(notes: unknown): boolean {
    return typeof notes === 'object'
        && notes !== null
        && (notes as { source?: unknown }).source === ORDER_SOURCE;
}
