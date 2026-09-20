/**
 * Razorpay webhook payload shapes (only the fields we read).
 * Razorpay wraps each resource in an `entity` sub-object.
 */

export interface RazorpaySubscriptionEntity {
    id: string;
    status: string;
    plan_id: string;
    customer_id: string;
    current_start?: number;
    current_end?: number;
    quantity?: number;
    notes?: Record<string, string>;
}

export interface RazorpayPaymentEntity {
    id: string;
    amount: number;
    currency: string;
    status: string;
    order_id?: string;
    /** Unix timestamp (seconds) of when payment was created */
    created_at?: number;
    /** Client-controlled — never used to decide who gets Pro. */
    notes?: unknown;
}

export interface RazorpayRefundEntity {
    id: string;
    payment_id: string;
    /** Refunded amount in the smallest currency unit */
    amount: number;
    status: string;
}

export interface RazorpayWebhookPayload {
    event: string;
    payload: {
        subscription?: { entity: RazorpaySubscriptionEntity };
        payment?: { entity: RazorpayPaymentEntity };
        refund?: { entity: RazorpayRefundEntity };
    };
}
