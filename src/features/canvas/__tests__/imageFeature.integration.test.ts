/**
 * Image Feature Integration Tests — End-to-end validation of the image pipeline
 * Covers: types, validation, markdown round-trip, slash commands, security, infra
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IMAGE_ACCEPTED_MIME_TYPES, IMAGE_MAX_FILE_SIZE } from '../types/image';
import { isAcceptedImageType, validateImageFile, buildNodeImagePath } from '../services/imageUploadService';
import { isSafeImageSrc } from '../extensions/imageExtension';
import { markdownToHtml, htmlToMarkdown } from '../services/markdownConverter';
import { slashCommands, getCommandById, filterCommands } from '../services/slashCommands';
import { sanitizeFilename } from '@/shared/utils/sanitize';
import { strings } from '@/shared/localization/strings';

describe('Image feature — security integration', () => {
    it('rejects all XSS vectors in image src', () => {
        const xssVectors = [
            'javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'blob:https://evil.com/uuid',
            'http://insecure.com/img.png',
            '',
        ];
        xssVectors.forEach(src => {
            expect(isSafeImageSrc(src)).toBe(false);
        });
    });

    it('allows only safe protocols for images', () => {
        expect(isSafeImageSrc('https://cdn.example.com/img.jpg')).toBe(true);
        expect(isSafeImageSrc('data:image/png;base64,iVBOR')).toBe(true);
    });

    it('rejects SVG (potential XSS vector) as upload type', () => {
        expect(isAcceptedImageType('image/svg+xml')).toBe(false);
    });

    it('sanitizes filenames to prevent path traversal', () => {
        const malicious = '../../etc/passwd';
        const path = buildNodeImagePath('u1', 'w1', 'n1', malicious);
        expect(path).not.toContain('..');
        expect(path).not.toContain('/etc/');
    });

    it('sanitizeFilename strips control characters', () => {
        expect(sanitizeFilename('file\x00\x1Fname.jpg')).toBe('filename.jpg');
    });
});

describe('Image feature — type system integration', () => {
    it('IMAGE_ACCEPTED_MIME_TYPES matches isAcceptedImageType', () => {
        IMAGE_ACCEPTED_MIME_TYPES.forEach(mime => {
            expect(isAcceptedImageType(mime)).toBe(true);
        });
    });

    it('max file size is 5MB', () => {
        expect(IMAGE_MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    });

    it('validation uses localized error messages', () => {
        const bigFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
        expect(() => validateImageFile(bigFile)).toThrow(strings.canvas.imageFileTooLarge);

        const badFile = new File(['x'], 'bad.txt', { type: 'text/plain' });
        expect(() => validateImageFile(badFile)).toThrow(strings.canvas.imageUnsupportedType);
    });
});

describe('Image feature — slash command integration', () => {
    it('insert-image command exists in registry', () => {
        const cmd = getCommandById('insert-image');
        expect(cmd).toBeDefined();
        expect(cmd?.icon).toBe('🖼️');
    });

    it('slash commands have unique IDs and prefixes', () => {
        const ids = slashCommands.map(c => c.id);
        const prefixes = slashCommands.map(c => c.prefix);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    it('filters by "image" keyword', () => {
        const results = filterCommands('image');
        expect(results.some(c => c.id === 'insert-image')).toBe(true);
        expect(results.some(c => c.id === 'ai-generate')).toBe(false);
    });

    it('filters by "photo" keyword', () => {
        const results = filterCommands('photo');
        expect(results.some(c => c.id === 'insert-image')).toBe(true);
    });
});

describe('Image feature — markdown round-trip integration', () => {
    it('preserves image with alt text', () => {
        const md = '![My Photo](https://cdn.example.com/photo.jpg)';
        expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    });

    it('preserves image without alt text', () => {
        const md = '![](https://cdn.example.com/photo.jpg)';
        expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    });

    it('preserves image between paragraphs', () => {
        const md = 'Before\n\n![pic](https://x.com/img.jpg)\n\nAfter';
        expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    });

    it('handles multiple images in sequence', () => {
        const md = '![a](https://x.com/1.jpg)\n\n![b](https://x.com/2.jpg)';
        expect(htmlToMarkdown(markdownToHtml(md))).toBe(md);
    });

    it('produces block-level <img> without <p> wrapper', () => {
        const md = '![pic](https://x.com/img.jpg)';
        const html = markdownToHtml(md);
        expect(html).not.toMatch(/<p><img/);
        expect(html).toContain('<img');
    });

    it('preserves image width attribute through round-trip', () => {
        const html = '<img src="https://cdn.example.com/photo.jpg" alt="pic" width="250">';
        const md = htmlToMarkdown(html);
        const roundTripped = markdownToHtml(md);
        expect(roundTripped).toContain('width="250"');
    });

    it('sanitizes brackets in alt text to prevent markdown injection', () => {
        const html = '<img src="https://x.com/img.jpg" alt="[evil](https://xss.com)" />';
        const md = htmlToMarkdown(html);
        expect(md).not.toContain('[evil]');
        expect(md).toBe('![evil(https://xss.com)](https://x.com/img.jpg)');
    });
});

describe('Image feature — post-upload persistence', () => {
    it('onAfterInsert callback parameter is accepted by insertImageIntoEditor', async () => {
        const { insertImageIntoEditor } = await import('../services/imageInsertService');
        expect(insertImageIntoEditor.length).toBeGreaterThanOrEqual(3);
    });
});

describe('Image feature — localization integration', () => {
    it('all image-related strings exist', () => {
        expect(strings.canvas.imageUploading).toBeDefined();
        expect(strings.canvas.imageUploadFailed).toBeDefined();
        expect(strings.canvas.imageReadFailed).toBeDefined();
        expect(strings.canvas.imageUnsafeUrl).toBeDefined();
        expect(strings.canvas.imageFileTooLarge).toBeDefined();
        expect(strings.canvas.imageUnsupportedType).toBeDefined();
        expect(strings.nodeUtils.image).toBeDefined();
        expect(strings.slashCommands.insertImage.label).toBeDefined();
        expect(strings.slashCommands.insertImage.description).toBeDefined();
    });

    it('no string values are empty', () => {
        expect(strings.canvas.imageUploading.length).toBeGreaterThan(0);
        expect(strings.canvas.imageUploadFailed.length).toBeGreaterThan(0);
        expect(strings.canvas.imageReadFailed.length).toBeGreaterThan(0);
        expect(strings.canvas.imageUnsafeUrl.length).toBeGreaterThan(0);
        expect(strings.canvas.imageFileTooLarge.length).toBeGreaterThan(0);
        expect(strings.canvas.imageUnsupportedType.length).toBeGreaterThan(0);
        expect(strings.nodeUtils.image.length).toBeGreaterThan(0);
        expect(strings.slashCommands.insertImage.label.length).toBeGreaterThan(0);
    });
});

describe('Image feature — infrastructure', () => {
    const rulesPath = path.resolve(__dirname, '../../../../storage.rules');

    it('storage.rules file exists', () => {
        expect(fs.existsSync(rulesPath)).toBe(true);
    });

    it('storage.rules contains user-scoped image path', () => {
        const content = fs.readFileSync(rulesPath, 'utf-8');
        expect(content).toContain('users/{userId}');
        expect(content).toContain('request.auth.uid == userId');
    });

    it('firebase.json references storage.rules', () => {
        const configPath = path.resolve(__dirname, '../../../../firebase.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(config.storage).toBeDefined();
        // firebase.json uses a named target list (array) so `storage:rules` deploys under firebase-tools 15
        const targets: Array<{ rules?: string }> = [config.storage].flat();
        expect(targets.map((t) => t.rules)).toContain('storage.rules');
    });

    it('storage.rules enforces server-side 5MB upload limit', () => {
        const content = fs.readFileSync(rulesPath, 'utf-8');
        expect(content).toContain('request.resource.size');
        expect(content).toContain('5 * 1024 * 1024');
    });
});
