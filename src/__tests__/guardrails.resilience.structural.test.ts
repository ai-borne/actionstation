/**
 * Architectural Guardrail — Client Resilience
 *
 * Prevents regression of production-hardening fixes via source code scanning.
 * Covers: #2 (fetch timeout), #9 (silent catches), #10 (setTimeout cleanup),
 *         #13 (React keys), #14 (optional chaining), #15 (void .catch),
 *         #16 (IDB migration), #17 (env validation), file size limits.
 *
 * See also: guardrails.security.structural.test.ts for security checks.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '__tests__']);

function collectSrcFiles(dir: string, results: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectSrcFiles(full, results);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
            results.push(full);
        }
    }
    return results;
}

const rel = (f: string) => relative(SRC_DIR, f);
const read = (f: string) => readFileSync(f, 'utf-8');
const srcFiles = collectSrcFiles(SRC_DIR);

// ─── #2: fetch() must include AbortSignal timeout ─────────────────────────

describe('#2 — fetch() calls must have AbortSignal timeout', () => {
    const ALLOWLIST = [
        'features/auth/services/calendarAuthService.ts',
        'features/canvas/services/linkPreviewService.ts',
        'features/canvas/services/linkPreviewFallback.ts',
        'features/ai/services/attachmentTextCache.ts',
        'features/calendar/services/serverCalendarClient.ts',
        'shared/services/performanceService.ts',
    ];

    it('no client fetch() without signal in non-allowlisted files', () => {
        const violations: string[] = [];
        for (const file of srcFiles) {
            const r = rel(file);
            if (ALLOWLIST.includes(r)) continue;
            const content = read(file);
            if (!/\bfetch\s*\(/.test(content)) continue;
            if (!content.includes('signal:') && !content.includes('AbortSignal')) {
                violations.push(r);
            }
        }
        expect(violations, fmtMsg('fetch() without AbortSignal timeout', 'Add signal: AbortSignal.timeout(MS)', violations)).toEqual([]);
    });
});

// ─── #9: catch blocks must report errors ──────────────────────────────────

describe('#9 — catch blocks must report errors (no silent swallowing)', () => {
    const ALLOWLIST = [
        'shared/utils/storage.ts', 'shared/services/storageQuotaService.ts',
        'shared/services/swCacheService.ts', 'features/canvas/services/linkPreviewCache.ts',
        'features/canvas/services/linkPreviewService.ts', 'features/canvas/services/linkPreviewFallback.ts',
        'features/canvas/services/imageInsertService.ts', 'features/canvas/services/storagePathUtils.ts',
        'features/canvas/extensions/attachmentExtension.ts', 'features/canvas/extensions/imageExtension.ts',
        'features/canvas/utils/imageProxyUrl.ts', 'features/canvas/hooks/useLinkPreviewRetry.ts',
        'features/auth/services/calendarAuthService.ts', 'features/auth/services/authService.ts',
        'features/auth/services/authTokenService.ts', 'features/ai/services/attachmentTextCache.ts',
        'features/calendar/services/calendarIntentService.ts',
        'features/knowledgeBank/services/geminiClient.ts',
        'features/knowledgeBank/services/geminiPdfExtractor.ts',
        'features/knowledgeBank/services/imageDescriptionService.ts',
        'features/knowledgeBank/services/storageService.ts',
        'features/knowledgeBank/services/summarizationService.ts',
        'features/knowledgeBank/services/summarizeEntries.ts',
        'features/subscription/services/subscriptionService.ts',
        'features/workspace/services/persistentCacheService.ts',
        'features/workspace/services/workspaceCache.ts',
    ];

    it('no silent catch blocks in service/hook files', () => {
        const targets = srcFiles.filter((f) => {
            const r = rel(f);
            if (ALLOWLIST.includes(r)) return false;
            return r.includes('/services/') || r.includes('/hooks/');
        });
        const violations: string[] = [];
        const REPORTING = ['captureError', 'console.error', 'console.warn', 'logger.error', 'logger.warn', 'toast.', 'setError', 'throw', 'reject'];

        for (const file of targets) {
            const content = read(file);
            for (const match of content.matchAll(/\}\s*catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/g)) {
                const body = match[1] ?? '';
                if (body.trim().length > 0 && !REPORTING.some((k) => body.includes(k))) {
                    const line = content.slice(0, match.index).split('\n').length;
                    violations.push(`${rel(file)}:${line}`);
                }
            }
        }
        expect(violations, fmtMsg('silent catch blocks', 'Add captureError() or toast.error()', violations)).toEqual([]);
    });
});

// ─── #10: setTimeout in useEffect must be cleaned up ──────────────────────

describe('#10 — setTimeout inside useEffect must have clearTimeout', () => {
    it('hooks with setTimeout inside useEffect include clearTimeout', () => {
        const violations: string[] = [];
        for (const file of srcFiles.filter((f) => f.includes('/hooks/'))) {
            const content = read(file);
            for (const m of content.matchAll(/useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},\s*\[/g)) {
                const body = m[1] ?? '';
                if (body.includes('setTimeout') && !body.includes('clearTimeout')) {
                    violations.push(`${rel(file)}:${content.slice(0, m.index).split('\n').length}`);
                }
            }
        }
        expect(violations, fmtMsg('setTimeout without clearTimeout in useEffect', 'Clear timeout in return function', violations)).toEqual([]);
    });

    // Extends #10 to useCallback bodies. A standalone setTimeout (line starting
    // with `setTimeout`) inside useCallback is a memory leak: if the component
    // unmounts before the timer fires, the callback runs against a torn-down
    // tree. Fix: store the return value in a ref and clear it in a useEffect
    // cleanup (timerRef.current = setTimeout(...) + clearTimeout on unmount).
    it('hooks with standalone setTimeout inside useCallback store the timer ID in a ref', () => {
        const violations: string[] = [];
        for (const file of srcFiles.filter((f) => f.includes('/hooks/'))) {
            const content = read(file);
            for (const m of content.matchAll(/useCallback\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]*?)\},\s*\[/g)) {
                const body = m[1] ?? '';
                // A line whose first non-whitespace token is `setTimeout` is a
                // fire-and-forget call whose ID is not captured for cleanup.
                if (/\n\s+setTimeout\s*\(/.test(body)) {
                    violations.push(`${rel(file)}:${content.slice(0, m.index).split('\n').length}`);
                }
            }
        }
        expect(
            violations,
            fmtMsg(
                'standalone setTimeout in useCallback (timer ID not stored)',
                'Store timer ID: timerRef.current = setTimeout(...). Add useEffect cleanup: clearTimeout(timerRef.current)',
                violations,
            ),
        ).toEqual([]);
    });
});

// ─── #13: no bare array indices as React keys ─────────────────────────────

describe('#13 — React keys must not be bare array indices', () => {
    it('no component uses key={i} or key={index}', () => {
        const violations: string[] = [];
        for (const file of srcFiles.filter((f) => f.endsWith('.tsx'))) {
            if (/key=\{(?:i|index|idx)\}/.test(read(file))) violations.push(rel(file));
        }
        expect(violations, fmtMsg('bare index as React key', 'Use key={`${id}-${i}`}', violations)).toEqual([]);
    });
});

// ─── #14: node.data must use optional chaining ────────────────────────────

describe('#14 — node.data access must use optional chaining', () => {
    const ALLOWLIST = [
        'features/canvas/stores/', 'features/canvas/types/',
        'features/ai/services/contextChainBuilder.ts', 'features/ai/services/nodePoolBuilder.ts',
        'features/ai/hooks/useNodeTransformation.ts', 'features/canvas/services/documentInsertService.ts',
        'features/workspace/services/mergeNodes.ts', 'app/components/SettingsPanel/sections/AIMemorySection.tsx',
    ];

    it('no unsafe node.data. access outside stores/types', () => {
        const violations: string[] = [];
        for (const file of srcFiles) {
            const r = rel(file);
            if (ALLOWLIST.some((a) => r.includes(a))) continue;
            if (r.includes('/stores/') || r.includes('/types/')) continue;
            const content = read(file);
            if (/node\.data\.\w+/.test(content) && !/node\.data\?\.\w+/.test(content)) violations.push(r);
        }
        expect(violations, fmtMsg('node.data without optional chaining', 'Use node.data?.field', violations)).toEqual([]);
    });
});

// ─── #15: void async calls must have .catch ───────────────────────────────

describe('#15 — fire-and-forget void calls must have .catch', () => {
    const ALLOWLIST = [
        'features/workspace/hooks/useAutosave.ts', 'features/workspace/hooks/useSaveCallback.ts',
        'features/canvas/components/CanvasRadar.tsx', 'features/canvas/hooks/usePanToNode.ts',
        'shared/hooks/useSwRegistration.ts',
        'app/hooks/useWorkspaceLoading.ts', 'app/hooks/useQueueDrainer.ts',
        'features/workspace/hooks/useWorkspaceLoader.ts', 'features/workspace/hooks/usePinWorkspaceButton.ts',
        'features/workspace/hooks/useWorkspaceSwitcher.ts', 'features/canvas/hooks/useAuthToken.ts',
        'features/canvas/hooks/useIdeaCardActions.ts', 'features/canvas/hooks/useImageInsert.ts',
        'features/canvas/hooks/useLinkPreviewRetry.ts', 'features/canvas/components/nodes/ShareMenu.tsx',
        'features/knowledgeBank/hooks/useFileProcessor.ts',
        'shared/components/OfflineFallback.tsx', 'shared/components/Sidebar.tsx',
    ];

    it('no void asyncFn() without .catch in hooks/components', () => {
        const violations: string[] = [];
        for (const file of srcFiles) {
            const r = rel(file);
            if (ALLOWLIST.includes(r)) continue;
            if (!r.includes('/hooks/') && !r.includes('/components/')) continue;
            const lines = read(file).split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? '';
                if (/\bvoid\s+\w+/.test(line) && !line.includes('.catch') && !line.includes('fitView')) {
                    if (/\bvoid\s+(?:import|initWebVitals|checkSync)/.test(line)) continue;
                    violations.push(`${r}:${i + 1}`);
                }
            }
        }
        expect(violations, fmtMsg('void async without .catch', 'Add .catch((e) => captureError(e as Error))', violations)).toEqual([]);
    });
});

// ─── #16: IndexedDB versioned migration ───────────────────────────────────

describe('#16 — IndexedDB must use versioned migration handler', () => {
    it('indexedDbService.ts uses oldVersion-based upgrade', () => {
        const p = join(SRC_DIR, 'shared', 'services', 'indexedDbService.ts');
        if (!existsSync(p)) return;
        const content = read(p);
        expect(content).toContain('oldVersion');
        expect(content).toContain('upgradeHandler');
    });
});

// ─── #17: env vars validated at startup ───────────────────────────────────

describe('#17 — env vars must be validated at startup', () => {
    const REQUIRED_VARS = [
        'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
        'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID',
        'VITE_FIREBASE_APP_ID', 'VITE_CLOUD_FUNCTIONS_URL',
    ];

    it('envValidation.ts covers all critical VITE_ vars', () => {
        const p = join(SRC_DIR, 'config', 'envValidation.ts');
        if (!existsSync(p)) { expect.fail('envValidation.ts must exist'); return; }
        const content = read(p);
        for (const v of REQUIRED_VARS) expect(content, `must validate ${v}`).toContain(v);
    });

    it('main.tsx calls validateProductionEnv()', () => {
        expect(read(join(SRC_DIR, 'main.tsx'))).toContain('validateProductionEnv');
    });
});

// ─── File size limits ─────────────────────────────────────────────────────

describe('File size limits (300-line max)', () => {
    it('no source file exceeds 300 lines', () => {
        const violations: string[] = [];
        for (const file of srcFiles) {
            const lines = read(file).split('\n').length;
            if (lines > 300) violations.push(`${rel(file)} (${lines} lines)`);
        }
        expect(violations, `Files exceeding 300 lines:\n${violations.map((v) => `  - ${v}`).join('\n')}`).toEqual([]);
    });
});

function fmtMsg(issue: string, fix: string, violations: string[]): string {
    return `${issue}:\n  Fix: ${fix}\n\n${violations.map((v) => `  - ${v}`).join('\n')}`;
}

// ─── Keyboard: approved keydown listener allowlist ────────────────────────────

describe('Keyboard: raw addEventListener("keydown") allowlist', () => {
    // Only these files are permitted to attach keydown listeners via addEventListener:
    //   useKeyboardShortcuts — capture-phase, all plain + modifier shortcuts
    //   useEscapeLayer       — single global Escape listener (priority-ordered)
    //   useNodeShortcuts     — per-node capture listener guarded by GLOBAL_SHORTCUT_KEYS
    //   useFocusTrap         — container-scoped Tab-trap for accessibility (WCAG 2.1 §2.1.2)
    //
    // All other Escape handling → useEscapeLayer
    // All other shortcut handling → useKeyboardShortcuts
    // Local input handlers (SearchBar, TagInput, WorkspaceItem) use React
    // onKeyDown props which are NOT addEventListener calls and are NOT restricted.
    const KEYDOWN_ALLOWLIST = new Set([
        'app/hooks/useKeyboardShortcuts.ts',
        'shared/hooks/useEscapeLayer.ts',
        'features/canvas/hooks/useNodeShortcuts.ts',
        'shared/hooks/useFocusTrap.ts',
    ]);

    it('no file outside the allowlist attaches a raw document keydown listener', () => {
        const violations: string[] = [];
        for (const file of srcFiles) {
            const r = rel(file);
            if (KEYDOWN_ALLOWLIST.has(r)) continue;
            const content = read(file);
            if (
                content.includes("addEventListener('keydown'") ||
                content.includes('addEventListener("keydown"')
            ) {
                violations.push(r);
            }
        }
        expect(
            violations,
            fmtMsg(
                'raw keydown listener outside allowlist',
                'Use useEscapeLayer (Escape) or useKeyboardShortcuts (shortcuts). ' +
                'Local input handlers must use React onKeyDown props, not addEventListener.',
                violations,
            ),
        ).toEqual([]);
    });
});
