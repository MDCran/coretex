/** Curated product changelog + roadmap. Client-safe (no server-only imports). */

export type ChangeType = "added" | "improved" | "fixed";

export interface Release {
    version: string;
    date: string; // ISO date
    title: string;
    highlights: { type: ChangeType; text: string }[];
}

export const CHANGELOG: Release[] = [
    {
        version: "0.5.0",
        date: "2026-06-16",
        title: "Command palette, theming & a polished shell",
        highlights: [
            { type: "added", text: "Global command palette — press ⌘K (Ctrl+K) to jump anywhere or run quick actions." },
            { type: "added", text: "Theming engine: pick an accent color and interface density in Settings → Appearance." },
            { type: "added", text: "A top navbar with notifications, theme toggle and a full account menu." },
            { type: "added", text: "System status page at /status and a public /api/health probe." },
            { type: "improved", text: "Consistent skeleton loaders and empty/error states across the app." },
            { type: "improved", text: "Lively gradient call-to-action banners on the dashboard and module landings." },
            { type: "fixed", text: "Resolved a calendar freeze and a production build blocker." },
        ],
    },
    {
        version: "0.4.0",
        date: "2026-06-10",
        title: "Music, calendar overlays & financial depth",
        highlights: [
            { type: "added", text: "Spotify widget with device selection, volume, and live Genius lyrics." },
            { type: "added", text: "Unified calendar pulling overlays from every module." },
            { type: "improved", text: "Credit score tracking with a clearer chart and legend." },
        ],
    },
];

export const LATEST_VERSION = CHANGELOG[0].version;

export type RoadmapStatus = "shipped" | "in_progress" | "planned";

export interface RoadmapItem {
    status: RoadmapStatus;
    title: string;
    description: string;
}

export const ROADMAP: RoadmapItem[] = [
    { status: "shipped", title: "Command palette & theming", description: "⌘K navigation, accent colors and density controls." },
    { status: "shipped", title: "Status & health monitoring", description: "Live dependency health and a machine-readable probe." },
    { status: "in_progress", title: "Background jobs", description: "Move reminders, syncing and digests onto a Redis worker." },
    { status: "in_progress", title: "AI cost controls (FinOps)", description: "Per-feature attribution, model routing and budget throttling." },
    { status: "planned", title: "Workspaces & collaboration", description: "Invite a coach or partner with scoped, role-based access." },
    { status: "planned", title: "Apple Health & importers", description: "Optional, per-metric pull from Apple Health plus CSV importers." },
    { status: "planned", title: "Personal AI copilot (RAG)", description: "Answers grounded in your own notes, journal and history." },
];
