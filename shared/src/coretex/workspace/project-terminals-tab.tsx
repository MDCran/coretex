// @ts-nocheck
"use client";

// Coretex Relay — per-project Terminals tab. Lists the terminals tagged with this
// project (project-scoped via TerminalSessionMeta.projectId) and embeds the live
// xterm for the selected one. "New terminal" opens one in the project's source
// folder, tagged with the project so it shows up here.

import { useEffect, useRef, useState } from "react";
import type { Project } from "@repo/coretex/types";
import type { BridgeClient } from "@repo/coretex/client";
import { Download01, Plus, Terminal, Trash01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { useTheme } from "../theme";
import { XtermTerm } from "../terminal/xterm-term";
import { TerminalBuddyBar } from "../terminal/terminal-buddy-bar";
import { resolveBuddyModelClient } from "../terminal/terminal-dock";
import { readTerminalLog, downloadTextFile, terminalLogFilename } from "../terminal/terminal-registry";
import { speechOptsFor } from "../ui/speech-opts";

const SURFACE = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

export const ProjectTerminalsTab = ({ project, state, actions, client }: { project: Project; state: CoretexState; actions: CoretexActions; client?: BridgeClient }) => {
    const theme = useTheme();
    const terms = state.terminals.filter((t) => t.projectId === project.id);
    const [activeId, setActiveId] = useState<string | null>(null);
    const active = terms.find((t) => t.id === activeId) ?? terms[0] ?? null;

    // Focus a newly created terminal (its id only arrives async, after terminal:created),
    // and fall back to the last remaining one when the active terminal is killed. Without
    // this, "New terminal" appears to do nothing — the pane stays on the old session.
    const prevIdsRef = useRef<string[]>([]);
    const termIds = terms.map((t) => t.id).join("|");
    useEffect(() => {
        const ids = terms.map((t) => t.id);
        const added = ids.find((id) => !prevIdsRef.current.includes(id));
        setActiveId((cur) => {
            if (added) return added;
            if (cur && !ids.includes(cur)) return ids[ids.length - 1] ?? null;
            return cur;
        });
        prevIdsRef.current = ids;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [termIds]);

    const exportLog = (id: string, title: string) => {
        downloadTextFile(terminalLogFilename(title), readTerminalLog(id) ?? "");
    };
    const activeScheme = (() => {
        const name = state.settings?.appearance.application.activeColorScheme ?? null;
        return name ? (state.settings?.colorSchemes ?? []).find((s) => s.name === name) ?? null : null;
    })();

    const newTerm = (): void => { actions.terminalCreate({ projectId: project.id, cwd: project.sourcePath }); };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <Terminal className="size-5 text-brand-secondary" />
                <h2 className="text-sm font-semibold text-primary">Terminals</h2>
                <span className="text-xs text-tertiary">{terms.length} open{project.sourcePath ? ` · ${project.sourcePath}` : " · set a source folder in Settings"}</span>
                <Button size="sm" color="primary" iconLeading={Plus} className="ml-auto" onClick={newTerm}>New terminal</Button>
            </div>

            {terms.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl text-center" style={{ border: "1px dashed var(--c-border)" }}>
                    <Terminal className="size-7 text-quaternary" />
                    <p className="text-sm text-tertiary">No terminals for this project yet.</p>
                    <Button size="sm" color="secondary" iconLeading={Plus} onClick={newTerm}>Open one{project.sourcePath ? " in the source folder" : ""}</Button>
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 gap-3">
                    <div className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto rounded-xl p-2" style={SURFACE}>
                        {terms.map((t) => (
                            <div key={t.id} className={cx("group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition", active?.id === t.id ? "" : "hover:bg-secondary")} style={active?.id === t.id ? { background: "var(--sidebar-active-bg)" } : { color: "var(--c-text-secondary)" }}>
                                <button type="button" onClick={() => setActiveId(t.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: t.status === "running" ? "#22c55e" : "var(--c-text-muted)" }} title={t.status} />
                                    <span className="min-w-0 truncate text-primary">{t.title}</span>
                                </button>
                                <button type="button" title="Export log to file" onClick={() => exportLog(t.id, t.title)} className="shrink-0 rounded p-1 opacity-0 transition hover:bg-[var(--surface-2)] group-hover:opacity-100">
                                    <Download01 className="size-3.5 text-tertiary" />
                                </button>
                                <button type="button" title="Kill terminal" onClick={() => actions.terminalKill(t.id)} className="shrink-0 rounded p-1 opacity-0 transition hover:bg-[var(--surface-2)] group-hover:opacity-100">
                                    <Trash01 className="size-3.5 text-error-primary" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl" style={SURFACE}>
                        {active && client ? (
                            <>
                                <div className="min-h-0 flex-1 overflow-hidden">
                                    <XtermTerm key={active.id} sessionId={active.id} client={client} actions={actions} dark={theme.resolved === "dark"} scheme={activeScheme} readOnly={active.readOnly} className="size-full p-1" />
                                </div>
                                {active.kind !== "agent" && !active.readOnly && state.settings?.terminalBuddy?.enabled !== false && (
                                    <TerminalBuddyBar
                                        key={`buddy-${active.id}`}
                                        sessionId={active.id}
                                        buddy={state.buddy[active.id]}
                                        actions={actions}
                                        models={state.models}
                                        model={resolveBuddyModelClient(state.settings, active.id)}
                                        onModelChange={(provider, id) => actions.setSetting(`terminalBuddy.perTerminal.${active.id}`, { provider, model: id })}
                                        defaultMode={state.settings?.terminalBuddy?.defaultMode ?? "suggest"}
                                        autoProbe={state.settings?.terminalBuddy?.probeOnStart !== false}
                                        speech={speechOptsFor(state.settings?.speech, "terminalBuddy")}
                                        injectIntoTerminal={state.settings?.speech?.injectIntoTerminal === true}
                                    />
                                )}
                            </>
                        ) : (
                            <div className="flex h-full items-center justify-center text-sm text-tertiary">Select a terminal to view it.</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
