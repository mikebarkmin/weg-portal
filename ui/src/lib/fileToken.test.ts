import { describe, expect, it, vi } from "vitest";

import {
    buildFileUrl,
    FILE_TOKEN_REFRESH_AFTER_MS,
    FILE_TOKEN_TTL_SECONDS,
    FileTokenRefresher,
} from "./fileToken";

describe("buildFileUrl", () => {
    it("builds the protected file URL layout with the token query", () => {
        expect(
            buildFileUrl("https://portal.example.com", "issues", "abc123", "photo.png", {
                token: "tok",
            }),
        ).toBe("https://portal.example.com/api/files/issues/abc123/photo.png?token=tok");
    });

    it("appends the thumb parameter after the token", () => {
        expect(
            buildFileUrl("http://localhost:8090", "issues", "r1", "f 1.jpg", {
                token: "a b",
                thumb: "600x0",
            }),
        ).toBe(
            "http://localhost:8090/api/files/issues/r1/f%201.jpg?token=a%20b&thumb=600x0",
        );
    });

    it("strips a trailing slash from the base and omits empty query parts", () => {
        expect(
            buildFileUrl("https://portal.example.com/", "issues", "r1", "p.png", {}),
        ).toBe("https://portal.example.com/api/files/issues/r1/p.png");
        expect(buildFileUrl("https://x.example/", "issues", "r1", "p.png").includes("?")).toBe(false);
    });

    it("uses the users collection name path shape PocketBase serves", () => {
        // milestone contract: /api/files/issues/{id}/{name}?token=...
        const url = buildFileUrl("", "issues", "issuexyz", "photo.png", { token: "t" });
        expect(url).toBe("/api/files/issues/issuexyz/photo.png?token=t");
    });
});

describe("FileTokenRefresher", () => {
    it("refreshes at ~2/3 of the 300s TTL", () => {
        expect(FILE_TOKEN_TTL_SECONDS).toBe(300);
        expect(FILE_TOKEN_REFRESH_AFTER_MS).toBe(200000);
    });

    it("caches while the token is young and refetches when it ages past the lead", async () => {
        let tick = 1_000_000;
        let issued = 0;
        const fetchToken = vi.fn(async () => `t${issued++}`);
        const refresher = new FileTokenRefresher(fetchToken, { now: () => tick });

        expect(await refresher.get()).toBe("t0");
        expect(await refresher.get()).toBe("t0"); // cached
        expect(fetchToken).toHaveBeenCalledTimes(1);

        tick += 199_999; // just below the 200 s refresh lead
        expect(await refresher.get()).toBe("t0");
        expect(fetchToken).toHaveBeenCalledTimes(1);

        tick += 1; // at/after the lead: proactive refresh, ~100 s before expiry
        expect(await refresher.get()).toBe("t1");
        expect(fetchToken).toHaveBeenCalledTimes(2);
    });

    it("shares a single in-flight request between concurrent callers (single flight)", async () => {
        const fetchToken = vi.fn(
        () =>
            new Promise<string>((resolve) => {
                setTimeout(() => resolve("shared"), 10);
            }),
        );
        const refresher = new FileTokenRefresher(fetchToken);

        const [a, b, c] = await Promise.all([
            refresher.get(),
            refresher.get(),
            refresher.get(),
        ]);
        expect(a).toBe("shared");
        expect(b).toBe("shared");
        expect(c).toBe("shared");
        expect(fetchToken).toHaveBeenCalledTimes(1);
    });

    it("get(true) forces a refresh even while the cached token is young (the 404 retry)", async () => {
        let issued = 0;
        const fetchToken = vi.fn(async () => `t${issued++}`);
        const refresher = new FileTokenRefresher(fetchToken);

        expect(await refresher.get()).toBe("t0");
        expect(await refresher.get(true)).toBe("t1"); // forced
        expect(fetchToken).toHaveBeenCalledTimes(2);
        expect(await refresher.get()).toBe("t1"); // young again -> cached
    });

    it("invalidate() drops the cache; the next get() fetches", async () => {
        const fetchToken = vi.fn(async () => "fresh");
        const refresher = new FileTokenRefresher(fetchToken);
        await refresher.get();
        refresher.invalidate();
        expect(refresher.peek()).toBeNull();
        expect(await refresher.get()).toBe("fresh");
        expect(fetchToken).toHaveBeenCalledTimes(2);
    });

    it("peek() exposes the cached token without touching the network", async () => {
        const fetchToken = vi.fn(async () => "cached");
        const refresher = new FileTokenRefresher(fetchToken);
        expect(refresher.peek()).toBeNull();
        await refresher.get();
        expect(refresher.peek()).toBe("cached");
        expect(fetchToken).toHaveBeenCalledTimes(1);
    });

    it("a failed fetch rejects and can be retried (in-flight slot is released)", async () => {
        let fail = true;
        const fetchToken = vi.fn(async () => {
            if (fail) {
                throw new Error("boom");
            }
            return "ok";
        });
        const refresher = new FileTokenRefresher(fetchToken);

        await expect(refresher.get()).rejects.toThrow("boom");
        fail = false;
        await expect(refresher.get()).resolves.toBe("ok");
        expect(fetchToken).toHaveBeenCalledTimes(2);
    });
});
