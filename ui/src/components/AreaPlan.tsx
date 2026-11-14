import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import { CircleMarker, ImageOverlay, MapContainer, Marker, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { buildFileUrl } from "../lib/fileToken";
import { useFileToken } from "../lib/useFileToken";
import { latLngToPlan, planToLatLng, type PlanPoint } from "../lib/issueAreas";
import "leaflet/dist/leaflet.css";

// The plan image of one area (issue_areas.plan) as a zoomable map without
// any geography: Leaflet's CRS.Simple maps plan pixels 1:1, nothing is
// loaded from a third party. The plan is a protected file - it loads with
// the viewer's short-lived file token, so only approved accounts see it.
//
// Used read-only (one pin, or the board's markers) and as the picker of
// the report form (onPick: tap the plan or drag the pin).
//
// Touch: while the whole plan is shown, a one-finger swipe scrolls the
// page (the map only pans once zoomed in), pinching zooms. The expand
// button opens the plan full-screen for precise pins on small screens.

export interface PlanMarker extends PlanPoint {
    id: string;
    title: string;
    subtitle?: string;
    color: string;
    onClick?: () => void;
}

interface AreaPlanProps {
    areaId: string;
    plan: string;
    pin?: PlanPoint | null;
    onPick?: (point: PlanPoint) => void;
    markers?: PlanMarker[];
    label: string;
    // shown in the full-screen view's title bar (e.g. "tap to place")
    hint?: string;
    className?: string;
}

// Inline SVG pin: no image assets needed for the marker.
function pinIcon(): L.DivIcon {
    return L.divIcon({
        className: "map-pin",
        html: `<svg width="30" height="42" viewBox="0 0 26 36" fill="none" aria-hidden="true">
            <path d="M13 35C13 35 25 20.5 25 12.5C25 5.9 19.6 1 13 1C6.4 1 1 5.9 1 12.5C1 20.5 13 35 13 35Z"
                fill="var(--primaryColor, #13161A)" stroke="#fff" stroke-width="1.5"/>
            <circle cx="13" cy="12.5" r="4.5" fill="#fff"/>
        </svg>`,
        iconSize: [30, 42],
        iconAnchor: [15, 40],
    });
}

// Markers closer than 1.5 % of the plan share one numbered dot: reports
// about the same door would otherwise hide each other completely.
function groupMarkers(markers: PlanMarker[]): PlanMarker[][] {
    const groups: PlanMarker[][] = [];
    for (const marker of markers) {
        const near = groups.find(
            (group) => Math.abs(group[0]!.x - marker.x) < 0.015 && Math.abs(group[0]!.y - marker.y) < 0.015,
        );
        if (near) near.push(marker);
        else groups.push([marker]);
    }
    return groups;
}

const groupKey = (group: PlanMarker[]) => group.map((marker) => marker.id).join(",");

function groupIcon(group: PlanMarker[], size: number): L.DivIcon {
    return L.divIcon({
        className: "plan-group",
        html: `<span style="background:${group[0]!.color}">${group.length}</span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    });
}

const atMinZoom = (map: L.Map) => map.getZoom() <= map.getMinZoom() + 0.01;

// Free strip above the plan (portal.css: .plan-canvas padding-top): room
// for the head of a pin near the top edge and for the expand button.
const TOP_STRIP = 40;
const FIT = { paddingTopLeft: L.point(0, TOP_STRIP), paddingBottomRight: L.point(0, 0) };

// Shows the whole plan, never lets the viewer zoom out further, and
// refits whenever the box changes size (full-screen, rotation, layout).
// Panning is only enabled while zoomed in: at the overview there is
// nothing to pan, so touch swipes scroll the page instead of the map.
function FitPlan({ bounds }: { bounds: L.LatLngBounds }) {
    const map = useMap();
    useEffect(() => {
        const syncDragging = () => {
            if (atMinZoom(map)) {
                map.dragging.disable();
                // back to the overview position (same zoom: no zoomend)
                map.fitBounds(bounds, { ...FIT, animate: true });
            } else {
                map.dragging.enable();
            }
        };
        const fit = () => {
            map.invalidateSize({ pan: false });
            map.setMinZoom(map.getBoundsZoom(bounds, false, L.point(0, TOP_STRIP)));
            map.fitBounds(bounds, { ...FIT, animate: false });
            syncDragging();
        };
        fit();
        const observer = new ResizeObserver(() => fit());
        observer.observe(map.getContainer());
        map.on("zoomend", syncDragging);
        return () => {
            observer.disconnect();
            map.off("zoomend", syncDragging);
        };
    }, [map, bounds]);
    return null;
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(event) {
            onPick(event.latlng.lat, event.latlng.lng);
        },
    });
    return null;
}

export default function AreaPlan({ areaId, plan, pin, onPick, markers, label, hint, className = "" }: AreaPlanProps) {
    const { t } = useTranslation();
    const { token, failed, onError } = useFileToken(true, areaId);
    const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
    const [expanded, setExpanded] = useState(false);
    // the numbered dot whose reports are listed below the plan
    const [openGroup, setOpenGroup] = useState<string | null>(null);
    const icon = useMemo(pinIcon, []);
    // bigger dots where they are tapped with a finger
    const markerRadius = L.Browser.touch ? 11 : 8;

    const url = token ? buildFileUrl(pb.baseUrl, "issue_areas", areaId, plan, { token }) : "";

    // the natural size of the plan defines the map's coordinate space
    useEffect(() => {
        if (!url) return;
        let active = true;
        const image = new Image();
        image.onload = () => {
            if (active && image.naturalWidth > 0 && image.naturalHeight > 0) {
                setSize({ url, width: image.naturalWidth, height: image.naturalHeight });
            }
        };
        // one forced token refresh, then give up (lib/useFileToken)
        image.onerror = () => active && onError(plan);
        image.src = url;
        return () => {
            active = false;
        };
    }, [url, plan, onError]);

    useEffect(() => {
        if (!expanded) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setExpanded(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [expanded]);

    const bounds = useMemo(
        () => (size ? L.latLngBounds([0, 0], [size.height, size.width]) : null),
        [size],
    );

    const groups = useMemo(() => groupMarkers(markers ?? []), [markers]);

    // one legend entry per marker color (the board colors by status)
    const legend = useMemo(() => {
        const seen = new Map<string, string>();
        for (const marker of markers ?? []) {
            if (marker.subtitle && !seen.has(marker.color)) seen.set(marker.color, marker.subtitle);
        }
        return [...seen.entries()];
    }, [markers]);

    if (failed.includes(plan)) {
        return <div className="alert warning">{t("areaPlan.failed")}</div>;
    }
    if (!size || !bounds) {
        return <div className={`map-canvas plan-canvas plan-loading ${className}`.trim()} aria-busy="true" />;
    }

    const position = pin ? planToLatLng(pin, size.width, size.height) : null;
    const pick = (lat: number, lng: number) => {
        const point = latLngToPlan(lat, lng, size.width, size.height);
        if (point && onPick) onPick(point);
    };

    const map = (
        <MapContainer
            // the coordinate space is fixed at mount: remount per plan
            key={`${areaId}:${size.width}x${size.height}`}
            crs={L.CRS.Simple}
            bounds={bounds}
            maxBounds={bounds.pad(0.5)}
            maxBoundsViscosity={1}
            minZoom={-6}
            maxZoom={3}
            // fractional fit: the plan fills its box edge to edge
            zoomSnap={0}
            zoomDelta={0.5}
            wheelPxPerZoomLevel={120}
            attributionControl={false}
            scrollWheelZoom={expanded || Boolean(onPick)}
            className="board-map-canvas"
        >
            <FitPlan bounds={bounds} />
            <ImageOverlay url={size.url} bounds={bounds} />
            {onPick && <ClickPicker onPick={pick} />}
            {groups.map((group) =>
                group.length === 1 ? (
                    <CircleMarker
                        key={group[0]!.id}
                        center={planToLatLng(group[0]!, size.width, size.height)}
                        radius={markerRadius}
                        pathOptions={{ color: "#fff", weight: 2, fillColor: group[0]!.color, fillOpacity: 0.95 }}
                        eventHandlers={group[0]!.onClick ? { click: group[0]!.onClick } : undefined}
                    >
                        <Tooltip direction="top" offset={[0, -markerRadius]}>
                            <strong>{group[0]!.title}</strong>
                            {group[0]!.subtitle && (
                                <>
                                    <br />
                                    {group[0]!.subtitle}
                                </>
                            )}
                        </Tooltip>
                    </CircleMarker>
                ) : (
                    <Marker
                        key={group.map((marker) => marker.id).join(",")}
                        position={planToLatLng(group[0]!, size.width, size.height)}
                        icon={groupIcon(group, markerRadius * 2 + 6)}
                        keyboard={false}
                        title={t("areaPlan.groupCount", { count: group.length })}
                        eventHandlers={{ click: () => setOpenGroup(groupKey(group)) }}
                    />
                ),
            )}
            {position && (
                <Marker
                    position={position}
                    icon={icon}
                    draggable={Boolean(onPick)}
                    autoPan
                    keyboard={false}
                    eventHandlers={{
                        dragend: (event) => {
                            const moved = (event.target as L.Marker).getLatLng();
                            // dropped outside the plan: snap back
                            const point = latLngToPlan(moved.lat, moved.lng, size.width, size.height);
                            if (point && onPick) {
                                onPick(point);
                            } else {
                                (event.target as L.Marker).setLatLng(position);
                            }
                        },
                    }}
                />
            )}
        </MapContainer>
    );

    // shown outside the map so it is never clipped by the small box
    const shownGroup = groups.find((group) => group.length > 1 && groupKey(group) === openGroup);
    const groupList = shownGroup && (
        <div className="plan-group-list">
            <div className="plan-group-list-head">
                <span className="txt-hint txt-sm">{t("areaPlan.groupCount", { count: shownGroup.length })}</span>
                <button
                    type="button"
                    className="btn sm circle transparent secondary"
                    aria-label={t("nav.close")}
                    onClick={() => setOpenGroup(null)}
                >
                    <i className="ri-close-line" aria-hidden="true" />
                </button>
            </div>
            <ul className="plan-popup-list">
                {shownGroup.map((marker) => (
                    <li key={marker.id}>
                        <button type="button" onClick={marker.onClick} disabled={!marker.onClick}>
                            <span className="plan-legend-dot" style={{ background: marker.color }} aria-hidden="true" />
                            <span className="txt">
                                <strong>{marker.title}</strong>
                                {marker.subtitle && <span className="txt-hint"> · {marker.subtitle}</span>}
                            </span>
                            <i className="ri-arrow-right-s-line" aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );

    const legendList = legend.length > 0 && (
        <ul className="plan-legend">
            {legend.map(([color, text]) => (
                <li key={color}>
                    <span className="plan-legend-dot" style={{ background: color }} aria-hidden="true" />
                    {text}
                </li>
            ))}
        </ul>
    );

    if (expanded) {
        return (
            <>
                {/* keeps the page layout while the plan is full-screen */}
                <div
                    className={`map-canvas plan-canvas plan-placeholder ${className}`.trim()}
                    style={{ aspectRatio: `${size.width} / ${size.height}` }}
                    aria-hidden="true"
                />
                {createPortal(
                    <div className="plan-fullscreen" role="dialog" aria-modal="true" aria-label={label}>
                        <div className="plan-fullscreen-bar">
                            <div className="plan-fullscreen-title">
                                <strong>{label}</strong>
                                {hint && <span className="txt-hint txt-sm">{hint}</span>}
                            </div>
                            <button type="button" className="btn sm" onClick={() => setExpanded(false)} autoFocus>
                                <i className="ri-check-line" aria-hidden="true" />
                                <span className="txt">{t("areaPlan.done")}</span>
                            </button>
                        </div>
                        <div className={`map-canvas plan-canvas plan-fullscreen-map ${onPick ? "plan-picker" : ""}`.trim()}>
                            {map}
                        </div>
                        {groupList}
                        {legendList}
                    </div>,
                    document.body,
                )}
            </>
        );
    }

    return (
        <div className="plan-view">
            <div
                className={`map-canvas plan-canvas ${onPick ? "plan-picker" : ""} ${className}`.replace(/\s+/g, " ").trim()}
                style={{ aspectRatio: `${size.width} / ${size.height}` }}
                aria-label={label}
            >
                {map}
                <button
                    type="button"
                    className="plan-expand-btn"
                    onClick={() => setExpanded(true)}
                    title={t("areaPlan.expand")}
                    aria-label={t("areaPlan.expand")}
                >
                    <i className="ri-fullscreen-line" aria-hidden="true" />
                </button>
            </div>
            {groupList}
            {legendList}
        </div>
    );
}
