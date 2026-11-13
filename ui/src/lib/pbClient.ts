import PocketBase from "pocketbase";

// The SPA is served by the portal binary itself, so the API is same-origin.
const baseUrl =
    typeof window === "undefined" ? "/" : window.location.origin;

export const pb = new PocketBase(baseUrl);

// NOTE: the user role must always be read from the auth store record,
// never decoded from the JWT (PocketBase JWTs carry no custom claims such
// as the `role` field). Server-side rules remain authoritative anyway.
export function currentUserRole(): string {
    const record = pb.authStore.record;
    return record?.["role"] ? String(record["role"]) : "";
}
