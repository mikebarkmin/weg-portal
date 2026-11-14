import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { serverMessage } from "../lib/pbErrors";
import { invalidateIssueAreas, parseFloorLines } from "../lib/issueAreas";
import AreaPlan from "../components/AreaPlan";
import FormField, { SwitchField } from "../components/FormField";
import { Page, PageHeading } from "../components/Page";

// issue_areas record as the Beirat sees it (collection API).
interface AreaRecord {
    id: string;
    name: string;
    floors: string[] | null;
    plan: string;
    sort: number;
    active: boolean;
}

// raster images only - the server rejects everything else (an SVG could
// carry script), 10 MB like the collection's file field
const PLAN_ACCEPT = "image/png,image/jpeg,image/webp";
const PLAN_TYPES = PLAN_ACCEPT.split(",");
const PLAN_MAX_BYTES = 10 * 1024 * 1024;

// Beirat/admin page: the areas a report can be located in. A house gets
// its floors; a shared area (basement, outside) gets a plan image on
// which owners place a pin. Areas that already have reports cannot be
// deleted (the reports reference them) - they are switched inactive.
export default function IssueAreas() {
    const { t } = useTranslation();
    const [items, setItems] = useState<AreaRecord[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // id of the area being edited, "new" for the create form
    const [editing, setEditing] = useState<string | null>(null);

    const load = useCallback(() => {
        pb.collection<AreaRecord>("issue_areas")
            .getFullList({ sort: "sort,name", requestKey: null })
            .then((list) => {
                setItems(list);
                setError(null);
            })
            .catch(() => setError(t("areas.loadError")));
    }, [t]);

    useEffect(() => {
        load();
    }, [load]);

    const changed = () => {
        setEditing(null);
        // the report form and the board read the areas through a cache
        invalidateIssueAreas();
        load();
    };

    const remove = async (area: AreaRecord) => {
        if (!window.confirm(t("areas.deleteConfirm", { name: area.name }))) return;
        try {
            await pb.collection("issue_areas").delete(area.id);
            changed();
        } catch {
            // PocketBase refuses while reports still reference the area
            setError(t("areas.deleteInUse", { name: area.name }));
        }
    };

    return (
        <Page sidebar={<p className="txt-hint sidebar-text">{t("areas.intro")}</p>}>
            <PageHeading title={t("areas.heading")}>
                {editing === null && (
                    <button type="button" className="btn sm" onClick={() => setEditing("new")}>
                        <i className="ri-add-line" aria-hidden="true" />
                        <span className="txt">{t("areas.add")}</span>
                    </button>
                )}
            </PageHeading>

            {error && <div className="alert danger m-b-sm">{error}</div>}
            {items === null && !error && <p className="txt-hint">{t("areas.loading")}</p>}

            <div className="flex-column gap-sm">
                {editing === "new" && (
                    <article className="post">
                        <AreaForm
                            nextSort={(items ?? []).reduce((max, area) => Math.max(max, area.sort), 0) + 1}
                            onSaved={changed}
                            onCancel={() => setEditing(null)}
                        />
                    </article>
                )}

                {items !== null && items.length === 0 && editing !== "new" && (
                    <div className="alert">{t("areas.empty")}</div>
                )}

                {(items ?? []).map((area) => (
                    <article key={area.id} className="post">
                        {editing === area.id ? (
                            <AreaForm area={area} nextSort={area.sort} onSaved={changed} onCancel={() => setEditing(null)} />
                        ) : (
                            <>
                                <header className="queue-card-header">
                                    <div className="queue-card-title-row">
                                        <h2 className="post-title">{area.name}</h2>
                                        <span className="flex gap-sm">
                                            <button
                                                type="button"
                                                className="btn sm secondary transparent"
                                                onClick={() => setEditing(area.id)}
                                            >
                                                <i className="ri-edit-line" aria-hidden="true" />
                                                <span className="txt">{t("areas.edit")}</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="btn sm secondary transparent"
                                                onClick={() => void remove(area)}
                                            >
                                                <i className="ri-delete-bin-line" aria-hidden="true" />
                                                <span className="txt">{t("areas.delete")}</span>
                                            </button>
                                        </span>
                                    </div>
                                    <span className="meta">
                                        {!area.active && (
                                            <span className="meta-item">
                                                <i className="ri-eye-off-line" aria-hidden="true" />
                                                {t("areas.inactive")}
                                            </span>
                                        )}
                                        {(area.floors ?? []).length > 0 && (
                                            <span className="meta-item">
                                                <i className="ri-stack-line" aria-hidden="true" />
                                                {(area.floors ?? []).join(", ")}
                                            </span>
                                        )}
                                        <span className="meta-item">
                                            <i className="ri-map-2-line" aria-hidden="true" />
                                            {area.plan ? t("areas.hasPlan") : t("areas.noPlan")}
                                        </span>
                                    </span>
                                </header>
                                {area.plan && (
                                    <AreaPlan
                                        areaId={area.id}
                                        plan={area.plan}
                                        label={t("issueDetail.planLabel", { area: area.name })}
                                        className="issue-map"
                                    />
                                )}
                            </>
                        )}
                    </article>
                ))}
            </div>
        </Page>
    );
}

function AreaForm({
    area,
    nextSort,
    onSaved,
    onCancel,
}: {
    area?: AreaRecord;
    nextSort: number;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState(area?.name ?? "");
    const [floors, setFloors] = useState((area?.floors ?? []).join("\n"));
    const [sort, setSort] = useState(String(area?.sort ?? nextSort));
    const [active, setActive] = useState(area?.active ?? true);
    const [file, setFile] = useState<File | null>(null);
    const [removePlan, setRemovePlan] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const id = (field: string) => `area-${field}-${area?.id ?? "new"}`;

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!name.trim()) {
            setError(t("validation.required"));
            return;
        }
        if (file && (!PLAN_TYPES.includes(file.type) || file.size > PLAN_MAX_BYTES)) {
            setError(t("areas.planInvalid"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const sortValue = Number.parseInt(sort, 10);
            // with a File the SDK sends multipart/form-data and keeps the
            // other fields (incl. the floors list) as JSON
            const payload: Record<string, unknown> = {
                name: name.trim(),
                floors: parseFloorLines(floors),
                sort: Number.isFinite(sortValue) ? sortValue : nextSort,
                active,
            };
            if (file) {
                payload.plan = file;
            } else if (removePlan) {
                payload.plan = null;
            }
            if (area) {
                await pb.collection("issue_areas").update(area.id, payload);
            } else {
                await pb.collection("issue_areas").create(payload);
            }
            onSaved();
        } catch (err) {
            setError(t("areas.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            <div className="grid sm">
                <FormField id={id("name")} className="col-12 col-md-8" label={t("areas.name")} required hint={t("areas.nameHint")}>
                    <input id={id("name")} type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
                <FormField id={id("sort")} className="col-12 col-md-4" label={t("areas.sort")}>
                    <input id={id("sort")} type="number" step={1} value={sort} onChange={(e) => setSort(e.target.value)} />
                </FormField>
                <FormField id={id("floors")} label={t("areas.floors")} hint={t("areas.floorsHint")}>
                    <textarea id={id("floors")} rows={5} value={floors} onChange={(e) => setFloors(e.target.value)} />
                </FormField>
                <FormField id={id("plan")} label={t("areas.plan")} hint={t("areas.planHint")}>
                    <input
                        id={id("plan")}
                        type="file"
                        accept={PLAN_ACCEPT}
                        onChange={(e) => {
                            setFile(e.target.files?.[0] ?? null);
                            setRemovePlan(false);
                        }}
                    />
                </FormField>
                {area?.plan && !file && (
                    <SwitchField
                        id={id("remove-plan")}
                        label={t("areas.removePlan")}
                        hint={t("areas.removePlanHint")}
                        checked={removePlan}
                        onChange={(e) => setRemovePlan(e.target.checked)}
                    />
                )}
                <SwitchField
                    id={id("active")}
                    label={t("areas.active")}
                    hint={t("areas.activeHint")}
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                />
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="button" className="btn sm secondary" disabled={busy} onClick={onCancel}>
                            {t("eventEditor.cancel")}
                        </button>
                        <button type="submit" className={`btn sm ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t("eventEditor.save")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
