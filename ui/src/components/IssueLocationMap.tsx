import { Circle, CircleMarker, MapContainer } from "react-leaflet";
import { useTranslation } from "react-i18next";

import type { PortalIssue } from "../types";
import { exactPositionOf, hasLocation } from "../lib/issues";
import { cssColor } from "../lib/cssColor";
import OsmTileLayer from "./OsmTileLayer";
import "leaflet/dist/leaflet.css";

// Read-only map of ONE issue's location. Viewers who receive the exact
// coordinates (beirat/hausmeister/hausverwaltung, enrich hook) see a
// precise pin; everyone else sees the ~100 m rounding area as a circle,
// never a pin that suggests false precision.
export default function IssueLocationMap({ issue, role }: { issue: PortalIssue; role: string }) {
    const { t } = useTranslation();
    const exact = exactPositionOf(issue, role);
    const center: [number, number] = exact ?? [issue.lat, issue.lng];

    // the map point is optional
    if (!hasLocation(issue)) {
        return <p className="txt-hint txt-sm m-0">{t("issueDetail.noLocation")}</p>;
    }

    return (
        <div className="issue-map map-canvas" aria-label={t("issueDetail.mapLabel")}>
            <MapContainer
                center={center}
                zoom={exact ? 18 : 16}
                maxZoom={19}
                scrollWheelZoom={false}
                className="board-map-canvas"
            >
                <OsmTileLayer />
                {exact ? (
                    <CircleMarker
                        center={exact}
                        radius={9}
                        pathOptions={{ color: "#fff", weight: 2, fillColor: cssColor("--primaryColor", "#13161a"), fillOpacity: 0.95 }}
                    />
                ) : (
                    <Circle
                        center={center}
                        radius={70}
                        pathOptions={{ color: cssColor("--primaryColor", "#13161a"), weight: 1, fillOpacity: 0.15 }}
                    />
                )}
            </MapContainer>
        </div>
    );
}
