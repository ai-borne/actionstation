/**
 * razorpayOrderNotes Tests — the marker that tells our Razorpay events from those of
 * other products sharing the same Razorpay account (e.g. SSBMax).
 */
import { describe, it, expect } from 'vitest';
import { buildOrderNotes, isActionStationNotes, ORDER_SOURCE } from '../razorpayOrderNotes.js';

describe('razorpayOrderNotes', () => {
    it('stamps every order with userId, planId and the ActionStation source', () => {
        expect(buildOrderNotes('user-1', 'plan_pro_annual_inr')).toEqual({
            userId: 'user-1',
            planId: 'plan_pro_annual_inr',
            source: 'actionstation',
        });
        expect(ORDER_SOURCE).toBe('actionstation');
    });

    it('recognises notes stamped by buildOrderNotes', () => {
        expect(isActionStationNotes(buildOrderNotes('u', 'p'))).toBe(true);
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['Razorpay empty-notes array', []],
        ['empty object', {}],
        ['another product', { userId: 'ssbmax-user', source: 'ssbmax' }],
        ['userId without a source', { userId: 'someone' }],
        ['a string', 'actionstation'],
    ])('does not recognise %s', (_label, notes) => {
        expect(isActionStationNotes(notes)).toBe(false);
    });
});
