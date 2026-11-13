import { useEffect, useState } from "react";

// Light/dark theme like BugStage: the choice is stored per browser and
// applied as <html data-color-scheme="..."> (BugStage's vars.css redefines
// the tokens under [data-color-scheme="dark"]). Default: light.
export type ColorScheme = "light" | "dark";

const STORAGE_KEY = "wegPortalColorScheme";
const listeners = new Set<(scheme: ColorScheme) => void>();

function readStored(): ColorScheme {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch {
        return "light";
    }
}

let current: ColorScheme = typeof window === "undefined" ? "light" : readStored();

// Applies the stored scheme; called once before the first render so the
// page never flashes in the wrong theme.
export function applyStoredColorScheme(): void {
    document.documentElement.setAttribute("data-color-scheme", current);
}

export function setColorScheme(scheme: ColorScheme): void {
    current = scheme;
    try {
        window.localStorage.setItem(STORAGE_KEY, scheme);
    } catch {
        // private mode etc.: the choice just isn't remembered
    }
    document.documentElement.setAttribute("data-color-scheme", scheme);
    listeners.forEach((listener) => listener(scheme));
}

export function useColorScheme(): ColorScheme {
    const [scheme, setScheme] = useState(current);
    useEffect(() => {
        listeners.add(setScheme);
        return () => {
            listeners.delete(setScheme);
        };
    }, []);
    return scheme;
}
