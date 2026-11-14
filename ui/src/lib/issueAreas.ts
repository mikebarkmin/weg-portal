import { useEffect, useState } from "react";
import { ClientResponseError } from "pocketbase";

import { pb } from "./pbClient";

// Issue locations inside the property (hooks/issueAreas.go): the
// selectable areas and the location of one issue.
//
// An area is a house with floors, or a shared area (basement, outside)
// with a plan image on which the reporter places a pin. The pin is stored
// normalized: x from the left edge, y from the top edge, both 0..1 - so a
// plan re-uploaded in another resolution keeps the pins valid.

export interface IssueArea {
    id: string;
    name: string;
    floors: string[];
    active: boolean;
    has_plan: boolean;
    // file name of the protected plan - only sent to approved accounts
    plan?: string;
}

// issue_locations record (same id as its issue). Only readable by the
// Beirat, the reporter and - once shared - Hausmeister/Hausverwaltung.
export interface IssueLocation {
    id: string;
    issue: string;
    area: string;
    floor: string;
    has_pin: boolean;
    x: number;
    y: number;
    shared: boolean;
}

export interface PlanPoint {
    x: number;
    y: number;
}

// "Haus 79 · 2. OG"; an unknown area (deleted meanwhile) keeps the floor.
export function locationLabel(
    location: Pick<IssueLocation, "area" | "floor">,
    areas: IssueArea[],
    fallbackName = "",
): string {
    const name = areas.find((area) => area.id === location.area)?.name ?? fallbackName;
    return [name, location.floor].filter((part) => part !== "").join(" · ");
}

// A location that narrows down to single flats or owners: a floor of a
// house, or a pin (parking space, private garden, cellar door).
export function isIdentifyingLocation(location: Pick<IssueLocation, "floor" | "has_pin"> | null): boolean {
    return location !== null && (location.floor !== "" || location.has_pin);
}

// ---- plan geometry (Leaflet CRS.Simple: lat grows upwards) -----------------

export function planToLatLng(point: PlanPoint, width: number, height: number): [number, number] {
    return [height - point.y * height, point.x * width];
}

// The normalized point of a map position, or null outside the plan.
export function latLngToPlan(lat: number, lng: number, width: number, height: number): PlanPoint | null {
    if (!(width > 0 && height > 0)) return null;
    const x = lng / width;
    const y = (height - lat) / height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        return null;
    }
    return { x, y };
}

// 4 decimals: far below one pixel on any plan
export function formatPlanCoordinate(value: number): string {
    return String(Math.round(value * 1e4) / 1e4);
}

// The pin of the report form's string fields, or null while unset/invalid.
export function parsePlanPoint(x: string, y: string): PlanPoint | null {
    if (x === "" || y === "") return null;
    const point = { x: Number(x), y: Number(y) };
    if (![point.x, point.y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) {
        return null;
    }
    return point;
}

// ---- floors editor (one label per line) ------------------------------------

export function parseFloorLines(text: string): string[] {
    const floors: string[] = [];
    for (const line of text.split("\n")) {
        const label = line.trim();
        if (label !== "" && !floors.includes(label)) {
            floors.push(label);
        }
    }
    return floors;
}

// ---- loading ---------------------------------------------------------------

// One request for the whole SPA; dropped when the login changes (the plan
// file names are only part of the answer for approved accounts) or after
// the Beirat edited the areas.
let areasPromise: Promise<IssueArea[]> | null = null;

export function invalidateIssueAreas(): void {
    areasPromise = null;
}

pb.authStore.onChange(() => invalidateIssueAreas());

export function fetchIssueAreas(): Promise<IssueArea[]> {
    if (!areasPromise) {
        areasPromise = pb
            .send<{ areas?: IssueArea[] }>("/api/portal/issue-areas", { requestKey: null })
            .then((body) => (Array.isArray(body.areas) ? body.areas : []))
            .catch((err) => {
                areasPromise = null;
                throw err;
            });
    }
    return areasPromise;
}

// The areas (null while loading; [] when they could not be loaded - the
// location is optional everywhere, so pages keep working without them).
export function useIssueAreas(refreshKey?: unknown): IssueArea[] | null {
    const [areas, setAreas] = useState<IssueArea[] | null>(null);

    useEffect(() => {
        let active = true;
        fetchIssueAreas()
            .then((list) => active && setAreas(list))
            .catch(() => active && setAreas([]));
        return () => {
            active = false;
        };
    }, [refreshKey]);

    return areas;
}

// The location of one issue: null when it has none - or when the caller
// may not see it (the API answers 404 in both cases, by design).
export async function fetchIssueLocation(issueId: string): Promise<IssueLocation | null> {
    try {
        return await pb.collection<IssueLocation>("issue_locations").getOne(issueId, { requestKey: null });
    } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) {
            return null;
        }
        throw err;
    }
}

export interface IssueLocationState {
    // undefined while loading
    location: IssueLocation | null | undefined;
    reload: () => void;
}

export function useIssueLocation(issueId: string, refreshKey?: unknown): IssueLocationState {
    const [location, setLocation] = useState<IssueLocation | null | undefined>(undefined);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!issueId) return;
        let active = true;
        fetchIssueLocation(issueId)
            .then((found) => active && setLocation(found))
            .catch(() => active && setLocation(null));
        return () => {
            active = false;
        };
    }, [issueId, refreshKey, tick]);

    return { location, reload: () => setTick((n) => n + 1) };
}

// Beirat only: share the location of one issue with Hausmeister and
// Hausverwaltung, or revoke it (POST /api/portal/issues/{id}/location-share).
export async function shareIssueLocation(issueId: string, shared: boolean): Promise<void> {
    await pb.send(`/api/portal/issues/${encodeURIComponent(issueId)}/location-share`, {
        method: "POST",
        body: { shared },
        requestKey: null,
    });
}
