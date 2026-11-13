import { useTranslation } from "react-i18next";

import { CALENDARS } from "../lib/calendars";
import type { CalendarId } from "../types";

// Which calendar an event belongs to (colored like the calendar toggles).
export default function CalendarBadge({ calendar }: { calendar: CalendarId }) {
    const { t } = useTranslation();
    const def = CALENDARS.find((c) => c.id === calendar) ?? CALENDARS[0]!;
    return (
        <span className={`label sm calendar-label calendar-${calendar}`}>
            <i className={def.icon} aria-hidden="true" />
            {t(`calendars.${calendar}`)}
        </span>
    );
}
