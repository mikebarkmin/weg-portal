import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Wrapper } from "../components/Page";
import Notice from "../components/Notice";

export default function NotFound() {
    const { t } = useTranslation();

    return (
        <Wrapper size="sm">
            <Notice
                icon="ri-compass-3-line"
                title={t("notFound.title")}
                actions={
                    <Link className="btn" to="/">
                        {t("notFound.home")}
                    </Link>
                }
            />
        </Wrapper>
    );
}
