// @ts-nocheck
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Route, Routes } from "react-router";
import { HomeScreen } from "@/pages/home-screen";
import { NotFound } from "@/pages/not-found";
import { RouteProvider } from "@/providers/router-provider";
import "@/styles/globals.css";

// NOTE: theming is owned by the inline pre-paint bootstrap in index.html plus the
// Coretex ThemeProvider that CoretexApp mounts (both keyed to 'coretex-theme'). The
// old standalone ThemeProvider here used a different storage key ('ui-theme') and
// would race the bootstrap on mount, causing a one-frame theme flash — so it's gone.
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <HashRouter>
            <RouteProvider>
                <Routes>
                    <Route path="/" element={<HomeScreen />} />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            </RouteProvider>
        </HashRouter>
    </StrictMode>,
);
