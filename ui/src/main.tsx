import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "./lib/i18n";
import "./css/bugstage/index.css";
import "./css/portal.css";

import App from "./App";
import { loadPortalConfig } from "./lib/portalConfig";
import { applyStoredColorScheme } from "./lib/theme";

applyStoredColorScheme();

// the deployment config (bounding box) must be in place before any map
// or form reads it
void loadPortalConfig().then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.StrictMode>
            <BrowserRouter>
                <App />
            </BrowserRouter>
        </React.StrictMode>,
    );
});
