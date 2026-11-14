import { useTranslation } from "react-i18next";

import { ISSUE_CATEGORY_KEYS } from "../lib/issues";

// <datalist> with the suggested report categories; connect it with
// <input list={id}>. Typing something else is still allowed.
export default function IssueCategoryList({ id }: { id: string }) {
    const { t } = useTranslation();
    return (
        <datalist id={id}>
            {ISSUE_CATEGORY_KEYS.map((key) => (
                <option key={key} value={t(`issue.categories.${key}`)} />
            ))}
        </datalist>
    );
}
