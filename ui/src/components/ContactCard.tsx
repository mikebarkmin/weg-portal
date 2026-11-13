import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { PortalContact } from "../types";
import VisibilityLabel from "./VisibilityLabel";
import { CONTACT_ICONS } from "../lib/contacts";

// One contact as a bordered card. Phone numbers and addresses are shown
// as text too (tel:/mailto: links may not work everywhere).
export default function ContactCard({
    contact,
    showVisibility = false,
    actions,
}: {
    contact: PortalContact;
    showVisibility?: boolean;
    actions?: ReactNode;
}) {
    const { t } = useTranslation();
    return (
        <article className={`post contact-card contact-${contact.category}`}>
            <header className="contact-card-head">
                <span className="contact-icon" aria-hidden="true">
                    <i className={CONTACT_ICONS[contact.category]} />
                </span>
                <span className="contact-name">
                    <strong>{contact.name}</strong>
                    {contact.function && <span className="txt-hint txt-sm">{contact.function}</span>}
                </span>
                {showVisibility && contact.visibility === "owners" && <VisibilityLabel visibility="owners" />}
            </header>
            <ul className="fact-list">
                {contact.phone && (
                    <li>
                        <i className="ri-phone-line" aria-hidden="true" />
                        <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>{contact.phone}</a>
                    </li>
                )}
                {contact.email && (
                    <li>
                        <i className="ri-mail-line" aria-hidden="true" />
                        <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    </li>
                )}
                {contact.note && (
                    <li>
                        <i className="ri-information-line" aria-hidden="true" />
                        <span className="prewrap">{contact.note}</span>
                    </li>
                )}
                {!contact.phone && !contact.email && !contact.note && (
                    <li className="txt-hint">{t("contacts.noDetails")}</li>
                )}
            </ul>
            {actions && <footer className="post-footer note-actions">{actions}</footer>}
        </article>
    );
}
