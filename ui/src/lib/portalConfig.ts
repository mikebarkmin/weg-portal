import { setPortalTimeZone } from "./timezone";

// Public per-deployment settings (GET /api/portal/config, hooks/portalConfig.go).
interface PortalConfig {
    timezone?: string;
    version?: string;
}

let appVersion = "";

// The running server build's version ("" until/unless the config loaded).
export function portalVersion(): string {
    return appVersion;
}

// Loads the deployment config once at startup. Never throws and never
// blocks for long: on any failure the built-in fallbacks stay in place.
export async function loadPortalConfig(timeoutMs = 3000): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("/api/portal/config", { signal: controller.signal });
        if (!res.ok) return;
        const config = (await res.json()) as PortalConfig;
        setPortalTimeZone(config.timezone);
        if (typeof config.version === "string") {
            appVersion = config.version.trim().slice(0, 64);
        }
    } catch {
        // keep the fallback values
    } finally {
        clearTimeout(timer);
    }
}
