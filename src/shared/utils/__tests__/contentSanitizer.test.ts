/**
 * Content Sanitizer — Unit tests
 * Verifies base64 image stripping for Firestore safety.
 */
import { describe, it, expect } from 'vitest';
import { stripBase64Images, PENDING_UPLOAD_PLACEHOLDER } from '../contentSanitizer';

describe('stripBase64Images', () => {
    it('replaces a base64 data:image string with placeholder', () => {
        const input = { output: 'text ![img](data:image/png;base64,iVBOR...) more text' };
        const result = stripBase64Images(input);
        expect(result.output).not.toContain('data:image/');
        expect(result.output).toContain(PENDING_UPLOAD_PLACEHOLDER);
    });

    it('preserves https URLs', () => {
        const input = { output: '![img](https://example.com/image.png)' };
        const result = stripBase64Images(input);
        expect(result.output).toBe('![img](https://example.com/image.png)');
    });

    it('handles nested objects recursively', () => {
        const input = {
            data: {
                inner: {
                    src: 'data:image/jpeg;base64,/9j/4AAQ...',
                },
            },
        };
        const result = stripBase64Images(input);
        const data = result.data as Record<string, Record<string, string>>;
        expect(data.inner!.src).toBe(PENDING_UPLOAD_PLACEHOLDER);
    });

    it('handles arrays by stripping base64 from each element', () => {
        const input = {
            items: [
                'data:image/gif;base64,R0lGOD...',
                'https://safe.url/img.png',
                'normal text',
            ],
        };
        const result = stripBase64Images(input);
        const items = result.items as string[];
        expect(items[0]).toBe(PENDING_UPLOAD_PLACEHOLDER);
        expect(items[1]).toBe('https://safe.url/img.png');
        expect(items[2]).toBe('normal text');
    });

    it('handles empty objects', () => {
        expect(stripBase64Images({})).toEqual({});
    });

    it('handles null/undefined values without crashing', () => {
        const input = { a: null, b: undefined, c: 'data:image/png;base64,abc' };
        const result = stripBase64Images(input);
        expect(result.a).toBeNull();
        expect(result.b).toBeUndefined();
        expect(result.c).toBe(PENDING_UPLOAD_PLACEHOLDER);
    });

    it('replaces multiple base64 occurrences in one string', () => {
        const input = {
            output: 'a data:image/png;base64,abc b data:image/jpeg;base64,xyz c',
        };
        const result = stripBase64Images(input);
        expect(result.output).not.toContain('data:image/');
    });

    it('handles data:image/webp format', () => {
        const input = { src: 'data:image/webp;base64,UklGRg...' };
        const result = stripBase64Images(input);
        expect(result.src).toBe(PENDING_UPLOAD_PLACEHOLDER);
    });

    it('does not modify non-image data: URIs', () => {
        const input = { href: 'data:text/plain;base64,SGVsbG8=' };
        const result = stripBase64Images(input);
        expect(result.href).toBe('data:text/plain;base64,SGVsbG8=');
    });

    it('replaces a blob: object-URL string with the placeholder (upload-in-progress preview)', () => {
        const input = { output: 'text ![img](blob:https://www.actionstation.in/uuid-1234) more text' };
        const result = stripBase64Images(input);
        expect(result.output).not.toContain('blob:');
        expect(result.output).toContain(PENDING_UPLOAD_PLACEHOLDER);
    });

    it('handles blob: URLs nested in objects and arrays', () => {
        const input = { data: { src: 'blob:https://www.actionstation.in/abc' }, items: ['blob:https://x/y', 'https://safe.url/img.png'] };
        const result = stripBase64Images(input);
        const data = result.data as Record<string, string>;
        const items = result.items as string[];
        expect(data.src).toBe(PENDING_UPLOAD_PLACEHOLDER);
        expect(items[0]).toBe(PENDING_UPLOAD_PLACEHOLDER);
        expect(items[1]).toBe('https://safe.url/img.png');
    });
});
