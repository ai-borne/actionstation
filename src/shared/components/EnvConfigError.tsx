/**
 * Blocking screen when required production env vars are missing.
 */
import React from 'react';
import { strings } from '@/shared/localization/strings';

interface EnvConfigErrorProps {
    readonly errors: readonly string[];
}

export const EnvConfigError = React.memo(function EnvConfigError({ errors }: EnvConfigErrorProps) {
    return (
        <div
            role="alert"
            className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)]"
            style={{ padding: 'var(--space-6)', gap: 'var(--space-4)' }}
        >
            <h1 className="text-xl font-semibold">{strings.security.envConfigTitle}</h1>
            <p className="max-w-md text-center text-sm text-[var(--color-text-secondary)]">
                {strings.security.envConfigBody}
            </p>
            <ul className="max-w-lg text-sm" style={{ paddingLeft: 'var(--space-5)' }}>
                {errors.map((err) => (
                    <li key={err}>{err}</li>
                ))}
            </ul>
        </div>
    );
});
