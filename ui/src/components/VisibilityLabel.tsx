import { useTranslation } from "react-i18next";

import type { Visibility } from "../types";

// "Öffentlich" / "Nur Eigentümer" label for announcements, documents and
// contacts (shown to logged-in users, who can see both kinds).
export default function VisibilityLabel({ visibility }: { visibility: Visibility }) {
    const { t } = useTranslation();
    return (
        <span className={`label sm ${visibility === "owners" ? "success" : ""}`}>
            <i className={visibility === "owners" ? "ri-home-heart-line" : "ri-global-line"} aria-hidden="true" />
            {t(`visibility.${visibility}`)}
        </span>
    );
}
