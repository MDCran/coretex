// @ts-nocheck
"use client";

// Rich select option builders — logos, subtitles, and detail lines for settings dropdowns.

import type { ReactNode } from "react";
import type { ModelInfo, ProviderConfigState, ProviderType, TerminalProfile } from "@repo/coretex/types";
import { Cloud01, Server01, Stars01 } from "@untitledui/icons";
import type { RichSelectOption } from "@/components/base/select/select-native";
import { BrandLogo } from "../ui/brand-logo";
import { modelLabel, providerLabel, roleLabel } from "../labels";
import { LOCAL_PROVIDER_IDS, providerLogoDomain, providerReadyDetail, providerShortBlurb } from "../provider-meta";

export function providerLogoIcon(provider: string, size = 20): ReactNode {
    return <BrandLogo domain={providerLogoDomain(provider)} name={providerLabel(provider)} size={size} chip={false} />;
}

function modelMetaLine(m: ModelInfo): string {
    return [m.paramSize, m.quantization, m.family ? modelLabel(m.family) : null].filter(Boolean).join(" · ");
}

function modelDetailLine(m: ModelInfo): string {
    const parts: string[] = [];
    if (m.contextLength) parts.push(m.contextLength >= 1000 ? `${Math.round(m.contextLength / 1000)}k context` : `${m.contextLength} ctx`);
    if (m.pricing?.inputPer1M != null) parts.push(`$${m.pricing.inputPer1M}/1M in`);
    if (LOCAL_PROVIDER_IDS.has(m.provider)) parts.push("Local");
    else parts.push("Cloud");
    if (m.stale) parts.push("Cached");
    return parts.join(" · ");
}

/** Rich option for a configured AI provider (Ollama, Anthropic, OpenAI, …). */
export function providerRichOption(p: ProviderConfigState): RichSelectOption {
    return {
        value: p.provider,
        label: providerLabel(p.provider),
        supportingText: providerShortBlurb(p.provider),
        detailText: providerReadyDetail(p),
        hint: providerReadyDetail(p),
        icon: providerLogoIcon(p.provider),
        disabled: !p.enabled,
    };
}

/** Inherit / global-default row for provider pickers. */
export function inheritProviderOption(label = "Use global default", subtitle = "Follow your main AI provider"): RichSelectOption {
    return {
        value: "",
        label,
        supportingText: subtitle,
        hint: subtitle,
        icon: <Stars01 data-icon className="size-5 text-brand-secondary" />,
    };
}

export function buildProviderSelectOptions(
    providers: ProviderConfigState[],
    opts?: { includeInherit?: boolean; inheritLabel?: string; inheritSubtitle?: string; readyOnly?: boolean },
): RichSelectOption[] {
    const pool = opts?.readyOnly ? providers.filter((p) => p.enabled) : providers;
    const items = pool.map(providerRichOption);
    if (opts?.includeInherit) items.unshift(inheritProviderOption(opts.inheritLabel, opts.inheritSubtitle));
    return items;
}

/** Email sorter backends — same carriers as AI providers, with logos. */
export function emailBackendOptions(): RichSelectOption[] {
    const backends: ProviderType[] = ["ollama", "lmstudio", "openai", "anthropic", "gemini"];
    return backends.map((id) => ({
        value: id,
        label: providerLabel(id),
        supportingText: providerShortBlurb(id),
        detailText: LOCAL_PROVIDER_IDS.has(id) ? "Runs on your machine" : "Cloud API",
        hint: providerShortBlurb(id),
        icon: providerLogoIcon(id),
    }));
}

/** Rich model row for settings dropdowns (when ModelPicker is too wide). */
export function modelRichOption(m: ModelInfo): RichSelectOption {
    return {
        value: m.id,
        label: m.displayName ?? m.name ?? modelLabel(m.id),
        supportingText: modelMetaLine(m) || providerLabel(m.provider),
        detailText: modelDetailLine(m),
        hint: `${m.id} · ${providerLabel(m.provider)}`,
        icon: providerLogoIcon(m.provider, 18),
    };
}

export function inheritModelOption(label = "Use provider default", subtitle = "Let the provider pick its default model"): RichSelectOption {
    return {
        value: "",
        label,
        supportingText: subtitle,
        hint: subtitle,
        icon: <Stars01 data-icon className="size-5 text-brand-secondary" />,
    };
}

