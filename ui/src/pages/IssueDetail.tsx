import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { useAuth } from "../lib/auth";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import {
    buildIssueStatusUpdate,
    issueTransitionsFor,
    type IssueStatus,
    type IssueVisibility,
} from "../lib/validation";
import {
    buildFileUrl,
    FileTokenRefresher,
} from "../lib/fileToken";
import type { PortalIssue } from "../types";
import StatusBadge from "../components/StatusBadge";
import VisibilityChip from "../components/VisibilityChip";

// Issue detail (M9): the fields, photos and - for beirat/hausmeister -
// the status change buttons for exactly the transitions the server
// accepts (lib/validation.ts mirrors hooks/issueWorkflow.go). Photos
// are protected files fetched with a short-lived file token; the token
// is refreshed proactively at ~2/3 of its TTL and once more when an
// image load fails (404), see lib/fileToken.ts.
export default function IssueDetail() {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const auth = useAuth();
    const { id = "" } = useParams();

    const [record, setRecord] = useState<PortalIssue | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<"load" | "notFound" | null>(null);

    // file token (single-flight, see lib/fileToken.ts)
    const refresher = useMemo(() => new FileTokenRefresher(() => pb.files.getToken()), []);
    const [token, setToken] = useState<string | null>(null);
    // file names whose 404-retry already failed are not retried anymore
    const retried = useMemo(() => new Set<string>(), []);
    const [photoFailed, setPhotoFailed] = useState<string[]>([]);

    const loadRecord = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const issue = await pb.collection<PortalIssue>("issues").getOne(id);
            setRecord(issue);
        } catch (err) {
            if (err instanceof ClientResponseError && errorStatus(err) === 404) {
                setError("notFound");
            } else {
                setError("load");
            }
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadRecord();
    }, [loadRecord]);

    // first token fetch + proactive refresh: whenever the token from the
    // refresher is more than ~2/3 of its TTL old, get() fetches a new one
    // automatically when the photos are (re)rendered.
    useEffect(() => {
        void refresher.get().then(setToken).catch(() => setToken(null));
    }, [refresher, record?.id]);

    // keep the open detail page live (same rules as the board; the Beirat
    // sees decisions made by another member without a reload).
    // Deliberately keyed on the record id only: (re)subscribing to every
    // incoming realtime update would reconnect the subscription each
    // time; the callback itself needs nothing from the current record.
    useEffect(() => {
        const recordId = record?.id;
        if (!recordId) return;
        let active = true;
        let unsubscribe: (() => Promise<void>) | null = null;

        pb.collection<PortalIssue>("issues")
            .subscribe(recordId, (event) => {
                if (!active) return;
                if (event.action === "delete") {
                    if (active) {
                        setRecord(null);
                        setError("notFound");
                    }
                    return;
                }
                setRecord(event.record);
            })
            .then((unsub) => {
                if (active) {
                    unsubscribe = unsub;
                } else {
                    void unsub();
                }
            })
            .catch(() => {
                // realtime is an enhancement - the page works without it
            });

        return () => {
            active = false;
            if (unsubscribe) {
                void unsubscribe();
            }
        };
    }, [record?.id]);

    const onPhotoError = (filename: string) => {
        if (retried.has(filename)) {
            setPhotoFailed((prev) =>
                prev.includes(filename) ? prev : [...prev, filename],
            );
            return;
        }
        // one-shot 404 retry: force a fresh token and let the re-rendered
        // URL load with it
        retried.add(filename);
        void refresher
            .get(true)
            .then((fresh) => {
                setPhotoFailed((prev) => prev.filter((name) => name !== filename));
                setToken(fresh);
            })
            .catch(() => {
                setPhotoFailed((prev) =>
                    prev.includes(filename) ? prev : [...prev, filename],
                );
            });
    };

    // ---- status transitions (beirat + hausmeister only; see
    // lib/validation.ts for the matrix) ----
    const role = auth.role;
    const transitions = useMemo(
        () => (record ? issueTransitionsFor(role, record.status) : []),
        [role, record],
    );
    const [visibility, setVisibility] = useState<IssueVisibility | "">("");
    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<{ key: string; detail: string } | null>(null);

    const applyTransition = async (
        next: IssueStatus,
        requiresVisibility: boolean,
    ) => {
        if (!record) return;
        let payload;
        try {
            payload = buildIssueStatusUpdate(
                role,
                record.status,
                next,
                requiresVisibility
                    ? visibility === "community" || visibility === "private"
                        ? visibility
                        : undefined
                    : undefined,
            );
        } catch {
            setActionError({ key: "issueDetail.error.visibilityRequired", detail: "" });
            return;
        }
        setActionBusy(true);
        setActionError(null);
        try {
            await pb.collection("issues").update(record.id, payload);
            // re-read: the response carries the new hook-owned timestamps
            const fresh = await pb.collection<PortalIssue>("issues").getOne(record.id);
            setRecord(fresh);
        } catch (err) {
            const detail = err instanceof ClientResponseError ? serverMessage(err) : "";
            const key =
                err instanceof ClientResponseError && errorStatus(err) === 400
                    ? "issueDetail.error.transition"
                    : "issueDetail.error.generic";
            setActionError({ key, detail });
        } finally {
            setActionBusy(false);
        }
    };

    if (loading && !record) {
        return (
            <>
                <h1>{t("issueDetail.heading")}</h1>
                <p className="state">{t("issueDetail.loading")}</p>
            </>
        );
    }

    if (error === "notFound" || (!record && error)) {
        return (
            <section className="card state">
                <h1>{t("issueDetail.notFoundTitle")}</h1>
                <p>{t("issueDetail.notFoundText")}</p>
                <div className="btn-row">
                    <Link className="btn btn-outline" to="/issues">
                        {t("issueDetail.back")}
                    </Link>
                </div>
            </section>
        );
    }

    if (error === "load" || !record) {
        return (
            <>
                <h1>{t("issueDetail.heading")}</h1>
                <p className="state state-error">{t("issueDetail.loadError")}</p>
                <div className="btn-row">
                    <button type="button" className="btn" onClick={() => void loadRecord()}>
                        {t("issueDetail.retry")}
                    </button>
                </div>
            </>
        );
    }

    // roles with at least one possible next step (beirat, hausmeister)
    const canDecide = transitions.length > 0;

    const decided = parsePBDate(record.decided_at);
    const resolved = parsePBDate(record.resolved_at);

    return (
        <>
            <p className="hint">
                <Link to="/issues">{t("issueDetail.back")}</Link>
            </p>
            <article className="card detail-card">
                <h1 className="detail-title">{record.title}</h1>
                <div className="board-item-badges detail-badges">
                    <StatusBadge status={record.status} />
                    {auth.role === "beirat" && (
                        <VisibilityChip visibility={record.visibility} />
                    )}
                </div>

                {record.description && (
                    <p className="prewrap">{record.description}</p>
                )}

                <dl className="queue-meta">
                    {record.category && (
                        <>
                            <dt>{t("issueDetail.category")}</dt>
                            <dd>{record.category}</dd>
                        </>
                    )}
                    <dt>{t("issueDetail.location")}</dt>
                    <dd>
                        {record.lat.toFixed(3)}, {record.lng.toFixed(3)}
                    </dd>
                    {decided && (
                        <>
                            <dt>{t("issueDetail.decided")}</dt>
                            <dd>{formatLongDate(decided, locale)}</dd>
                        </>
                    )}
                    {resolved && (
                        <>
                            <dt>{t("issueDetail.resolved")}</dt>
                            <dd>{formatLongDate(resolved, locale)}</dd>
                        </>
                    )}
                </dl>

                {record.photos.length > 0 && (
                    <div className="field">
                        <span className="field-label">{t("issueDetail.photos")}</span>
                        <ul className="photo-thumbs detail-photos">
                            {record.photos
                                .filter((name) => !photoFailed.includes(name))
                                .map((name) => (
                                    <li key={name} className="photo-thumb">
                                        {token ? (
                                            <img
                                                src={buildFileUrl(
                                                    pb.baseUrl,
                                                    "issues",
                                                    record.id,
                                                    name,
                                                    { token, thumb: "600x0" },
                                                )}
                                                alt={t("issueDetail.photoAlt", {
                                                    index: record.photos.indexOf(name) + 1,
                                                })}
                                                onError={() => onPhotoError(name)}
                                            />
                                        ) : (
                                            <div className="photo-placeholder" />
                                        )}
                                    </li>
                                ))}
                        </ul>
                        {photoFailed.length > 0 && (
                            <p className="hint">{t("issueDetail.photoFailed")}</p>
                        )}
                    </div>
                )}

                {canDecide && (
                    <div className="detail-actions">
                        <h2 className="section-title">{t("issueDetail.actions")}</h2>
                        {transitions.some((transition) => transition.requiresVisibility) && (
                            <div className="field">
                                <label htmlFor="detail-visibility">
                                    {t("moderation.visibility.label")}
                                </label>
                                <select
                                    id="detail-visibility"
                                    value={visibility}
                                    onChange={(e) =>
                                        setVisibility(e.target.value as IssueVisibility | "")
                                    }
                                >
                                    <option value="">—</option>
                                    <option value="community">
                                        {t("issueVisibility.community.label")}
                                    </option>
                                    <option value="private">
                                        {t("issueVisibility.private.label")}
                                    </option>
                                </select>
                                <p className="hint">
                                    {t("moderation.visibility.hint")}
                                </p>
                            </div>
                        )}
                        {actionError && (
                            <div className="form-error">
                                {t(actionError.key)}
                                {actionError.detail ? ` (${actionError.detail})` : ""}
                            </div>
                        )}
                        <div className="btn-row">
                            {transitions.map((transition) => (
                                <button
                                    key={transition.status}
                                    type="button"
                                    className={
                                        transition.status === "rejected"
                                            ? "btn btn-outline"
                                            : "btn"
                                    }
                                    disabled={actionBusy}
                                    onClick={() =>
                                        void applyTransition(
                                            transition.status,
                                            transition.requiresVisibility,
                                        )
                                    }
                                >
                                    {transition.status === "open"
                                        ? t("moderation.accept")
                                        : t(`issueDetail.action.${transition.status}`)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </article>
        </>
    );
}
