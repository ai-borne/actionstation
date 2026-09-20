/**
 * Settings Store - State management for app preferences
 * SSOT for theme, canvas settings, and user preferences
 */
import { create } from 'zustand';
import { getStorageItem, getValidatedStorageItem, setStorageItem, getStorageJson, setStorageJson } from '@/shared/utils/storage';
import { trackSettingsChanged } from '@/shared/services/analyticsService';
import {
    type ActionId,
    DEFAULT_HOVER_MENU,
    DEFAULT_RIGHT_CLICK_MENU,
    HOVER_MENU_MAX,
    RIGHT_CLICK_MENU_MAX,
    validatePlacement,
    validateActionList,
} from './iconRegistry';
import { type GridColumnsPreference, VALID_GRID_COLUMNS } from '@/features/canvas/services/gridColumnsResolver';

export type { GridColumnsPreference };
export { VALID_GRID_COLUMNS };

export type ThemeOption = 'light' | 'dark' | 'system' | 'sepia' | 'grey' | 'darkBlack';
type ResolvedTheme = 'light' | 'dark' | 'sepia' | 'grey' | 'darkBlack';

/** Direct themes that resolve to themselves (not 'system') */
const DIRECT_THEMES: ReadonlySet<string> = new Set(['light', 'dark', 'sepia', 'grey', 'darkBlack']);

export type CanvasScrollMode = 'zoom' | 'navigate';
export type ConnectorStyle = 'ghost' | 'regular' | 'light' | 'bold' | 'dashed' | 'dotted';
export type SettingsTabId = 'appearance' | 'canvas' | 'toolbar' | 'account' | 'privacy' | 'keyboard' | 'about';

/** Allow-lists for validated storage reads (defense-in-depth) */
const VALID_THEMES: readonly ThemeOption[] = ['light', 'dark', 'system', 'sepia', 'grey', 'darkBlack'];
const VALID_SCROLL_MODES: readonly CanvasScrollMode[] = ['zoom', 'navigate'];
const VALID_CONNECTOR_STYLES: readonly ConnectorStyle[] = ['ghost', 'regular', 'light', 'bold', 'dashed', 'dotted'];
const VALID_SETTINGS_TABS: readonly SettingsTabId[] = ['appearance', 'canvas', 'toolbar', 'account', 'privacy', 'keyboard', 'about'];

// Storage keys
const STORAGE_KEYS = {
    theme: 'settings-theme',
    canvasGrid: 'settings-canvasGrid',
    autoSave: 'settings-autoSave',
    autoSaveInterval: 'settings-autoSaveInterval',
    compactMode: 'settings-compactMode',
    canvasScrollMode: 'settings-canvasScrollMode',
    connectorStyle: 'settings-connectorStyle',
    isCanvasLocked: 'settings-isCanvasLocked',
    canvasFreeFlow: 'settings-canvasFreeFlow',
    gridColumns: 'settings-gridColumns',
    autoAnalyzeDocuments: 'settings-autoAnalyzeDocuments',
    lastSettingsTab: 'settings-lastSettingsTab',
    hoverMenuIcons: 'settings-hoverMenuIcons',
    rightClickMenuIcons: 'settings-rightClickMenuIcons',
} as const;

/** One-time migration: move old localStorage keys to new names. */
function migrateIconPlacementKeys(): void {
    try {
        const OLD_HOVER = 'settings-utilsBarIcons';
        const OLD_RIGHT = 'settings-contextMenuIcons';
        const hoverVal = localStorage.getItem(OLD_HOVER);
        if (hoverVal !== null) {
            localStorage.setItem('settings-hoverMenuIcons', hoverVal);
            localStorage.removeItem(OLD_HOVER);
        }
        const rightVal = localStorage.getItem(OLD_RIGHT);
        if (rightVal !== null) {
            localStorage.setItem('settings-rightClickMenuIcons', rightVal);
            localStorage.removeItem(OLD_RIGHT);
        }
    } catch {
        // localStorage unavailable in SSR / test environments
    }
}

// Constants
const AUTO_SAVE_MIN = 10;
const AUTO_SAVE_MAX = 300;
const AUTO_SAVE_DEFAULT = 30;

