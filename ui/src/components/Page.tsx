import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

// Page skeleton in BugStage's layout (layout.css): an optional sidebar with
// sub-navigation, filters, metadata and actions next to the content column.
// Below 800 px BugStage stacks the sidebar above the content.
export function Page({
    sidebar,
    children,
    className = "",
}: {
    sidebar?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={`page ${className}`.trim()}>
            {sidebar && <aside className="page-sidebar">{sidebar}</aside>}
            <div className="page-content">{children}</div>
        </div>
    );
}

// Narrow single-column page (forms like login, legal texts, notices).
export function Wrapper({ children, size = "" }: { children: ReactNode; size?: "" | "sm" }) {
    return <div className={`portal-wrapper ${size}`.trim()}>{children}</div>;
}

export function PageHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
    return (
        <header className="page-heading">
            <h1 className="title">{title}</h1>
            {children && (
                <>
                    <div className="flex-fill" />
                    <div className="page-heading-ctrls">{children}</div>
                </>
            )}
        </header>
    );
}

export function SidebarMenu({
    title,
    secondary = false,
    children,
}: {
    title?: ReactNode;
    secondary?: boolean;
    children: ReactNode;
}) {
    return (
        <div className={`sidebar-menu ${secondary ? "secondary" : ""}`.trim()}>
            {title && <div className="menu-title">{title}</div>}
            <div className="menu-content">{children}</div>
        </div>
    );
}

export function MenuLink({
    to,
    icon,
    children,
    end = false,
}: {
    to: string;
    icon?: string;
    children: ReactNode;
    end?: boolean;
}) {
    return (
        <NavLink to={to} end={end} className={({ isActive }) => `menu-item ${isActive ? "active" : ""}`}>
            {icon && <i className={icon} aria-hidden="true" />}
            <span className="txt">{children}</span>
        </NavLink>
    );
}

export function MenuButton({
    icon,
    active = false,
    onClick,
    children,
    count,
}: {
    icon?: string;
    active?: boolean;
    onClick: () => void;
    children: ReactNode;
    count?: number;
}) {
    return (
        <button
            type="button"
            className={`menu-item ${active ? "active" : ""}`}
            aria-pressed={active}
            onClick={onClick}
        >
            {icon && <i className={icon} aria-hidden="true" />}
            <span className="txt">{children}</span>
            {count !== undefined && <span className="label sm menu-count">{count}</span>}
        </button>
    );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
    return (
        <Link to={to} className="menu-item link-prev">
            <i className="ri-arrow-left-line" aria-hidden="true" />
            <span className="txt">{children}</span>
        </Link>
    );
}

// Label/value pairs in the sidebar (BugStage's discussion sidebar shows
// "Category", "Labels", ... the same way).
export function SidebarInfo({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="sidebar-menu secondary sidebar-info">
            <div className="menu-title">{label}</div>
            <div className="menu-content">{children}</div>
        </div>
    );
}
