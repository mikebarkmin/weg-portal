import { useTranslation } from "react-i18next";

import type { IssueVisibilityValue } from "../types";

// Small chip for the issue visibility (community|private). Rendered where
// the role actually sees the field: the Beirat (also for private issues)
// on the board/detail pages.
export default function VisibilityChip({ visibility }: { visibility: IssueVisibilityValue }) {
    const { t } = useTranslation();

    if (visibility !== "community" && visibility !== "private") {
        return null;
    }

    return (
        <span
            className="label sm outline-label"
            title={t(`issueVisibility.${visibility}.hint`)}
        >
            <i className={visibility === "private" ? "ri-lock-line" : "ri-group-line"} aria-hidden="true" />
            {t(`issueVisibility.${visibility}.label`)}
        </span>
    );
}
