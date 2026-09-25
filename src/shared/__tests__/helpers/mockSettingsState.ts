/**
 * Shared mock factory for useSettingsStore in component tests
 * SSOT: single place to update when SettingsState interface changes
 */
import { vi, type Mock } from 'vitest';
import type {
    ThemeOption,
    ConnectorStyle,
    CanvasScrollMode,
    SettingsTabId,
    GridColumnsPreference,
} from '@/shared/stores/settingsStore';
import type { ActionId } from '@/shared/stores/iconRegistry';
import { DEFAULT_HOVER_MENU, DEFAULT_RIGHT_CLICK_MENU } from '@/shared/stores/iconRegistry';

type MockFn = Mock<(...args: unknown[]) => void>;

/** Strongly-typed overrides — only valid SettingsState keys accepted */
export interface MockSettingsOverrides {
    theme?: ThemeOption;
    canvasGrid?: boolean;
    autoSave?: boolean;
    autoSaveInterval?: number;
    compactMode?: boolean;
    canvasScrollMode?: CanvasScrollMode;
    connectorStyle?: ConnectorStyle;
    isCanvasLocked?: boolean;
    canvasFreeFlow?: boolean;
    gridColumns?: GridColumnsPreference;
    lastSettingsTab?: SettingsTabId;
    setTheme?: MockFn;
    toggleCanvasGrid?: MockFn;
    setAutoSave?: MockFn;
    setAutoSaveInterval?: MockFn;
    toggleCompactMode?: MockFn;
    setCanvasScrollMode?: MockFn;
    setConnectorStyle?: MockFn;
    toggleCanvasLocked?: MockFn;
    toggleCanvasFreeFlow?: MockFn;
    setGridColumns?: MockFn;
    setLastSettingsTab?: MockFn;
    getResolvedTheme?: () => 'light' | 'dark' | 'sepia' | 'grey' | 'darkBlack';
    loadFromStorage?: MockFn;
    autoAnalyzeDocuments?: boolean;
    toggleAutoAnalyzeDocuments?: MockFn;
    hoverMenuIcons?: ActionId[];
    rightClickMenuIcons?: ActionId[];
    setHoverMenuIcons?: MockFn;
    setRightClickMenuIcons?: MockFn;
    resetIconPlacement?: MockFn;
}

/** Creates a complete mock SettingsState with optional type-safe overrides */
export function createMockSettingsState(overrides: MockSettingsOverrides = {}) {
    return {
        theme: 'system' as ThemeOption,
        canvasGrid: true,
        autoSave: true,
        autoSaveInterval: 30,
        compactMode: false,
        canvasScrollMode: 'navigate' as CanvasScrollMode,
        connectorStyle: 'regular' as ConnectorStyle,
        isCanvasLocked: false,
        canvasFreeFlow: false,
        gridColumns: 4 as GridColumnsPreference,
        lastSettingsTab: 'appearance' as SettingsTabId,
        setTheme: vi.fn(),
        toggleCanvasGrid: vi.fn(),
        setAutoSave: vi.fn(),
        setAutoSaveInterval: vi.fn(),
        toggleCompactMode: vi.fn(),
        setCanvasScrollMode: vi.fn(),
        setConnectorStyle: vi.fn(),
        toggleCanvasLocked: vi.fn(),
        toggleCanvasFreeFlow: vi.fn(),
        setGridColumns: vi.fn(),
        setLastSettingsTab: vi.fn(),
        getResolvedTheme: () => 'light' as const,
        loadFromStorage: vi.fn(),
        autoAnalyzeDocuments: true,
        toggleAutoAnalyzeDocuments: vi.fn(),
        hoverMenuIcons: [...DEFAULT_HOVER_MENU] as ActionId[],
        rightClickMenuIcons: [...DEFAULT_RIGHT_CLICK_MENU] as ActionId[],
        setHoverMenuIcons: vi.fn(),
        setRightClickMenuIcons: vi.fn(),
        resetIconPlacement: vi.fn(),
        ...overrides,
    };
}
