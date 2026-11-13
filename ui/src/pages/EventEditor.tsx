import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { fieldErrors } from "../lib/pbErrors";
import { weekdayLabel } from "../lib/dates";
import {
    buildEventPayload,
    emptyEventForm,
    eventToForm,
    validateEventForm,
    type EventFormValues,
    type Frequency,
    type RepeatEnd,
} from "../lib/eventForm";
import type { PortalEvent } from "../types";
import { CALENDARS } from "../lib/calendars";
import { BackLink, Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField, { SwitchField } from "../components/FormField";

type Errors = Partial<Record<keyof EventFormValues, string>>;

// Beirat event editor: /events/new and /events/:id/edit (route guarded by
// RequireBeirat; the events collection rules allow writes for the Beirat
// only, so the server stays authoritative).
export default function EventEditor() {
    const { id } = useParams();
    const isNew = !id;
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const locale = i18n.language;

    const [values, setValues] = useState<EventFormValues>(emptyEventForm);
    const [loading, setLoading] = useState(!isNew);
    const [loadError, setLoadError] = useState(false);
    const [errors, setErrors] = useState<Errors>({});
    const [serverError, setServerError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        if (isNew) return;
        let active = true;
        pb.collection<PortalEvent>("events")
            .getOne(id)
            .then((event) => {
                if (!active) return;
                setValues(eventToForm(event));
                setLoading(false);
            })
            .catch(() => {
                if (!active) return;
                setLoadError(true);
                setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [id, isNew]);

    const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => {
        setValues((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: undefined }));
    };

    // switching all-day keeps the chosen dates (drops/adds the time part)
    const setAllDay = (allDay: boolean) => {
        setValues((prev) => {
            const convert = (value: string) =>
                !value ? "" : allDay ? value.slice(0, 10) : value.length === 10 ? `${value}T19:00` : value;
            return { ...prev, all_day: allDay, date_start: convert(prev.date_start), date_end: convert(prev.date_end) };
        });
    };

    const toggleWeekday = (day: number) => {
        set(
            "weekdays",
            values.weekdays.includes(day)
                ? values.weekdays.filter((d) => d !== day)
                : [...values.weekdays, day].sort(),
        );
    };

    const save = async (event: { preventDefault(): void }) => {
        event.preventDefault();
        const found = validateEventForm(values);
        setErrors(found);
        if (Object.keys(found).length > 0) return;

        setBusy(true);
        setServerError(null);
        try {
            const payload = buildEventPayload(values);
            const saved = isNew
                ? await pb.collection<PortalEvent>("events").create(payload)
                : await pb.collection<PortalEvent>("events").update(id, payload);
            navigate(`/events/${saved.id}`);
        } catch (err) {
            if (err instanceof ClientResponseError && err.status === 400) {
                const serverFields = fieldErrors(err);
                if (Object.keys(serverFields).length > 0) {
                    setErrors(serverFields as Errors);
                    return;
                }
            }
            setServerError("eventEditor.error.save");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!id) return;
        if (!confirmDelete) {
            setConfirmDelete(true);
            return;
        }
        setBusy(true);
        setServerError(null);
        try {
            await pb.collection("events").delete(id);
            navigate("/kalender");
        } catch {
            setServerError("eventEditor.error.delete");
            setBusy(false);
        }
    };

    const error = (key: keyof EventFormValues) => (errors[key] ? t(errors[key]!) : null);

    const backTo = isNew ? "/kalender" : `/events/${id}`;
    const backLabel = isNew ? t("event.back") : t("eventEditor.backToEvent");
    const sidebar = (
        <>
            <SidebarMenu>
                <BackLink to={backTo}>{backLabel}</BackLink>
            </SidebarMenu>
            <p className="txt-hint sidebar-text">{t("eventEditor.intro")}</p>
        </>
    );

    if (loading) {
        return (
            <Page sidebar={sidebar}>
                <p className="txt-hint">{t("calendar.loading")}</p>
            </Page>
        );
    }
    if (loadError) {
        return (
            <Page sidebar={sidebar}>
                <div className="alert danger">{t("event.loadError")}</div>
            </Page>
        );
    }

    const dateType = values.all_day ? "date" : "datetime-local";
    const repeats = values.freq !== "none" || values.customRule !== "";

    return (
        <Page sidebar={sidebar}>
            <PageHeading title={isNew ? t("eventEditor.headingNew") : t("eventEditor.headingEdit")} />
            <form className="post" onSubmit={save} noValidate>
                <div className="grid sm">
                    <FormField id="event-title" label={t("suggestion.title")} required error={error("title")}>
                        <input
                            id="event-title"
                            type="text"
                            maxLength={200}
                            autoComplete="off"
                            value={values.title}
                            onChange={(e) => set("title", e.target.value)}
                        />
                    </FormField>

                    <FormField id="event-description" label={t("suggestion.description")} error={error("description")}>
                        <textarea
                            id="event-description"
                            rows={4}
                            maxLength={5000}
                            value={values.description}
                            onChange={(e) => set("description", e.target.value)}
                        />
                    </FormField>

                    <div className="col-12">
                        <fieldset className="visibility-choice">
                            <legend className="field-group-label">{t("calendars.label")}</legend>
                            <div className="visibility-options calendar-options">
                                {CALENDARS.map((c) => (
                                    <label key={c.id} className={`choice-card calendar-choice calendar-${c.id} ${values.calendar === c.id ? "active" : ""}`}>
                                        <input
                                            type="radio"
                                            name="event-calendar"
                                            checked={values.calendar === c.id}
                                            onChange={() => set("calendar", c.id)}
                                        />
                                        <i className={c.icon} aria-hidden="true" />
                                        <span className="choice-card-txt">
                                            <strong>{t(`calendars.${c.id}`)}</strong>
                                            <span className="txt-hint txt-sm">{t(`calendars.${c.id}Hint`)}</span>
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    </div>

                    <SwitchField
                        id="event-all-day"
                        label={t("suggestion.allDay")}
                        checked={values.all_day}
                        onChange={(e) => setAllDay(e.target.checked)}
                    />

                    <FormField id="event-start" className="col-12 col-md-6" label={t("suggestion.dateStart")} required error={error("date_start")}>
                        <input
                            id="event-start"
                            type={dateType}
                            value={values.date_start}
                            onChange={(e) => set("date_start", e.target.value)}
                        />
                    </FormField>
                    <FormField id="event-end" className="col-12 col-md-6" label={t("suggestion.dateEnd")} error={error("date_end")}>
                        <input
                            id="event-end"
                            type={dateType}
                            value={values.date_end}
                            onChange={(e) => set("date_end", e.target.value)}
                        />
                    </FormField>

                    <FormField id="event-location" className="col-12 col-md-6" label={t("suggestion.location")} error={error("location")}>
                        <input
                            id="event-location"
                            type="text"
                            maxLength={200}
                            value={values.location}
                            onChange={(e) => set("location", e.target.value)}
                        />
                    </FormField>
                    <FormField id="event-category" className="col-12 col-md-6" label={t("suggestion.category")} error={error("category")}>
                        <input
                            id="event-category"
                            type="text"
                            maxLength={100}
                            value={values.category}
                            onChange={(e) => set("category", e.target.value)}
                        />
                    </FormField>

                    <div className="col-12">
                        <hr className="m-0" />
                    </div>
                    <div className="col-12">
                        <h2 className="section-title">
                            <i className="ri-repeat-line" aria-hidden="true" />
                            {t("event.recurrence")}
                        </h2>
                    </div>

                    {values.customRule ? (
                        <>
                            <FormField
                                id="event-custom-rule"
                                label="RRULE"
                                hint={t("eventEditor.customRuleHint")}
                                error={error("customRule")}
                            >
                                <input
                                    id="event-custom-rule"
                                    type="text"
                                    value={values.customRule}
                                    onChange={(e) => set("customRule", e.target.value)}
                                />
                            </FormField>
                            <div className="col-12">
                                <button type="button" className="btn sm secondary" onClick={() => set("customRule", "")}>
                                    {t("eventEditor.replaceCustomRule")}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <FormField id="event-freq" className="col-12 col-md-6" label={t("eventEditor.repeat")}>
                                <select id="event-freq" value={values.freq} onChange={(e) => set("freq", e.target.value as Frequency)}>
                                    <option value="none">{t("recurrence.none")}</option>
                                    <option value="DAILY">{t("recurrence.daily")}</option>
                                    <option value="WEEKLY">{t("recurrence.weekly")}</option>
                                    <option value="MONTHLY">{t("recurrence.monthly")}</option>
                                    <option value="YEARLY">{t("recurrence.yearly")}</option>
                                </select>
                            </FormField>
                            {repeats && (
                                <FormField id="event-interval" className="col-12 col-md-6" label={t("eventEditor.interval")} error={error("interval")}>
                                    <input
                                        id="event-interval"
                                        type="number"
                                        inputMode="numeric"
                                        min={1}
                                        max={99}
                                        value={values.interval}
                                        onChange={(e) => set("interval", Number(e.target.value))}
                                    />
                                </FormField>
                            )}

                            {values.freq === "WEEKLY" && (
                                <div className="col-12">
                                    <div className="field-group-label">{t("eventEditor.weekdays")}</div>
                                    <div className="weekday-picker">
                                        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                                            <label key={day} className={`weekday-option ${values.weekdays.includes(day) ? "active" : ""}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={values.weekdays.includes(day)}
                                                    onChange={() => toggleWeekday(day)}
                                                />
                                                <span>{weekdayLabel(day, locale)}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="field-help">{t("eventEditor.weekdaysHint")}</div>
                                </div>
                            )}

                            {repeats && (
                                <>
                                    <FormField id="event-repeat-end" className="col-12 col-md-6" label={t("eventEditor.ends")}>
                                        <select
                                            id="event-repeat-end"
                                            value={values.repeatEnd}
                                            onChange={(e) => set("repeatEnd", e.target.value as RepeatEnd)}
                                        >
                                            <option value="never">{t("eventEditor.endsNever")}</option>
                                            <option value="until">{t("eventEditor.endsUntil")}</option>
                                            <option value="count">{t("eventEditor.endsCount")}</option>
                                        </select>
                                    </FormField>
                                    {values.repeatEnd === "until" && (
                                        <FormField id="event-until" className="col-12 col-md-6" label={t("eventEditor.untilDate")} required error={error("until")}>
                                            <input
                                                id="event-until"
                                                type="date"
                                                value={values.until}
                                                onChange={(e) => set("until", e.target.value)}
                                            />
                                        </FormField>
                                    )}
                                    {values.repeatEnd === "count" && (
                                        <FormField id="event-count" className="col-12 col-md-6" label={t("eventEditor.countLabel")} required error={error("count")}>
                                            <input
                                                id="event-count"
                                                type="number"
                                                inputMode="numeric"
                                                min={1}
                                                max={999}
                                                value={values.count}
                                                onChange={(e) => set("count", Number(e.target.value))}
                                            />
                                        </FormField>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {serverError && (
                        <div className="col-12">
                            <div className="alert danger">{t(serverError)}</div>
                        </div>
                    )}

                    <div className="col-12">
                        <footer className="form-footer">
                            {!isNew &&
                                (confirmDelete ? (
                                    <>
                                        <span className="txt-hint txt-sm delete-hint">{t("eventEditor.deleteHint")}</span>
                                        <button type="button" className="btn secondary" onClick={() => setConfirmDelete(false)}>
                                            {t("eventEditor.cancel")}
                                        </button>
                                        <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
                                            <i className="ri-delete-bin-line" aria-hidden="true" />
                                            <span className="txt">{t("eventEditor.confirmDelete")}</span>
                                        </button>
                                    </>
                                ) : (
                                    <button type="button" className="btn secondary transparent" disabled={busy} onClick={() => void remove()}>
                                        <i className="ri-delete-bin-line" aria-hidden="true" />
                                        <span className="txt">{t("eventEditor.delete")}</span>
                                    </button>
                                ))}
                            {!confirmDelete && (
                                <>
                                    <span className="flex-fill" />
                                    <button type="submit" className={`btn expanded-lg ${busy ? "loading" : ""}`} disabled={busy}>
                                        <span className="txt">{busy ? t("eventEditor.saving") : t("eventEditor.save")}</span>
                                    </button>
                                </>
                            )}
                        </footer>
                    </div>
                </div>
            </form>
        </Page>
    );
}
