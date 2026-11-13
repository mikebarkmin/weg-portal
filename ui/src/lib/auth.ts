import { useEffect, useState } from "react";

import { pb } from "./pbClient";

// The secret of `canShow` et al.: the role always comes from the auth
// store record (PocketBase JWTs carry no custom claims such as `role`).
// Server-side rules remain authoritative; these helpers only decide
// what the UI shows/links.
export function roleOf(record: unknown): string {
    if (record && typeof record === "object" && "role" in record) {
        const role = (record as Record<string, unknown>)["role"];
        return typeof role === "string" ? role : "";
    }
    return "";
}

// Whether the Beirat-only pages (moderation queue, user approval) may
// be shown for the given role.
export function canShow(role: string): boolean {
    return role === "beirat";
}

// Whether the admin-only account management page (/admin) may be shown.
export function canShowAdmin(role: string): boolean {
    return role === "admin";
}

export interface AuthState {
    isAuthenticated: boolean;
    role: string;
    name: string;
    email: string;
}

function readState(): AuthState {
    const record = pb.authStore.record as Record<string, unknown> | null;
    return {
        isAuthenticated: pb.authStore.isValid,
        role: roleOf(record),
        name:
            record && typeof record["name"] === "string"
                ? record["name"]
                : "",
        email:
            record && typeof record["email"] === "string"
                ? record["email"]
                : "",
    };
}

// Minimal auth state hook: re-exports pb.authStore as React state so
// components re-render on login/logout. There is no own state to keep
// in sync - PocketBase persists the store in localStorage.
export function useAuth(): AuthState {
    const [state, setState] = useState<AuthState>(readState);

    useEffect(() => {
        // onChange returns the unsubscribe function (cleanup).
        return pb.authStore.onChange(() => setState(readState()));
    }, []);

    return state;
}

export function logout(): void {
    pb.authStore.clear();
}

// The approval gate for the issue board (M9). Residents whose account is
// not usable yet (unverified or awaiting the Beirat's approval) get an
// explanatory page instead of the board; beirat, hausmeister and
// hausverwaltung are exempt (their accounts are approved by definition -
// see the roles matrix). The server rules stay authoritative: the gate
// only picks which explanatory page to render.
export type BoardAccessState = "granted" | "unverified" | "waiting";

function flagOf(record: Record<string, unknown> | null, key: string): boolean {
    return record?.[key] === true;
}

export function boardAccessOf(record: unknown): BoardAccessState {
    const role = roleOf(record);

    if (role !== "resident") {
        // beirat / hausmeister / hausverwaltung: no approval gate
        return "granted";
    }

    const data = record as Record<string, unknown> | null;
    if (!flagOf(data, "verified")) {
        // the email address must be confirmed first - only verified
        // users enter the Beirat's approval queue
        return "unverified";
    }
    if (!flagOf(data, "approved")) {
        return "waiting";
    }
    return "granted";
}

// Accounts are for owners only: an approved + verified account (or a
// Beirat/staff account) counts as "owner" for owner-only content
// (announcements, documents, contacts, the owners' calendar, polls and
// meeting topics). Server rules decide; this only picks what to show.
export function isOwnerAccount(record: unknown): boolean {
    const role = roleOf(record);
    if (role === "beirat") return true;
    const data = record as Record<string, unknown> | null;
    return flagOf(data, "approved") && flagOf(data, "verified");
}

export function useOwnerAccount(): boolean {
    const auth = useAuth();
    return auth.isAuthenticated && isOwnerAccount(pb.authStore.record);
}
