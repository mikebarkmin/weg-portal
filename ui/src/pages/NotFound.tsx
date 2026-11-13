import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
    const { t } = useTranslation();

    return (
        <div className="card">
            <h1>{t("notFound.title")}</h1>
            <Link className="btn" to="/">
                {t("notFound.home")}
            </Link>
        </div>
    );
}
