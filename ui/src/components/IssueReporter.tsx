import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";

interface IssueMeta {
    id: string;
    email: string;
    name: string;
}

// The submitter contact of an issue (issue_metas, readable by the Beirat
// only - plan.md roles matrix "Submitter emails"). Renders nothing for
// anyone else or when no meta exists.
export default function IssueReporter({ issueId }: { issueId: string }) {
    const { t } = useTranslation();
    const [meta, setMeta] = useState<IssueMeta | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        pb.collection<IssueMeta>("issue_metas")
            .getFirstListItem(pb.filter("issue = {:issue}", { issue: issueId }))
            .then((record) => active && setMeta(record))
            .catch(() => active && setFailed(true));
        return () => {
            active = false;
        };
    }, [issueId]);

    if (failed) {
        return <span className="txt-hint">{t("issueDetail.reporterUnavailable")}</span>;
    }
    if (!meta) return <span className="txt-hint">…</span>;

    return (
        <span className="reporter">
            {meta.name && <span className="reporter-name">{meta.name}</span>}
            <a className="reporter-email" href={`mailto:${meta.email}`}>
                {meta.email}
            </a>
        </span>
    );
}
