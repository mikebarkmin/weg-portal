// Resolves a CSS custom property (design token) to a concrete rgb() color.
// Leaflet writes path colors into SVG presentation attributes, which do
// not reliably resolve var(--x), so map markers need the concrete color.
// Tokens may themselves be var(...) chains or color-mix() (dark theme),
// so the browser resolves them on a probe element instead of reading the
// raw declaration.
export function cssColor(variable: string, fallback: string): string {
    if (typeof document === "undefined" || !document.body) return fallback;
    const probe = document.createElement("span");
    probe.style.display = "none";
    probe.style.color = fallback;
    probe.style.color = `var(${variable}, ${fallback})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value || fallback;
}
