// @ts-nocheck
// Coretex Relay — internal navigation model. The shared dashboard drives both the
// Next web app and the Vite/react-router desktop app, so navigation is held as
// in-app view state (not URL routes) to keep one codebase identical across hosts.

export type ProjectTab = "overview" | "canvas" | "agents" | "kanban" | "queue" | "documents" | "git" | "secrets" | "chat" | "terminals" | "billing" | "settings";

export const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "canvas", label: "Canvas" },
    { id: "agents", label: "Agents" },
    { id: "kanban", label: "Kanban" },
    { id: "queue", label: "Queue" },
    { id: "documents", label: "Documents" },
    { id: "git", label: "Source Control" },
    { id: "secrets", label: "Secrets" },
    { id: "chat", label: "Chat" },
    { id: "terminals", label: "Terminals" },
    { id: "billing", label: "Usage & Billing" },
    { id: "settings", label: "Settings" },
];

export type NavTarget =
    | { kind: "home" }
    | { kind: "aichat" }
    | { kind: "usage" }
    | { kind: "analytics" }
    | { kind: "council" }
    | { kind: "agents" }
    | { kind: "plan" }
    | { kind: "email" }
    | { kind: "env" }
    | { kind: "keyvault" }
    | { kind: "calendar" }
    | { kind: "projects" }
    | { kind: "github" }
    | { kind: "agent"; id: string }
    | { kind: "files" }
    | { kind: "database" }
    | { kind: "docker" }
    | { kind: "remote" }
    | { kind: "servers" }
    | { kind: "settings"; page?: string }
    | { kind: "project"; id: string; tab: ProjectTab }
    | { kind: "financial" }
    | { kind: "social" }
    | { kind: "workouts" }
    | { kind: "nutrition" }
    | { kind: "health" }
    | { kind: "tasks" };

export type TopLevel = "home" | "aichat" | "usage" | "analytics" | "council" | "agents" | "plan" | "email" | "env" | "keyvault" | "calendar" | "projects" | "github" | "files" | "database" | "docker" | "remote" | "servers" | "settings" | "project" | "financial" | "social" | "workouts" | "nutrition" | "health" | "tasks";
