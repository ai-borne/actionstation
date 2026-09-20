/**
 * Cloud Functions Entry Point
 * Exports all HTTP functions for Firebase deployment
 */
import { initializeApp } from 'firebase-admin/app';

// Initialize Firebase Admin SDK (must be called before any admin imports)
initializeApp();

export { fetchLinkMeta } from './fetchLinkMeta.js';
export { proxyImage } from './proxyImage.js';
export { geminiProxy } from './geminiProxy.js';
export { onNodeDeleted } from './onNodeDeleted.js';
export { scheduledStorageCleanup } from './scheduledStorageCleanup.js';
export { workspaceBundle } from './workspaceBundle.js';
export { health } from './health.js';
export { firestoreBackup } from './firestoreBackup.js';
export { verifyTurnstile } from './verifyTurnstile.js';
export { exchangeCalendarCode, disconnectCalendar } from './calendarAuth.js';
export {
    calendarCreateEvent, calendarUpdateEvent,
    calendarDeleteEvent, calendarListEvents,
} from './calendarEvents.js';
export { createCheckoutSession } from './createCheckoutSession.js';
export { stripeWebhook } from './stripeWebhook.js';
export { createBillingPortalSession } from './createBillingPortalSession.js';
export { createRazorpayOrder } from './createRazorpayOrder.js';
export { razorpayWebhook } from './razorpayWebhook.js';
export { onUserDeleted } from './onUserDeleted.js';
export { onStorageObjectFinalized, onStorageObjectDeleted } from './onStorageUsage.js';
export { gdprServerExport } from './gdprServerExport.js';
