// Resolves a CSS custom property (design token) to its current value.
// Leaflet writes path colors into SVG presentation attributes, which do
// not reliably resolve var(--x), so map markers need the concrete color.
export function cssColor(variable: string, fallback: string): string {
    if (typeof document === "undefined") return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return value || fallback;
}
