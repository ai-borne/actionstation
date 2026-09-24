/**
 * legalRoutes — public, auth-free legal routes resolved by pathname.
 * Lazy so the legal copy stays out of the main bundle.
 */
import { lazy, type ComponentType } from 'react';

const LEGAL_ROUTES: ReadonlyMap<string, ComponentType> = new Map<string, ComponentType>([
    ['/terms', lazy(() => import('./TermsOfService').then(m => ({ default: m.TermsOfService })))],
    ['/privacy', lazy(() => import('./PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })))],
    ['/refund', lazy(() => import('./RefundPolicy').then(m => ({ default: m.RefundPolicy })))],
    ['/contact', lazy(() => import('./ContactPage').then(m => ({ default: m.ContactPage })))],
]);

/** Page component for a legal pathname, or null when the path is not a legal page. */
export function resolveLegalRoute(pathname: string): ComponentType | null {
    return LEGAL_ROUTES.get(pathname) ?? null;
}
