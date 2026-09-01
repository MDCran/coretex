// @ts-nocheck
"use client";

// Shared settings navigation catalog — drives the main app sidebar when Settings
// is open, and the SettingsWindow content routing. Keeps one source of truth so
// we never end up with a nested settings rail inside the software sidebar.

import {
    Bell01,
    Coins01,
    Colors,
    Command,
    Container,
    Cursor04,
    Database01,
    Folder,
    Lightbulb01,
    Globe01,
    Lightning01,
    LifeBuoy01,
    Lock01,
    Mail01,
    MessageSmileCircle,
    MessageTextSquare02,
    Microphone01,
    Monitor01,
    Palette,
    Server01,
    Stars01,
    Terminal,
    User01,
    Users01,
} from "@untitledui/icons";

type SettingsIcon = typeof User01;

export type SettingsPageId = "account" | "startup" | "interaction" | "appearance" | "color-schemes" | "rendering" | "keybinds" | "notifications" | "profiles" | "ai-providers" | "agents" | "terminal-buddy" | "autocomplete" | "speech" | "memory" | "mcp-servers" | "model-pricing" | "files" | "email" | "database" | "docker" | "remote" | "security" | "about";

export const SETTINGS_ICONS: Record<SettingsPageId, SettingsIcon> = {
    account: User01,
    startup: Lightning01,
    interaction: Cursor04,
    appearance: Palette,
    "color-schemes": Colors,
    rendering: Monitor01,
    keybinds: Command,
    notifications: Bell01,
    profiles: Terminal,
    "ai-providers": Stars01,
    agents: Users01,
    "terminal-buddy": MessageSmileCircle,
    autocomplete: MessageTextSquare02,
    speech: Microphone01,
    memory: Lightbulb01,
    "mcp-servers": Server01,
    "model-pricing": Coins01,
    files: Folder,
    email: Mail01,
    database: Database01,
    docker: Container,
    remote: Globe01,
    security: Lock01,
    about: LifeBuoy01,
};

export const SETTINGS_GROUPS: {
    group: string;
    items: { id: SettingsPageId; label: string }[];
}[] = [
    {
        group: "Account",
        items: [
            { id: "account", label: "Account" },
            { id: "notifications", label: "Notifications" },
        ],
    },
    {
        group: "General",
        items: [
            { id: "startup", label: "Startup" },
            { id: "interaction", label: "Interaction" },
            { id: "speech", label: "Microphone" },
            { id: "keybinds", label: "Actions & keybinds" },
            { id: "profiles", label: "Profiles" },
        ],
    },
    {
        group: "Appearance",
        items: [
            { id: "appearance", label: "Appearance" },
            { id: "color-schemes", label: "Color schemes" },
            { id: "rendering", label: "Rendering & compatibility" },
        ],
    },
    {
        group: "AI",
        items: [
            { id: "ai-providers", label: "AI providers" },
            { id: "agents", label: "Agents & assistants" },
            { id: "terminal-buddy", label: "Terminal Buddy" },
            { id: "autocomplete", label: "Autocomplete" },
            { id: "memory", label: "Memory" },
            { id: "mcp-servers", label: "MCP servers" },
            { id: "model-pricing", label: "Model pricing" },
        ],
    },
    {
        group: "Workspace",
        items: [
            { id: "files", label: "File manager" },
        ],
    },
    {
        group: "Connections",
        items: [
            { id: "email", label: "Email" },
            { id: "database", label: "Database" },
            { id: "docker", label: "Docker" },
            { id: "remote", label: "Remote & connectors" },
        ],
    },
    {
        group: "Advanced",
        items: [
            { id: "security", label: "Security" },
            { id: "about", label: "About & updates" },
        ],
    },
];

export const SETTINGS_PAGE_IDS = new Set<string>(SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id)));

export function isSettingsPageId(id: string | undefined): id is SettingsPageId {
    return typeof id === "string" && SETTINGS_PAGE_IDS.has(id);
}

export function settingsPageLabel(id: SettingsPageId): string | undefined {
    return SETTINGS_GROUPS.flatMap((g) => g.items).find((i) => i.id === id)?.label;
}
