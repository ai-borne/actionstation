/**
 * Brand logo mark — filled circle with a checkmark. SSOT for the in-app brand identity.
 * Mirrors public/favicon.svg; the circle follows the active theme's primary color.
 */
interface BrandLogoIconProps {
    size?: number;
    className?: string;
}

export function BrandLogoIcon({ size = 32, className }: BrandLogoIconProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            data-testid="brand-logo"
            className={className}
        >
            <circle cx="24" cy="24" r="20" fill="var(--color-primary)" />
            <path
                d="M16 24L22 30L32 18"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
