import type { PortalContact } from "../types";

// Remix icon per contact category.
export const CONTACT_ICONS: Record<PortalContact["category"], string> = {
    beirat: "ri-shield-user-line",
    verwaltung: "ri-building-line",
    hausmeister: "ri-tools-line",
    notdienst: "ri-alarm-warning-line",
    sonstiges: "ri-contacts-line",
};
