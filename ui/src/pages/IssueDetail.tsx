import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { errorStatus, serverMessage } from "../lib/pbErrors";
import { formatLongDate } from "../lib/dates";
import { parsePBDate } from "../lib/recurrence";
import {
    buildIssueStatusUpdate,
    issueTransitionsFor,
    type IssueStatus,
    type IssueVisibility,
} from "../lib/validation";
import type { PortalIssue } from "../types";
import StatusBadge from "../components/StatusBadge";
import { BackLink, Page, PageHeading, SidebarInfo, SidebarMenu, Wrapper } from "../components/Page";
import FormField from "../components/FormField";
import Notice from "../components/Notice";
import VisibilityChip from "../components/VisibilityChip";
import ProtectedPhotos from "../components/ProtectedPhotos";
import IssueLocationMap from "../components/IssueLocationMap";
import IssueReporter from "../components/IssueReporter";
import IssueHistory from "../components/IssueHistory";
import { exactPositionOf, hasLocation } from "../lib/issues";

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

    const backSidebar = (
        <SidebarMenu>
            <BackLink to="/issues">{t("issueDetail.back")}</BackLink>
        </SidebarMenu>
    );

    if (loading && !record) {
        return (
            <Page sidebar={backSidebar}>
                <p className="txt-hint">{t("issueDetail.loading")}</p>
            </Page>
        );
    }

    if (error === "notFound" || (!record && error)) {
        return (
            <Wrapper size="sm">
                <Notice
                    icon="ri-question-line"
                    title={t("issueDetail.notFoundTitle")}
                    actions={
                        <Link className="btn secondary" to="/issues">
                            {t("issueDetail.back")}
                        </Link>
                    }
                >
                    <p>{t("issueDetail.notFoundText")}</p>
                </Notice>
            </Wrapper>
        );
    }

    if (error === "load" || !record) {
        return (
            <Page sidebar={backSidebar}>
                <div className="alert danger flex gap-sm">
                    <span className="flex-fill">{t("issueDetail.loadError")}</span>
                    <button type="button" className="btn sm secondary" onClick={() => void loadRecord()}>
                        {t("issueDetail.retry")}
                    </button>
                </div>
            </Page>
        );
    }

    // roles with at least one possible next step (beirat, hausmeister)
    const canDecide = transitions.length > 0;

    const created = parsePBDate(record.created);
    const decided = parsePBDate(record.decided_at);
    const resolved = parsePBDate(record.resolved_at);
    const exact = exactPositionOf(record, role);

    return (
        <Page
            sidebar={
                <>
                    {backSidebar}
                    <SidebarInfo label={t("issueDetail.status")}>
                        <span className="labels-list">
                            <StatusBadge status={record.status} />
                            {canShow(auth.role) && <VisibilityChip visibility={record.visibility} />}
                        </span>
                    </SidebarInfo>
                    {record.category && (
                        <SidebarInfo label={t("issueDetail.category")}>
                            <span>{record.category}</span>
                        </SidebarInfo>
                    )}
                    {created && (
                        <SidebarInfo label={t("issueDetail.created")}>
                            <span>{formatLongDate(created, locale)}</span>
                        </SidebarInfo>
                    )}
                    {decided && (
                        <SidebarInfo label={t("issueDetail.decided")}>
                            <span>{formatLongDate(decided, locale)}</span>
                        </SidebarInfo>
                    )}
                    {resolved && (
                        <SidebarInfo label={t("issueDetail.resolved")}>
                            <span>{formatLongDate(resolved, locale)}</span>
                        </SidebarInfo>
                    )}
                    {canShow(role) && (
                        <SidebarInfo label={t("issueDetail.reporter")}>
                            <IssueReporter issueId={record.id} />
                        </SidebarInfo>
                    )}
                </>
            }
        >
            <PageHeading title={record.title} />
            <div className="flex-column gap-sm">
                <article className="post">
                    {record.description ? (
                        <div className="content prewrap">{record.description}</div>
                    ) : (
                        <div className="txt-hint">{t("issueDetail.noDescription")}</div>
                    )}

                    <hr />

                    <div className="post-section">
                        <h2 className="section-title">
                            <i className="ri-map-pin-line" aria-hidden="true" />
                            {exact ? t("issueDetail.locationExact") : t("issueDetail.location")}
                        </h2>
                        <IssueLocationMap issue={record} role={role} />
                        {hasLocation(record) && (
                            <p className="txt-hint txt-sm m-0">
                                {exact
                                    ? `${exact[0].toFixed(6)}, ${exact[1].toFixed(6)}`
                                    : `${record.lat.toFixed(3)}, ${record.lng.toFixed(3)} · ${t("issueDetail.roundedHint")}`}
                            </p>
                        )}
                    </div>

                    {record.photos.length > 0 && (
                        <>
                            <hr />
                            <div className="post-section">
                                <h2 className="section-title">
                                    <i className="ri-image-line" aria-hidden="true" />
                                    {t("issueDetail.photos")}
                                </h2>
                                <ProtectedPhotos
                                    recordId={record.id}
                                    photos={record.photos}
                                    refreshKey={record}
                                    className="photo-thumbs detail-photos"
                                />
                            </div>
                        </>
                    )}
                </article>

                {canDecide && (
                    <section className="post detail-actions">
                        <h2 className="section-title">
                            <i className="ri-flag-line" aria-hidden="true" />
                            {t("issueDetail.actions")}
                        </h2>
                        {transitions.some((transition) => transition.requiresVisibility) && (
                            <div className="grid sm">
                                <FormField
                                    id="detail-visibility"
                                    label={t("moderation.visibility.label")}
                                    required
                                    hint={t("moderation.visibility.hint")}
                                >
                                    <select
                                        id="detail-visibility"
                                        value={visibility}
                                        onChange={(e) => setVisibility(e.target.value as IssueVisibility | "")}
                                    >
                                        <option value="">{t("moderation.visibility.choose")}</option>
                                        <option value="community">{t("issueVisibility.community.label")}</option>
                                        <option value="private">{t("issueVisibility.private.label")}</option>
                                    </select>
                                </FormField>
                            </div>
                        )}
                        {actionError && (
                            <div className="alert danger">
                                {t(actionError.key)}
                                {actionError.detail ? ` (${actionError.detail})` : ""}
                            </div>
                        )}
                        <footer className="form-footer">
                            {/* secondary action (reject) first, primary last - as in the moderation queue */}
                            {[...transitions]
                                .sort((a, b) => Number(b.status === "rejected") - Number(a.status === "rejected"))
                                .map((transition) => (
                                <button
                                    key={transition.status}
                                    type="button"
                                    className={`btn ${transition.status === "rejected" ? "secondary" : ""} ${actionBusy ? "loading" : ""}`}
                                    disabled={actionBusy}
                                    onClick={() => void applyTransition(transition.status, transition.requiresVisibility)}
                                >
                                    <span className="txt">
                                        {transition.status === "open"
                                            ? t("moderation.accept")
                                            : t(`issueDetail.action.${transition.status}`)}
                                    </span>
                                </button>
                                ))}
                        </footer>
                    </section>
                )}

                {(canShow(role) || role === "hausmeister" || role === "hausverwaltung") && (
                    <IssueHistory
                        issueId={record.id}
                        refreshKey={record.status}
                        canWrite={canShow(role) || (record.status !== "pending" && record.status !== "rejected")}
                    />
                )}
            </div>
        </Page>
    );
}
