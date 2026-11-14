import { useState } from "react";
import { useTranslation } from "react-i18next";

import { showError } from "../lib/toast";

interface ConfirmDeleteButtonProps {
    // performs the delete; a rejection shows an error toast and resets the button
    onConfirm: () => Promise<unknown>;
    // optional question shown next to the buttons while confirming
    prompt?: string;
    // icon-only trigger (rows with little room)
    iconOnly?: boolean;
    label?: string;
    disabled?: boolean;
    className?: string;
}

// The one way to delete something in the portal: the trash button turns
// into "Cancel / Delete" in place (no browser dialog), the delete shows a
// busy state, and a failure is reported instead of being swallowed.
export default function ConfirmDeleteButton({ onConfirm, prompt, iconOnly, label, disabled, className = "btn sm secondary transparent" }: ConfirmDeleteButtonProps) {
    const { t } = useTranslation();
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const text = label ?? t("notes.delete");

    const run = async () => {
        setBusy(true);
        try {
            await onConfirm();
        } catch {
            showError();
            setConfirming(false);
        } finally {
            setBusy(false);
        }
    };

    if (!confirming) {
        return (
            <button
                type="button"
                className={className}
                disabled={disabled}
                aria-label={iconOnly ? text : undefined}
                onClick={() => setConfirming(true)}
            >
                <i className="ri-delete-bin-line" aria-hidden="true" />
                {!iconOnly && <span className="txt">{text}</span>}
            </button>
        );
    }
    return (
        <span className="confirm-delete" role="group" aria-label={prompt ?? text}>
            {prompt && <span className="txt-hint txt-sm delete-hint">{prompt}</span>}
            <button type="button" className="btn sm secondary" disabled={busy} onClick={() => setConfirming(false)}>
                {t("eventEditor.cancel")}
            </button>
            <button
                type="button"
                className={`btn sm danger ${busy ? "loading" : ""}`}
                disabled={busy}
                autoFocus
                onClick={() => void run()}
            >
                <i className="ri-delete-bin-line" aria-hidden="true" />
                <span className="txt">{text}</span>
            </button>
        </span>
    );
}
