import { useRef, useState, useCallback } from 'react';
import { strings } from '@/shared/localization/strings';
import { useSidebarStore } from '@/shared/stores/sidebarStore';
import { useOutsideClick } from '@/shared/hooks/useOutsideClick';
import { useSidebarWorkspaces } from '@/app/hooks/useSidebarWorkspaces';
import { PlusIcon, ChevronDownIcon } from '@/shared/components/icons';
import { WorkspaceList } from '@/app/components/WorkspaceList';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from '@/app/components/SidebarFooter';
import { UpgradeWall } from '@/features/subscription/components/UpgradeWall';
import { useRazorpayCheckout } from '@/features/subscription/hooks/useRazorpayCheckout';
import { PRO_ANNUAL_PLAN_ID } from '@/features/subscription/types/subscription';
import { logger } from '@/shared/services/logger';
import { TemplatePicker } from '@/features/templates/components/TemplatePicker';
import { useTemplatePicker } from '@/features/templates/hooks/useTemplatePicker';
import type { WorkspaceTemplate } from '@/features/templates/types/template';
import './Sidebar.css';
import {
    SB_SIDEBAR, SB_WORKSPACES, SB_WORKSPACES_STYLE,
    SB_NEW_WS_WRAPPER, SB_NEW_WS_WRAPPER_STYLE,
    SB_SPLIT_BTN_CONTAINER,
    SB_NEW_WS_MAIN, SB_NEW_WS_MAIN_STYLE,
    SB_SPLIT_DIVIDER,
    SB_NEW_WS_DROPDOWN_BTN, SB_NEW_WS_DROPDOWN_BTN_STYLE,
    SB_DROPDOWN_MENU, SB_DROPDOWN_MENU_STYLE,
    SB_DROPDOWN_ITEM, SB_DROPDOWN_ITEM_STYLE,
} from './sidebarStyles';

interface SidebarProps {
    onSettingsClick?: () => void;
}

interface WorkspaceCreateButtonProps {
    isCreating: boolean;
    isCreatingDivider: boolean;
    onNewWorkspace: () => void;
    onNewDivider: () => Promise<void>;
}

function WorkspaceCreateButton({ isCreating, isCreatingDivider, onNewWorkspace, onNewDivider }: WorkspaceCreateButtonProps) {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    useOutsideClick(dropdownRef, isDropdownOpen, () => setIsDropdownOpen(false));

    const onAddDivider = () => { setIsDropdownOpen(false); void onNewDivider(); };

    return (
        <div className={SB_NEW_WS_WRAPPER} style={SB_NEW_WS_WRAPPER_STYLE} ref={dropdownRef}>
            <div className={SB_SPLIT_BTN_CONTAINER}>
                <button className={SB_NEW_WS_MAIN} style={SB_NEW_WS_MAIN_STYLE}
                    onClick={onNewWorkspace} disabled={isCreating || isCreatingDivider}
                >
                    <PlusIcon size={18} />
                    <span>{isCreating ? strings.common.loading : strings.workspace.newWorkspace}</span>
                </button>
                <div className={SB_SPLIT_DIVIDER} />
                <button className={SB_NEW_WS_DROPDOWN_BTN} style={SB_NEW_WS_DROPDOWN_BTN_STYLE}
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    disabled={isCreating || isCreatingDivider}
                    aria-label="New Workspace Options"
                    aria-expanded={isDropdownOpen}
                >
                    <ChevronDownIcon size={18} />
                </button>
            </div>
            {isDropdownOpen && (
                <div className={SB_DROPDOWN_MENU} style={SB_DROPDOWN_MENU_STYLE}>
                    <button className={SB_DROPDOWN_ITEM} style={SB_DROPDOWN_ITEM_STYLE}
                        onClick={onAddDivider} disabled={isCreating || isCreatingDivider}
                    >
                        {isCreatingDivider ? strings.common.loading : strings.workspace.newDivider}
                    </button>
                </div>
            )}
        </div>
    );
}

export function Sidebar({ onSettingsClick }: SidebarProps) {
    const {
        workspaces, currentWorkspaceId, isCreating, isCreatingDivider,
        handleNewWorkspace, handleNewDivider, handleDeleteDivider,
        handleSelectWorkspace, handleRenameWorkspace, handleReorderWorkspace,
        upgradeWall, dismissWall,
    } = useSidebarWorkspaces();

    const { isPickerOpen, customTemplates, isLoadingTemplates, openPicker, closePicker } = useTemplatePicker();

    const { startCheckout } = useRazorpayCheckout();
    const isPinned = useSidebarStore((s) => s.isPinned);
    const isHoverOpen = useSidebarStore((s) => s.isHoverOpen);

    const handleUpgrade = useCallback(() => {
        dismissWall();
        void startCheckout(PRO_ANNUAL_PLAN_ID, 'INR').catch(
            (e: unknown) => logger.error('[Sidebar] Upgrade checkout failed', e as Error),
        );
    }, [dismissWall, startCheckout]);

    const handleTemplateSelect = useCallback((template: WorkspaceTemplate) => {
        closePicker();
        void handleNewWorkspace(template);
    }, [closePicker, handleNewWorkspace]);

    const handleBlankCanvas = useCallback(() => {
        closePicker();
        void handleNewWorkspace(null);
    }, [closePicker, handleNewWorkspace]);

    return (
        <aside className={SB_SIDEBAR} data-pinned={String(isPinned)} data-open={String(isHoverOpen)}
            aria-label={strings.sidebar.ariaLabel}
        >
            <SidebarHeader isPinned={isPinned} isHoverOpen={isHoverOpen} onTogglePin={() => useSidebarStore.getState().togglePin()} />
            <div className={SB_WORKSPACES} style={SB_WORKSPACES_STYLE}>
                <WorkspaceCreateButton
                    isCreating={isCreating}
                    isCreatingDivider={isCreatingDivider}
                    onNewWorkspace={openPicker}
                    onNewDivider={handleNewDivider}
                />
                <WorkspaceList workspaces={workspaces} currentWorkspaceId={currentWorkspaceId}
                    onSelectWorkspace={handleSelectWorkspace} onRenameWorkspace={handleRenameWorkspace}
                    onReorderWorkspace={handleReorderWorkspace} onDeleteWorkspace={handleDeleteDivider}
                />
            </div>
            <SidebarFooter onSettingsClick={onSettingsClick} />
            {upgradeWall && (
                <UpgradeWall limitKind={upgradeWall.kind} current={upgradeWall.current}
                    max={upgradeWall.max} onDismiss={dismissWall} onUpgrade={handleUpgrade}
                />
            )}
            <TemplatePicker
                isOpen={isPickerOpen}
                customTemplates={customTemplates}
                isLoadingCustom={isLoadingTemplates}
                onSelect={handleTemplateSelect}
                onSelectBlank={handleBlankCanvas}
                onClose={closePicker}
            />
        </aside>
    );
}
