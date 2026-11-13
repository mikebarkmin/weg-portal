import { useTranslation } from "react-i18next";

import type { IssueStatus } from "../lib/validation";

// BugStage label colors per status: new (neutral) -> accepted (info) ->
// in progress (warning) -> resolved (success); rejected is danger.
const STATUS_LABEL_TONE: Record<IssueStatus, string> = {
    pending: "",
    open: "info",
    in_progress: "warning",
    resolved: "success",
    rejected: "danger",
};

// Localized status label for issues (and, shared vocabulary, elsewhere).
// The status VALUES themselves are never localized - only this display.
export default function StatusBadge({ status }: { status: IssueStatus }) {
    const { t } = useTranslation();
    return (
        <span className={`label sm ${STATUS_LABEL_TONE[status]}`}>{t(`issueStatus.${status}`)}</span>
    );
}
