/**
 * TipTap Image Extension — Block-level images with base64 support and resize.
 * Extends the default Image to constrain resize-wrapper DOM so images
 * never overflow their parent node regardless of intrinsic resolution.
 */
import Image from '@tiptap/extension-image';
import type { Editor } from '@tiptap/react';
import { strings } from '@/shared/localization/strings';

/** Check whether an image src uses a safe protocol */
export function isSafeImageSrc(src: string): boolean {
    if (!src) return false;
    if (src.startsWith('data:image/')) return true;
    try {
        const url = new URL(src);
        return url.protocol === 'https:';
    } catch {
        return false;
    }
}

const MIN_IMAGE_WIDTH = 50;
const MIN_IMAGE_HEIGHT = 50;

/**
 * Apply responsive constraints to the ResizableNodeView DOM so images
 * scale to fit their container instead of overflowing.
 *
 * The container is `display:flex` and the wrapper is a flex item whose
 * automatic min-width equals the image's intrinsic width (e.g. 1920px).
 * `overflow: hidden` on a flex item resets its automatic minimum to 0,
 * and `max-width: 100%` caps it to the editor's width.
 */
export function applyResponsiveConstraints(dom: HTMLElement): void {
    dom.style.overflow = 'hidden';

    const wrapper = dom.firstElementChild as HTMLElement | null;
    if (!wrapper) return;

    wrapper.style.maxWidth = '100%';
    wrapper.style.minWidth = '0';
    wrapper.style.overflow = 'hidden';

    const img = wrapper.querySelector('img');
    if (img) {
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
    }
}

/**
 * Create the "×" delete button that sits in the top-right corner of an image
 * node view. Extracted as a pure factory so it can be unit-tested without a
 * running TipTap editor instance.
 */
export function createImageDeleteButton(
    editor: Editor,
    getPos: () => number | undefined,
    nodeSize: number,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'node-image-delete-btn';
    btn.setAttribute('aria-label', strings.canvas.imageRemove);
    btn.textContent = '×';
    btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (typeof pos === 'number') {
            const { state, dispatch } = editor.view;
            dispatch(state.tr.delete(pos, pos + nodeSize));
        }
    });
    return btn;
}

/**
 * Inject the delete button into the image node view container DOM.
 * The container gets `position: relative` so the button can be absolutely
 * placed at the top-right corner.
 */
export function applyImageDeleteButton(
    dom: HTMLElement,
    editor: Editor,
    getPos: () => number | undefined,
    nodeSize: number,
): void {
    dom.style.position = 'relative';
    const btn = createImageDeleteButton(editor, getPos, nodeSize);
    dom.appendChild(btn);
}

export const NodeImage = Image.extend({
    addNodeView() {
        const parentFactory = this.parent?.();
        if (!parentFactory) return null;

        return (props: Parameters<typeof parentFactory>[0]) => {
            const nodeView = parentFactory(props);
            applyResponsiveConstraints(nodeView.dom);
            applyImageDeleteButton(
                nodeView.dom,
                props.editor as unknown as Editor,
                props.getPos as () => number | undefined,
                props.node.nodeSize,
            );
            return nodeView;
        };
    },
}).configure({
    inline: false,
    allowBase64: true,
    resize: {
        enabled: true,
        directions: ['right', 'bottom'],
        minWidth: MIN_IMAGE_WIDTH,
        minHeight: MIN_IMAGE_HEIGHT,
        alwaysPreserveAspectRatio: true,
    },
    HTMLAttributes: {
        class: 'node-image',
        loading: 'lazy',
    },
});
