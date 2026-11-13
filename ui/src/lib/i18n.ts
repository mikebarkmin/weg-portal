import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "../locales/de.json";
import en from "../locales/en.json";

export const defaultLanguage = "de";
export const supportedLanguages = ["de", "en"] as const;
export type Language = (typeof supportedLanguages)[number];

const storageKey = "weg-portal-lang";

function isSupported(value: string | null | undefined): value is Language {
    return !!value && (supportedLanguages as readonly string[]).includes(value);
}

function detectLanguage(): Language {
    try {
        const stored = localStorage.getItem(storageKey);
        if (isSupported(stored)) {
            return stored;
        }
    } catch {
        // localStorage may be unavailable (privacy mode) - fall through.
    }
    const nav = typeof navigator !== "undefined" ? navigator.language : "";
    const navShort = nav.split("-")[0]?.toLowerCase();
    return navShort === "en" ? "en" : defaultLanguage;
}

void i18n.use(initReactI18next).init({
    resources: {
        de: { translation: de },
        en: { translation: en },
    },
    lng: detectLanguage(),
    fallbackLng: defaultLanguage,
    supportedLngs: supportedLanguages,
    interpolation: {
        // react already escapes by default
        escapeValue: false,
    },
    returnEmptyString: false,
});

document.documentElement.lang = i18n.language;

export function changeLanguage(lng: Language): void {
    try {
        localStorage.setItem(storageKey, lng);
    } catch {
        // ignore - preference just won't persist
    }
    void i18n.changeLanguage(lng);
    document.documentElement.lang = lng;
}

export default i18n;
