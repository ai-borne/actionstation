/**
 * Image Extension Tests — Validates TipTap Image configuration and URL safety
 */
import { describe, it, expect } from 'vitest';
import { isSafeImageSrc, NodeImage, applyResponsiveConstraints } from '../imageExtension';

describe('isSafeImageSrc', () => {
    it('accepts HTTPS URLs', () => {
        expect(isSafeImageSrc('https://cdn.example.com/photo.jpg')).toBe(true);
    });

    it('rejects data:image/ base64 URLs (CSP img-src does not include data:)', () => {
        expect(isSafeImageSrc('data:image/jpeg;base64,/9j/4A==')).toBe(false);
        expect(isSafeImageSrc('data:image/png;base64,iVBOR')).toBe(false);
    });

    it('accepts blob: URLs (transient upload preview)', () => {
        expect(isSafeImageSrc('blob:https://www.actionstation.in/uuid')).toBe(true);
    });

    it('rejects javascript: URLs', () => {
        expect(isSafeImageSrc('javascript:alert(1)')).toBe(false);
    });

    it('rejects data:text/html URLs (XSS vector)', () => {
        expect(isSafeImageSrc('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    it('rejects HTTP URLs (insecure)', () => {
        expect(isSafeImageSrc('http://example.com/img.png')).toBe(false);
    });

    it('rejects empty string', () => {
        expect(isSafeImageSrc('')).toBe(false);
    });

    it('rejects malformed URLs', () => {
        expect(isSafeImageSrc('not-a-url')).toBe(false);
    });

});

describe('NodeImage extension', () => {
    it('is named "image"', () => {
        expect(NodeImage.name).toBe('image');
    });

    it('is configured as block-level (not inline)', () => {
        expect(NodeImage.options.inline).toBe(false);
    });

    it('does not allow base64 images (CSP img-src does not include data:)', () => {
        expect(NodeImage.options.allowBase64).toBe(false);
    });

    it('has resize enabled with aspect ratio preservation', () => {
        const resize = NodeImage.options.resize;
        expect(resize).not.toBe(false);
        expect(typeof resize === 'object' && resize.enabled).toBe(true);
        expect(typeof resize === 'object' && resize.alwaysPreserveAspectRatio).toBe(true);
    });
});

describe('applyResponsiveConstraints', () => {
    function createResizableDom(): HTMLDivElement {
        const container = document.createElement('div');
        container.style.display = 'flex';
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        const img = document.createElement('img');
        img.style.width = '1920px';
        img.style.height = '1080px';
        wrapper.appendChild(img);
        container.appendChild(wrapper);
        return container;
    }

    it('sets overflow hidden on the container', () => {
        const dom = createResizableDom();
        applyResponsiveConstraints(dom);
        expect(dom.style.overflow).toBe('hidden');
    });

    it('constrains wrapper with max-width 100% and min-width 0', () => {
        const dom = createResizableDom();
        applyResponsiveConstraints(dom);
        const wrapper = dom.firstElementChild as HTMLElement;
        expect(wrapper.style.maxWidth).toBe('100%');
        expect(wrapper.style.minWidth).toBe('0');
        expect(wrapper.style.overflow).toBe('hidden');
    });

    it('sets max-width 100% and height auto on the img', () => {
        const dom = createResizableDom();
        applyResponsiveConstraints(dom);
        const img = dom.querySelector('img') as HTMLImageElement;
        expect(img.style.maxWidth).toBe('100%');
        expect(img.style.height).toBe('auto');
    });

    it('handles container with no children gracefully', () => {
        const dom = document.createElement('div');
        expect(() => applyResponsiveConstraints(dom)).not.toThrow();
        expect(dom.style.overflow).toBe('hidden');
    });

    it('handles wrapper with no img gracefully', () => {
        const dom = document.createElement('div');
        const wrapper = document.createElement('div');
        dom.appendChild(wrapper);
        expect(() => applyResponsiveConstraints(dom)).not.toThrow();
        expect(wrapper.style.maxWidth).toBe('100%');
    });
});
