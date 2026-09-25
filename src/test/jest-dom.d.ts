import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// jest-dom's own vitest augmentation declares `Assertion<T = any>`, which no longer merges with
// vitest 5's `Assertion<R, T>`. Re-declare it with matching type parameters.
declare module 'vitest' {
    interface Assertion<R extends void | Promise<void> = void, T = unknown>
        extends TestingLibraryMatchers<unknown, R> {
        readonly __element?: T;
    }
    interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
