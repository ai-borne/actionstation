import { strings } from '@/shared/localization/strings';
import { BrandLogoIcon, PinIcon } from '@/shared/components/icons';
import { SB_HEADER, SB_HEADER_STYLE, SB_LOGO, SB_APP_NAME, SB_APP_NAME_STYLE, SB_PIN_TOGGLE } from './sidebarStyles';

interface SidebarHeaderProps {
    isPinned: boolean;
    isHoverOpen: boolean;
    onTogglePin: () => void;
}

export function SidebarHeader({ isPinned, isHoverOpen, onTogglePin }: SidebarHeaderProps) {
    return (
        <div className={SB_HEADER} style={SB_HEADER_STYLE}>
            <div className={SB_LOGO}>
                <BrandLogoIcon size={32} />
            </div>
            <span className={SB_APP_NAME} style={SB_APP_NAME_STYLE}>{strings.app.name}</span>
            <button
                className={SB_PIN_TOGGLE}
                onClick={onTogglePin}
                aria-label={isPinned ? strings.sidebar.unpin : strings.sidebar.pin}
                aria-pressed={isPinned}
                aria-expanded={isPinned || isHoverOpen}
                title={isPinned ? strings.sidebar.unpinTooltip : strings.sidebar.pinTooltip}
            >
                <PinIcon size={16} filled={isPinned} />
            </button>
        </div>
    );
}
