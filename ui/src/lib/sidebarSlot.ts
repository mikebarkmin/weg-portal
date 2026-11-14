import { createContext } from "react";

// The app shell (Layout.tsx) owns the left sidebar; pages render their
// sidebar content into this slot element via a portal (Page.tsx).
export const SidebarSlotContext = createContext<HTMLElement | null>(null);
