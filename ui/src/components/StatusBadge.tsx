import { useTranslation } from "react-i18next";

import type { IssueStatus } from "../lib/validation";

// Localized status label for issues (and, shared vocabulary, elsewhere).
// The status VALUES themselves are never localized - only this display.
export default function StatusBadge({ status }: { status: IssueStatus }) {
    const { t } = useTranslation();
    return <span className={`badge badge-status-${status}`}>{t(`issueStatus.${status}`)}</span>;
}
