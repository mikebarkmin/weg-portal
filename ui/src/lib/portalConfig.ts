import { applyIssueBounds, type IssueBounds } from "./validation";
import { setPortalTimeZone } from "./timezone";

// Public per-deployment settings (GET /api/portal/config, hooks/portalConfig.go).
interface PortalConfig {
    bounds?: Partial<IssueBounds>;
    timezone?: string;
}

// Loads the deployment config once at startup. Never throws and never
// blocks for long: on any failure the built-in fallbacks stay in place
// (the server validates the location again anyway).
export async function loadPortalConfig(timeoutMs = 3000): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch("/api/portal/config", { signal: controller.signal });
        if (!res.ok) return;
        const config = (await res.json()) as PortalConfig;
        applyIssueBounds(config.bounds);
        setPortalTimeZone(config.timezone);
    } catch {
        // keep the fallback values
    } finally {
        clearTimeout(timer);
    }
}
