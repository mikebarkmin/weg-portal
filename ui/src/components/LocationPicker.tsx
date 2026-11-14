import { useTranslation } from "react-i18next";

import AreaPlan from "./AreaPlan";
import FormField from "./FormField";
import { formatPlanCoordinate, parsePlanPoint, type IssueArea } from "../lib/issueAreas";

// The optional location of a report (replaces the former map): the area
// of the property, the floor for houses and - on areas with a plan - a
// pin. Everything is handed to the form as plain strings; the server
// validates them again (hooks/issueAreas.go).
//
// The plan is only available to approved accounts: guests and unapproved
// accounts pick the area (and floor) from the lists only.

export interface LocationValue {
    area: string;
    floor: string;
    x: string;
    y: string;
}

interface LocationPickerProps {
    // null while loading
    areas: IssueArea[] | null;
    value: LocationValue;
    onChange: (value: LocationValue) => void;
}

export default function LocationPicker({ areas, value, onChange }: LocationPickerProps) {
    const { t } = useTranslation();

    // retired areas are not offered any more
    const options = (areas ?? []).filter((area) => area.active);
    const area = options.find((candidate) => candidate.id === value.area);
    const pin = parsePlanPoint(value.x, value.y);

    if (areas !== null && options.length === 0) {
        return <p className="txt-hint txt-sm m-0">{t("issue.location.unavailable")}</p>;
    }

    return (
        <div className="location-picker">
            <div className="grid sm">
                <FormField id="issue-area" className="col-12 col-md-6" label={t("issue.location.area")}>
                    <select
                        id="issue-area"
                        value={value.area}
                        disabled={areas === null}
                        // a new area invalidates the floor and the pin
                        onChange={(e) => onChange({ area: e.target.value, floor: "", x: "", y: "" })}
                    >
                        <option value="">{t("issue.location.none")}</option>
                        {options.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.name}
                            </option>
                        ))}
                    </select>
                </FormField>
                {area && area.floors.length > 0 && (
                    <FormField id="issue-floor" className="col-12 col-md-6" label={t("issue.location.floor")}>
                        <select
                            id="issue-floor"
                            value={value.floor}
                            onChange={(e) => onChange({ ...value, floor: e.target.value })}
                        >
                            <option value="">{t("issue.location.floorNone")}</option>
                            {area.floors.map((floor) => (
                                <option key={floor} value={floor}>
                                    {floor}
                                </option>
                            ))}
                        </select>
                    </FormField>
                )}
            </div>

            {area && area.plan && (
                <>
                    <AreaPlan
                        areaId={area.id}
                        plan={area.plan}
                        pin={pin}
                        label={t("issue.location.planLabel", { area: area.name })}
                        hint={t("issue.location.pinHint")}
                        onPick={(point) =>
                            onChange({
                                ...value,
                                x: formatPlanCoordinate(point.x),
                                y: formatPlanCoordinate(point.y),
                            })
                        }
                    />
                    <div className="map-toolbar">
                        {pin ? (
                            <button
                                type="button"
                                className="btn sm secondary"
                                onClick={() => onChange({ ...value, x: "", y: "" })}
                            >
                                <i className="ri-close-line" aria-hidden="true" />
                                <span className="txt">{t("issue.location.clear")}</span>
                            </button>
                        ) : (
                            <span className="txt-hint txt-sm">{t("issue.location.pinHint")}</span>
                        )}
                    </div>
                </>
            )}
            {area && area.has_plan && !area.plan && (
                <p className="txt-hint txt-sm m-0">{t("issue.location.planOwnersOnly")}</p>
            )}

            <p className="txt-hint txt-sm m-0">
                <i className="ri-lock-line" aria-hidden="true" /> {t("issue.location.privacy")}
            </p>
        </div>
    );
}
