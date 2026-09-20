import { useCallback, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCanvasStore } from '../stores/canvasStore';
import { enterFocusWithEditing } from '../stores/focusStore';
import { toggleContentModeWithUndo } from '../services/contentModeToggleService';
import { useIdeaCardActions } from './useIdeaCardActions';
import { useIdeaCardDuplicateAction } from './useIdeaCardDuplicateAction';
import { useIdeaCardShareAction } from './useIdeaCardShareAction';
import { useIdeaCardImageHandlers } from './useIdeaCardImageHandlers';
import { useNodeInput, type NodeShortcutMap } from './useNodeInput';
import { useNodeShortcuts } from './useNodeShortcuts';
import { deleteNodeAttachments } from '../services/documentUploadService';
import { captureError } from '@/shared/services/sentryService';
import type { UseIdeaCardHandlersParams, NodeColorKey } from './useIdeaCardHandlers.types';

export function useIdeaCardHandlers(params: UseIdeaCardHandlersParams) {
    const { id, selected, setShowTagInput, contentRef, headingRef, editor, getMarkdown, setContent,
        getEditableContent, saveContent, submitHandlerRef, imageUploadFn,
        generateFromPrompt, branchFromNode, resolvedData, isEditing, onSubmitAI } = params;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- legacy field, heading is SSOT
    const { prompt = '', output, isGenerating } = resolvedData;

    const { slashHandler, handleImageClick, handleAttachmentClick, documentInsertFn, handleAfterImageInsert } = useIdeaCardImageHandlers({ id, editor, getMarkdown, imageUploadFn });

    const { handleDelete: rawDelete, handleRegenerate, handleConnectClick, handleTransform,
        handleHeadingChange, handleCopy, handleTagsChange, isTransforming } = useIdeaCardActions({
        nodeId: id, getEditableContent, contentRef, generateFromPrompt, branchFromNode,
    });
    const { handleDuplicate } = useIdeaCardDuplicateAction(id);
    const { handleShare, isSharing } = useIdeaCardShareAction(id);
    const handleDelete = useCallback(() => {
        // Read attachments fresh from the store (resolvedData may be a stale prop snapshot).
        const freshAttachments = useCanvasStore.getState().nodes.find((n) => n.id === id)?.data.attachments;
        if (freshAttachments && freshAttachments.length > 0) void deleteNodeAttachments(freshAttachments).catch((e: unknown) => captureError(e as Error));
        rawDelete();
    }, [id, rawDelete]);

    const handlePinToggle = useCallback(() => { useCanvasStore.getState().toggleNodePinned(id); }, [id]);
    const handleCollapseToggle = useCallback(() => { useCanvasStore.getState().toggleNodeCollapsed(id); }, [id]);
    const handlePoolToggle = useCallback(() => { useCanvasStore.getState().toggleNodePoolMembership(id); }, [id]);
    const handleColorChange = useCallback((colorKey: NodeColorKey) => {
        useCanvasStore.getState().updateNodeColor(id, colorKey);
    }, [id]);
    const handleTagOpen = useCallback(() => { setShowTagInput(true); }, [setShowTagInput]);
    const handleFocusClick = useCallback(() => { enterFocusWithEditing(id); }, [id]);
    const handleCmdClick = useCallback((e: ReactMouseEvent) => {
        if (!e.metaKey && !e.ctrlKey) return;
        enterFocusWithEditing(id);
    }, [id]);

    const focusBody = useCallback(() => { if (editor) editor.commands.focus(); }, [editor]);
    const focusHeading = useCallback(() => { headingRef.current?.focus(); }, [headingRef]);
    const handleMindmapToggle = useCallback(() => { void toggleContentModeWithUndo(id).catch((e: unknown) => captureError(e as Error)); }, [id]);
    const nodeShortcuts: NodeShortcutMap = useMemo(() => ({
        t: handleTagOpen, c: handleCollapseToggle, f: handleFocusClick, m: handleMindmapToggle,
    }), [handleTagOpen, handleCollapseToggle, handleFocusClick, handleMindmapToggle]);
    useNodeShortcuts(selected ?? false, nodeShortcuts);

    const { handleKeyDown, handleDoubleClick } = useNodeInput({
        nodeId: id, isEditing, editor, getMarkdown, setContent, getEditableContent, saveContent,
        submitHandlerRef, isGenerating: Boolean(isGenerating),
        isNewEmptyNode: !prompt && !output, focusHeading, shortcuts: nodeShortcuts,
        nodeOutput: output, contentMode: resolvedData.contentMode,
    });

    const onTagsChange = useCallback((ids: string[]) => {
        handleTagsChange(ids);
        if (ids.length === 0) setShowTagInput(false);
    }, [handleTagsChange, setShowTagInput]);
    const onKeyDownReact = useCallback((e: ReactKeyboardEvent) => handleKeyDown(e.nativeEvent), [handleKeyDown]);

    return {
        slashHandler, handleImageClick, handleAttachmentClick, documentInsertFn, handleAfterImageInsert, handleDelete, handleRegenerate,
        handleConnectClick, handleTransform, handleHeadingChange, handleCopy, handleDuplicate,
        handleShare, isSharing, isTransforming, handlePinToggle, handleCollapseToggle,
        handlePoolToggle, handleColorChange, handleTagOpen, handleFocusClick, handleCmdClick,
        handleDoubleClick, onSubmitAI, onTagsChange, onKeyDownReact, focusBody,
    };
}
