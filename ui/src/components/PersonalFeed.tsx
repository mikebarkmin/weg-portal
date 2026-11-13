import { useState } from "react";
import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { buildIcalUrl } from "../lib/ical";

// The personal iCal link: includes every calendar the account can see.
// Calendar apps cannot log in, so the URL carries a secret token
// (POST /api/portal/calendar-token); renewing it invalidates old copies.
export default function PersonalFeed({ allowRenew = false }: { allowRenew?: boolean }) {
    const { t } = useTranslation();
    const [url, setUrl] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [copied, setCopied] = useState(false);

    const fetchToken = async (renew: boolean) => {
        setBusy(true);
        setError(false);
        setCopied(false);
        try {
            const res = await pb.send<{ token: string }>("/api/portal/calendar-token", {
                method: "POST",
                body: { renew },
            });
            setUrl(`${buildIcalUrl()}?token=${encodeURIComponent(res.token)}`);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="personal-feed">
            {!url ? (
                <button type="button" className="menu-item" disabled={busy} onClick={() => void fetchToken(false)}>
                    <i className="ri-rss-line" aria-hidden="true" />
                    <span className="txt">{t("calendar.personalFeed")}</span>
                </button>
            ) : (
                <>
                    <div className="field">
                        <label htmlFor="personal-feed-url">{t("calendar.personalFeed")}</label>
                        <input id="personal-feed-url" type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
                    </div>
                    <div className="flex gap-10 flex-wrap">
                        <button type="button" className="btn sm secondary" onClick={() => void copy()}>
                            <i className={copied ? "ri-check-line" : "ri-file-copy-line"} aria-hidden="true" />
                            <span className="txt">{copied ? t("calendar.copied") : t("calendar.copy")}</span>
                        </button>
                        {allowRenew && (
                            <button type="button" className="btn sm secondary transparent" disabled={busy} onClick={() => void fetchToken(true)}>
                                <i className="ri-refresh-line" aria-hidden="true" />
                                <span className="txt">{t("calendar.renewFeed")}</span>
                            </button>
                        )}
                    </div>
                </>
            )}
            <p className="txt-hint txt-sm m-0">{t("calendar.personalFeedHint")}</p>
            {error && <div className="field-help error">{t("calendar.feedError")}</div>}
        </div>
    );
}
