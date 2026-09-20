/**
 * WelcomeScreen — full-screen first-visit overlay.
 * Portal-rendered; dismissed by CTA or Escape.
 */
import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from '@/shared/hooks/useEscapeLayer';
import { ESCAPE_PRIORITY } from '@/shared/hooks/escapePriorities';
import { useFocusTrap } from '@/shared/hooks/useFocusTrap';
import { strings } from '@/shared/localization/strings';
import { BrandLogoIcon } from '@/shared/components/icons';

interface WelcomeScreenProps {
    readonly onDismiss: () => void;
}

/** Bullet list highlighting three key features of the app on the welcome screen. */
function WelcomeBullets() {
    return (
        <ul
            className="text-[var(--color-text-secondary)] flex flex-col"
            style={{ fontSize: 'var(--font-size-sm)', lineHeight: 'var(--line-height-relaxed)', listStyle: 'disc', paddingLeft: 'var(--space-lg)', margin: 0, gap: 'var(--space-xs)' }}
        >
            <li>{strings.onboarding.welcome.bullet1}</li>
            <li>{strings.onboarding.welcome.bullet2}</li>
            <li>{strings.onboarding.welcome.bullet3}</li>
        </ul>
    );
}

/** Full-screen first-visit welcome overlay; portal-rendered and dismissed by CTA or Escape. */
export const WelcomeScreen = React.memo(function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
    useEscapeLayer(ESCAPE_PRIORITY.MODAL, true, onDismiss);
    const dialogRef = useRef<HTMLDivElement>(null);
    useFocusTrap(dialogRef, true);

    return createPortal(
        <div
            ref={dialogRef}
            className="fixed inset-0 bg-[var(--color-background)] z-[calc(var(--z-modal)+10)] flex items-center justify-center"
            role="dialog" aria-modal="true"
            aria-labelledby="onboarding-welcome-title"
            data-testid="welcome-screen"
        >
            <div className="flex flex-col w-full" style={{ maxWidth: 560, padding: 'var(--space-2xl)', gap: 'var(--space-md)' }}>
                {/* Logo row */}
                <div className="flex items-center" style={{ gap: 'var(--space-sm)' }}>
                    <BrandLogoIcon size={28} />
                    <span className="font-bold text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-lg)', letterSpacing: '-0.01em' }}>
                        {strings.app.name}
                    </span>
                </div>

                {/* Early access badge */}
                <span
                    className="inline-block self-start text-[var(--color-primary)] rounded-full"
                    style={{ border: '1px solid var(--color-primary)', padding: 'var(--space-xxs) var(--space-sm)', fontSize: 'var(--font-size-xs)' }}
                >
                    {strings.onboarding.welcome.earlyAccess}
                </span>

                {/* Title */}
                <h1 id="onboarding-welcome-title" className="font-bold text-[var(--color-text-primary)]" style={{ fontSize: 'var(--font-size-2xl)', lineHeight: 'var(--line-height-tight)', margin: 0 }}>
                    {strings.onboarding.welcome.title}
                </h1>

                {/* Intro */}
                <p className="text-[var(--color-text-secondary)]" style={{ fontSize: 'var(--font-size-sm)', margin: 0 }}>
                    {strings.onboarding.welcome.intro}
                </p>

                <WelcomeBullets />

                {/* CTA */}
                <button
                    className="self-start text-[var(--color-text-on-primary)] font-medium cursor-pointer rounded-md transition-colors duration-150 ease-in-out"
                    style={{ background: 'var(--color-primary)', border: 'none', padding: 'var(--space-sm) var(--space-xl)', fontSize: 'var(--font-size-base)', marginTop: 'var(--space-sm)' }}
                    onClick={onDismiss} autoFocus type="button"
                >
                    {strings.onboarding.welcome.ctaLabel}
                </button>
            </div>
        </div>,
        document.body,
    );
});
