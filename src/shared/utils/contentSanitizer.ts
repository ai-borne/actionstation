/**
 * Content Sanitizer — Strips non-durable image references before Firestore writes.
 * Prevents accidentally persisting a large base64 blob, or a `blob:` object-URL
 * preview that only exists in the current tab, when an image upload is still
 * in progress at the time of autosave.
 */

export const PENDING_UPLOAD_PLACEHOLDER = '[image-uploading]';

const BASE64_IMAGE_RE = /data:image\/[a-zA-Z+]+;base64,[^\s"')}\]]+/g;
const BLOB_URL_RE = /blob:[^\s"')}\]]+/g;

function stripValue(value: unknown): unknown {
    if (typeof value === 'string') {
        if (!value.includes('data:image/') && !value.includes('blob:')) return value;
        const replaced = value
            .replace(BASE64_IMAGE_RE, PENDING_UPLOAD_PLACEHOLDER)
            .replace(BLOB_URL_RE, PENDING_UPLOAD_PLACEHOLDER);
        return replaced === value ? value : replaced;
    }
    if (Array.isArray(value)) {
        return value.map(stripValue);
    }
    if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        return stripBase64Images(value as Record<string, unknown>);
    }
    return value;
}

/**
 * Recursively walks a record and replaces any `data:image/...;base64,...`
 * or `blob:...` object-URL strings with a safe placeholder. Returns a new
 * object (no mutation).
 */
export function stripBase64Images<T extends Record<string, unknown>>(obj: T): T {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
        result[key] = stripValue(val);
    }
    return result as T;
}
