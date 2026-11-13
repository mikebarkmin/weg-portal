import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import L from "leaflet";
import { CircleMarker, MapContainer, Tooltip, useMap } from "react-leaflet";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { ISSUE_STATUSES, type IssueStatus } from "../lib/validation";
import { ACTIVE_ISSUE_STATUSES, positionOf, STATUS_ICONS } from "../lib/issues";
import { formatShortDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import { cssColor } from "../lib/cssColor";
import type { PortalIssue } from "../types";
import StatusBadge from "../components/StatusBadge";
import VisibilityChip from "../components/VisibilityChip";
import ProtectedPhotos from "../components/ProtectedPhotos";
import { issueLatLngBounds } from "../lib/issueBounds";
import { MenuButton, Page, PageHeading, SidebarMenu } from "../components/Page";
import OsmTileLayer from "../components/OsmTileLayer";
import "leaflet/dist/leaflet.css";

// The issue board (M9): list + map of EXACTLY the issues the server
// returns for the caller - the API rules decide what is visible
// (community-only + accepted for residents, everything incl. pending/
// private + exact coords for the Beirat, accepted incl. private with
// exact coords for hausmeister/hausverwaltung). Nothing is filtered out
// client-side beyond what arrives; the status/category filters below are
// pure display filters (kept client-side so filter changes are instant
// and the realtime subscription keeps ONE authoritative list).

const STATUS_COLOR_VARS: Record<IssueStatus, string> = {
    pending: "--surfaceAlt5Color",
    open: "--infoColor",
    in_progress: "--warningColor",
    resolved: "--successColor",
    rejected: "--dangerColor",
};

type StatusFilter = IssueStatus | "all" | "active";

// Fits the map to the visible markers whenever the filtered set changes
// (falls back to the community box when there is nothing to show).
function FitToMarkers({ positions }: { positions: [number, number][] }) {
    const map = useMap();
    const key = positions.map((p) => p.join(",")).join(";");
    useEffect(() => {
        if (positions.length === 0) {
            map.fitBounds(issueLatLngBounds(), { padding: [16, 16] });
        } else {
            map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 17 });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the positions' content
    }, [map, key]);
    return null;
}

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
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }, []);

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

        return () => {
            active = false;
            if (unsubscribe) {
                void unsubscribe();
            }
        };
    }, []);

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

    // issues without a map point are listed but not drawn
    const located = useMemo(
        () =>
            filtered.flatMap((issue) => {
                const position = positionOf(issue, auth.role);
                return position ? [{ issue, position }] : [];
            }),
        [filtered, auth.role],
    );
    const positions = useMemo(() => located.map((entry) => entry.position), [located]);

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
                    <SidebarMenu secondary>
                        <Link className="menu-item" to="/issues/new">
                            <i className="ri-error-warning-line" aria-hidden="true" />
                            <span className="txt">{t("nav.newIssue")}</span>
                        </Link>
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
                    <div className="board-map map-canvas" aria-label={t("board.map.label")}>
                        <MapContainer bounds={issueLatLngBounds()} maxZoom={19} className="board-map-canvas">
                            <FitToMarkers positions={positions} />
                            <OsmTileLayer />
                            {located.map(({ issue, position }) => (
                                <CircleMarker
                                    key={issue.id}
                                    center={position}
                                    radius={8}
                                    pathOptions={{
                                        color: "#fff",
                                        weight: 2,
                                        fillColor: cssColor(STATUS_COLOR_VARS[issue.status], "#888"),
                                        fillOpacity: 0.9,
                                    }}
                                    eventHandlers={{
                                        click: () => navigate(`/issues/${issue.id}`),
                                    }}
                                >
                                    <Tooltip>
                                        <strong>{issue.title}</strong>
                                        <br />
                                        {t(`issueStatus.${issue.status}`)}
                                    </Tooltip>
                                </CircleMarker>
                            ))}
                        </MapContainer>
                    </div>

                    <p className="txt-hint txt-sm m-0">{t("board.count", { count: filtered.length })}</p>

                    {filtered.length === 0 ? (
                        <div className="alert">{t("board.empty")}</div>
                    ) : (
                        <div className="list board-list">
                            {filtered.map((issue) => {
                                const created = parsePBDate(issue.created);
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
