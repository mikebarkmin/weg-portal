import { useEffect, useState } from "react";

// Minimal toast store for short feedback after an action (mostly: an
// action failed). Rendered by <Toasts /> in the Layout with BugStage's
// toast styles (css/bugstage/toast.css). Messages are i18n keys.
export type ToastKind = "info" | "success" | "error";

export interface Toast {
    id: number;
    kind: ToastKind;
    messageKey: string;
}

const DURATION_MS = 5000;
let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<(list: Toast[]) => void>();

function emit() {
    for (const listener of listeners) listener(toasts);
}

export function dismissToast(id: number): void {
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
}

export function showToast(messageKey: string, kind: ToastKind = "info"): void {
    const id = nextId++;
    // the same message twice in a row (double click) is shown once
    toasts = [...toasts.filter((toast) => toast.messageKey !== messageKey), { id, kind, messageKey }];
    emit();
    window.setTimeout(() => dismissToast(id), DURATION_MS);
}

export function showError(messageKey = "common.actionFailed"): void {
    showToast(messageKey, "error");
}

export function useToasts(): Toast[] {
    const [list, setList] = useState<Toast[]>(toasts);
    useEffect(() => {
        listeners.add(setList);
        return () => {
            listeners.delete(setList);
        };
    }, []);
    return list;
}
