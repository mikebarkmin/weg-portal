import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { canShow, logout, useAuth, useOwnerAccount } from "../lib/auth";
import { changeLanguage, supportedLanguages, type Language } from "../lib/i18n";
import { setColorScheme, useColorScheme } from "../lib/theme";

interface NavItem {
    to: string;
    icon: string;
    label: string;
    active?: boolean;
}

// Initials for the avatar circle (BugStage shows them in the header).
function initialsOf(name: string, fallback: string): string {
    const source = name.trim() || fallback;
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : source.slice(0, 2);
    return letters.toUpperCase();
}

// App shell in BugStage's layout: the floating header bar (.project-header)
// with icon navigation, the page body, and the footer with the theme and
// language pickers. On narrow screens the navigation collapses into a
// dropdown behind a menu button, exactly like BugStage's project menu.
export default function Layout() {
    const { t } = useTranslation();
    const auth = useAuth();
    const scheme = useColorScheme();
    const location = useLocation();
    const navigate = useNavigate();
    const menuId = useId().replace(/:/g, "");
    const reportId = useId().replace(/:/g, "");
    const beiratId = useId().replace(/:/g, "");
    const isOwner = useOwnerAccount();
    const accountId = useId().replace(/:/g, "");

    const isBeirat = canShow(auth.role);

    // Like BugStage's project menu: the items stay inline while they fit
    // into one row and collapse into a dropdown otherwise. An invisible
    // copy of the inline menu is measured against the free space.
    const barRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLElement>(null);
    const [collapsed, setCollapsed] = useState(false);
    useLayoutEffect(() => {
        const bar = barRef.current;
        const measure = measureRef.current;
        if (!bar || !measure) return;
        const update = () => {
            const reserved = Array.from(bar.children).reduce((sum, child) => {
                const el = child as HTMLElement;
                if (el === measure || el.classList.contains("project-menu") ||
                    el.classList.contains("project-menu-toggle") || el.classList.contains("flex-fill")) {
                    return sum;
                }
                return sum + el.offsetWidth;
            }, 0);
            const style = getComputedStyle(bar);
            const gap = parseFloat(style.columnGap || "0") || 0;
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const free = bar.clientWidth - padding - reserved - gap * 3;
            setCollapsed(measure.scrollWidth > free);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(bar);
        return () => observer.disconnect();
    }, [isBeirat, auth.isAuthenticated, t]);

    // keep the document title in sync with the active language
    useEffect(() => {
        document.title = t("app.title");
    }, [t]);

    // close open dropdowns after every navigation
    useEffect(() => {
        document.querySelectorAll<HTMLElement>("[popover]").forEach((el) => {
            try {
                el.hidePopover();
            } catch {
                // not open
            }
        });
    }, [location.pathname]);

    const onBoard =
        location.pathname.startsWith("/issues") && location.pathname !== "/issues/new";

    // main pages; "report" and "beirat" items live in their own dropdowns
    const items: NavItem[] = [
        { to: "/aktuelles", icon: "ri-megaphone-line", label: t("nav.announcements") },
        { to: "/kalender", icon: "ri-calendar-2-line", label: t("nav.calendar") },
        { to: "/issues", icon: "ri-map-pin-2-line", label: t("nav.board"), active: onBoard },
        { to: "/dokumente", icon: "ri-folder-3-line", label: t("nav.documents") },
    ];
    if (isOwner) {
        items.push({ to: "/mitreden", icon: "ri-chat-poll-line", label: t("nav.participate") });
    }
    const reportItems: NavItem[] = [
        { to: "/issues/new", icon: "ri-error-warning-line", label: t("nav.newIssue") },
        { to: "/suggestions/new", icon: "ri-calendar-event-line", label: t("nav.newSuggestion") },
    ];
    const beiratItems: NavItem[] = isBeirat
        ? [
              { to: "/moderation", icon: "ri-inbox-2-line", label: t("nav.moderation") },
              { to: "/users", icon: "ri-group-line", label: t("nav.users") },
              { to: "/notes", icon: "ri-sticky-note-line", label: t("nav.notes") },
              { to: "/rechtstexte", icon: "ri-scales-3-line", label: t("nav.legal") },
          ]
        : [];
    const groupButtons = [
        { id: reportId, icon: "ri-add-circle-line", label: t("nav.report"), items: reportItems },
        ...(isBeirat ? [{ id: beiratId, icon: "ri-shield-user-line", label: t("nav.beirat"), items: beiratItems }] : []),
    ];

    const dropdownLink = (item: NavItem) => (
        <NavLink key={item.to} to={item.to} end className={({ isActive }) => `dropdown-item ${isActive ? "active" : ""}`}>
            <i className={item.icon} aria-hidden="true" />
            <span className="txt">{item.label}</span>
        </NavLink>
    );

    const navLink = (item: NavItem) => (
        <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
                `header-btn ${(item.active ?? isActive) ? "active" : ""}`
            }
            {...(item.active !== undefined
                ? { "aria-current": item.active ? ("page" as const) : undefined }
                : {})}
        >
            <i className={item.icon} aria-hidden="true" />
            <span className="txt">{item.label}</span>
        </NavLink>
    );

    const onLogout = () => {
        logout();
        navigate("/");
    };

    return (
        <div className="app">
            <div className="app-body">
                {/* BugStage picks the header text color from the accent's lightness */}
                <header className="project-header accent-vars" data-accent={scheme === "dark" ? "dark" : "light"}>
                    <div className="top-bar">
                        <Link
                            to="/"
                            className="header-btn secondary all-projects-btn"
                            aria-label={t("nav.home")}
                        >
                            <i className="ri-home-4-line" aria-hidden="true" />
                        </Link>
                        <div className="top-bar-content" ref={barRef}>
                            <nav ref={measureRef} className="project-menu menu-measure" aria-hidden="true">
                                {items.map((item) => (
                                    <span key={item.to} className="header-btn">
                                        <i className={item.icon} />
                                        <span className="txt">{item.label}</span>
                                    </span>
                                ))}
                                {groupButtons.map((group) => (
                                    <span key={group.id} className="header-btn">
                                        <i className={group.icon} />
                                        <span className="txt">{group.label}</span>
                                        <i className="ri-arrow-drop-down-fill" />
                                    </span>
                                ))}
                            </nav>
                            <Link to="/" className="header-title">
                                <span className="txt">{t("app.title")}</span>
                            </Link>
                            <div className="flex-fill" />

                            {collapsed ? (
                                <>
                                    <nav
                                        id={menuId}
                                        className="project-menu dropdown"
                                        popover="auto"
                                        aria-label={t("nav.menu")}
                                    >
                                        {items.map(navLink)}
                                        {groupButtons.map((group) => (
                                            <div key={group.id} className="menu-group">
                                                <div className="dropdown-section-title">{group.label}</div>
                                                {group.items.map(navLink)}
                                            </div>
                                        ))}
                                    </nav>
                                    <button
                                        type="button"
                                        className="header-btn project-menu-toggle"
                                        popoverTarget={menuId}
                                        aria-label={t("nav.menu")}
                                    >
                                        <i className="ri-menu-line" aria-hidden="true" />
                                    </button>
                                </>
                            ) : (
                                <nav className="project-menu" aria-label={t("nav.menu")}>
                                    {items.map(navLink)}
                                    {groupButtons.map((group) => (
                                        <span key={group.id} className="header-group">
                                            <button
                                                type="button"
                                                className={`header-btn ${group.items.some((i) => location.pathname.startsWith(i.to)) ? "active" : ""}`}
                                                popoverTarget={group.id}
                                            >
                                                <i className={group.icon} aria-hidden="true" />
                                                <span className="txt">{group.label}</span>
                                                <i className="ri-arrow-drop-down-fill" aria-hidden="true" />
                                            </button>
                                            <div id={group.id} className="dropdown sm header-dropdown" popover="auto">
                                                {group.items.map(dropdownLink)}
                                            </div>
                                        </span>
                                    ))}
                                </nav>
                            )}

                            {auth.isAuthenticated ? (
                                <>
                                    <button
                                        type="button"
                                        className="header-btn account-btn"
                                        popoverTarget={accountId}
                                        aria-label={t("nav.account")}
                                    >
                                        <span className="thumb circle sm account-thumb">
                                            {initialsOf(auth.name, auth.email)}
                                        </span>
                                    </button>
                                    <div id={accountId} className="dropdown sm account-dropdown" popover="auto">
                                        <div className="dropdown-section-title">
                                            {auth.name || auth.email}
                                        </div>
                                        <Link className="dropdown-item" to="/meine-einreichungen">
                                            <i className="ri-file-list-3-line" aria-hidden="true" />
                                            <span className="txt">{t("nav.mySubmissions")}</span>
                                        </Link>
                                        <Link className="dropdown-item" to="/profile">
                                            <i className="ri-user-settings-line" aria-hidden="true" />
                                            <span className="txt">{t("nav.profile")}</span>
                                        </Link>
                                        <button type="button" className="dropdown-item" onClick={onLogout}>
                                            <i className="ri-logout-box-r-line" aria-hidden="true" />
                                            <span className="txt">{t("nav.logout")}</span>
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <NavLink
                                    to="/login"
                                    className={({ isActive }) => `header-btn login-btn ${isActive ? "active" : ""}`}
                                    aria-label={t("nav.login")}
                                >
                                    <i className="ri-login-box-line" aria-hidden="true" />
                                    <span className="txt">{t("nav.login")}</span>
                                </NavLink>
                            )}
                        </div>
                    </div>
                </header>

                <main className="app-main">
                    <Outlet />
                </main>
            </div>

            <AppFooter />
        </div>
    );
}

