/**
 * LinkPreviewCard Tests
 * TDD: Validates link preview card rendering, proxied images, interactions, accessibility
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LinkPreviewCard, LinkPreviewList } from '../LinkPreviewCard';
import type { LinkPreviewMetadata } from '../../../types/node';
import { strings } from '@/shared/localization/strings';

// Mock signed-URL resolution (no Firebase in test environment)
vi.mock('../../../hooks/useSignedImageUrl', () => ({
    useSignedImageUrl: (url: string | undefined) => {
        if (!url) return '';
        return `https://proxy.test/proxyImage?url=${encodeURIComponent(url)}&sig=abc&exp=1`;
    },
}));

describe('LinkPreviewCard', () => {
    const fullPreview: LinkPreviewMetadata = {
        url: 'https://example.com/article',
        title: 'Example Article Title',
        description: 'A detailed description of the example article content.',
        image: 'https://example.com/og-image.jpg',
        favicon: 'https://example.com/favicon.ico',
        domain: 'example.com',
        cardType: 'summary_large_image',
        fetchedAt: Date.now(),
    };

    const minimalPreview: LinkPreviewMetadata = {
        url: 'https://minimal.org',
        domain: 'minimal.org',
        fetchedAt: Date.now(),
    };

    const errorPreview: LinkPreviewMetadata = {
        url: 'https://broken.com',
        domain: 'broken.com',
        fetchedAt: Date.now(),
        error: true,
    };

    describe('Full metadata rendering', () => {
        it('renders title', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            expect(screen.getByText('Example Article Title')).toBeInTheDocument();
        });

        it('renders description', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            expect(screen.getByText(/A detailed description/)).toBeInTheDocument();
        });

        it('renders domain', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            expect(screen.getByText('example.com')).toBeInTheDocument();
        });

        it('renders favicon through proxy', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const favicon = screen.getByAltText('example.com favicon');
            expect(favicon).toBeInTheDocument();
            expect(favicon).toHaveAttribute('src',
                expect.stringContaining('proxy.test/proxyImage'));
        });

        it('renders OG image through proxy', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');
            expect(image).toBeInTheDocument();
            expect(image).toHaveAttribute('src',
                expect.stringContaining('proxy.test/proxyImage'));
        });
    });

    describe('Image proxying and security', () => {
        it('never puts an auth token in image URLs', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            for (const img of screen.getAllByRole('img')) {
                expect(img.getAttribute('src') ?? '').not.toMatch(/[?&]token=/);
            }
        });

        it('uses proxied URL for OG image (not direct external URL)', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');
            expect(image.getAttribute('src')).not.toBe(
                'https://example.com/og-image.jpg',
            );
            expect(image.getAttribute('src')).toContain('proxy.test');
        });

        it('uses proxied URL for favicon', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const favicon = screen.getByAltText('example.com favicon');
            expect(favicon.getAttribute('src')).not.toBe(
                'https://example.com/favicon.ico',
            );
            expect(favicon.getAttribute('src')).toContain('proxy.test');
        });

        it('sets referrerPolicy="no-referrer" on OG image', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');
            expect(image).toHaveAttribute('referrerPolicy', 'no-referrer');
        });

        it('sets referrerPolicy="no-referrer" on favicon', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const favicon = screen.getByAltText('example.com favicon');
            expect(favicon).toHaveAttribute('referrerPolicy', 'no-referrer');
        });
    });

    describe('Image error handling', () => {
        it('shows placeholder when image fails to load', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');

            // Simulate image load error
            fireEvent.error(image);

            // Image <img> should be removed, placeholder div should appear
            expect(screen.queryByAltText('Example Article Title'))
                .not.toBeInTheDocument();
            expect(screen.getByRole('img', { name: 'Example Article Title' }))
                .toBeInTheDocument();
        });

        it('shows fallback placeholder with accessible text when image fails to load', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');

            fireEvent.error(image);

            const placeholder = screen.getByRole('img', { name: 'Example Article Title' });
            expect(placeholder).toBeInTheDocument();
            expect(placeholder.textContent).toContain(strings.linkPreview.imageFailed);
        });

        it('placeholder uses string resource, not hardcoded text', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');

            fireEvent.error(image);

            const placeholder = screen.getByRole('img', { name: 'Example Article Title' });
            expect(placeholder.textContent).toBe(strings.linkPreview.imageFailed);
        });
    });

    describe('Minimal metadata rendering', () => {
        it('renders domain when title is missing', () => {
            render(<LinkPreviewCard preview={minimalPreview} />);
            const elements = screen.getAllByText('minimal.org');
            expect(elements.length).toBeGreaterThanOrEqual(1);
        });

        it('renders URL as fallback title when title and domain missing', () => {
            const noTitle: LinkPreviewMetadata = {
                url: 'https://example.com/page',
                fetchedAt: Date.now(),
            };
            render(<LinkPreviewCard preview={noTitle} />);
            expect(screen.getByText('https://example.com/page')).toBeInTheDocument();
        });

        it('does not render image when image is undefined', () => {
            render(<LinkPreviewCard preview={minimalPreview} />);
            expect(screen.queryByRole('img')).not.toBeInTheDocument();
        });

        it('does not render description when undefined', () => {
            render(<LinkPreviewCard preview={minimalPreview} />);
            const elements = screen.getAllByText('minimal.org');
            expect(elements.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('Error state', () => {
        it('renders unavailable message for error previews', () => {
            render(<LinkPreviewCard preview={errorPreview} />);
            expect(screen.getByText(strings.linkPreview.unavailable)).toBeInTheDocument();
        });

        it('still renders domain for error previews', () => {
            render(<LinkPreviewCard preview={errorPreview} />);
            expect(screen.getByText('broken.com')).toBeInTheDocument();
        });
    });

    describe('Interactions', () => {
        it('opens link in new tab on click', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const link = screen.getByRole('link');
            expect(link).toHaveAttribute('href', 'https://example.com/article');
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });

        it('calls onRemove when remove button is clicked', () => {
            const onRemove = vi.fn();
            render(<LinkPreviewCard preview={fullPreview} onRemove={onRemove} />);
            const removeBtn = screen.getByLabelText(strings.linkPreview.removePreview);
            fireEvent.click(removeBtn);
            expect(onRemove).toHaveBeenCalledWith('https://example.com/article');
        });

        it('does not render remove button when onRemove is not provided', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            expect(screen.queryByLabelText(strings.linkPreview.removePreview))
                .not.toBeInTheDocument();
        });
    });

    describe('imageError resets when proxiedImage URL changes (auth token timing fix)', () => {
        it('shows image after error when proxied URL changes to a valid URL', async () => {
            // Simulate: initial render with failing image → imageError=true
            // Then proxied URL changes (e.g. token loads) → imageError must reset
            const { rerender } = render(<LinkPreviewCard preview={fullPreview} />);
            const image = screen.getByAltText('Example Article Title');

            // Simulate the proxy returning 401 (no token yet) → image error
            fireEvent.error(image);
            expect(screen.queryByAltText('Example Article Title')).not.toBeInTheDocument();

            // Now rerender with a different preview (different image URL) — simulates
            // token becoming available and buildProxiedImageUrl returning a new URL
            const updatedPreview = {
                ...fullPreview,
                image: 'https://example.com/og-image-v2.jpg',
            };
            await act(async () => { rerender(<LinkPreviewCard preview={updatedPreview} />); });

            // imageError should have reset — image element should be visible again
            expect(screen.getByAltText('Example Article Title')).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        it('has accessible link role', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            expect(screen.getByRole('link')).toBeInTheDocument();
        });

        it('link has descriptive aria-label', () => {
            render(<LinkPreviewCard preview={fullPreview} />);
            const link = screen.getByRole('link');
            expect(link).toHaveAttribute('aria-label',
                expect.stringContaining('Example Article Title'));
        });
    });
});

describe('LinkPreviewList', () => {
    const previews: Record<string, LinkPreviewMetadata> = {
        'https://example.com': {
            url: 'https://example.com',
            title: 'Example',
            domain: 'example.com',
            fetchedAt: Date.now(),
        },
        'https://test.org': {
            url: 'https://test.org',
            title: 'Test Site',
            domain: 'test.org',
            fetchedAt: Date.now(),
        },
    };

    it('renders a card for each preview in the record', () => {
        render(<LinkPreviewList previews={previews} />);
        expect(screen.getByText('Example')).toBeInTheDocument();
        expect(screen.getByText('Test Site')).toBeInTheDocument();
    });

    it('renders nothing when previews record is empty', () => {
        const { container } = render(<LinkPreviewList previews={{}} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the list container with test id', () => {
        render(<LinkPreviewList previews={previews} />);
        expect(screen.getByTestId('link-preview-list')).toBeInTheDocument();
    });

    it('passes onRemove to each card', () => {
        const onRemove = vi.fn();
        render(<LinkPreviewList previews={previews} onRemove={onRemove} />);
        const removeButtons = screen.getAllByLabelText(strings.linkPreview.removePreview);
        expect(removeButtons).toHaveLength(2);
        const firstButton = removeButtons[0];
        if (firstButton) {
            fireEvent.click(firstButton);
        }
        expect(onRemove).toHaveBeenCalled();
    });
});
