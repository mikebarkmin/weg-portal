import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, canShowAdmin, useAuth } from "../lib/auth";
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
import FormField, { SwitchField } from "../components/FormField";
import Notice from "../components/Notice";
import VisibilityChip from "../components/VisibilityChip";
import ProtectedPhotos from "../components/ProtectedPhotos";
import IssueLocationView from "../components/IssueLocationView";
import IssueEditor from "../components/IssueEditor";
import IssueReporter from "../components/IssueReporter";
import IssueHistory from "../components/IssueHistory";
import {
    isIdentifyingLocation,
    shareIssueLocation,
    useIssueAreas,
    useIssueLocation,
} from "../lib/issueAreas";

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
    const navigate = useNavigate();
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

    // ---- location: a separate record the server only hands to the
    // Beirat, the reporter and (once shared) Hausmeister/Hausverwaltung ----
    const areas = useIssueAreas();
    const { location, reload: reloadLocation } = useIssueLocation(id, record?.status);
    // decided together with the accept: share the location with staff?
    const [shareOnAccept, setShareOnAccept] = useState(true);
    const [shareBusy, setShareBusy] = useState(false);
    const identifying = isIdentifyingLocation(location ?? null);
    // a floor or a pin narrows down to single flats: suggest "private"
    useEffect(() => {
        if (identifying) {
            setVisibility((current) => (current === "" ? "private" : current));
        }
    }, [identifying]);

    const [actionBusy, setActionBusy] = useState(false);
    const [actionError, setActionError] = useState<{ key: string; detail: string } | null>(null);
    const [editing, setEditing] = useState(false);
    const [deleteBusy, setDeleteBusy] = useState(false);

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
            if (requiresVisibility && location) {
                await shareIssueLocation(record.id, shareOnAccept);
                reloadLocation();
            }
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

    // Beirat: share or revoke the location of an accepted issue
    const toggleShare = async (shared: boolean) => {
        if (!record) return;
        setShareBusy(true);
        setActionError(null);
        try {
            await shareIssueLocation(record.id, shared);
            reloadLocation();
        } catch (err) {
            setActionError({
                key: "issueDetail.error.generic",
                detail: err instanceof ClientResponseError ? serverMessage(err) : "",
            });
        } finally {
            setShareBusy(false);
        }
    };

    // Admin: delete the report with everything attached to it (the
    // server cascades metas, locations and the history)
    const remove = async () => {
        if (!record) return;
        if (!window.confirm(t("issueDetail.deleteConfirm", { title: record.title }))) return;
        setDeleteBusy(true);
        try {
            await pb.collection("issues").delete(record.id);
            navigate("/issues");
        } catch (err) {
            setDeleteBusy(false);
            setActionError({
                key: "issueDetail.error.generic",
                detail: err instanceof ClientResponseError ? serverMessage(err) : "",
            });
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
    const isStaff = role === "hausmeister" || role === "hausverwaltung";
    // other owners never learn whether an issue has a location at all
    const showLocation = canShow(role) || isStaff || Boolean(location);
    const isAccepted = record.status !== "pending" && record.status !== "rejected";

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
            <PageHeading title={record.title}>
                {canShow(role) && !editing && (
                    <button type="button" className="btn sm secondary" onClick={() => setEditing(true)}>
                        <i className="ri-edit-line" aria-hidden="true" />
                        <span className="txt">{t("moderation.edit")}</span>
                    </button>
                )}
                {canShowAdmin(role) && (
                    <button type="button" className="btn sm secondary transparent" disabled={deleteBusy} onClick={() => void remove()}>
                        <i className="ri-delete-bin-line" aria-hidden="true" />
                        <span className="txt">{t("issueDetail.delete")}</span>
                    </button>
                )}
            </PageHeading>
            <div className="flex-column gap-sm">
                <article className="post">
                    {editing ? (
                        <IssueEditor
                            issue={record}
                            onSaved={(updated) => {
                                setRecord(updated);
                                setEditing(false);
                            }}
                            onCancel={() => setEditing(false)}
                        />
                    ) : record.description ? (
                        <div className="content prewrap">{record.description}</div>
                    ) : (
                        <div className="txt-hint">{t("issueDetail.noDescription")}</div>
                    )}

                    {showLocation && (
                        <>
                            <hr />
                            <div className="post-section">
                                <h2 className="section-title">
                                    <i className="ri-map-pin-line" aria-hidden="true" />
                                    {t("issueDetail.location")}
                                </h2>
                                <IssueLocationView
                                    location={location}
                                    areas={areas}
                                    emptyText={isStaff ? t("issueDetail.noLocationShared") : undefined}
                                />
                                {location && (
                                    <p className="txt-hint txt-sm m-0">
                                        <i className="ri-lock-line" aria-hidden="true" />{" "}
                                        {canShow(role) || isStaff
                                            ? t("issueDetail.locationRestricted")
                                            : t("issueDetail.locationOwn")}
                                    </p>
                                )}
                                {canShow(role) && location && isAccepted && (
                                    <div className="grid sm">
                                        <SwitchField
                                            id="detail-location-shared"
                                            label={t("moderation.shareLocation.label")}
                                            hint={t("moderation.shareLocation.hint")}
                                            checked={location.shared}
                                            disabled={shareBusy}
                                            onChange={(e) => void toggleShare(e.target.checked)}
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}

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
                                {identifying && (
                                    <div className="col-12">
                                        <div className="field-help">{t("moderation.visibility.locationHint")}</div>
                                    </div>
                                )}
                                {location && (
                                    <SwitchField
                                        id="detail-share-on-accept"
                                        label={t("moderation.shareLocation.label")}
                                        hint={t("moderation.shareLocation.hint")}
                                        checked={shareOnAccept}
                                        onChange={(e) => setShareOnAccept(e.target.checked)}
                                    />
                                )}
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
                                        {t(transition.labelKey)}
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
