/**
 * How long typing must pause before a card's title or body is committed to the node (and so to
 * autosave). Committing per keystroke caused O(N) re-renders; committing only on blur meant text
 * typed just before closing the tab was lost.
 */
export const EDIT_COMMIT_DELAY_MS = 400;
