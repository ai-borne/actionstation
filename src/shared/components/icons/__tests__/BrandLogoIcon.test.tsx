import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogoIcon } from '../BrandLogoIcon';

describe('BrandLogoIcon', () => {
    it('renders a decorative circle + checkmark mark at the default size', () => {
        render(<BrandLogoIcon />);
        const svg = screen.getByTestId('brand-logo');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('width', '32');
        expect(svg.querySelector('circle')).toHaveAttribute('fill', 'var(--color-primary)');
        expect(svg.querySelector('path')).toHaveAttribute('d', 'M16 24L22 30L32 18');
    });

    it('honours size and className props', () => {
        render(<BrandLogoIcon size={56} className="brand" />);
        const svg = screen.getByTestId('brand-logo');
        expect(svg).toHaveAttribute('width', '56');
        expect(svg).toHaveAttribute('height', '56');
        expect(svg).toHaveClass('brand');
    });
});
