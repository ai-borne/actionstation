import type { IdeaNodeData, NodeColorKey } from '../types/node';
import type { NodeHeadingHandle } from '../components/nodes/NodeHeading';
import type { SubmitKeymapHandler } from '../extensions/submitKeymap';
import type { Editor } from '@tiptap/react';

export interface UseIdeaCardHandlersParams {
    id: string;
    selected: boolean | undefined;
    setShowTagInput: (v: boolean) => void;
    contentRef: React.RefObject<HTMLDivElement | null>;
    headingRef: React.RefObject<NodeHeadingHandle | null>;
    editor: Editor | null;
    getMarkdown: () => string;
    setContent: (md: string) => void;
    getEditableContent: () => string;
    saveContent: (md: string) => void;
    submitHandlerRef: React.MutableRefObject<SubmitKeymapHandler | null>;
    imageUploadFn: (file: File) => Promise<string>;
    generateFromPrompt: (nodeId: string) => void | Promise<void>;
    branchFromNode: (nodeId: string) => string | undefined;
    resolvedData: IdeaNodeData;
    isEditing: boolean;
    onSubmitAI: (prompt: string) => void;
}

export type { NodeColorKey };
