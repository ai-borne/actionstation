/**
 * CalendarConnectionGroup — Settings → Account → Google Calendar.
 * View over useCalendarConnection: shows whether Calendar is connected and offers
 * Connect or Disconnect. Disconnecting revokes the grant at Google (see calendarAuthService).
 */
import React from 'react';
import { useCalendarConnection } from '@/features/calendar/hooks/useCalendarConnection';
import { calendarStrings as cs } from '@/features/calendar/localization/calendarStrings';
import { SettingsGroup } from './SettingsGroup';
import {
    SP_SETTING_DESC, SP_SETTING_DESC_STYLE,
    SP_BTN_SECONDARY, SP_BTN_SECONDARY_STYLE,
} from '../settingsPanelStyles';

function buttonLabel(isConnected: boolean, isBusy: boolean): string {
    if (isBusy) return cs.connection.disconnecting;
    return isConnected ? cs.connection.disconnect : cs.connection.connect;
}

export const CalendarConnectionGroup = React.memo(function CalendarConnectionGroup() {
    const { isConnected, isBusy, connect, disconnect } = useCalendarConnection();
    const s = cs.connection;

    return (
        <SettingsGroup title={s.title}>
            <span className={SP_SETTING_DESC} style={SP_SETTING_DESC_STYLE}>
                {isConnected ? s.connectedDescription : s.notConnectedDescription}
            </span>
            <button
                className={SP_BTN_SECONDARY}
                style={{ ...SP_BTN_SECONDARY_STYLE, marginTop: 8 }}
                disabled={isBusy}
                onClick={() => { (isConnected ? disconnect() : connect()).catch(() => undefined); }}
            >
                {buttonLabel(isConnected, isBusy)}
            </button>
        </SettingsGroup>
    );
});
