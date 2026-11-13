import { useTranslation } from "react-i18next";

import {
    changeLanguage,
    supportedLanguages,
    type Language,
} from "../lib/i18n";

export default function LangSwitch() {
    const { t, i18n } = useTranslation();

    return (
        <div
            className="lang-switch"
            role="group"
            aria-label={t("lang.switch")}
        >
            {supportedLanguages.map((lng: Language) => (
                <button
                    key={lng}
                    type="button"
                    className="btn btn-outline"
                    aria-pressed={i18n.language === lng}
                    onClick={() => changeLanguage(lng)}
                >
                    {t(`lang.${lng}`)}
                </button>
            ))}
        </div>
    );
}
