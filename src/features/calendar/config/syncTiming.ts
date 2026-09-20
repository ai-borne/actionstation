import { ACTION_TOAST_DURATION_MS } from '@/shared/stores/toastStore';

/** Quiet period after the last edit before a changed title/notes is pushed to Google. */
export const CALENDAR_UPDATE_DEBOUNCE_MS = 2000;

/**
 * How long a Google delete waits after its card is removed: the Undo toast's lifetime,
 * so clicking Undo cancels the delete and the event survives.
 */
export const CALENDAR_DELETE_GRACE_MS = ACTION_TOAST_DURATION_MS;
