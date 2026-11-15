import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClientResponseError } from "pocketbase";

import { pb } from "../lib/pbClient";
import { canShow, useAuth } from "../lib/auth";
import { serverMessage } from "../lib/pbErrors";
import { CONTACT_ICONS } from "../lib/contacts";
import type { ContactCategory, PortalContact, Visibility } from "../types";
import { Page, PageHeading, SidebarMenu } from "../components/Page";
import FormField from "../components/FormField";
import VisibilityLabel from "../components/VisibilityLabel";
import ConfirmDeleteButton from "../components/ConfirmDeleteButton";

const CATEGORIES: ContactCategory[] = ["notdienst", "beirat", "verwaltung", "hausmeister", "sonstiges"];

// Who to call: emergency services first, then Beirat, Verwaltung,
// Hausmeister. Maintained by the Beirat; some entries owners-only.
export default function Contacts() {
    const { t } = useTranslation();
    const auth = useAuth();
    const isBeirat = canShow(auth.role);

    const [items, setItems] = useState<PortalContact[] | null>(null);
    const [error, setError] = useState(false);
    const [editing, setEditing] = useState<string | "new" | null>(null);

    const load = useCallback(() => {
        pb.collection<PortalContact>("contacts")
            .getFullList({ sort: "sort,name" })
            .then((list) => {
                setItems(list);
                setError(false);
            })
            .catch(() => setError(true));
    }, []);

    useEffect(() => {
        load();
    }, [load, auth.isAuthenticated, auth.role]);

    const remove = async (contact: PortalContact) => {
        try {
            await pb.collection("contacts").delete(contact.id);
        } finally {
            load();
        }
    };

    const groups = CATEGORIES.map((category) => ({
        category,
        contacts: (items ?? []).filter((c) => c.category === category),
    })).filter((g) => g.contacts.length > 0);

    return (
        <Page
            sidebar={
                <>
                    <SidebarMenu title={t("contacts.heading")}>
                        {groups.map((g) => (
                            <a key={g.category} className="menu-item" href={`#contacts-${g.category}`}>
                                <i className={CONTACT_ICONS[g.category]} aria-hidden="true" />
                                <span className="txt">{t(`contacts.category.${g.category}`)}</span>
                            </a>
                        ))}
                        {isBeirat && (
                            <button type="button" className="menu-item" onClick={() => setEditing("new")}>
                                <i className="ri-add-line" aria-hidden="true" />
                                <span className="txt">{t("contacts.new")}</span>
                            </button>
                        )}
                    </SidebarMenu>
                    {!auth.isAuthenticated && <p className="txt-hint sidebar-text">{t("contacts.guestHint")}</p>}
                </>
            }
        >
            <PageHeading title={t("contacts.heading")}>
                {isBeirat && editing !== "new" && (
                    <button type="button" className="btn sm" onClick={() => setEditing("new")}>
                        <i className="ri-add-line" aria-hidden="true" />
                        <span className="txt">{t("contacts.new")}</span>
                    </button>
                )}
            </PageHeading>

            <div className="flex-column gap-sm">
                {editing === "new" && (
                    <ContactForm
                        onSaved={() => {
                            setEditing(null);
                            load();
                        }}
                        onCancel={() => setEditing(null)}
                    />
                )}
                {error && <div className="alert danger">{t("contacts.loadError")}</div>}
                {items === null && !error && <p className="txt-hint">{t("calendar.loading")}</p>}
                {items !== null && items.length === 0 && <div className="alert">{t("contacts.empty")}</div>}

                {groups.map((g) => (
                    <section key={g.category} id={`contacts-${g.category}`} className="home-section">
                        <header className="page-heading">
                            <h2 className="title">{t(`contacts.category.${g.category}`)}</h2>
                        </header>
                        <div className="table-wrapper">
                            <table className="contact-table">
                                <thead>
                                    <tr>
                                        <th>{t("contacts.name")}</th>
                                        <th>{t("contacts.phone")}</th>
                                        <th>{t("contacts.email")}</th>
                                        <th>{t("contacts.note")}</th>
                                        {isBeirat && (
                                            <th className="min-width">
                                                <span className="hidden-visually">{t("contacts.actions")}</span>
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {g.contacts.map((c) =>
                                        editing === c.id ? (
                                            <tr key={c.id} className="contact-edit-row">
                                                <td colSpan={isBeirat ? 5 : 4}>
                                                    <ContactForm
                                                        contact={c}
                                                        onSaved={() => {
                                                            setEditing(null);
                                                            load();
                                                        }}
                                                        onCancel={() => setEditing(null)}
                                                    />
                                                </td>
                                            </tr>
                                        ) : (
                                            <ContactRow
                                                key={c.id}
                                                contact={c}
                                                showVisibility={auth.isAuthenticated}
                                                actions={
                                                    isBeirat && (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className="btn sm secondary transparent circle"
                                                                aria-label={t("notes.editAction")}
                                                                title={t("notes.editAction")}
                                                                onClick={() => setEditing(c.id)}
                                                            >
                                                                <i className="ri-edit-line" aria-hidden="true" />
                                                            </button>
                                                            <ConfirmDeleteButton iconOnly onConfirm={() => remove(c)} />
                                                        </>
                                                    )
                                                }
                                            />
                                        ),
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ))}
            </div>
        </Page>
    );
}

// Allow long addresses to wrap after the "@" instead of mid-word.
function breakableEmail(email: string) {
    const at = email.indexOf("@");
    if (at < 0) return email;
    return (
        <>
            {email.slice(0, at + 1)}
            <wbr />
            {email.slice(at + 1)}
        </>
    );
}

function ContactRow({
    contact,
    showVisibility,
    actions,
}: {
    contact: PortalContact;
    showVisibility: boolean;
    actions?: ReactNode;
}) {
    return (
        <tr>
            <td className="contact-name-cell">
                <strong>{contact.name}</strong>
                {contact.function && <span className="txt-hint txt-sm">{contact.function}</span>}
                {showVisibility && contact.visibility === "owners" && <VisibilityLabel visibility="owners" />}
            </td>
            <td className={contact.phone ? "" : "contact-empty"}>
                {contact.phone && (
                    <span className="contact-fact">
                        <i className="ri-phone-line" aria-hidden="true" />
                        <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className="nowrap">
                            {contact.phone}
                        </a>
                    </span>
                )}
            </td>
            <td className={contact.email ? "" : "contact-empty"}>
                {contact.email && (
                    <span className="contact-fact">
                        <i className="ri-mail-line" aria-hidden="true" />
                        <a href={`mailto:${contact.email}`}>{breakableEmail(contact.email)}</a>
                    </span>
                )}
            </td>
            <td className={contact.note ? "contact-note" : "contact-empty"}>
                {contact.note && <span className="prewrap txt-sm">{contact.note}</span>}
            </td>
            {actions && (
                <td className="min-width">
                    <div className="contact-actions">{actions}</div>
                </td>
            )}
        </tr>
    );
}

function ContactForm({
    contact,
    onSaved,
    onCancel,
}: {
    contact?: PortalContact;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [values, setValues] = useState({
        name: contact?.name ?? "",
        function: contact?.function ?? "",
        category: contact?.category ?? ("beirat" as ContactCategory),
        phone: contact?.phone ?? "",
        email: contact?.email ?? "",
        note: contact?.note ?? "",
        sort: contact?.sort ?? 0,
        visibility: contact?.visibility ?? ("public" as Visibility),
    });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const id = (field: string) => `contact-${field}-${contact?.id ?? "new"}`;
    const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
        setValues((prev) => ({ ...prev, [key]: value }));

    const submit = async (e: { preventDefault(): void }) => {
        e.preventDefault();
        if (!values.name.trim()) {
            setError(t("validation.required"));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            if (contact) await pb.collection("contacts").update(contact.id, values);
            else await pb.collection("contacts").create(values);
            onSaved();
        } catch (err) {
            setError(t("contacts.saveError") + (err instanceof ClientResponseError ? ` (${serverMessage(err)})` : ""));
        } finally {
            setBusy(false);
        }
    };

    return (
        <form className="post contact-form" onSubmit={submit} noValidate>
            <div className="grid sm">
                <FormField id={id("name")} className="col-12 col-md-6" label={t("contacts.name")} required>
                    <input id={id("name")} type="text" maxLength={200} value={values.name} onChange={(e) => set("name", e.target.value)} autoFocus />
                </FormField>
                <FormField id={id("function")} className="col-12 col-md-6" label={t("contacts.function")}>
                    <input id={id("function")} type="text" maxLength={200} value={values.function} onChange={(e) => set("function", e.target.value)} />
                </FormField>
                <FormField id={id("category")} className="col-12 col-md-6" label={t("contacts.categoryLabel")}>
                    <select id={id("category")} value={values.category} onChange={(e) => set("category", e.target.value as ContactCategory)}>
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {t(`contacts.category.${c}`)}
                            </option>
                        ))}
                    </select>
                </FormField>
                <FormField id={id("visibility")} className="col-12 col-md-6" label={t("visibility.label")}>
                    <select id={id("visibility")} value={values.visibility} onChange={(e) => set("visibility", e.target.value as Visibility)}>
                        <option value="public">{t("visibility.public")}</option>
                        <option value="owners">{t("visibility.owners")}</option>
                    </select>
                </FormField>
                <FormField id={id("phone")} className="col-12 col-md-6" label={t("contacts.phone")}>
                    <input id={id("phone")} type="tel" maxLength={100} value={values.phone} onChange={(e) => set("phone", e.target.value)} />
                </FormField>
                <FormField id={id("email")} className="col-12 col-md-6" label={t("contacts.email")}>
                    <input id={id("email")} type="email" maxLength={254} value={values.email} onChange={(e) => set("email", e.target.value)} />
                </FormField>
                <FormField id={id("note")} label={t("contacts.note")}>
                    <textarea id={id("note")} rows={2} maxLength={1000} value={values.note} onChange={(e) => set("note", e.target.value)} />
                </FormField>
                <FormField id={id("sort")} className="col-12 col-md-6" label={t("contacts.sort")} hint={t("contacts.sortHint")}>
                    <input id={id("sort")} type="number" value={values.sort} onChange={(e) => set("sort", Number(e.target.value) || 0)} />
                </FormField>
                {error && (
                    <div className="col-12">
                        <div className="alert danger">{error}</div>
                    </div>
                )}
                <div className="col-12">
                    <footer className="form-footer">
                        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
                            {t("eventEditor.cancel")}
                        </button>
                        <button type="submit" className={`btn ${busy ? "loading" : ""}`} disabled={busy}>
                            <span className="txt">{t("eventEditor.save")}</span>
                        </button>
                    </footer>
                </div>
            </div>
        </form>
    );
}
