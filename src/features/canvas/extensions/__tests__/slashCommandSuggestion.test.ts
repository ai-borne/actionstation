/**
 * slashCommandSuggestion Tests
 * TDD: Validates updatePosition + createSlashSuggestionRender lifecycle
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePosition, createSlashSuggestionRender, SlashCommandSuggestion } from '../slashCommandSuggestion';

// Mock ReactRenderer
const mockUpdateProps = vi.fn();
const mockDestroy = vi.fn();
const mockOnKeyDown = vi.fn();
const mockElement = document.createElement('div');
vi.mock('@tiptap/react', () => ({
    ReactRenderer: vi.fn().mockImplementation(function MockReactRenderer() {
        return {
            element: mockElement,
            ref: { onKeyDown: mockOnKeyDown },
            updateProps: mockUpdateProps,
            destroy: mockDestroy,
        };
    }),
}));

describe('SlashCommandSuggestion priority', () => {
    it('has higher priority than SubmitKeymap (1000) so Suggestion handles Enter/Escape before SubmitKeymap', () => {
        expect(SlashCommandSuggestion.config.priority).toBeGreaterThan(1000);
    });

    it('has higher priority than StarterKit (100) so its handleKeyDown runs before StarterKit Enter', () => {
        expect(SlashCommandSuggestion.config.priority).toBeGreaterThan(100);
    });
});

describe('updatePosition', () => {
    let popup: HTMLDivElement;

    beforeEach(() => {
        popup = document.createElement('div');
    });

    it('positions popup below cursor rect', () => {
        const rect = new DOMRect(100, 200, 50, 20);
        updatePosition(popup, () => rect);

        expect(popup.style.left).toBe(`${100 + window.scrollX}px`);
        expect(popup.style.top).toBe(`${220 + window.scrollY + 4}px`);
    });

    it('handles null popup gracefully', () => {
        expect(() => updatePosition(null, () => new DOMRect())).not.toThrow();
    });

    it('handles null clientRect gracefully', () => {
        expect(() => updatePosition(popup, null)).not.toThrow();
        expect(popup.style.left).toBe('');
    });

    it('handles undefined clientRect gracefully', () => {
        expect(() => updatePosition(popup, undefined)).not.toThrow();
        expect(popup.style.left).toBe('');
    });

    it('handles clientRect returning null', () => {
        expect(() => updatePosition(popup, () => null)).not.toThrow();
        expect(popup.style.left).toBe('');
    });
});

describe('createSlashSuggestionRender', () => {
    const onSelect = vi.fn();
    const onActiveChange = vi.fn();
    const makeProps = () => ({
        items: [], command: vi.fn(), editor: {} as never,
        clientRect: () => new DOMRect(10, 20, 100, 16),
    });

    interface Lifecycle {
        onStart: (props: never) => void;
        onUpdate: (props: never) => void;
        onKeyDown: (props: never) => boolean;
        onExit: (props: never) => void;
    }

    let lifecycle: Lifecycle;

    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
        const renderFn = createSlashSuggestionRender({ onSelect, onActiveChange });
        lifecycle = renderFn() as unknown as Lifecycle;
    });

    describe('onStart', () => {
        it('calls onActiveChange(true)', () => {
            lifecycle.onStart(makeProps() as never);
            expect(onActiveChange).toHaveBeenCalledWith(true);
        });

        it('appends popup element to document.body', () => {
            lifecycle.onStart(makeProps() as never);
            const popups = document.body.querySelectorAll('div');
            expect(popups.length).toBeGreaterThanOrEqual(1);
        });

        it('sets z-index 9999 on popup', () => {
            lifecycle.onStart(makeProps() as never);
            const popup = document.body.lastElementChild as HTMLDivElement;
            expect(popup.style.zIndex).toBe('9999');
        });

        it('positions popup absolutely', () => {
            lifecycle.onStart(makeProps() as never);
            const popup = document.body.lastElementChild as HTMLDivElement;
            expect(popup.style.position).toBe('absolute');
        });
    });

    describe('onUpdate', () => {
        it('updates renderer props', () => {
            lifecycle.onStart(makeProps() as never);
            lifecycle.onUpdate(makeProps() as never);
            expect(mockUpdateProps).toHaveBeenCalled();
        });
    });

    describe('onKeyDown', () => {
        it('returns false for Escape key', () => {
            lifecycle.onStart(makeProps() as never);
            const result = lifecycle.onKeyDown({
                event: new KeyboardEvent('keydown', { key: 'Escape' }),
            } as never);
            expect(result).toBe(false);
        });

        it('delegates non-Escape keys to renderer ref', () => {
            lifecycle.onStart(makeProps() as never);
            mockOnKeyDown.mockReturnValue(true);
            const result = lifecycle.onKeyDown({
                event: new KeyboardEvent('keydown', { key: 'ArrowDown' }),
            } as never);
            expect(mockOnKeyDown).toHaveBeenCalled();
            expect(result).toBe(true);
        });
    });

    describe('onExit', () => {
        it('calls onActiveChange(false)', () => {
            lifecycle.onStart(makeProps() as never);
            lifecycle.onExit(null as never);
            expect(onActiveChange).toHaveBeenCalledWith(false);
        });

        it('removes popup from DOM', () => {
            lifecycle.onStart(makeProps() as never);
            expect(document.body.children.length).toBe(1);
            lifecycle.onExit(null as never);
            expect(document.body.children.length).toBe(0);
        });

        it('destroys renderer', () => {
            lifecycle.onStart(makeProps() as never);
            lifecycle.onExit(null as never);
            expect(mockDestroy).toHaveBeenCalled();
        });
    });
});
