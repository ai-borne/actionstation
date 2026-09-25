import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import react from 'eslint-plugin-react';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'dist-node', 'coverage', 'node_modules', 'functions', '*.config.js', '*.config.ts', '**/*.d.ts'] },
    {
        extends: [
            js.configs.recommended,
            ...tseslint.configs.strictTypeChecked,
            ...tseslint.configs.stylisticTypeChecked,
        ],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.es2020,
            },
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.node.json', './e2e/tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
            react,
            'jsx-a11y': jsxA11y,
            'import-x': importX,
        },
        rules: {
            // ═══════════════════════════════════════════════════════════════
            // REACT HOOKS - Strict enforcement
            // ═══════════════════════════════════════════════════════════════
            ...reactHooks.configs.recommended.rules,
            'react-hooks/exhaustive-deps': 'error',

            // ═══════════════════════════════════════════════════════════════
            // REACT REFRESH - HMR compatibility
            // ═══════════════════════════════════════════════════════════════
            'react-refresh/only-export-components': [
                'warn',
                { allowConstantExport: true },
            ],

            // ═══════════════════════════════════════════════════════════════
            // REACT - Best practices
            // ═══════════════════════════════════════════════════════════════
            'react/jsx-key': ['error', { checkFragmentShorthand: true }],
            'react/jsx-no-duplicate-props': 'error',
            'react/jsx-no-undef': 'error',
            'react/jsx-uses-react': 'off', // Not needed with new JSX transform
            'react/jsx-uses-vars': 'error',
            'react/no-children-prop': 'error',
            'react/no-danger-with-children': 'error',
            'react/no-deprecated': 'error',
            'react/no-direct-mutation-state': 'error',
            'react/no-unescaped-entities': 'error',
            'react/no-unknown-property': 'error',
            'react/react-in-jsx-scope': 'off', // Not needed with new JSX transform
            'react/self-closing-comp': 'error',
            'react/void-dom-elements-no-children': 'error',

            // ═══════════════════════════════════════════════════════════════
            // ACCESSIBILITY - WCAG compliance
            // TODO: Re-enable jsx-a11y/click-events-have-key-events after adding
            // keyboard handlers to interactive elements (Phase 7 of CI upgrade)
            // ═══════════════════════════════════════════════════════════════
            'jsx-a11y/alt-text': 'error',
            'jsx-a11y/anchor-has-content': 'error',
            'jsx-a11y/anchor-is-valid': 'error',
            'jsx-a11y/aria-props': 'error',
            'jsx-a11y/aria-proptypes': 'error',
            'jsx-a11y/aria-role': 'error',
            'jsx-a11y/aria-unsupported-elements': 'error',
            'jsx-a11y/click-events-have-key-events': 'off', // Temporarily suppressed
            'jsx-a11y/heading-has-content': 'error',
            'jsx-a11y/html-has-lang': 'error',
            'jsx-a11y/img-redundant-alt': 'error',
            'jsx-a11y/no-access-key': 'error',
            'jsx-a11y/no-distracting-elements': 'error',
            'jsx-a11y/no-redundant-roles': 'error',
            'jsx-a11y/role-has-required-aria-props': 'error',
            'jsx-a11y/role-supports-aria-props': 'error',
            'jsx-a11y/scope': 'error',

            // ═══════════════════════════════════════════════════════════════
            // IMPORTS - Order and validation (rules that don't require resolver)
            // ═══════════════════════════════════════════════════════════════
            'import-x/no-duplicates': 'error',
            'import-x/first': 'error',
            'import-x/newline-after-import': 'error',

            // ═══════════════════════════════════════════════════════════════
            // TYPESCRIPT - Strict type safety
            // ═══════════════════════════════════════════════════════════════
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-non-null-assertion': 'error',
            '@typescript-eslint/prefer-nullish-coalescing': 'error',
            '@typescript-eslint/prefer-optional-chain': 'error',
            '@typescript-eslint/strict-boolean-expressions': [
                'warn',
                {
                    allowString: true,
                    allowNumber: true,
                    allowNullableObject: true,
                    allowNullableBoolean: true,
                    allowNullableString: true,
                    allowNullableNumber: true,
                    allowAny: true,
                },
            ],
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': [
                'error',
                { checksVoidReturn: { attributes: false } },
            ],
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/prefer-as-const': 'error',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
            '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-confusing-void-expression': [
                'error',
                { ignoreArrowShorthand: true },
            ],
            // Relax some strict rules that are too noisy
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                { allowNumber: true, allowBoolean: true },
            ],
            '@typescript-eslint/no-unsafe-assignment': 'warn',
            '@typescript-eslint/no-unsafe-member-access': 'warn',
            '@typescript-eslint/no-unsafe-call': 'warn',
            '@typescript-eslint/no-unsafe-return': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',

            // ═══════════════════════════════════════════════════════════════
            // CODE QUALITY - Best practices
            // ═══════════════════════════════════════════════════════════════
            'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
            'max-lines-per-function': [
                'warn',
                { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
            ],
            'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
            'no-debugger': 'error',
            'no-alert': 'warn',
            'no-eval': 'error',
            'no-implied-eval': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'prefer-const': 'error',
            'no-var': 'error',
            'object-shorthand': 'error',
            'prefer-template': 'error',
            'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
            'no-param-reassign': ['error', { props: false }],
            'no-nested-ternary': 'warn',
            complexity: ['warn', { max: 20 }],
            'max-depth': ['warn', { max: 5 }],
        },
    },
    // Playwright E2E: fixtures hand the test a value through a callback named `use`, which the
    // React hooks rule mistakes for React's `use` hook.
    {
        files: ['e2e/**/*.ts'],
        rules: { 'react-hooks/rules-of-hooks': 'off' },
    },
    // Test files - relax rules for testing patterns
    {
        files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/non-nullable-type-assertion-style': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
            '@typescript-eslint/prefer-nullish-coalescing': 'off',
            'no-unsafe-optional-chaining': 'off',
            'max-lines-per-function': 'off',
            'max-lines': 'off',
            'no-console': 'off',
        },
    }
);
