// @ts-nocheck
"use client";

// Coretex Relay — settings content area. Navigation lives in the main app
// sidebar (settings mode); this view only renders the active page full-bleed.

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Settings01 } from "@untitledui/icons";
import type { CoretexConfig } from "@repo/coretex/types";
import type { CoretexActions, CoretexState } from "../use-coretex";
import type { NavTarget } from "../nav";
import { AccountPage } from "./pages/account-page";
import { StartupPage } from "./pages/startup-page";
import { InteractionPage } from "./pages/interaction-page";
import { AppearancePage } from "./pages/appearance-page";
import { ColorSchemesPage } from "./pages/color-schemes-page";
import { RenderingPage } from "./pages/rendering-page";
import { KeybindsPage } from "./pages/keybinds-page";
import { ProfilesPage } from "./pages/profiles-page";
import { AiProvidersPage } from "./pages/ai-providers-page";
import { AgentsSettingsPage } from "./pages/agents-settings-page";
import { TerminalBuddyPage } from "./pages/terminal-buddy-page";
import { AutocompletePage } from "./pages/autocomplete-page";
import { SpeechPage } from "./pages/speech-page";
import { MemoryPage } from "./pages/memory-page";
import { NotificationsPage } from "./pages/notifications-page";
import { McpServersPage } from "./pages/mcp-servers-page";
import { EmailSettingsPage } from "./pages/email-settings-page";
import { FilesPage } from "./pages/files-page";
import { DatabasePage } from "./pages/database-page";
import { DockerPage } from "./pages/docker-page";
import { RemotePage } from "./pages/remote-page";
import { SecurityPage } from "./pages/security-page";
import { AboutPage } from "./pages/about-page";
import { ModelPricingView } from "../views/model-pricing-view";
import {
    SETTINGS_ICONS,
    isSettingsPageId,
    settingsPageLabel,
    type SettingsPageId,
} from "./settings-nav";

export interface SettingsPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (t: NavTarget) => void;
}

export const SettingsWindow = ({
    state,
    actions,
    page: pageProp,
    onNavigate,
}: {
    state: CoretexState;
    actions: CoretexActions;
    /** Active settings page — owned by app nav / sidebar. */
    page?: string;
    onNavigate?: (t: NavTarget) => void;
}) => {
    const settings = state.settings;
    const reduceMotion = useReducedMotion();
    const page: SettingsPageId = isSettingsPageId(pageProp) ? pageProp : "account";

    useEffect(() => {
        actions.getSettings();
    }, [actions]);

    if (!settings) {
        return <div className="flex h-full items-center justify-center text-sm text-tertiary">Loading settings…</div>;
    }

    const props: SettingsPageProps = { settings, state, actions, onNavigate };
    const ActiveIcon = SETTINGS_ICONS[page];
    const pageLabel = settingsPageLabel(page);

    return (
        <div className="@container/settings-page relative h-full min-w-0 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-6 px-4 py-6 @lg/settings-page:px-6 @lg/settings-page:py-8 @5xl/settings-page:px-12">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-tertiary">
                        <Settings01 className="size-3.5" />
                        <span>Settings</span>
                        <span className="text-quaternary">/</span>
                        <ActiveIcon className="size-3.5" />
                        <span className="break-words text-secondary [overflow-wrap:anywhere]">{pageLabel}</span>
                    </div>

                    <AnimatePresence mode="popLayout" initial={false}>
                        <motion.div
                            key={page}
                            initial={reduceMotion ? false : { opacity: 0.72, y: 6 }}
                            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                            exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                            className="flex min-w-0 flex-col gap-6"
                        >
                            {page === "account" && <AccountPage {...props} />}
                            {page === "startup" && <StartupPage {...props} />}
                            {page === "interaction" && <InteractionPage {...props} />}
                            {page === "appearance" && <AppearancePage {...props} />}
                            {page === "color-schemes" && <ColorSchemesPage {...props} />}
                            {page === "rendering" && <RenderingPage {...props} />}
                            {page === "keybinds" && <KeybindsPage {...props} />}
                            {page === "profiles" && <ProfilesPage {...props} />}
                            {page === "ai-providers" && <AiProvidersPage {...props} />}
                            {page === "agents" && <AgentsSettingsPage {...props} />}
                            {page === "terminal-buddy" && <TerminalBuddyPage {...props} />}
                            {page === "autocomplete" && <AutocompletePage {...props} />}
                            {page === "speech" && <SpeechPage {...props} />}
                            {page === "memory" && <MemoryPage {...props} />}
                            {page === "mcp-servers" && <McpServersPage {...props} />}
                            {page === "model-pricing" && <ModelPricingView state={state} actions={actions} />}
                            {page === "notifications" && <NotificationsPage {...props} />}
                            {page === "files" && <FilesPage {...props} />}
                            {page === "email" && <EmailSettingsPage {...props} />}
                            {page === "database" && <DatabasePage {...props} />}
                            {page === "docker" && <DockerPage {...props} />}
                            {page === "remote" && <RemotePage {...props} />}
                            {page === "security" && <SecurityPage {...props} />}
                            {page === "about" && <AboutPage {...props} />}
                        </motion.div>
                    </AnimatePresence>
            </div>
        </div>
    );
};
