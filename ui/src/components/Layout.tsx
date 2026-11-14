import { useCallback, useEffect, useId, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { canShow, canShowAdmin, logout, useAuth, useOwnerAccount } from "../lib/auth";
import { changeLanguage, supportedLanguages, type Language } from "../lib/i18n";
import { activeSection, buildSections, isLeafActive, type NavSection } from "../lib/nav";
import { setColorScheme, useColorScheme } from "../lib/theme";
import { portalVersion } from "../lib/portalConfig";
import { SidebarSlotContext } from "../lib/sidebarSlot";

// Initials for the avatar circle (BugStage shows them in the header).
function initialsOf(name: string, fallback: string): string {
    const source = name.trim() || fallback;
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : source.slice(0, 2);
    return letters.toUpperCase();
}

const MOBILE_QUERY = "(max-width: 800px)";
const SIDEBAR_KEY = "portal.sidebarHidden";

function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
    useEffect(() => {
        const mql = window.matchMedia(query);
        const onChange = () => setMatches(mql.matches);
        onChange();
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, [query]);
    return matches;
}

function readSidebarHidden(): boolean {
    try {
        return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
        return false;
    }
}

// App shell in BugStage's layout: the floating header bar (.project-header)
// holds only the top-level sections as tabs (a bottom tab bar on phones);
// the left sidebar holds the active section's sub-navigation plus the
// page's own sidebar content. The header's menu button toggles the
// sidebar - on phones it slides in as a drawer.
export default function Layout() {
    const { t } = useTranslation();
    const auth = useAuth();
    const scheme = useColorScheme();
    const location = useLocation();
    const navigate = useNavigate();
    const isOwner = useOwnerAccount();
    const accountId = useId().replace(/:/g, "");
    const sidebarId = useId().replace(/:/g, "");
    const isMobile = useMediaQuery(MOBILE_QUERY);

    const isBeirat = canShow(auth.role);
    const isAdmin = canShowAdmin(auth.role);
    const sections = buildSections({ isAuthenticated: auth.isAuthenticated, isOwner, isBeirat, isAdmin });
    const path = location.pathname;
    const section = activeSection(sections, path);

    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const slotRef = useCallback((el: HTMLDivElement | null) => setSlot(el), []);

    // desktop: collapsible sidebar (remembered); phones: drawer
    const [hidden, setHidden] = useState(readSidebarHidden);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const toggleSidebar = () => {
        if (isMobile) {
            setDrawerOpen((open) => !open);
            return;
        }
        setHidden((h) => {
            try {
                localStorage.setItem(SIDEBAR_KEY, h ? "0" : "1");
            } catch {
                // storage unavailable: keep the in-memory state
            }
            return !h;
        });
    };
    const sidebarVisible = isMobile ? drawerOpen : !hidden;

    // keep the document title in sync with the active language
    useEffect(() => {
        document.title = t("app.title");
    }, [t]);

    // close the drawer and open dropdowns after every navigation
    useEffect(() => {
        setDrawerOpen(false);
        document.querySelectorAll<HTMLElement>("[popover]").forEach((el) => {
            try {
                el.hidePopover();
            } catch {
                // not open
            }
        });
    }, [path]);

    useEffect(() => {
        if (!isMobile) setDrawerOpen(false);
    }, [isMobile]);

    useEffect(() => {
        if (!drawerOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setDrawerOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [drawerOpen]);

    // filters and in-page actions in the drawer close it as well
    const onSidebarClick = (e: React.MouseEvent) => {
        if (isMobile && (e.target as HTMLElement).closest(".menu-item")) setDrawerOpen(false);
    };

    const onLogout = () => {
        logout();
        navigate("/");
    };

    const tab = (s: NavSection) => {
        const active = s.id === section?.id;
        return (
            <Link
                key={s.id}
                to={s.to}
                className={`header-btn tab ${active ? "active" : ""}`}
                title={t(s.tabKey)}
                aria-current={active ? "page" : undefined}
            >
                <i className={s.icon} aria-hidden="true" />
                <span className="txt">{t(s.tabKey)}</span>
            </Link>
        );
    };

    return (
        <div className={`app ${isMobile ? "has-bottom-tabs" : ""}`.trim()}>
            <div className="app-body">
                {/* sticky wrapper: keeps the header in view and masks the
                    content scrolling underneath the gap above it */}
                <div className="app-header">
                {/* BugStage picks the header text color from the accent's lightness */}
                <header className="project-header accent-vars" data-accent={scheme === "dark" ? "dark" : "light"}>
                    <div className="top-bar">
                        <button
                            type="button"
                            className="header-btn secondary all-projects-btn sidebar-toggle"
                            aria-label={t("nav.menu")}
                            aria-controls={sidebarId}
                            aria-expanded={sidebarVisible}
                            onClick={toggleSidebar}
                        >
                            <i className={isMobile ? "ri-menu-line" : "ri-layout-left-line"} aria-hidden="true" />
                        </button>
                        <div className="top-bar-content">
                            <Link to="/" className="header-title">
                                <span className="txt">{t("app.title")}</span>
                            </Link>
                            <div className="flex-fill" />

                            {!isMobile && (
                                <nav className="project-menu" aria-label={t("nav.sections")}>
                                    {sections.map(tab)}
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
                </div>

                <div className={`page app-page ${sidebarVisible ? "sidebar-open" : "sidebar-closed"}`}>
                    {isMobile && drawerOpen && (
                        <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
                    )}
                    <aside
                        id={sidebarId}
                        className={`page-sidebar app-sidebar ${isMobile ? "drawer" : ""}`.trim()}
                        aria-label={section ? t(section.tabKey) : t("nav.menu")}
                        inert={!sidebarVisible || undefined}
                        onClick={onSidebarClick}
                    >
                        {isMobile && (
                            <div className="drawer-head">
                                <span className="txt">{section ? t(section.tabKey) : t("app.title")}</span>
                                <button
                                    type="button"
                                    className="btn sm circle transparent secondary"
                                    aria-label={t("nav.close")}
                                    onClick={() => setDrawerOpen(false)}
                                >
                                    <i className="ri-close-line" aria-hidden="true" />
                                </button>
                            </div>
                        )}
                        {section && <SectionNav section={section} path={path} />}
                        <div className="sidebar-slot" ref={slotRef} />
                    </aside>
                    <main className="page-content app-main">
                        <SidebarSlotContext.Provider value={slot}>
                            <Outlet />
                        </SidebarSlotContext.Provider>
                    </main>
                </div>
            </div>

            <AppFooter />

            {isMobile && (
                <nav className="bottom-tabs" aria-label={t("nav.sections")}>
                    {/* no "Start" tab: the header title links home, which
                        keeps six tabs for the Beirat from getting cramped */}
                    {sections.filter((s) => s.id !== "home").map((s) => {
                        const active = s.id === section?.id;
                        return (
                            <Link
                                key={s.id}
                                to={s.to}
                                className={`bottom-tab ${active ? "active" : ""}`}
                                aria-current={active ? "page" : undefined}
                            >
                                <i className={s.icon} aria-hidden="true" />
                                <span className="txt">{t(s.tabKey)}</span>
                            </Link>
                        );
                    })}
                </nav>
            )}
        </div>
    );
}

// The active section's sub-navigation, drawn like BugStage's repository
// tree: the section as the parent entry, its pages nested below.
function SectionNav({ section, path }: { section: NavSection; path: string }) {
    const { t } = useTranslation();
    return (
        <nav className="sidebar-menu section-nav" aria-label={t(section.tabKey)}>
            <div className="menu-content">
                <Link to={section.to} className="menu-item section-root">
                    <i className={section.icon} aria-hidden="true" />
                    <span className="txt">{t(section.tabKey)}</span>
                </Link>
                {section.items.length > 1 && (
                    <div className="sidebar-menu">
                        <div className="menu-content">
                            {section.items.map((leaf) => {
                                const active = isLeafActive(leaf, path);
                                return (
                                    <Link
                                        key={leaf.to}
                                        to={leaf.to}
                                        className={`menu-item ${active ? "active" : ""}`}
                                        aria-current={active ? "page" : undefined}
                                    >
                                        <span className="txt">{t(leaf.labelKey)}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </nav>
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
                {portalVersion() && (
                    <span className="list-item txt-hint" title={t("footer.version")}>
                        {portalVersion()}
                    </span>
                )}
            </nav>
        </footer>
    );
}
