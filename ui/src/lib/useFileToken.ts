import { useCallback, useEffect, useMemo, useState } from "react";

import { pb } from "./pbClient";
import { FileTokenRefresher } from "./fileToken";

// One single-flight file token provider for the whole SPA (lib/fileToken.ts):
// a page that renders many protected photos (board, moderation queue)
// fetches ONE token, not one per image. File tokens belong to the logged-in
// user, so the cache is dropped whenever the auth state changes.
const sharedRefresher = new FileTokenRefresher(() => pb.files.getToken());
pb.authStore.onChange(() => sharedRefresher.invalidate());

export interface ProtectedFileToken {
    // the current token (null while loading or when none is needed)
    token: string | null;
    // file names whose forced-refresh retry also failed
    failed: string[];
    // <img onError>: one forced token refresh per file, then give up
    onError: (filename: string) => void;
}

// Token state for protected files. `needed` = false skips the fetch (no
// photos on the page). Every change of `refreshKey` (e.g. a realtime
// record update) re-checks the token age, so a long-lived page refreshes
// it at ~2/3 of the TTL before it can expire.
export function useFileToken(needed: boolean, refreshKey?: unknown): ProtectedFileToken {
    const [token, setToken] = useState<string | null>(sharedRefresher.peek());
    const [failed, setFailed] = useState<string[]>([]);
    const retried = useMemo(() => new Set<string>(), []);

    useEffect(() => {
        if (!needed) return;
        let active = true;
        void sharedRefresher
            .get()
            .then((fresh) => active && setToken(fresh))
            .catch(() => active && setToken(null));
        return () => {
            active = false;
        };
    }, [needed, refreshKey]);

    const onError = useCallback(
        (filename: string) => {
            const markFailed = () =>
                setFailed((prev) => (prev.includes(filename) ? prev : [...prev, filename]));
            if (retried.has(filename)) {
                markFailed();
                return;
            }
            retried.add(filename);
            void sharedRefresher
                .get(true)
                .then((fresh) => {
                    setFailed((prev) => prev.filter((name) => name !== filename));
                    setToken(fresh);
                })
                .catch(markFailed);
        },
        [retried],
    );

    return { token, failed, onError };
}
