import { useEffect } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

import LangSwitch from "./LangSwitch";
import { canShow, logout, useAuth } from "../lib/auth";

export default function Layout() {
    const { t } = useTranslation();
    const auth = useAuth();

    // keep the document title in sync with the active language
    useEffect(() => {
        document.title = t("app.title");
    }, [t]);

    return (
        <div className="app">
            <header className="app-header">
                <div className="app-header-inner">
                    <Link className="app-title" to="/">
                        {t("app.title")}
                    </Link>
                    <LangSwitch />
                </div>
                <nav className="app-nav">
                    <NavLink to="/">{t("nav.calendar")}</NavLink>
                    <NavLink to="/issues">{t("nav.board")}</NavLink>
                    <NavLink to="/suggestions/new">{t("nav.newSuggestion")}</NavLink>
                    <NavLink to="/issues/new">{t("nav.newIssue")}</NavLink>
                    {canShow(auth.role) && (
                        <>
                            <NavLink to="/moderation">
                                {t("nav.moderation")}
                            </NavLink>
                            <NavLink to="/users">{t("nav.users")}</NavLink>
                            <NavLink to="/notes">{t("nav.notes")}</NavLink>
                        </>
                    )}
                    <span className="app-nav-spacer" />
                    {auth.isAuthenticated ? (
                        <>
                            <NavLink to="/profile">{t("nav.profile")}</NavLink>
                            <button
                                type="button"
                                className="app-nav-logout"
                                onClick={logout}
                            >
                                {t("nav.logout")}
                            </button>
                        </>
                    ) : (
                        <>
                            <NavLink to="/login">{t("nav.login")}</NavLink>
                            <NavLink to="/signup">{t("nav.signup")}</NavLink>
                        </>
                    )}
                </nav>
            </header>
            <main className="app-main">
                <Outlet />
            </main>
            <footer className="app-footer">
                <NavLink to="/impressum">{t("legal.footer.impressum")}</NavLink>
                <NavLink to="/datenschutz">{t("legal.footer.datenschutz")}</NavLink>
            </footer>
        </div>
    );
}
