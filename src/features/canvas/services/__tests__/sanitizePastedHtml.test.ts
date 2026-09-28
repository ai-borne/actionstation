/** sanitizePastedHtml — strips unsafe attributes from pasted rich HTML */
import { describe, it, expect } from 'vitest';
import { sanitizePastedHtml } from '../sanitizePastedHtml';

describe('sanitizePastedHtml', () => {
    it('preserves basic semantic tags', () => {
        const html = '<p>Hello <strong>bold</strong> and <em>italic</em></p>';
        expect(sanitizePastedHtml(html)).toBe(html);
    });

    it('strips inline style attributes', () => {
        const result = sanitizePastedHtml('<p style="color:red; font-size:72px">text</p>');
        expect(result).not.toContain('style');
        expect(result).toContain('<p>text</p>');
    });

    it('strips class attributes', () => {
        const result = sanitizePastedHtml('<span class="MsoNormal">word</span>');
        expect(result).not.toContain('class');
        expect(result).toContain('word');
    });

    it('strips id attributes', () => {
        const result = sanitizePastedHtml('<h2 id="section-1">Title</h2>');
        expect(result).not.toContain('id=');
        expect(result).toContain('<h2>Title</h2>');
    });

    it('preserves href on anchor tags', () => {
        const html = '<a href="https://example.com">link</a>';
        expect(sanitizePastedHtml(html)).toContain('href="https://example.com"');
    });

    it('strips style from anchor while preserving href', () => {
        const result = sanitizePastedHtml(
            '<a href="https://example.com" style="color:blue" class="link">click</a>',
        );
        expect(result).toContain('href="https://example.com"');
        expect(result).not.toContain('style');
        expect(result).not.toContain('class');
    });

    it('preserves src and alt on img tags', () => {
        const html = '<img src="https://img.example.com/a.png" alt="photo">';
        const result = sanitizePastedHtml(html);
        expect(result).toContain('src="https://img.example.com/a.png"');
        expect(result).toContain('alt="photo"');
    });

    it('strips onerror/onload XSS event handlers', () => {
        const result = sanitizePastedHtml(
            '<img src="x" onerror="alert(1)" onload="alert(2)">',
        );
        expect(result).not.toContain('onerror');
        expect(result).not.toContain('onload');
        expect(result).not.toContain('alert');
    });

    it('strips all on* event handler attributes', () => {
        const result = sanitizePastedHtml(
            '<div onclick="steal()" onmouseover="track()">safe</div>',
        );
        expect(result).not.toContain('onclick');
        expect(result).not.toContain('onmouseover');
    });

    it('strips data-* attributes (except data-attachment)', () => {
        const result = sanitizePastedHtml(
            '<div data-custom="foo" data-tracking="bar">content</div>',
        );
        expect(result).not.toContain('data-custom');
        expect(result).not.toContain('data-tracking');
    });

    it('preserves data-attachment attribute', () => {
        const html = '<div data-attachment=\'{"name":"file.pdf"}\'></div>';
        const result = sanitizePastedHtml(html);
        expect(result).toContain('data-attachment');
    });

    it('handles nested elements with mixed safe/unsafe attributes', () => {
        const html = '<ul style="list-style:none"><li class="item"><strong>bold</strong></li></ul>';
        const result = sanitizePastedHtml(html);
        expect(result).not.toContain('style');
        expect(result).not.toContain('class');
        expect(result).toContain('<strong>bold</strong>');
    });

    it('returns empty string for empty input', () => {
        expect(sanitizePastedHtml('')).toBe('');
    });

    it('drops an <img> whose src is a data: URI (CSP img-src does not include data:)', () => {
        const result = sanitizePastedHtml(
            '<p>before</p><img src="data:image/png;base64,iVBOR" alt="x"><p>after</p>',
        );
        expect(result).not.toContain('<img');
        expect(result).not.toContain('data:image');
        expect(result).toContain('<p>before</p>');
        expect(result).toContain('<p>after</p>');
    });

    it('preserves an <img> with a blob: src (upload-in-progress preview)', () => {
        const html = '<img src="blob:https://www.actionstation.in/uuid" alt="photo">';
        const result = sanitizePastedHtml(html);
        expect(result).toContain('src="blob:https://www.actionstation.in/uuid"');
    });

    it('drops an <img> with no src or an unsafe src', () => {
        expect(sanitizePastedHtml('<img alt="none">')).not.toContain('<img');
        expect(sanitizePastedHtml('<img src="javascript:alert(1)">')).not.toContain('<img');
    });
});