export function buildModelSelectOptions(models: ModelInfo[], opts?: { includeInherit?: boolean; pinnedId?: string }): RichSelectOption[] {
    const seen = new Set<string>();
    const items: RichSelectOption[] = [];
    if (opts?.includeInherit) items.push(inheritModelOption());
    for (const m of models) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        items.push(modelRichOption(m));
    }
    if (opts?.pinnedId && !seen.has(opts.pinnedId)) {
        items.push({
            value: opts.pinnedId,
            label: modelLabel(opts.pinnedId),
            supportingText: "Saved model",
            detailText: "Not in current catalog",
            hint: opts.pinnedId,
            icon: <Cloud01 data-icon className="size-5 text-quaternary" />,
        });
    }
    return items;
}

export function profileRichOption(p: TerminalProfile): RichSelectOption {
    const shell = p.commandLine?.trim() || "Default shell";
    return {
        value: p.id,
        label: p.name,
        supportingText: shell,
        detailText: `${p.appearance.fontFace} ${p.appearance.fontSize}pt`,
        hint: `${p.name} — ${shell}`,
    };
}

/** Memory type choices — labels are what the closed select shows (Fact, Preference, …). */
export const MEMORY_CATEGORY_OPTIONS: RichSelectOption[] = [
    { value: "fact", label: "Fact", supportingText: "Stable truths about you or your work", hint: "Fact" },
    { value: "preference", label: "Preference", supportingText: "Taste, style, and how you like things done", hint: "Preference" },
    { value: "project", label: "Project", supportingText: "Context tied to a specific codebase or effort", hint: "Project" },
    { value: "person", label: "Person", supportingText: "People, roles, and relationships", hint: "Person" },
    { value: "instruction", label: "Instruction", supportingText: "Standing rules the assistant should follow", hint: "Instruction" },
    { value: "other", label: "Other", supportingText: "Anything that doesn't fit the buckets above", hint: "Other" },
];

export const AGENT_ROLE_OPTIONS: RichSelectOption[] = [
    { value: "orchestrator", label: roleLabel("orchestrator"), supportingText: "Coordinates other agents and the queue", hint: "Top-level coordinator" },
    { value: "planner", label: roleLabel("planner"), supportingText: "Breaks goals into steps and milestones", hint: "Planning specialist" },
    { value: "researcher", label: roleLabel("researcher"), supportingText: "Gathers context, docs, and references", hint: "Research specialist" },
    { value: "developer", label: roleLabel("developer"), supportingText: "Writes and edits code in the repo", hint: "Implementation specialist" },
    { value: "reviewer", label: roleLabel("reviewer"), supportingText: "Reviews diffs, quality, and risks", hint: "Code review specialist" },
    { value: "writer", label: roleLabel("writer"), supportingText: "Docs, copy, and long-form prose", hint: "Writing specialist" },
    { value: "analyst", label: roleLabel("analyst"), supportingText: "Data, metrics, and structured reasoning", hint: "Analysis specialist" },
    { value: "devops", label: roleLabel("devops"), supportingText: "Deploy, infra, CI, and operations", hint: "DevOps specialist" },
    { value: "qa", label: roleLabel("qa"), supportingText: "Tests, repro steps, and verification", hint: "QA specialist" },
    { value: "custom", label: roleLabel("custom"), supportingText: "Your own role prompt and behavior", hint: "Fully custom agent role" },
];

