import { useTranslation } from "react-i18next";

import { pb } from "../lib/pbClient";
import { buildFileUrl } from "../lib/fileToken";
import { useFileToken } from "../lib/useFileToken";

interface ProtectedPhotosProps {
    recordId: string;
    photos: string[];
    // PocketBase thumb size (issues.photos defines 100x100 and 600x0)
    thumb?: "100x100" | "600x0";
    // re-check the token age when this changes (e.g. realtime updates)
    refreshKey?: unknown;
    className?: string;
    // false inside another link (board rows): no nested <a>
    linkFull?: boolean;
}

// Gallery of protected issue photos (plan.md "Files"): the images load
// with a short-lived file token; a tap opens the full-size photo in a new
// tab (the token travels in the URL, it expires after a few minutes).
export default function ProtectedPhotos({
    recordId,
    photos,
    thumb = "600x0",
    refreshKey,
    className = "photo-thumbs",
    linkFull = true,
}: ProtectedPhotosProps) {
    const { t } = useTranslation();
    const { token, failed, onError } = useFileToken(photos.length > 0, refreshKey);

    if (photos.length === 0) return null;

    const url = (name: string, size?: string) =>
        buildFileUrl(pb.baseUrl, "issues", recordId, name, {
            token: token ?? undefined,
            thumb: size,
        });

    return (
        <>
            <ul className={className}>
                {photos
                    .filter((name) => !failed.includes(name))
                    .map((name) => (
                        <li key={name} className="photo-thumb">
                            {token ? (
                                linkFull ? (
                                    <a href={url(name)} target="_blank" rel="noopener">
                                        <img
                                            src={url(name, thumb)}
                                            alt={t("issueDetail.photoAlt", { index: photos.indexOf(name) + 1 })}
                                            loading="lazy"
                                            onError={() => onError(name)}
                                        />
                                    </a>
                                ) : (
                                    <img
                                        src={url(name, thumb)}
                                        alt=""
                                        loading="lazy"
                                        onError={() => onError(name)}
                                    />
                                )
                            ) : (
                                <div className="photo-placeholder" />
                            )}
                        </li>
                    ))}
            </ul>
            {failed.length > 0 && <div className="field-help">{t("issueDetail.photoFailed")}</div>}
        </>
    );
}