interface SettingsState {
    theme: ThemeOption;
    canvasGrid: boolean;
    autoSave: boolean;
    autoSaveInterval: number;
    compactMode: boolean;
    canvasScrollMode: CanvasScrollMode;
    connectorStyle: ConnectorStyle;
    isCanvasLocked: boolean;
    canvasFreeFlow: boolean;
    gridColumns: GridColumnsPreference;
    autoAnalyzeDocuments: boolean;
    lastSettingsTab: SettingsTabId;
    hoverMenuIcons: ActionId[];
    rightClickMenuIcons: ActionId[];
    setTheme: (theme: ThemeOption) => void;
    toggleCanvasGrid: () => void;
    setAutoSave: (enabled: boolean) => void;
    setAutoSaveInterval: (seconds: number) => void;
    toggleCompactMode: () => void;
    setCanvasScrollMode: (mode: CanvasScrollMode) => void;
    setConnectorStyle: (style: ConnectorStyle) => void;
    toggleCanvasLocked: () => void;
    toggleCanvasFreeFlow: () => void;
    setGridColumns: (columns: GridColumnsPreference) => void;
    toggleAutoAnalyzeDocuments: () => void;
    setLastSettingsTab: (tab: SettingsTabId) => void;
    setHoverMenuIcons: (icons: ActionId[]) => void;
    setRightClickMenuIcons: (icons: ActionId[]) => void;
    resetIconPlacement: () => void;
    getResolvedTheme: () => ResolvedTheme;
    loadFromStorage: () => void;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function getClampedStorageItem(key: string, defaultVal: number, min: number, max: number): number {
    return clamp(getStorageItem<number>(key, defaultVal), min, max);
}

const DEFAULT_GRID_COLUMNS: GridColumnsPreference = 4;

/** Loads gridColumns from localStorage, parsing mixed string/number type safely. */
function loadGridColumnsFromStorage(): GridColumnsPreference {
    try {
        const raw = localStorage.getItem(STORAGE_KEYS.gridColumns);
        if (raw === null) return DEFAULT_GRID_COLUMNS;
        if (raw === 'auto') return 'auto';
        const num = Number(raw);
        if (VALID_GRID_COLUMNS.includes(num as GridColumnsPreference)) return num as GridColumnsPreference;
        return DEFAULT_GRID_COLUMNS;
    } catch {
        return DEFAULT_GRID_COLUMNS;
    }
}

/** Build initial state values from localStorage (pure helper, no actions). */
function createInitialState() {
    migrateIconPlacementKeys();
    const placement = validatePlacement(
        getStorageJson<unknown>(STORAGE_KEYS.hoverMenuIcons, null),
        getStorageJson<unknown>(STORAGE_KEYS.rightClickMenuIcons, null),
    );
    return {
        theme: getValidatedStorageItem(STORAGE_KEYS.theme, 'system', VALID_THEMES),
        canvasGrid: getStorageItem<boolean>(STORAGE_KEYS.canvasGrid, true),
        autoSave: getStorageItem<boolean>(STORAGE_KEYS.autoSave, true),
        autoSaveInterval: getClampedStorageItem(STORAGE_KEYS.autoSaveInterval, AUTO_SAVE_DEFAULT, AUTO_SAVE_MIN, AUTO_SAVE_MAX),
        compactMode: getStorageItem<boolean>(STORAGE_KEYS.compactMode, false),
        canvasScrollMode: getValidatedStorageItem(STORAGE_KEYS.canvasScrollMode, 'navigate', VALID_SCROLL_MODES),
        connectorStyle: getValidatedStorageItem(STORAGE_KEYS.connectorStyle, 'regular', VALID_CONNECTOR_STYLES),
        isCanvasLocked: getStorageItem<boolean>(STORAGE_KEYS.isCanvasLocked, false),
        canvasFreeFlow: getStorageItem<boolean>(STORAGE_KEYS.canvasFreeFlow, false),
        gridColumns: loadGridColumnsFromStorage(),
        autoAnalyzeDocuments: getStorageItem<boolean>(STORAGE_KEYS.autoAnalyzeDocuments, true),
        lastSettingsTab: getValidatedStorageItem(STORAGE_KEYS.lastSettingsTab, 'appearance', VALID_SETTINGS_TABS),
        hoverMenuIcons: placement.hoverMenu,
        rightClickMenuIcons: placement.rightClickMenu,
    };
}

/** Build all action methods for the settings store. */
function createSettingsActions(
    set: (partial: Partial<SettingsState>) => void,
    get: () => SettingsState,
): Omit<SettingsState, keyof ReturnType<typeof createInitialState>> {
    type SettingKey = 'canvasGrid' | 'compactMode' | 'isCanvasLocked' | 'canvasFreeFlow' | 'autoAnalyzeDocuments';
    const toggle = (key: SettingKey) => {
        const v = !get()[key]; set({ [key]: v }); setStorageItem(STORAGE_KEYS[key], v); trackSettingsChanged(key, v);
    };
    return {
        setTheme: (theme) => { set({ theme }); setStorageItem(STORAGE_KEYS.theme, theme); trackSettingsChanged('theme', theme); },
        toggleCanvasGrid: () => toggle('canvasGrid'),
        setAutoSave: (enabled) => { set({ autoSave: enabled }); setStorageItem(STORAGE_KEYS.autoSave, enabled); trackSettingsChanged('autoSave', enabled); },
        setAutoSaveInterval: (seconds) => {
            const clamped = clamp(seconds, AUTO_SAVE_MIN, AUTO_SAVE_MAX);
            set({ autoSaveInterval: clamped }); setStorageItem(STORAGE_KEYS.autoSaveInterval, clamped); trackSettingsChanged('autoSaveInterval', clamped);
        },
        toggleCompactMode: () => toggle('compactMode'),
        setCanvasScrollMode: (mode) => { set({ canvasScrollMode: mode }); setStorageItem(STORAGE_KEYS.canvasScrollMode, mode); trackSettingsChanged('canvasScrollMode', mode); },
        setConnectorStyle: (style) => { set({ connectorStyle: style }); setStorageItem(STORAGE_KEYS.connectorStyle, style); trackSettingsChanged('connectorStyle', style); },
        toggleCanvasLocked: () => toggle('isCanvasLocked'),
        toggleCanvasFreeFlow: () => toggle('canvasFreeFlow'),
        setGridColumns: (columns: GridColumnsPreference) => {
            if (!VALID_GRID_COLUMNS.includes(columns)) return;
            set({ gridColumns: columns }); setStorageItem(STORAGE_KEYS.gridColumns, columns); trackSettingsChanged('gridColumns', columns);
        },
        toggleAutoAnalyzeDocuments: () => toggle('autoAnalyzeDocuments'),
        setHoverMenuIcons: (icons) => {
            const validated = validateActionList(icons, HOVER_MENU_MAX);
            set({ hoverMenuIcons: validated }); setStorageJson(STORAGE_KEYS.hoverMenuIcons, validated); trackSettingsChanged('hoverMenuIcons', validated);
        },
        setRightClickMenuIcons: (icons) => {
            const validated = validateActionList(icons, RIGHT_CLICK_MENU_MAX);
            set({ rightClickMenuIcons: validated }); setStorageJson(STORAGE_KEYS.rightClickMenuIcons, validated); trackSettingsChanged('rightClickMenuIcons', validated);
        },
        resetIconPlacement: () => {
            const hoverMenu = [...DEFAULT_HOVER_MENU]; const rightClickMenu = [...DEFAULT_RIGHT_CLICK_MENU];
            set({ hoverMenuIcons: hoverMenu, rightClickMenuIcons: rightClickMenu });
            setStorageJson(STORAGE_KEYS.hoverMenuIcons, hoverMenu); setStorageJson(STORAGE_KEYS.rightClickMenuIcons, rightClickMenu);
            trackSettingsChanged('iconPlacementReset', true);
        },
        setLastSettingsTab: (tab) => { set({ lastSettingsTab: tab }); setStorageItem(STORAGE_KEYS.lastSettingsTab, tab); },
        getResolvedTheme: () => {
            const { theme } = get();
            if (DIRECT_THEMES.has(theme)) return theme as ResolvedTheme;
            if (typeof window !== 'undefined') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            return 'light';
        },
        loadFromStorage: () => { set(createInitialState()); },
    };
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
    ...createInitialState(),
    ...createSettingsActions(set, get),
}));
