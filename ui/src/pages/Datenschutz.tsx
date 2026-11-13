import LegalText from "../components/LegalText";

// Public privacy-policy page (M12) - reachable without an account.
// The text is a clearly marked draft from the locale files (de.json);
// the retention periods stated there must always match the
// portal_settings values (the betriebshandbuch reminds superusers).
export default function Datenschutz() {
    return <LegalText prefix="legal.datenschutz" />;
}
