import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useTranslation } from "react-i18next";

import { isWithinIssueBounds, ISSUE_BOUNDS } from "../lib/validation";
import "leaflet/dist/leaflet.css";

// Map location picker for the issue report form (plan.md: Leaflet +
// OpenStreetMap tiles, no API key, no data to third parties beyond the
// OSM tile requests). The user pins the location by tapping the map or
// by dragging the marker; coordinates are handed to the form as plain
// string values (the server parses and validates them itself).

interface MapPickerProps {
    // current coordinates as strings ("" while unset), shared with the form
    lat: string;
    lng: string;
    // called with coordinate strings whenever a location was picked
    onPick: (lat: string, lng: string) => void;
}

// 6 decimals ≈ 0.1 m - well below the server's 3-decimal rounding
function fmtCoordinate(value: number): string {
    return String(Math.round(value * 1e6) / 1e6);
}

// Inline SVG pin so no image assets (and no extra third-party requests)
// are needed for the marker.
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

const bounds = L.latLngBounds(
    [ISSUE_BOUNDS.minLat, ISSUE_BOUNDS.minLng],
    [ISSUE_BOUNDS.maxLat, ISSUE_BOUNDS.maxLng],
);

// Keeps the whole community box visible by never allowing zoom levels at
// which the pan-limited viewport would show area outside the box.
function MinZoomBounds() {
    const map = useMap();
    useEffect(() => {
        const update = () => {
            map.setMinZoom(Math.min(map.getBoundsZoom(bounds, false), 14));
        };
        update();
        map.on("resize", update);
        return () => {
            map.off("resize", update);
        };
    }, [map]);
    return null;
}

// Map clicks set the pin position.
function ClickPicker({ onPick }: { onPick: (lat: string, lng: string) => void }) {
    useMapEvents({
        click(event) {
            onPick(fmtCoordinate(event.latlng.lat), fmtCoordinate(event.latlng.lng));
        },
    });
    return null;
}

export default function MapPicker({ lat, lng, onPick }: MapPickerProps) {
    const { t } = useTranslation();
    const mapRef = useRef<L.Map | null>(null);
    const icon = useMemo(pinIcon, []);
    const [locating, setLocating] = useState(false);
    const [locationError, setLocationError] = useState<string | null>(null);

    const position: [number, number] | null =
        lat !== "" && lng !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
            ? [Number(lat), Number(lng)]
            : null;

    const useMyLocation = () => {
        if (!("geolocation" in navigator)) {
            setLocationError(t("issue.location.unsupported"));
            return;
        }
        setLocating(true);
        setLocationError(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                const { latitude, longitude } = pos.coords;
                if (!isWithinIssueBounds(latitude, longitude)) {
                    // inside the geofence or not: never silently move the
                    // pin somewhere the reporter did not choose
                    setLocationError(t("issue.location.outside"));
                    return;
                }
                onPick(fmtCoordinate(latitude), fmtCoordinate(longitude));
                mapRef.current?.flyTo([latitude, longitude], 15, { duration: 0.7 });
            },
            (error) => {
                setLocating(false);
                setLocationError(
                    error.code === error.PERMISSION_DENIED
                        ? t("issue.location.denied")
                        : t("issue.location.generic"),
                );
            },
            // maximumAge 0: never a stale cached position (an override or
            // earlier fix could otherwise silently keep the old coords)
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
    };

    return (
        <div className="map-picker">
            {/* bounds/maxBounds: pan/zoom stay inside the community box
                (TODO: keep in sync with the server env, see validation.ts) */}
            <MapContainer
                ref={mapRef}
                center={[(ISSUE_BOUNDS.minLat + ISSUE_BOUNDS.maxLat) / 2, (ISSUE_BOUNDS.minLng + ISSUE_BOUNDS.maxLng) / 2]}
                zoom={12}
                maxZoom={18}
                maxBounds={bounds}
                maxBoundsViscosity={1.0}
                className="map-canvas"
            >
                {/* {s}: OSM's official a/b/c tile subdomains. The served
                    CSP allows only https://*.tile.openstreetmap.org, and a
                    subdomain URL matches it (the bare tile.openstreetmap
                    org host would be blocked by img-src) */}
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    subdomains="abc"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
                />
                <MinZoomBounds />
                <ClickPicker onPick={onPick} />
                {position && (
                    <Marker
                        position={position}
                        icon={icon}
                        draggable
                        autoPan
                        eventHandlers={{
                            dragend: (event) => {
                                const { lat: newLat, lng: newLng } = (event.target as L.Marker).getLatLng();
                                onPick(fmtCoordinate(newLat), fmtCoordinate(newLng));
                            },
                        }}
                    />
                )}
            </MapContainer>
            <div className="map-toolbar">
                <button
                    type="button"
                    className="btn btn-outline"
                    onClick={useMyLocation}
                    disabled={locating}
                >
                    {locating ? t("issue.location.searching") : t("issue.location.useMyLocation")}
                </button>
            </div>
            {!position && <p className="hint">{t("issue.location.hint")}</p>}
            {locationError && <p className="field-error">{locationError}</p>}
        </div>
    );
}