function AppFooter() {
    const { t, i18n } = useTranslation();
    const scheme = useColorScheme();
    const themeId = useId().replace(/:/g, "");
    const langId = useId().replace(/:/g, "");

    const pick = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
        (e.currentTarget.closest("[popover]") as HTMLElement | null)?.hidePopover();
        fn();
    };

    return (
        <footer className="app-footer">
            <nav className="links-list ctrls">
                <button type="button" className="list-item handle" popoverTarget={themeId}>
                    <i className="ri-palette-line" aria-hidden="true" />
                    <span className="txt">
                        {t("footer.theme")}: {t(`footer.scheme.${scheme}`)}
                    </span>
                    <i className="ri-arrow-drop-down-fill" aria-hidden="true" />
                </button>
                <div id={themeId} className="dropdown sm" popover="auto">
                    {(["light", "dark"] as const).map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={`dropdown-item ${scheme === option ? "active" : ""}`}
                            onClick={pick(() => setColorScheme(option))}
                        >
                            {t(`footer.scheme.${option}`)}
                        </button>
                    ))}
                </div>

                <button type="button" className="list-item handle" popoverTarget={langId}>
                    <i className="ri-translate-2" aria-hidden="true" />
                    <span className="txt">{t(`lang.${i18n.language as Language}`)}</span>
                    <i className="ri-arrow-drop-down-fill" aria-hidden="true" />
                </button>
                <div id={langId} className="dropdown sm" popover="auto" aria-label={t("lang.switch")}>
                    {supportedLanguages.map((lng: Language) => (
                        <button
                            key={lng}
                            type="button"
                            className={`dropdown-item ${i18n.language === lng ? "active" : ""}`}
                            onClick={pick(() => changeLanguage(lng))}
                        >
                            {t(`lang.${lng}`)}
                        </button>
                    ))}
                </div>
            </nav>
            <nav className="links-list credits">
                <Link className="list-item" to="/kontakte">
                    {t("nav.contacts")}
                </Link>
                <Link className="list-item" to="/impressum">
                    {t("legal.footer.impressum")}
                </Link>
                <Link className="list-item" to="/datenschutz">
                    {t("legal.footer.datenschutz")}
                </Link>
            </nav>
        </footer>
    );
}
