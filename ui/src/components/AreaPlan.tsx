import { useEffect, useMemo, useState } from "react";
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
    className?: string;
}

// Inline SVG pin: no image assets needed for the marker.
function pinIcon(): L.DivIcon {
    return L.divIcon({
        className: "map-pin",
        html: `<svg width="26" height="36" viewBox="0 0 26 36" fill="none" aria-hidden="true">
            <path d="M13 35C13 35 25 20.5 25 12.5C25 5.9 19.6 1 13 1C6.4 1 1 5.9 1 12.5C1 20.5 13 35 13 35Z"
                fill="var(--primaryColor, #13161A)" stroke="#fff" stroke-width="1.5"/>
            <circle cx="13" cy="12.5" r="4.5" fill="#fff"/>
        </svg>`,
        iconSize: [26, 36],
        iconAnchor: [13, 34],
    });
}

// Shows the whole plan and never lets the viewer zoom out further.
function FitPlan({ bounds }: { bounds: L.LatLngBounds }) {
    const map = useMap();
    useEffect(() => {
        const fit = () => {
            map.invalidateSize();
            map.setMinZoom(map.getBoundsZoom(bounds, false));
            map.fitBounds(bounds, { animate: false });
        };
        fit();
        map.on("resize", fit);
        return () => {
            map.off("resize", fit);
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

export default function AreaPlan({ areaId, plan, pin, onPick, markers, label, className = "" }: AreaPlanProps) {
    const { t } = useTranslation();
    const { token, failed, onError } = useFileToken(true, areaId);
    const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
    const icon = useMemo(pinIcon, []);

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

    const bounds = useMemo(
        () => (size ? L.latLngBounds([0, 0], [size.height, size.width]) : null),
        [size],
    );

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

    return (
        <div className={`map-canvas plan-canvas ${className}`.trim()} aria-label={label}>
            <MapContainer
                // the coordinate space is fixed at mount: remount per plan
                key={`${areaId}:${size.width}x${size.height}`}
                crs={L.CRS.Simple}
                bounds={bounds}
                maxBounds={bounds.pad(0.25)}
                maxBoundsViscosity={0.8}
                minZoom={-6}
                maxZoom={2}
                zoomSnap={0.25}
                attributionControl={false}
                scrollWheelZoom={Boolean(onPick)}
                className="board-map-canvas"
            >
                <FitPlan bounds={bounds} />
                <ImageOverlay url={size.url} bounds={bounds} />
                {onPick && <ClickPicker onPick={pick} />}
                {(markers ?? []).map((marker) => (
                    <CircleMarker
                        key={marker.id}
                        center={planToLatLng(marker, size.width, size.height)}
                        radius={8}
                        pathOptions={{ color: "#fff", weight: 2, fillColor: marker.color, fillOpacity: 0.95 }}
                        eventHandlers={marker.onClick ? { click: marker.onClick } : undefined}
                    >
                        <Tooltip>
                            <strong>{marker.title}</strong>
                            {marker.subtitle && (
                                <>
                                    <br />
                                    {marker.subtitle}
                                </>
                            )}
                        </Tooltip>
                    </CircleMarker>
                ))}
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
        </div>
    );
}
