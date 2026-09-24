/**
 * LegalSection — titled prose block shared by the legal page contents.
 */
import type { ReactNode } from 'react';

interface LegalSectionProps {
    title: string;
    children: ReactNode;
}

export function LegalSection({ title, children }: LegalSectionProps) {
    return (
        <section style={{ marginBottom: 40 }}>
            <h2
                className="font-semibold text-[var(--color-text-primary)]"
                style={{ fontSize: 'var(--font-size-lg)', marginBottom: 12 }}
            >
                {title}
            </h2>
            <div className="text-[var(--color-text-secondary)]" style={{ fontSize: 'var(--font-size-base)', lineHeight: 1.8 }}>
                {children}
            </div>
        </section>
    );
}