/** Generic enum presets for schema-driven SettingSelect rows. */
export function richEnumOptions(path: string): RichSelectOption[] | null {
    const map: Record<string, RichSelectOption[]> = {
        "filesView.defaultView": [
            { value: "columns", label: "Columns", supportingText: "Miller columns — drill folders side by side", hint: "Finder-style column browser" },
            { value: "table", label: "Table", supportingText: "Sortable rows with size, type, and dates", hint: "Spreadsheet-style listing" },
            { value: "grid", label: "Grid", supportingText: "Large thumbnails and tiles", hint: "Icon grid view" },
        ],
        "filesView.density": [
            { value: "comfortable", label: "Comfortable", supportingText: "More vertical breathing room", hint: "Relaxed row spacing" },
            { value: "compact", label: "Compact", supportingText: "Fit more entries on screen", hint: "Dense row spacing" },
        ],
        "filesView.openOn": [
            { value: "single-click", label: "Single click", supportingText: "Open files and folders immediately", hint: "One click to open" },
            { value: "double-click", label: "Double click", supportingText: "Select first, open on second click", hint: "Classic desktop behavior" },
        ],
        "terminalBuddy.defaultMode": [
            { value: "suggest", label: "Suggest", supportingText: "Proposes commands — you approve each run", hint: "Human-in-the-loop suggestions" },
            { value: "auto", label: "Auto", supportingText: "Runs commands within your guardrails", hint: "Autonomous within safety limits" },
        ],
        "terminalBuddy.buddyBarPosition": [
            { value: "bottom", label: "Bottom", supportingText: "Docked under the terminal", hint: "Bottom buddy bar" },
            { value: "side", label: "Side", supportingText: "Vertical strip beside the terminal", hint: "Side buddy bar" },
        ],
        "interaction.clipboard.copyFormats": [
            { value: "plain", label: "Plain text only", supportingText: "Smallest payload, works everywhere", hint: "text/plain only" },
            { value: "plain-html", label: "Plain + HTML", supportingText: "Rich paste into browsers and docs", hint: "text/plain + text/html" },
            { value: "plain-rtf", label: "Plain + RTF", supportingText: "Legacy rich text for Office apps", hint: "text/plain + text/rtf" },
        ],
        "rendering.render.graphicsApi": [
            { value: "auto", label: "Automatic", supportingText: "Pick the best API for this machine", hint: "Auto-detect graphics backend" },
            { value: "d3d11", label: "Direct3D 11", supportingText: "Stable on most Windows GPUs", hint: "D3D11 compositor" },
            { value: "d3d12", label: "Direct3D 12", supportingText: "Newer Windows path when available", hint: "D3D12 compositor" },
            { value: "opengl", label: "OpenGL", supportingText: "Cross-platform GPU backend", hint: "OpenGL compositor" },
            { value: "software", label: "Software", supportingText: "CPU rendering — slow but compatible", hint: "Software rasterizer" },
        ],
        "rendering.render.antialiasing": [
            { value: "grayscale", label: "Grayscale", supportingText: "Smooth edges on any background", hint: "Standard grayscale AA" },
            { value: "subpixel", label: "ClearType / Subpixel", supportingText: "Sharpest on opaque horizontal text", hint: "RGB subpixel AA" },
            { value: "none", label: "None", supportingText: "Crisp pixels, no smoothing", hint: "Disable antialiasing" },
        ],
        "startup.onStart": [
            { value: "new-tab", label: "Open a new tab", supportingText: "Fresh tab on every launch", hint: "Start with a blank tab" },
            { value: "restore", label: "Restore previous session", supportingText: "Reopen tabs and layout from last time", hint: "Session restore on launch" },
        ],
        "startup.newInstance": [
            { value: "window", label: "Open a new window", supportingText: "Separate window per launch", hint: "New top-level window" },
            { value: "tab", label: "Open a new tab", supportingText: "Reuse the existing window", hint: "New tab in current window" },
            { value: "focus", label: "Focus existing", supportingText: "Bring the running instance forward", hint: "Activate existing window" },
        ],
        "filesView.sortBy": [
            { value: "name", label: "Name", supportingText: "Alphabetical order", hint: "Sort by file or folder name" },
            { value: "modified", label: "Date modified", supportingText: "Newest or oldest changes first", hint: "Sort by last modified time" },
            { value: "size", label: "Size", supportingText: "Largest or smallest files first", hint: "Sort by byte size" },
            { value: "type", label: "Type", supportingText: "Group by extension or folder", hint: "Sort by file type" },
        ],
        "filesView.sortDir": [
            { value: "asc", label: "Ascending", supportingText: "A→Z, oldest, smallest", hint: "Ascending order" },
            { value: "desc", label: "Descending", supportingText: "Z→A, newest, largest", hint: "Descending order" },
        ],
        "filesView.defaultSearchScope": [
            { value: "folder", label: "Current folder", supportingText: "Search recursively from here", hint: "Folder-scoped search" },
            { value: "index", label: "All indexed locations", supportingText: "Search everything Coretex indexes", hint: "Global indexed search" },
        ],
        "startup.language": [
            { value: "system", label: "Use system default", supportingText: "Match the OS locale", hint: "System language" },
            { value: "en", label: "English", supportingText: "Force English UI strings", hint: "English" },
        ],
        "startup.imeMode": [
            { value: "alphanumeric", label: "Alphanumeric", supportingText: "Latin input by default", hint: "Alphanumeric IME" },
            { value: "native", label: "Native", supportingText: "Follow the active input method", hint: "Native IME" },
        ],
        "autocomplete.nativeTabFallback": [
            { value: "never", label: "Never (always use autocomplete)", supportingText: "Tab always accepts Coretex suggestions", hint: "Never pass Tab to the shell" },
            { value: "when-no-suggestion", label: "When there's no suggestion", supportingText: "Tab falls through if nothing to accept", hint: "Smart Tab handoff" },
            { value: "always", label: "Always (Tab is the shell's)", supportingText: "Shell completion owns Tab entirely", hint: "Native shell Tab only" },
        ],
    };
    return map[path] ?? null;
}

export function localCloudBadge(local: boolean): ReactNode {
    return local ? <Server01 data-icon className="size-5 text-success-primary" /> : <Cloud01 data-icon className="size-5 text-tertiary" />;
}
