import { useEffect } from "react";
import { Link, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";

import LangSwitch from "./LangSwitch";

export default function Layout() {
    const { t } = useTranslation();

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
            </header>
            <main className="app-main">
                <Outlet />
            </main>
        </div>
    );
}
