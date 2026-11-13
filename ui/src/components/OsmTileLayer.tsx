import { TileLayer } from "react-leaflet";

// OpenStreetMap tiles for every map in the portal.
//
// referrerPolicy: the site sends "Referrer-Policy: same-origin" (Caddy),
// which would drop the Referer for these cross-site tile requests - and the
// OSM tile servers block browser requests without one ("x-blocked: No
// referer sent", https://operations.osmfoundation.org/policies/tiles/).
// "strict-origin-when-cross-origin" sends only the portal's origin
// (https://weg7026.de/), never the page path.
//
// The single host tile.openstreetmap.org is OSM's recommended endpoint (the
// old a/b/c subdomains are legacy); the CSP in portal.go allows it.
export default function OsmTileLayer() {
    return (
        <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            referrerPolicy="strict-origin-when-cross-origin"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
        />
    );
}
