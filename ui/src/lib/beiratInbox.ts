import { createContext, useContext, useEffect, useState } from "react";

import { pb } from "./pbClient";

// What is waiting for the Beirat: pending suggestions, reports and agenda
// topics plus verified accounts awaiting approval. Loaded once by the
// Layout (only for Beirat/admin) and shared via context, so the header
// tab badge, the sidebar and the start page show the same numbers.
export interface BeiratInbox {
    suggestions: number;
    issues: number;
    agenda: number;
    users: number;
}

export function inboxTotal(inbox: BeiratInbox | null): number {
    if (!inbox) return 0;
    return inbox.suggestions + inbox.issues + inbox.agenda + inbox.users;
}

const REFRESH_MS = 60_000;
const CHANGED_EVENT = "portal:beirat-inbox";

// Called by the moderation queue and user approval after a decision so
// the badges update without waiting for the next navigation or refresh.
export function notifyInboxChanged(): void {
    window.dispatchEvent(new Event(CHANGED_EVENT));
}

async function countOf(collection: string, filter: string): Promise<number> {
    const res = await pb.collection(collection).getList(1, 1, {
        filter,
        fields: "id",
        // own key: the SDK would otherwise auto-cancel this request when a
        // page lists the same collection at the same moment (or vice versa)
        requestKey: `beirat-inbox-${collection}`,
    });
    return res.totalItems;
}

async function loadInbox(): Promise<BeiratInbox> {
    const [suggestions, issues, agenda, users] = await Promise.all([
        countOf("suggestions", "status = 'pending'"),
        countOf("issues", "status = 'pending'"),
        countOf("agenda_items", "status = 'pending'"),
        // unverified accounts must confirm their email first (UserApproval)
        countOf("users", "approved = false && verified = true"),
    ]);
    return { suggestions, issues, agenda, users };
}

// `refreshKey` (the current path) reloads after every navigation, so a
// decision made in the moderation queue is reflected right away.
export function useBeiratInboxLoader(enabled: boolean, refreshKey: string): BeiratInbox | null {
    const [inbox, setInbox] = useState<BeiratInbox | null>(null);

    useEffect(() => {
        if (!enabled) {
            setInbox(null);
            return;
        }
        let active = true;
        const load = () =>
            loadInbox()
                .then((value) => active && setInbox(value))
                .catch(() => undefined);
        load();
        const timer = window.setInterval(load, REFRESH_MS);
        window.addEventListener(CHANGED_EVENT, load);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener(CHANGED_EVENT, load);
        };
    }, [enabled, refreshKey]);

    return inbox;
}

export const BeiratInboxContext = createContext<BeiratInbox | null>(null);

export function useBeiratInbox(): BeiratInbox | null {
    return useContext(BeiratInboxContext);
}
