/**
 * useNodeGeneration Hook - Bridges AI service with canvas store
 * Handles AI generation for IdeaCard nodes
 * Calendar intent interception delegated to calendarIntentHandler
 */
import { useCallback } from 'react';
import { useCanvasStore, getNodeMap } from '@/features/canvas/stores/canvasStore';
import { useAIStore } from '../stores/aiStore';
import { generateContentWithContext } from '../services/geminiService';
import { createIdeaNode } from '@/features/canvas/types/node';
import { createEdge } from '@/features/canvas/types/edge';
import { generateUUID } from '@/shared/utils/uuid';
import { calculateBranchPlacement } from '@/features/canvas/services/freeFlowPlacementService';
import { usePanToNodeContext } from '@/features/canvas/contexts/PanToNodeContext';
import { buildContextChain } from '../services/contextChainBuilder';
import { strings } from '@/shared/localization/strings';
import { toast, toastWithAction } from '@/shared/stores/toastStore';
import { useKnowledgeBankContext } from '@/features/knowledgeBank/hooks/useKnowledgeBankContext';
import { useNodePoolContext } from './useNodePoolContext';
import { processCalendarIntent } from '@/features/calendar/services/calendarIntentHandler';
import { useNodeCreationGuard } from '@/features/subscription/hooks/useNodeCreationGuard';
import { useTierLimits } from '@/features/subscription/hooks/useTierLimits';
import { useRazorpayCheckout } from '@/features/subscription/hooks/useRazorpayCheckout';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';
import { logger } from '@/shared/services/logger';

type StartCheckout = (planId: string, currency: 'INR' | 'USD') => Promise<void>;

function showAiDailyLimitToast(startCheckout: StartCheckout): void {
    toastWithAction(
        strings.subscription.limits.aiDailyLimit,
        'warning',
        {
            label: strings.subscription.upgradeCta,
            onClick: () => {
                void startCheckout(PRO_ANNUAL_PLAN_ID, 'INR').catch(
                    (e: unknown) => logger.error('[useNodeGeneration] Checkout failed', e as Error),
                );
            },
        },
    );
}

/**
 * Hook for generating AI content from IdeaCard nodes
 */
export function useNodeGeneration() {
    const { getKBContext } = useKnowledgeBankContext();
    const { getPoolContext } = useNodePoolContext();
    const { panToPosition } = usePanToNodeContext();
    const { guardNodeCreation } = useNodeCreationGuard();
    const { check, dispatch } = useTierLimits();
    const { startCheckout } = useRazorpayCheckout();

    /**
     * Generate AI output from an IdeaCard node
     * Updates output in-place (no new node created)
     */
    const generateFromPrompt = useCallback(
        async (nodeId: string) => {
            // Check daily AI generation limit
            const aiCheck = check('aiDaily');
            if (!aiCheck.allowed) {
                showAiDailyLimitToast(startCheckout);
                return;
            }

            const freshNodes = useCanvasStore.getState().nodes;
            const node = getNodeMap(freshNodes).get(nodeId);
            if (node?.type !== 'idea') return;

            const ideaData = node.data;
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-deprecated -- intentional: empty string fallback + legacy field access
            const promptText = (ideaData.heading?.trim() || ideaData.prompt) || '';
            if (!promptText) return;

            // Set generating immediately before any async work to prevent placeholder flash
            useCanvasStore.getState().setNodeGenerating(nodeId, true);

            try {
                // Calendar intent interception (spinner already set above)
                const handled = await processCalendarIntent(nodeId, promptText);
                if (handled) return;

                const upstreamNodes = useCanvasStore.getState().getUpstreamNodes(nodeId);
                const contextChain = await buildContextChain(upstreamNodes);

                useAIStore.getState().startGeneration(nodeId);
                const generationType = contextChain.length > 0 ? 'chain' as const : 'single' as const;

                const excludeIds = new Set([nodeId, ...upstreamNodes.map((n) => n.id)]);
                const kbContext = getKBContext(promptText, generationType);
                const poolContext = await getPoolContext(promptText, generationType, excludeIds);
                const content = await generateContentWithContext(promptText, contextChain, poolContext, kbContext, ideaData.contentMode);

                useCanvasStore.getState().updateNodeOutput(nodeId, content);
                dispatch({ type: 'AI_GENERATED' });
                useAIStore.getState().completeGeneration();
            } catch (error) {
                const message = error instanceof Error ? error.message : strings.errors.aiError;
                useAIStore.getState().setError(message);
                toast.error(message);
            } finally {
                useCanvasStore.getState().setNodeGenerating(nodeId, false);
            }
        },
        [getKBContext, getPoolContext, check, dispatch, startCheckout]
    );

    /**
     * Branch from an IdeaCard to create a new connected IdeaCard
     */
    const branchFromNode = useCallback(
        (sourceNodeId: string) => {
            if (!guardNodeCreation()) return undefined;

            const freshNodes = useCanvasStore.getState().nodes;
            const sourceNode = getNodeMap(freshNodes).get(sourceNodeId);
            if (!sourceNode) return;

            const position = calculateBranchPlacement(sourceNode, freshNodes);
            const newNode = createIdeaNode(
                `idea-${generateUUID()}`,
                sourceNode.workspaceId,
                position,
                ''
            );

            const edge = createEdge(
                `edge-${generateUUID()}`,
                sourceNode.workspaceId,
                sourceNodeId,
                newNode.id,
            );
            useCanvasStore.getState().addNodeAndEdge(newNode, edge);
            panToPosition(position.x, position.y);

            return newNode.id;
        },
        [panToPosition, guardNodeCreation]
    );

    return {
        generateFromPrompt,
        branchFromNode,
    };
}
