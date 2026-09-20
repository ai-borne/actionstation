/**
 * How long to yield to the event loop before triggering the Google OAuth redirect.
 * Gives any in-flight autosave debounce time to flush its Firestore write before the browser
 * navigates away, preventing the node from disappearing. Shared by every Connect Calendar entry point.
 */
export const AUTOSAVE_YIELD_MS = 300;
