import LegalText from "../components/LegalText";

// Public imprint page (M12) - reachable without an account. The text
// is a clearly marked draft from the locale files (de.json); it must
// be reviewed and filled in (TODO(Beirat)) before it becomes final.
export default function Impressum() {
    return <LegalText prefix="legal.impressum" />;
}
