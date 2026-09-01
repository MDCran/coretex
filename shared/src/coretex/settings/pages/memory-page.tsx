// @ts-nocheck
"use client";

// Coretex Relay — Memory manager (§4). A local, user-owned memory store the
// assistant uses for personalization. Add/search/edit/delete/toggle memories,
// generate them from chat history, and master-toggle the whole system. Items
// persist on the Brain (~/.coretex/memory.json) and feed the assistant context.
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { CoretexConfig, MemoryItem } from "@repo/coretex/types";
import { Edit01, Folder, Globe01, Lightbulb01, Plus, RefreshCcw05, SearchLg, Stars01, Trash01, Users01, X } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import type { RichSelectOption } from "@/components/base/select/select-native";
import { Toggle } from "@/components/base/toggle/toggle";
import { HelpTooltip } from "../../ui/help-tooltip";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingToggle, SettingsSection } from "../controls";
import { MEMORY_CATEGORY_OPTIONS } from "../rich-select-options";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

const CATEGORIES: {
    value: MemoryItem["category"];
    label: string;
    color: "blue" | "success" | "indigo" | "pink" | "warning" | "gray";
}[] = [
    { value: "fact", label: "Fact", color: "blue" },
    { value: "preference", label: "Preference", color: "success" },
    { value: "project", label: "Project", color: "indigo" },
    { value: "person", label: "Person", color: "pink" },
    { value: "instruction", label: "Instruction", color: "warning" },
    { value: "other", label: "Other", color: "gray" },
];

const catMeta = (c: string) => CATEGORIES.find((x) => x.value === c) ?? CATEGORIES[5];

