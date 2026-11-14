import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { serverMessage } from "../lib/pbErrors";
import FormField, { SwitchField } from "./FormField";
import type { PortalIssue } from "../types";

// Plain field edits of a report (text and photo removal) without a status
// change: allowed for the Beirat/Admin by the issue update rule and the
// workflow hook - in the moderation queue (before deciding) and on the
// detail page (afterwards).
export default function IssueEditor({
    issue,
    onSaved,
    onCancel,
}: {
    issue: PortalIssue;
    onSaved: (updated: PortalIssue) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [title, setTitle] = useState(issue.title);
    const [description, setDescription] = useState(issue.description);
    const [category, setCategory] = useState(issue.category);
    // photos the Beirat removes before publishing (e.g. they show people,
    // name plates or licence plates)
    const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!title.trim()) {
            setError(t("validation.required"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const updated = await pb.collection<PortalIssue>("issues").update(issue.id, {
                title: title.trim(),
                description: description.trim(),
                category: category.trim(),
                // PocketBase "field-" modifier: delete these files
                ...(removedPhotos.length > 0 ? { "photos-": removedPhotos } : {}),
            });
            onSaved(updated);
        } catch (err) {
            setError(t("moderation.error.generic") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={submit} noValidate>
            <div className="grid sm">
                <FormField id={`edit-title-${issue.id}`} label={t("issue.title")} required>
                    <input id={`edit-title-${issue.id}`} type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
                </FormField>
                <FormField id={`edit-description-${issue.id}`} label={t("issue.description")}>
                    <textarea id={`edit-description-${issue.id}`} rows={3} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} />
                </FormField>
                <FormField id={`edit-category-${issue.id}`} label={t("issue.category")}>
                    <input id={`edit-category-${issue.id}`} type="text" maxLength={100} value={category} onChange={(e) => setCategory(e.target.value)} />
                </FormField>
                <div className="col-12">
                    <div className="field-help">{t("moderation.editHint")}</div>
                </div>
                {issue.photos.map((photo, index) => (
                    <SwitchField
                        key={photo}
                        id={`edit-remove-photo-${issue.id}-${index}`}
                        label={t("moderation.removePhoto", { index: index + 1 })}
                        checked={removedPhotos.includes(photo)}
                        onChange={(e) =>
                            setRemovedPhotos((prev) =>
                                e.target.checked ? [...prev, photo] : prev.filter((name) => name !== photo),
                            )
                        }
                    />
                ))}
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="button" className="btn sm secondary" disabled={busy} onClick={onCancel}>
                            {t("eventEditor.cancel")}
                        </button>
                        <button type="submit" className={`btn sm ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t("eventEditor.save")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
