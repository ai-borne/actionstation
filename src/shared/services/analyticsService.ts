/**
 * Analytics Service — PostHog (lazy-loaded)
 * Wraps PostHog with typed events. Key loaded from VITE_POSTHOG_KEY.
 * PostHog is dynamically imported after first paint to keep it off the critical path.
 * Safe to call even when PostHog is not configured (no-ops silently).
 */
import { logger } from '@/shared/services/logger';
import { consentService } from '@/features/legal/services/consentService';

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? 'https://app.posthog.com';

interface PostHogLike {
    init: (key: string, config: Record<string, unknown>) => void;
    identify: (id: string) => void;
    reset: () => void;
    capture: (event: string, properties?: Record<string, unknown>) => void;
    opt_out_capturing: () => void;
}

let posthogInstance: PostHogLike | null = null;
let loadPromise: Promise<PostHogLike | null> | null = null;

async function getPosthog(): Promise<PostHogLike | null> {
    if (posthogInstance) return posthogInstance;
    if (!KEY) return null;
    loadPromise ??= import('posthog-js')
            .then((mod) => {
                posthogInstance = mod.default;
                return posthogInstance;
            })
            .catch((err: unknown) => {
                if (import.meta.env.DEV) {
                    logger.warn('[Analytics] Failed to load posthog-js', err);
                }
                return null;
            });
    return loadPromise;
}

/**
 * Initialize PostHog lazily. Schedules the actual init after first paint.
 * Callers may treat this as fire-and-forget.
 */
export function initAnalytics(): void {
    if (!consentService.hasConsented()) return;

    if (!KEY) {
        if (import.meta.env.DEV) {
            logger.info('[Analytics] VITE_POSTHOG_KEY not set — skipping initialization.');
        }
        return;
    }

    void getPosthog().then((ph) => {
        if (!ph) return;
        ph.init(KEY, {
            api_host: HOST,
            autocapture: false,
            respect_dnt: true,
            persistence: 'localStorage',
            disable_session_recording: true,
            loaded(instance: PostHogLike) {
                if (import.meta.env.DEV) {
                    instance.opt_out_capturing();
                }
            },
        });
    });
}

/**
 * Identify the signed-in user. Call after successful authentication.
 * We only pass the opaque user ID — no PII (name, email).
 */
export function identifyUser(userId: string): void {
    if (!consentService.hasConsented()) return;
    void getPosthog().then((ph) => ph?.identify(userId));
}

/** Stop analytics capture when user opts out */
export function optOutAnalytics(): void {
    void getPosthog().then((ph) => ph?.opt_out_capturing());
}

/** Reset identity on sign-out so next user gets a fresh anonymous ID. */
export function resetAnalyticsUser(): void {
    void getPosthog().then((ph) => ph?.reset());
}

// ── Typed event catalogue ─────────────────────────────────────────────────────

export function trackSignIn(): void { track('sign_in'); }
export function trackSignOut(): void { track('sign_out'); }

export function trackNodeCreated(nodeType: string): void {
    track('node_created', { node_type: nodeType });
}

export function trackAiGenerated(nodeType: string): void {
    track('ai_generated', { node_type: nodeType });
}

export function trackWorkspaceCreated(): void { track('workspace_created'); }
export function trackWorkspaceDeleted(): void { track('workspace_deleted'); }

export function trackTemplateUsed(templateId: string, isCustom: boolean): void {
    track('template_used', { template_id: templateId, is_custom: isCustom });
}

export function trackKbEntryAdded(method: 'paste' | 'file'): void {
    track('kb_entry_added', { method });
}

export function trackCanvasUndo(
    commandType: string,
    source: 'keyboard' | 'toast' | 'button' = 'keyboard',
): void {
    track('canvas_undo', { command_type: commandType, source });
}

export function trackCanvasRedo(
    commandType: string,
    source: 'keyboard' | 'toast' | 'button' = 'keyboard',
): void {
    track('canvas_redo', { command_type: commandType, source });
}

type SettingKey =
    | 'theme' | 'canvasGrid' | 'autoSave' | 'autoSaveInterval'
    | 'compactMode' | 'canvasScrollMode' | 'connectorStyle'
    | 'isCanvasLocked' | 'canvasFreeFlow' | 'gridColumns' | 'autoAnalyzeDocuments' | 'data_export'
    | 'branch_export' | 'canvas_undo' | 'canvas_redo'
    | 'toolbarButtonOrder' | 'toolbarHiddenButtons' | 'toolbarReset'
    | 'hoverMenuIcons' | 'rightClickMenuIcons' | 'iconPlacementReset'
    | 'gdpr_data_export';

export function trackSettingsChanged(setting: SettingKey, value: string | boolean | number | readonly string[]): void {
    track('settings_changed', { setting, value });
}

export function trackDocumentAgentTriggered(filename: string): void {
    track('document_agent_triggered', { filename });
}

export function trackDocumentAgentCompleted(classification: string, confidence: string): void {
    track('document_agent_completed', { classification, confidence });
}

export function trackDocumentAgentFailed(errorType: string): void {
    track('document_agent_failed', { error_type: errorType });
}

export function trackDocumentAgentExpanded(sectionCount: number): void {
    track('document_agent_expanded', { section_count: sectionCount });
}

export function trackCrossReferenceGenerated(matchCount: number): void {
    track('cross_reference_generated', { match_count: matchCount });
}

export function trackAggregationGenerated(classificationCount: number): void {
    track('aggregation_generated', { classification_count: classificationCount });
}

// ── Onboarding events ─────────────────────────────────────────────────────────

export function trackOnboardingWelcomeShown(): void { track('onboarding_welcome_shown'); }
export function trackOnboardingWelcomeDismissed(): void { track('onboarding_welcome_dismissed'); }

export function trackOnboardingStepViewed(step: string, index: number): void {
    track('onboarding_step_viewed', { step, index });
}

// ── Tile / spatial chunking events ────────────────────────────────────────────

export function trackTileLoadFailed(tileId: string): void {
    track('tile_load_failed', { tile_id: tileId });
}

export function trackTileLoadRetried(tileCount: number): void {
    track('tile_load_retried', { tile_count: tileCount });
}

export function trackOnboardingCompleted(stepsViewed: number): void {
    track('onboarding_completed', { steps_viewed: stepsViewed });
}

export function trackOnboardingSkipped(atStep: number): void {
    track('onboarding_skipped', { at_step: atStep });
}

// ── Internal helper ───────────────────────────────────────────────────────────

function track(event: string, properties?: Record<string, unknown>): void {
    if (!consentService.hasConsented()) return;
    void getPosthog().then((ph) => ph?.capture(event, properties));
}
