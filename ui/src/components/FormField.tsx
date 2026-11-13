import type { ReactNode } from "react";

// One form control in BugStage's field style (form.css): the label sits
// inside the grey input box; help and error text follow below it. The
// "required" class adds BugStage's red asterisk to the label.
export default function FormField({
    id,
    label,
    error,
    hint,
    required = false,
    className = "col-12",
    children,
}: {
    id: string;
    label: ReactNode;
    error?: string | null;
    hint?: ReactNode;
    required?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={className}>
            <div className={`field ${required ? "required" : ""} ${error ? "error" : ""}`.trim()}>
                <label htmlFor={id}>{label}</label>
                {children}
            </div>
            {hint && <div className="field-help">{hint}</div>}
            {error && (
                <div className="field-help error" role="alert">
                    {error}
                </div>
            )}
        </div>
    );
}

// A BugStage toggle switch (input.switch + label) for boolean options.
export function SwitchField({
    id,
    label,
    className = "col-12",
    hint,
    error,
    ...input
}: {
    id: string;
    label: ReactNode;
    className?: string;
    hint?: ReactNode;
    error?: string | null;
} & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <div className={className}>
            <div className={`field inline ${error ? "error" : ""}`.trim()}>
                <input id={id} type="checkbox" className="switch" {...input} />
                <label htmlFor={id}>{label}</label>
            </div>
            {hint && <div className="field-help">{hint}</div>}
            {error && (
                <div className="field-help error" role="alert">
                    {error}
                </div>
            )}
        </div>
    );
}
