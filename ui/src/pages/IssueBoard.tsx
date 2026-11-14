import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { ISSUE_STATUSES, type IssueStatus } from "../lib/validation";
import { ACTIVE_ISSUE_STATUSES, STATUS_ICONS } from "../lib/issues";
import { locationLabel, useIssueAreas, type IssueLocation } from "../lib/issueAreas";
import { formatShortDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import { cssColor } from "../lib/cssColor";
import type { PortalIssue } from "../types";
import StatusBadge from "../components/StatusBadge";
import VisibilityChip from "../components/VisibilityChip";
import ProtectedPhotos from "../components/ProtectedPhotos";
import AreaPlan, { type PlanMarker } from "../components/AreaPlan";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";

// The issue board (M9): list of EXACTLY the issues the server returns for
// the caller - the API rules decide what is visible (community-only +
// accepted for residents, everything incl. pending/private for the
// Beirat, accepted incl. private for hausmeister/hausverwaltung).
//
// Locations are separate records (issue_locations) with their own rule:
// the Beirat gets all of them, Hausmeister/Hausverwaltung the ones the
// Beirat shared, owners only those of their own reports. Whatever arrives
// is shown as a label on the row and - for pins - on the area plans;
// other owners' issues simply have no location here. Nothing is filtered out
// client-side beyond what arrives; the status/category filters below are
// pure display filters (kept client-side so filter changes are instant
// and the realtime subscription keeps ONE authoritative list).

const STATUS_COLOR_VARS: Record<IssueStatus, string> = {
    // pale tokens vanish on a white plan: new issues get the dark primary
    pending: "--primaryColor",
    open: "--infoColor",
    in_progress: "--warningColor",
    resolved: "--successColor",
    archived: "--surfaceAlt5Color",
    rejected: "--dangerColor",
};

type StatusFilter = IssueStatus | "all" | "active";

// Board order: pending issues first (they wait for a Beirat decision),
// after that the most recent decision first. The collection has no
// autodate fields (M1), so the hook-owned decided_at (set on
// accept/reject, hooks/issueWorkflow.go) is the only timestamp to sort
// by; the id keeps the order stable for records without one.
function issueOrderKey(issue: PortalIssue): string {
    return issue.decided_at || "9999-";
}

function byBoardOrder(a: PortalIssue, b: PortalIssue): number {
    const key = issueOrderKey(b).localeCompare(issueOrderKey(a));
    return key !== 0 ? key : b.id.localeCompare(a.id);
}

export default function IssueBoard() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const auth = useAuth();
    // beirat and admin share the Beirat view (plan.md roles matrix)
    const isBeirat = canShow(auth.role);
    const locale = useTranslation().i18n.language;

    const [items, setItems] = useState<PortalIssue[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // locations the server lets this viewer see, by issue id
    const areas = useIssueAreas();
    const [locations, setLocations] = useState<Map<string, IssueLocation>>(new Map());
    const [planArea, setPlanArea] = useState("");

    const loadLocations = useCallback(async () => {
        try {
            const list = await pb
                .collection<IssueLocation>("issue_locations")
                .getFullList({ requestKey: null });
            setLocations(new Map(list.map((location) => [location.id, location])));
        } catch {
            // the board works without locations
            setLocations(new Map());
        }
    }, []);

    // default: only what still needs attention (pending/open/in progress)
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
    const [categoryFilter, setCategoryFilter] = useState("");

    // ---- initial load (plus manual retry) ----
    const load = useCallback(async () => {
        setLoading(true);
        setError(false);
        try {
            // no server-side sort: see byBoardOrder (decided_at is the
            // only timestamp the collection carries)
            const list = await pb.collection<PortalIssue>("issues").getFullList();
            setItems(list.sort(byBoardOrder));
            void loadLocations();
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [loadLocations]);

    useEffect(() => {
        void load();
    }, [load]);

    // ---- realtime: update list (and with it the map) live while the
    // board is open; unsubscribe on unmount. The subscription lives on
    // the server side under the same read rules as the REST API, so
    // residents only ever receive records they are allowed to see. ----
    useEffect(() => {
        let active = true;
        let unsubscribe: (() => Promise<void>) | null = null;

        pb.collection<PortalIssue>("issues")
            .subscribe("*", (event) => {
                if (!active) return;
                setItems((prev) => {
                    if (event.action === "delete") {
                        return prev.filter((item) => item.id !== event.record.id);
                    }
                    const fresh = event.record;
                    const index = prev.findIndex((item) => item.id === fresh.id);
                    if (index === -1) {
                        return [fresh, ...prev].sort(byBoardOrder);
                    }
                    const next = prev.slice();
                    next[index] = fresh;
                    return next;
                });
            })
            .then((unsub) => {
                if (active) {
                    unsubscribe = unsub;
                } else {
                    void unsub();
                }
            })
            .catch(() => {
                // realtime is an enhancement - the page works without it
            });

        // a location appears with a new report and changes when the Beirat
        // shares or revokes it: just re-read the (small) list
        let unsubscribeLocations: (() => Promise<void>) | null = null;
        pb.collection("issue_locations")
            .subscribe("*", () => {
                if (active) void loadLocations();
            })
            .then((unsub) => {
                if (active) {
                    unsubscribeLocations = unsub;
                } else {
                    void unsub();
                }
            })
            .catch(() => undefined);

        return () => {
            active = false;
            if (unsubscribe) {
                void unsubscribe();
            }
            if (unsubscribeLocations) {
                void unsubscribeLocations();
            }
        };
    }, [loadLocations]);

    // ---- display filters (see the page comment) ----
    const filtered = useMemo(() => {
        const needle = categoryFilter.trim().toLowerCase();
        return items.filter((item) => {
            if (statusFilter === "active" && !ACTIVE_ISSUE_STATUSES.has(item.status)) return false;
            if (
                statusFilter !== "all" &&
                statusFilter !== "active" &&
                item.status !== statusFilter
            ) {
                return false;
            }
            if (
                needle !== "" &&
                ![item.title, item.category, item.description].some((text) =>
                    text.toLowerCase().includes(needle),
                )
            ) {
                return false;
            }
            return true;
        });
    }, [items, statusFilter, categoryFilter]);

    const counts = useMemo(() => {
        const result: Record<string, number> = { all: items.length, active: 0 };
        for (const item of items) {
            result[item.status] = (result[item.status] ?? 0) + 1;
            if (ACTIVE_ISSUE_STATUSES.has(item.status)) result.active! += 1;
        }
        return result;
    }, [items]);

    // areas with a plan on which at least one visible issue has a pin
    const planAreas = useMemo(() => {
        const withPins = new Set<string>();
        for (const issue of filtered) {
            const location = locations.get(issue.id);
            if (location?.has_pin) withPins.add(location.area);
        }
        return (areas ?? []).filter((area) => area.plan && withPins.has(area.id));
    }, [areas, filtered, locations]);
    const shownPlan = planAreas.find((area) => area.id === planArea) ?? planAreas[0];

    const markers = useMemo<PlanMarker[]>(() => {
        if (!shownPlan) return [];
        return filtered.flatMap((issue) => {
            const location = locations.get(issue.id);
            if (!location || !location.has_pin || location.area !== shownPlan.id) return [];
            return [
                {
                    id: issue.id,
                    x: location.x,
                    y: location.y,
                    title: issue.title,
                    subtitle: t(`issueStatus.${issue.status}`),
                    color: cssColor(STATUS_COLOR_VARS[issue.status], "#888"),
                    onClick: () => navigate(`/issues/${issue.id}`),
                },
            ];
        });
    }, [shownPlan, filtered, locations, navigate, t]);

    const filterOptions: { value: StatusFilter; icon: string; label: string }[] = [
        { value: "active", icon: "ri-inbox-line", label: t("board.filters.active") },
        ...ISSUE_STATUSES.filter((status) => (counts[status] ?? 0) > 0).map((status) => ({
            value: status as StatusFilter,
            icon: STATUS_ICONS[status],
            label: t(`issueStatus.${status}`),
        })),
        { value: "all", icon: "ri-list-check", label: t("board.filters.all") },
    ];

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("board.filters.status")}>
                        {filterOptions.map((option) => (
                            <MenuButton
                                key={option.value}
                                icon={option.icon}
                                active={statusFilter === option.value}
                                count={counts[option.value] ?? 0}
                                onClick={() => setStatusFilter(option.value)}
                            >
                                {option.label}
                            </MenuButton>
                        ))}
                    </SidebarMenu>
                    <p className="txt-hint sidebar-text">{t("board.intro")}</p>
                </>
            }
        >
            <PageHeading title={t("board.heading")} />

            <div className="searchbar m-b-sm">
                <div className="fields">
                    <label className="addon" htmlFor="board-search" aria-label={t("board.filters.search")}>
                        <i className="ri-search-line" aria-hidden="true" />
                    </label>
                    <div className="field search-field">
                        <input
                            id="board-search"
                            type="search"
                            placeholder={t("board.filters.searchPlaceholder")}
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {loading && <p className="txt-hint">{t("board.loading")}</p>}
            {error && (
                <div className="alert danger flex gap-sm">
                    <span className="flex-fill">{t("board.error")}</span>
                    <button type="button" className="btn sm secondary" onClick={() => void load()}>
                        {t("board.retry")}
                    </button>
                </div>
            )}

            {!loading && !error && (
                <div className="flex-column gap-sm">
                    {shownPlan && shownPlan.plan && (
                        <section className="board-plans" aria-label={t("board.plan.label")}>
                            {planAreas.length === 1 && (
                                <h2 className="board-plan-title">
                                    <i className="ri-map-2-line" aria-hidden="true" /> {shownPlan.name}
                                </h2>
                            )}
                            {planAreas.length > 1 && (
                                <div className="board-plan-tabs" role="tablist">
                                    {planAreas.map((area) => (
                                        <button
                                            key={area.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={area.id === shownPlan.id}
                                            className={`btn sm ${area.id === shownPlan.id ? "" : "secondary"}`}
                                            onClick={() => setPlanArea(area.id)}
                                        >
                                            <span className="txt">{area.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <AreaPlan
                                areaId={shownPlan.id}
                                plan={shownPlan.plan}
                                markers={markers}
                                label={t("issueDetail.planLabel", { area: shownPlan.name })}
                                className="board-map"
                            />
                            <p className="txt-hint txt-sm m-0">
                                <i className="ri-lock-line" aria-hidden="true" /> {t("board.plan.hint")}
                            </p>
                        </section>
                    )}

                    <p className="txt-hint txt-sm m-0">{t("board.count", { count: filtered.length })}</p>

                    {filtered.length === 0 ? (
                        <div className="alert">{t("board.empty")}</div>
                    ) : (
                        <div className="list board-list">
                            {filtered.map((issue) => {
                                const created = parsePBDate(issue.created);
                                const location = locations.get(issue.id);
                                const place = location ? locationLabel(location, areas ?? []) : "";
                                return (
                                    <Link key={issue.id} className="list-item next board-item" to={`/issues/${issue.id}`}>
                                        <span className={`status-icon status-${issue.status}`} aria-hidden="true">
                                            <i className={STATUS_ICONS[issue.status]} />
                                        </span>
                                        <span className="content">
                                            <span className="board-item-title">{issue.title}</span>
                                            <span className="meta">
                                                <StatusBadge status={issue.status} />
                                                {isBeirat && <VisibilityChip visibility={issue.visibility} />}
                                                {issue.category && (
                                                    <span className="meta-item">
                                                        <i className="ri-price-tag-3-line" aria-hidden="true" />
                                                        {issue.category}
                                                    </span>
                                                )}
                                                {place && (
                                                    <span className="meta-item">
                                                        <i className="ri-map-pin-line" aria-hidden="true" />
                                                        {place}
                                                    </span>
                                                )}
                                                {created && (
                                                    <span className="meta-item">
                                                        <i className="ri-calendar-line" aria-hidden="true" />
                                                        {formatShortDate(created, locale)}
                                                    </span>
                                                )}
                                                {issue.photos.length > 0 && (
                                                    <span className="meta-item">
                                                        <i className="ri-image-line" aria-hidden="true" />
                                                        {issue.photos.length}
                                                    </span>
                                                )}
                                            </span>
                                            {issue.description && (
                                                <span className="board-item-excerpt">{issue.description}</span>
                                            )}
                                        </span>
                                        {issue.photos.length > 0 && (
                                            <ProtectedPhotos
                                                recordId={issue.id}
                                                photos={issue.photos.slice(0, 1)}
                                                thumb="100x100"
                                                className="board-item-thumb"
                                                linkFull={false}
                                            />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </Page>
    );
}
