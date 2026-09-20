import { useCallback, useState, useRef } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { useFocusStore } from '../stores/focusStore';
import { useNodeData } from './useNodeData';
import { useIdeaCardEditor } from './useIdeaCardEditor';
import { useIdeaCardState } from './useIdeaCardState';
import { useIdeaCardHandlers } from './useIdeaCardHandlers';
import { useLinkPreviewRetry } from './useLinkPreviewRetry';
import { useProximityBar } from './useProximityBar';
import { useNodeGeneration } from '@/features/ai/hooks/useNodeGeneration';
import { useNodeImageUpload } from './useNodeImageUpload';
import { useIdeaCardCalendar } from '@/features/calendar/hooks/useIdeaCardCalendar';
import type { IdeaNodeData } from '../types/node';
import type { NodeHeadingHandle } from '../components/nodes/NodeHeading';
import type { AfterImageInsertFn } from '../services/imageInsertService';
import type { DocumentInsertFn } from '../extensions/fileHandlerExtension';

interface UseIdeaCardParams {
    id: string;
    rfData: IdeaNodeData;
    selected: boolean | undefined;
}

export function useIdeaCard({ id, rfData, selected }: UseIdeaCardParams) {
    const storeData = useNodeData(id);
    const resolvedData: IdeaNodeData = storeData ?? rfData;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy field, heading is SSOT
    const { heading, prompt = '', output, isGenerating, isPinned, isCollapsed, tags: tagIds = [], linkPreviews, calendarEvent } = resolvedData;
    const promptSource = (heading?.trim() ?? prompt) || '';
    const isAICard = Boolean(promptSource && output && promptSource !== output);
    const [showTagInput, setShowTagInput] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null), cardWrapperRef = useRef<HTMLDivElement>(null);
    const barContainerRef = useRef<HTMLDivElement>(null), headingRef = useRef<NodeHeadingHandle>(null);
    const proximityLostFnRef = useRef<(() => void) | undefined>(undefined);
    const registerProximityLostFn = useCallback((fn: () => void) => { proximityLostFnRef.current = fn; }, []);
    const handleProximityLost = useCallback(() => { proximityLostFnRef.current?.(); }, []);
    useProximityBar(cardWrapperRef, barContainerRef, handleProximityLost);
    const { generateFromPrompt, branchFromNode } = useNodeGeneration();
    const { getEditableContent, saveContent, placeholder, onSubmitAI } = useIdeaCardState({
        nodeId: id, prompt, output, isAICard,
        generateFromPrompt, // eslint-disable-line @typescript-eslint/no-misused-promises -- async, consumed by useIdeaCardState
    });
    const calendar = useIdeaCardCalendar({ nodeId: id, calendarEvent });
    // Scoped boolean selectors: only re-render THIS card when editing/focus targets it.
    // Unscoped `(s) => s.editingNodeId` returned the raw string — when editing starts,
    // ALL N cards re-rendered because null→"idea-xxx" is a value change for every subscriber.
    // Scoped `=== id` returns boolean — only the 2 affected cards re-render (old + new editor).
    const isEditingThisNode = useCanvasStore((s) => s.editingNodeId === id);
    const isFocusedOnThisNode = useFocusStore((s) => s.focusedNodeId === id);
    const isEditing = isEditingThisNode && !isFocusedOnThisNode;
    const imageUploadFn = useNodeImageUpload(id);
    const documentInsertFnRef = useRef<DocumentInsertFn | null>(null);
    const onAfterImageInsertRef = useRef<AfterImageInsertFn | null>(null);
    const onExitEditing = useCallback((): void => {
        if (useFocusStore.getState().focusedNodeId) return;
        useCanvasStore.getState().stopEditing();
    }, []);

    // Deferred blur: only exit editing if focus truly left the card.
    // heading→body (Enter/Tab) must NOT exit — activeElement stays inside.
    const onHeadingBlur = useCallback((): void => {
        requestAnimationFrame(() => {
            if (cardWrapperRef.current?.contains(document.activeElement)) return;
            onExitEditing();
        });
    }, [onExitEditing, cardWrapperRef]);

    const { editor, getMarkdown, setContent, submitHandlerRef } = useIdeaCardEditor({
        isEditing, output, getEditableContent, placeholder, saveContent,
        onExitEditing,
        imageUploadFn,
        documentInsertFnRef,
        onAfterImageInsertRef,
    });

    const handlers = useIdeaCardHandlers({
        id, selected, setShowTagInput, contentRef, headingRef, editor, getMarkdown, setContent,
        getEditableContent, saveContent, submitHandlerRef, imageUploadFn,
        generateFromPrompt, branchFromNode, resolvedData, isEditing, onSubmitAI,
    });

    documentInsertFnRef.current = handlers.documentInsertFn;
    onAfterImageInsertRef.current = handlers.handleAfterImageInsert;
    useLinkPreviewRetry(id, linkPreviews);
    return {
        resolvedData, heading, prompt, output, isGenerating, isPinned, isCollapsed, tagIds, linkPreviews, calendarEvent,
        isAICard, showTagInput, contentRef, cardWrapperRef, barContainerRef, headingRef,
        editor, hasContent: Boolean(output), isEditing, onHeadingBlur, calendar, registerProximityLostFn, ...handlers,
    };
}