export const MemoryPage = ({ settings, state, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const enabled = settings.memory.enabled;
    const items = state.memory ?? [];

    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState("");
    const [draftCat, setDraftCat] = useState<MemoryItem["category"]>("fact");
    const [draftScope, setDraftScope] = useState("global");
    const [filterScope, setFilterScope] = useState<string>("all");
    const [generating, setGenerating] = useState(false);
    const [genNote, setGenNote] = useState("");
    const memoryDeletion = useConfirm();

    // Inline edit of an existing memory (reuses the add-form pattern below).
    const [editing, setEditing] = useState<MemoryItem | null>(null);
    const [editText, setEditText] = useState("");
    const [editCat, setEditCat] = useState<MemoryItem["category"]>("fact");
    const [editScope, setEditScope] = useState("global");

    const scopeOptions = useMemo<RichSelectOption[]>(
        () => [
            {
                value: "global",
                label: "Everyone",
                supportingText: "AI Chat and every agent",
                icon: <Globe01 data-icon className="size-5 text-quaternary" />,
            },
            ...state.agents.map((agent) => ({
                value: `agent:${agent.id}`,
                label: agent.config.name,
                supportingText: "This agent only — injected into its runs",
                icon: <Users01 data-icon className="size-5 text-quaternary" />,
            })),
            ...state.projects.map((project) => ({
                value: `project:${project.id}`,
                label: project.name,
                supportingText: "This project only",
                icon: <Folder data-icon className="size-5 text-quaternary" />,
            })),
        ],
        [state.agents, state.projects],
    );

    const filterOptions = useMemo<RichSelectOption[]>(
        () => [
            {
                value: "all",
                label: "All scopes",
                supportingText: `${items.length} total`,
            },
            ...scopeOptions.map((o) => ({
                ...o,
                supportingText: `${items.filter((m) => m.scope === o.value || (o.value.startsWith("project:") && m.scope === o.value.slice(8))).length} saved`,
            })),
        ],
        [scopeOptions, items],
    );

    const scopeLabel = (scope: string): string => {
        if (scope === "global") return "Everyone";
        const option = scopeOptions.find((item) => item.value === scope);
        if (option) return String(option.label);
        const legacyProject = state.projects.find((project) => project.id === scope);
        return legacyProject?.name ?? "Scoped";
    };

    const startEdit = (m: MemoryItem) => {
        setEditing(m);
        setEditText(m.text);
        setEditCat(m.category);
        setEditScope(m.scope || "global");
    };

    const cancelEdit = () => setEditing(null);

    const saveEdit = () => {
        if (!editing) return;
        const text = editText.trim();
        if (!text) return;
        actions.memoryUpsert({
            ...editing,
            text,
            category: editCat,
            scope: editScope,
        });
        setEditing(null);
    };

    useEffect(() => {
        actions.memoryList();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const filtered = useMemo(() => {
        let list = items;
        if (filterScope !== "all") {
            list = list.filter((m) => m.scope === filterScope || (filterScope.startsWith("project:") && m.scope === filterScope.slice(8)));
        }
        const q = query.trim().toLowerCase();
        if (!q) return list;
        return list.filter((m) => m.text.toLowerCase().includes(q) || m.category.includes(q) || scopeLabel(m.scope).toLowerCase().includes(q));
    }, [items, query, filterScope, scopeOptions]);

    const enabledCount = items.filter((m) => m.enabled).length;
    const agentScopedCount = items.filter((m) => m.scope.startsWith("agent:")).length;

    const addMemory = () => {
        const text = draft.trim();
        if (!text) return;
        const item: MemoryItem = {
            id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            text,
            category: draftCat,
            source: "manual",
            scope: draftScope,
            createdAt: Date.now(),
            enabled: true,
        };
        actions.memoryUpsert(item);
        setDraft("");
        // Keep the list filtered on the scope you just wrote to.
        if (filterScope !== "all" && filterScope !== draftScope) setFilterScope(draftScope);
    };

    const generate = () => {
        setGenerating(true);
        setGenNote("");
        const before = items.length;
        actions.memoryGenerate();
        // Poll once after the Brain finishes (generate is async and rebroadcasts memory:items).
        window.setTimeout(() => {
            setGenerating(false);
            actions.memoryList();
            setGenNote("Generation finished — new items appear below if any durable facts were found.");
            void before;
        }, 5000);
    };

    return (
        <div className="flex flex-col gap-6">
            {memoryDeletion.dialog}
            <SettingsPageHeader
                icon={Lightbulb01}
                title="Memory"
                subtitle="Facts, preferences, and instructions for AI Chat and agents. Scope a memory to Everyone, one agent, or one project."
                badges={
                    !enabled ? (
                        <SettingsStatusBadge label="Disabled" color="gray" />
                    ) : items.length > 0 ? (
                        <SettingsStatusBadge label={`${enabledCount} active · ${items.length} total`} color="success" />
                    ) : (
                        <SettingsStatusBadge label="Empty" color="gray" />
                    )
                }
                actions={<Toggle aria-label="Enable memory" isSelected={enabled} onChange={(v) => actions.setSetting("memory.enabled", v)} />}
            />

            <SettingsTwoColumn
                left={
                    <SettingsSection title="Controls" description="Choose how Coretex recalls and creates durable context.">
                        <SettingToggle
                            settings={settings}
                            actions={actions}
                            path="memory.referencePastChats"
                            label="Reference past chats"
                            description="Include earlier turns from the current AI Chat when answering. Saved memories remain available independently."
                        />
                        <div className="flex flex-col items-start justify-between gap-3 py-3.5 sm:flex-row sm:items-center sm:gap-6">
                            <div className="min-w-0">
                                <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                                    Generate from chat history
                                    <HelpTooltip text="Summarizes your recent conversations into memories you can review, edit, or remove." />
                                </p>
                                <p className="mt-0.5 text-xs text-tertiary">Extract durable memories from your conversations.</p>
                            </div>
                            <Button
                                className="shrink-0"
                                size="sm"
                                color="secondary"
                                iconLeading={generating ? RefreshCcw05 : Stars01}
                                onClick={generate}
                                isDisabled={generating || !enabled}
                            >
                                {generating ? "Generating…" : "Generate now"}
                            </Button>
                        </div>
                        {genNote && <p className="pt-3 text-xs text-tertiary">{genNote}</p>}
                        {agentScopedCount > 0 && (
                            <p className="pt-3 text-xs text-tertiary">
                                {agentScopedCount} memor{agentScopedCount === 1 ? "y" : "ies"} scoped to a specific agent.
                            </p>
                        )}
                    </SettingsSection>
                }
                right={
                    <SettingsSection title="Add a memory" description="Save context manually and decide where it is available.">
                        <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2">
                            <div className="sm:col-span-2">
                                <FieldLabel>Memory</FieldLabel>
                                <Input aria-label="Memory" value={draft} placeholder="e.g. Prefers TypeScript and Untitled UI; works in Pacific time" onChange={setDraft} />
                            </div>
                            <div>
                                <FieldLabel>Type</FieldLabel>
                                <RichSelect
                                    aria-label="Memory type"
                                    options={MEMORY_CATEGORY_OPTIONS}
                                    value={draftCat}
                                    onChange={(e) => setDraftCat(e.target.value as MemoryItem["category"])}
                                    placeholder="Type"
                                />
                            </div>
                            <div>
                                <FieldLabel>Available to</FieldLabel>
                                <RichSelect
                                    aria-label="Memory scope"
                                    options={scopeOptions}
                                    value={draftScope}
                                    onChange={(e) => setDraftScope(e.target.value)}
                                    placeholder="Scope"
                                />
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
                                <p className="min-w-0 flex-1 text-xs text-tertiary">
                                    {draftScope.startsWith("agent:")
                                        ? "This memory is private to that agent and is injected only into its runs."
                                        : "You can edit its text, type, and scope at any time."}
                                </p>
                                <Button size="md" color="primary" iconLeading={Plus} onClick={addMemory} isDisabled={!draft.trim() || !enabled}>
                                    Add memory
                                </Button>
                            </div>
                        </div>
                    </SettingsSection>
                }
            />

            {/* Search + list */}
            <SettingsSection title="Saved memories" description="Search, filter, edit, pause, or remove the context Coretex can recall.">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <div className="w-full sm:w-48">
                        <RichSelect aria-label="Filter by scope" options={filterOptions} value={filterScope} onChange={(e) => setFilterScope(e.target.value)} />
                    </div>
                    <div className="w-full sm:w-56">
                        <Input aria-label="Search memories" value={query} onChange={setQuery} placeholder="Search memories" icon={SearchLg} size="sm" />
                    </div>
                </div>

                {filtered.length === 0 ? (
                    <p className="py-6 text-center text-sm text-tertiary">
                        {items.length === 0 ? "No memories yet — add one or generate from chats." : "No memories match your search."}
                    </p>
                ) : (
                    <ul className="flex flex-col divide-y divide-[var(--c-border)]">
                        {filtered.map((m) => {
                            const cm = catMeta(m.category);
                            if (editing?.id === m.id) {
                                return (
                                    <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                                        <div className="flex-1">
                                            <Input aria-label="Memory text" value={editText} placeholder="Memory text" onChange={setEditText} size="sm" />
                                        </div>
                                        <div className="w-full shrink-0 sm:w-36">
                                            <RichSelect
                                                aria-label="Memory type"
                                                options={MEMORY_CATEGORY_OPTIONS}
                                                value={editCat}
                                                onChange={(e) => setEditCat(e.target.value as MemoryItem["category"])}
                                            />
                                        </div>
                                        <div className="w-full shrink-0 sm:w-52">
                                            <RichSelect
                                                aria-label="Memory scope"
                                                options={scopeOptions}
                                                value={editScope}
                                                onChange={(e) => setEditScope(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                                            <Button size="sm" color="primary" onClick={saveEdit} isDisabled={!editText.trim()}>
                                                Save
                                            </Button>
                                            <Button size="sm" color="tertiary" iconLeading={X} onClick={cancelEdit}>
                                                Cancel
                                            </Button>
                                        </div>
                                    </li>
                                );
                            }
                            return (
                                <li key={m.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start">
                                    <div className="min-w-0 flex-1">
                                        <p className={`text-sm ${m.enabled ? "text-primary" : "text-quaternary line-through"}`}>{m.text}</p>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            <Badge size="sm" color={cm.color}>
                                                {cm.label}
                                            </Badge>
                                            <span className="text-xs text-quaternary">{m.source}</span>
                                            <Badge size="sm" color="gray">
                                                {scopeLabel(m.scope)}
                                            </Badge>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-2 self-end sm:self-auto">
                                        <Toggle aria-label={`Enable memory: ${m.text}`} size="sm" isSelected={m.enabled} onChange={(v) => actions.memoryUpsert({ ...m, enabled: v })} />
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => startEdit(m)}>
                                            Edit
                                        </Button>
                                        <Button
                                            size="sm"
                                            color="tertiary-destructive"
                                            iconLeading={Trash01}
                                            onClick={() =>
                                                memoryDeletion.confirm({
                                                    title: "Delete this memory?",
                                                    description: "Coretex will stop using this saved context for AI Chat and agents. This cannot be undone.",
                                                    confirmLabel: "Delete memory",
                                                    onConfirm: () => actions.memoryDelete(m.id),
                                                })
                                            }
                                        >
                                            Delete
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </SettingsSection>
        </div>
    );
};

const FieldLabel = ({ children }: { children: ReactNode }) => <p className="mb-1.5 text-xs font-medium text-tertiary">{children}</p>;
