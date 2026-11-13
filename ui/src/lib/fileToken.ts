// File tokens for the protected issues.photos field (plan.md "Files").
// Without a fresh token the /api/files/... URLs return 404. The token TTL
// is 300 s (users.FileToken.Duration, set in migrations/1795000102_settings.go
// and mirrored here); pages refresh it at ~2/3 of the TTL so an open page
// never renders an expired URL, plus a single forced retry when an <img>
// still answers 404 (see FileTokenRefresher.get).

export const FILE_TOKEN_TTL_SECONDS = 300;

// ~2/3 of the TTL: a cached token older than this is refreshed proactively.
export const FILE_TOKEN_REFRESH_AFTER_MS = Math.round(
    (FILE_TOKEN_TTL_SECONDS * 1000 * 2) / 3,
);

// Builds a protected file URL in the PocketBase layout
// {base}/api/files/{collection}/{recordId}/{filename}?token=...&thumb=...
// (same shape as the SDK's pb.files.getUrl, kept explicit and pure so the
// builder and the token refresh logic are unit-testable).
export function buildFileUrl(
    baseUrl: string,
    collection: string,
    recordId: string,
    filename: string,
    query: { token?: string; thumb?: string } = {},
): string {
    const base = baseUrl.endsWith("/")
        ? baseUrl.slice(0, -1)
        : baseUrl;
    const params: string[] = [];
    if (query.token) {
        params.push(`token=${encodeURIComponent(query.token)}`);
    }
    if (query.thumb) {
        params.push(`thumb=${encodeURIComponent(query.thumb)}`);
    }
    const suffix = params.length > 0 ? `?${params.join("&")}` : "";
    return (
        `${base}/api/files/${encodeURIComponent(collection)}` +
        `/${encodeURIComponent(recordId)}` +
        `/${encodeURIComponent(filename)}${suffix}`
    );
}

// Single-flight token provider: concurrent callers share one getToken()
// request, a cached token is reused while younger than refreshAfterMs, and
// get(true) forces a refresh (used for the one-shot 404 retry). The clock
// and the fetcher are injectable for the unit tests.
export class FileTokenRefresher {
    private readonly fetchToken: () => Promise<string>;
    private readonly now: () => number;
    private readonly refreshAfterMs: number;

    private cached: string | null = null;
    private issuedAt = -Infinity;
    private inFlight: Promise<string> | null = null;

    constructor(
        fetchToken: () => Promise<string>,
        options: { now?: () => number; refreshAfterMs?: number } = {},
    ) {
        this.fetchToken = fetchToken;
        this.now = options.now ?? (() => Date.now());
        this.refreshAfterMs = options.refreshAfterMs ?? FILE_TOKEN_REFRESH_AFTER_MS;
    }

    // The current token, or null when none has been fetched (yet).
    peek(): string | null {
        return this.cached;
    }

    // A cached token is reused while it is younger than refreshAfterMs
    // (so it stays usable for at least ttl - refreshAfterMs); concurrent
    // calls share a single fetch. get(true) forces a refresh.
    async get(force = false): Promise<string> {
        if (
            !force &&
            this.cached !== null &&
            this.now() - this.issuedAt < this.refreshAfterMs
        ) {
            return this.cached;
        }

        if (!this.inFlight) {
            this.inFlight = (async () => {
                const token = await this.fetchToken();
                this.cached = token;
                this.issuedAt = this.now();
                return token;
            })().finally(() => {
                this.inFlight = null;
            });
        }
        return this.inFlight;
    }

    // Drops the cached token; the next get() fetches a fresh one.
    invalidate(): void {
        this.cached = null;
        this.issuedAt = -Infinity;
    }
}
