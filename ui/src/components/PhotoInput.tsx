import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { reencodePhoto } from "../lib/exifStrip";
import { MAX_PHOTOS } from "../lib/validation";

// One attached photo. `blob` is ALWAYS the re-encoded JPEG from
// lib/exifStrip - the ORIGINAL FILE NEVER LEAVE THE BROWSER and is never
// uploaded (EXIF incl. GPS is thereby stripped). `url` is a local object
// URL used for the preview.
export interface PreparedPhoto {
    id: number;
    blob: Blob;
    url: string;
}

interface PhotoInputProps {
    photos: PreparedPhoto[];
    // hands the complete new list of prepared photos back to the form
    onChange: (photos: PreparedPhoto[]) => void;
}

const ACCEPTED_MIMES = "image/jpeg,image/png,image/webp";

export default function PhotoInput({ photos, onChange }: PhotoInputProps) {
    const { t } = useTranslation();
    const inputRef = useRef<HTMLInputElement>(null);
    const nextId = useRef(0);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const addFiles = async (files: FileList | File[]) => {
        setMessage(null);
        const selected = Array.from(files);
        if (selected.length === 0) return;

        const space = MAX_PHOTOS - photos.length;
        if (space <= 0) {
            setMessage(t("issue.photos.tooMany", { count: MAX_PHOTOS }));
            return;
        }
        const acceptedFiles = selected.slice(0, space);
        const skipped = selected.length - acceptedFiles.length;

        setBusy(true);
        const prepared: PreparedPhoto[] = [];
        let failed = 0;
        for (const file of acceptedFiles) {
            try {
                const { blob } = await reencodePhoto(file);
                prepared.push({
                    id: nextId.current++,
                    blob,
                    url: URL.createObjectURL(blob),
                });
            } catch {
                // undecodable/unsupported file: it is NOT attached -
                // an original file must never be uploaded unstripped
                failed++;
            }
        }
        setBusy(false);

        const notes: string[] = [];
        if (skipped > 0) {
            notes.push(t("issue.photos.tooMany", { count: MAX_PHOTOS }));
        }
        if (failed > 0) {
            notes.push(t("issue.photos.processingFailed", { count: failed }));
        }
        setMessage(notes.join(" ") || null);

        if (prepared.length > 0) {
            onChange([...photos, ...prepared]);
        }
    };

    const removePhoto = (id: number) => {
        const photo = photos.find((p) => p.id === id);
        if (photo) {
            URL.revokeObjectURL(photo.url);
        }
        setMessage(null);
        onChange(photos.filter((p) => p.id !== id));
    };

    return (
        <div className="photo-input">
            {photos.length > 0 && (
                <ul className="photo-thumbs">
                    {photos.map((photo, index) => (
                        <li key={photo.id} className="photo-thumb">
                            <img
                                src={photo.url}
                                alt={t("issue.photos.preview", { index: index + 1 })}
                            />
                            <button
                                type="button"
                                className="btn btn-outline photo-remove"
                                onClick={() => removePhoto(photo.id)}
                            >
                                {t("issue.photos.remove")}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <button
                type="button"
                className="btn btn-outline"
                disabled={busy || photos.length >= MAX_PHOTOS}
                onClick={() => inputRef.current?.click()}
            >
                {busy ? t("issue.photos.processing") : t("issue.photos.add")}
            </button>
            {/* the native picker reports HEIC files as image/heic; the
                accept list filters them where the OS honors it */}
            <input
                ref={inputRef}
                id="issue-photos"
                type="file"
                accept={ACCEPTED_MIMES}
                multiple
                hidden
                onChange={(event) => {
                    void addFiles(event.target.files ?? []);
                    event.target.value = ""; // allow re-adding the same file
                }}
            />
            <p className="hint">{t("issue.photos.hint", { count: MAX_PHOTOS })}</p>
            {message && <p className="field-error">{message}</p>}
        </div>
    );
}
