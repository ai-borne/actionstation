/**
 * SettingsPanelContent — tab list and section router for SettingsPanel.
 * Extracted to keep SettingsPanel within the 100-line component limit.
 */
import { useSettingsStore, type SettingsTabId } from '@/shared/stores/settingsStore';
import { AppearanceSection } from './sections/AppearanceSection';
import { CanvasSection } from './sections/CanvasSection';
import { ToolbarSection } from './sections/ToolbarSection';
import { AccountSection } from './sections/AccountSection';
import { PrivacySection } from './sections/PrivacySection';
import { KeyboardSection } from './sections/KeyboardSection';
import { AboutSection } from './sections/AboutSection';
import {
    PaletteTabIcon, CanvasTabIcon, SlidersTabIcon,
    UserTabIcon, PrivacyTabIcon, KeyboardTabIcon, InfoTabIcon,
} from './settingsTabIcons';
import {
    SP_TABS, SP_TABS_STYLE, SP_TAB, SP_TAB_STYLE, SP_TAB_ACTIVE_STYLE,
    SP_SECTION_CONTENT, SP_SECTION_CONTENT_STYLE,
} from './settingsPanelStyles';
import { strings } from '@/shared/localization/strings';

interface Tab {
    id: SettingsTabId;
    label: string;
    icon: React.ComponentType;
}

const TABS: Tab[] = [
    { id: 'appearance', label: strings.settings.appearance, icon: PaletteTabIcon },
    { id: 'canvas',     label: strings.settings.canvas,     icon: CanvasTabIcon },
    { id: 'toolbar',    label: strings.settings.toolbar,    icon: SlidersTabIcon },
    { id: 'account',    label: strings.settings.account,    icon: UserTabIcon },
    { id: 'privacy',    label: strings.settings.privacy,    icon: PrivacyTabIcon },
    { id: 'keyboard',   label: strings.settings.keyboard,   icon: KeyboardTabIcon },
    { id: 'about',      label: strings.settings.about,      icon: InfoTabIcon },
];

const PANEL_ID = 'settings-tabpanel';
const TAB_ID_PREFIX = 'settings-tab-';

function SectionForTab({ tab }: { tab: SettingsTabId }) {
    switch (tab) {
        case 'appearance': return <AppearanceSection />;
        case 'canvas':     return <CanvasSection />;
        case 'toolbar':    return <ToolbarSection />;
        case 'account':    return <AccountSection />;
        case 'privacy':    return <PrivacySection />;
        case 'keyboard':   return <KeyboardSection />;
        case 'about':      return <AboutSection />;
        default: { const _exhaustive: never = tab; return _exhaustive; }
    }
}

interface SettingsPanelContentProps {
    activeTab: SettingsTabId;
    sectionRef: React.RefObject<HTMLDivElement>;
    innerRef: React.RefObject<HTMLDivElement>;
    tabListRef: React.RefObject<HTMLDivElement>;
    handleTabKeyDown: (e: React.KeyboardEvent) => void;
}

export function SettingsPanelContent({ activeTab, sectionRef, innerRef, tabListRef, handleTabKeyDown }: SettingsPanelContentProps) {
    return (
        <>
            <div ref={tabListRef} className={SP_TABS} style={SP_TABS_STYLE}
                role="tablist" aria-label={strings.settings.title}
                onKeyDown={handleTabKeyDown}>
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id;
                    const Icon = tab.icon;
                    return (
                        <button key={tab.id} data-tab-id={tab.id}
                            className={SP_TAB}
                            style={isActive ? SP_TAB_ACTIVE_STYLE : SP_TAB_STYLE}
                            onClick={() => useSettingsStore.getState().setLastSettingsTab(tab.id)}
                            role="tab" aria-selected={isActive}
                            aria-controls={PANEL_ID}
                            id={`${TAB_ID_PREFIX}${tab.id}`}
                            tabIndex={isActive ? 0 : -1}>
                            <Icon />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
            <div ref={sectionRef} className={SP_SECTION_CONTENT}
                style={SP_SECTION_CONTENT_STYLE} role="tabpanel"
                id={PANEL_ID} aria-labelledby={`${TAB_ID_PREFIX}${activeTab}`}>
                <div ref={innerRef} key={activeTab} className="settings-fade-in">
                    <SectionForTab tab={activeTab} />
                </div>
            </div>
        </>
    );
}
