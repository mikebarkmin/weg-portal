import L from "leaflet";

import { ISSUE_BOUNDS } from "./validation";

// The community box as Leaflet bounds (deployment config, loaded at
// startup - see lib/portalConfig.ts).
export function issueLatLngBounds(): L.LatLngBounds {
    return L.latLngBounds(
        [ISSUE_BOUNDS.minLat, ISSUE_BOUNDS.minLng],
        [ISSUE_BOUNDS.maxLat, ISSUE_BOUNDS.maxLng],
    );
}
