import { useTranslation } from "react-i18next";

import AreaPlan from "./AreaPlan";
import { locationLabel, type IssueArea, type IssueLocation } from "../lib/issueAreas";

// Read-only location of ONE issue: "Haus 79 · 2. OG", plus the plan with
// the pin when the reporter placed one. Rendered only for viewers the
// server handed the location to (Beirat, the reporter, staff once shared).
export default function IssueLocationView({
    location,
    areas,
    emptyText,
}: {
    // undefined while loading, null when there is none (or no access)
    location: IssueLocation | null | undefined;
    areas: IssueArea[] | null;
    emptyText?: string;
}) {
    const { t } = useTranslation();

    if (location === undefined || areas === null) {
        return <p className="txt-hint txt-sm m-0">…</p>;
    }
    if (location === null) {
        return <p className="txt-hint txt-sm m-0">{emptyText ?? t("issueDetail.noLocation")}</p>;
    }

    const area = areas.find((candidate) => candidate.id === location.area);
    const label = locationLabel(location, areas, t("issueDetail.unknownArea"));

    return (
        <div className="issue-location">
            <p className="issue-location-label m-0">
                <i className="ri-map-pin-line" aria-hidden="true" /> {label}
            </p>
            {location.has_pin && area?.plan && (
                <AreaPlan
                    areaId={area.id}
                    plan={area.plan}
                    pin={{ x: location.x, y: location.y }}
                    label={t("issueDetail.planLabel", { area: area.name })}
                    className="issue-map"
                />
            )}
        </div>
    );
}
