import type { ReactNode } from "react";

// Centered status block (success after a submission, login required,
// waiting for approval, not found). Title, text and actions share one
// axis so nothing sits off-center.
export default function Notice({
    icon,
    tone = "neutral",
    title,
    children,
    actions,
}: {
    icon: string;
    tone?: "neutral" | "success" | "warning" | "danger";
    title: ReactNode;
    children?: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <section className={`post notice notice-${tone}`}>
            <span className="notice-icon" aria-hidden="true">
                <i className={icon} />
            </span>
            <h1 className="notice-title">{title}</h1>
            {children && <div className="notice-text">{children}</div>}
            {actions && <div className="notice-actions">{actions}</div>}
        </section>
    );
}
