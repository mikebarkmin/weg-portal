import { useTranslation } from "react-i18next";

import { weekdayLabel } from "../lib/dates";
import FormField from "./FormField";
import type { Frequency, RecurrenceErrors, RecurrenceValues, RepeatEnd } from "../lib/eventForm";

// The shared recurrence editor: a group of grid children (heading,
// builder fields or a verbatim custom rule) that any event-like form can
// drop into its .grid - the Beirat event editor, the public meeting
// suggestion form and the moderation-queue suggestion editor.
//
// `values` is the recurrence part of the form (see eventForm.ts), every
// change is reported through onChange as a patch. `errors` holds i18n
// keys (from validateRecurrence) that are resolved here.
export default function RecurrenceFields({
    idPrefix,
    values,
    onChange,
    errors = {},
}: {
    idPrefix: string;
    values: RecurrenceValues;
    onChange: (patch: Partial<RecurrenceValues>) => void;
    errors?: RecurrenceErrors;
}) {
    const { t, i18n } = useTranslation();
    const locale = i18n.language;
    const id = (field: string) => `${idPrefix}-${field}`;
    // validation errors arrive as i18n keys
    const txt = (key?: string) => (key ? t(key) : undefined);

    const repeats = values.freq !== "none";

    const toggleWeekday = (day: number) => {
        onChange({
            weekdays: values.weekdays.includes(day)
                ? values.weekdays.filter((d) => d !== day)
                : [...values.weekdays, day],
        });
    };

    const heading = (
        <>
            <div className="col-12">
                <hr className="m-0" />
            </div>
            <div className="col-12">
                <h2 className="section-title">
                    <i className="ri-repeat-line" aria-hidden="true" />
                    {t("event.recurrence")}
                </h2>
            </div>
        </>
    );

    if (values.customRule) {
        return (
            <>
                {heading}
                <FormField
                    id={id("custom-rule")}
                    label="RRULE"
                    hint={t("eventEditor.customRuleHint")}
                    error={txt(errors.customRule)}
                >
                    <input
                        id={id("custom-rule")}
                        type="text"
                        value={values.customRule}
                        onChange={(e) => onChange({ customRule: e.target.value })}
                    />
                </FormField>
                <div className="col-12">
                    <button type="button" className="btn sm secondary" onClick={() => onChange({ customRule: "" })}>
                        {t("eventEditor.replaceCustomRule")}
                    </button>
                </div>
            </>
        );
    }

    return (
        <>
            {heading}
            <FormField id={id("freq")} className="col-12 col-md-6" label={t("eventEditor.repeat")}>
                <select id={id("freq")} value={values.freq} onChange={(e) => onChange({ freq: e.target.value as Frequency })}>
                    <option value="none">{t("recurrence.none")}</option>
                    <option value="DAILY">{t("recurrence.daily")}</option>
                    <option value="WEEKLY">{t("recurrence.weekly")}</option>
                    <option value="MONTHLY">{t("recurrence.monthly")}</option>
                    <option value="YEARLY">{t("recurrence.yearly")}</option>
                </select>
            </FormField>
            {repeats && (
                <FormField id={id("interval")} className="col-12 col-md-6" label={t("eventEditor.interval")} error={txt(errors.interval)}>
                    <input
                        id={id("interval")}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={99}
                        value={values.interval}
                        onChange={(e) => onChange({ interval: Number(e.target.value) })}
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
                    <FormField id={id("repeat-end")} className="col-12 col-md-6" label={t("eventEditor.ends")}>
                        <select
                            id={id("repeat-end")}
                            value={values.repeatEnd}
                            onChange={(e) => onChange({ repeatEnd: e.target.value as RepeatEnd })}
                        >
                            <option value="never">{t("eventEditor.endsNever")}</option>
                            <option value="until">{t("eventEditor.endsUntil")}</option>
                            <option value="count">{t("eventEditor.endsCount")}</option>
                        </select>
                    </FormField>
                    {values.repeatEnd === "until" && (
                        <FormField id={id("until")} className="col-12 col-md-6" label={t("eventEditor.untilDate")} required error={txt(errors.until)}>
                            <input id={id("until")} type="date" value={values.until} onChange={(e) => onChange({ until: e.target.value })} />
                        </FormField>
                    )}
                    {values.repeatEnd === "count" && (
                        <FormField id={id("count")} className="col-12 col-md-6" label={t("eventEditor.countLabel")} required error={txt(errors.count)}>
                            <input
                                id={id("count")}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={999}
                                value={values.count}
                                onChange={(e) => onChange({ count: Number(e.target.value) })}
                            />
                        </FormField>
                    )}
                </>
            )}
        </>
    );
}
