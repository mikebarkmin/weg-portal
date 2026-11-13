import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

import { pb } from "../lib/pbClient";
import { useAuth } from "../lib/auth";
import { ISSUE_STATUSES, ISSUE_BOUNDS, type IssueStatus } from "../lib/validation";
import type { PortalIssue } from "../types";
import StatusBadge from "../components/StatusBadge";
import VisibilityChip from "../components/VisibilityChip";
import "leaflet/dist/leaflet.css";

// The issue board (M9): list + map of EXACTLY the issues the server
// returns for the caller - the API rules decide what is visible
// (community-only + accepted for residents, everything incl. pending/
// private + exact coords for the Beirat, accepted incl. private with
// exact coords for hausmeister/hausverwaltung). Nothing is filtered out
// client-side beyond what arrives; the status/category filters below are
// pure display filters (kept client-side so filter changes are instant
// and the realtime subscription keeps ONE authoritative list).
const STATUS_COLORS: Record<IssueStatus, string> = {
    pending: "var(--surfaceAlt5Color)",
    open: "var(--infoColor)",
    in_progress: "var(--warningColor)",
    resolved: "var(--successColor)",
    rejected: "var(--dangerColor)",
};

// Markers sit on the exact coordinates when the viewer's record carries
// them (unhidden for beirat/HM/HV by the enrich hook) and on the rounded
// ones otherwise - residents never receive lat_exact/lng_exact at all.
function positionOf(issue: PortalIssue): [number, number] {
    const lat = typeof issue.lat_exact === "number" ? issue.lat_exact : issue.lat;
    const lng = typeof issue.lng_exact === "number" ? issue.lng_exact : issue.lng;
    return [lat, lng];
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
    const isBeirat = auth.role === "beirat";

    const [items, setItems] = useState<PortalIssue[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
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
            if (statusFilter !== "all" && item.status !== statusFilter) return false;
            if (needle !== "" && !item.category.toLowerCase().includes(needle)) {
                return false;
            }
            return true;
        });
    }, [items, statusFilter, categoryFilter]);

    return (
        <>
            <h1>{t("board.heading")}</h1>
            <p className="hint">{t("board.intro")}</p>

            <div className="board-filters">
                <div className="field">
                    <label htmlFor="board-status-filter">
                        {t("board.filters.status")}
                    </label>
                    <select
                        id="board-status-filter"
                        value={statusFilter}
                        onChange={(e) =>
                            setStatusFilter(e.target.value as IssueStatus | "all")
                        }
                    >
                        <option value="all">{t("board.filters.all")}</option>
                        {ISSUE_STATUSES.map((status) => (
                            <option key={status} value={status}>
                                {t(`issueStatus.${status}`)}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="field">
                    <label htmlFor="board-category-filter">
                        {t("board.filters.category")}
                    </label>
                    <input
                        id="board-category-filter"
                        type="search"
                        placeholder={t("board.filters.categoryPlaceholder")}
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                    />
                </div>
            </div>

            {loading && <p className="state">{t("board.loading")}</p>}
            {error && (
                <>
                    <p className="state state-error">{t("board.error")}</p>
                    <div className="btn-row">
                        <button type="button" className="btn" onClick={() => void load()}>
                            {t("board.retry")}
                        </button>
                    </div>
                </>
            )}

            {!loading && !error && (
                <>
                    <p className="hint">
                        {t("board.count", { count: filtered.length })}
                    </p>

                    <div
                        className="board-map map-canvas"
                        aria-label={t("board.map.label")}
                    >
                        <MapContainer
                            center={[
                                (ISSUE_BOUNDS.minLat + ISSUE_BOUNDS.maxLat) / 2,
                                (ISSUE_BOUNDS.minLng + ISSUE_BOUNDS.maxLng) / 2,
                            ]}
                            zoom={12}
                            maxZoom={18}
                            className="board-map-canvas"
                        >
                            <TileLayer
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                subdomains="abc"
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
                            />
                            {filtered.map((issue) => (
                                <CircleMarker
                                    key={issue.id}
                                    center={positionOf(issue)}
                                    radius={8}
                                    pathOptions={{
                                        color: "#fff",
                                        weight: 2,
                                        fillColor: STATUS_COLORS[issue.status],
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

                    {filtered.length === 0 ? (
                        <p className="state">{t("board.empty")}</p>
                    ) : (
                        <ul className="board-list">
                            {filtered.map((issue) => (
                                <li key={issue.id} className="card board-item">
                                    <Link
                                        className="board-item-title"
                                        to={`/issues/${issue.id}`}
                                    >
                                        {issue.title}
                                    </Link>
                                    <div className="board-item-badges">
                                        <StatusBadge status={issue.status} />
                                        {isBeirat && (
                                            <VisibilityChip visibility={issue.visibility} />
                                        )}
                                    </div>
                                    {issue.category && (
                                        <p className="hint">{issue.category}</p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </>
    );
}
