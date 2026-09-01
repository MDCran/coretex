// @ts-nocheck
"use client";

// Coretex — a reusable folder picker modal that browses the Brain filesystem (drives →
// folders) and returns a chosen directory path. Used wherever a folder is selected: a
// project's source-code location, a document index location, etc. Reuses the existing
// fs:roots + fs:listDir protocol (so it never disturbs the main Files view's cwd).

import { useEffect, useState } from "react";
import { ArrowUp, ChevronRight, Folder, HardDrive, Home01, RefreshCcw01, XClose } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import type { CoretexActions, CoretexState } from "../use-coretex";

export const FolderPicker = ({ state, actions, title = "Choose a folder", initialPath, onPick, onClose }: {
    state: CoretexState;
    actions: CoretexActions;
    title?: string;
    initialPath?: string;
    onPick: (path: string) => void;
    onClose: () => void;
}) => {
    const { fs } = state;
    const [cwd, setCwd] = useState<string>(initialPath || fs.home || "");

    useEffect(() => {
        actions.fsRoots();
        if (!cwd && fs.home) setCwd(fs.home);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!cwd && fs.home) setCwd(fs.home);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fs.home]);
    // Fetch the current directory's listing into the shared dirs cache (independent of the Files cwd).
    useEffect(() => {
        if (cwd && fs.dirs[cwd] === undefined) actions.fsListDir(cwd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cwd, fs.dirs]);

    const listing = cwd ? fs.dirs[cwd] : undefined;
    const folders = (listing?.entries ?? []).filter((e) => e.isDir);
    const parent = listing?.parent ?? null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onMouseDown={onClose}>
            <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }} onMouseDown={(e) => e.stopPropagation()}>
                <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <h2 className="text-sm font-semibold text-primary">{title}</h2>
                    <button type="button" onClick={onClose} className="rounded p-1 text-quaternary hover:text-secondary"><XClose className="size-4" /></button>
                </div>

                {/* Nav row: up + current path */}
                <div className="flex shrink-0 items-center gap-1.5 px-4 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                    <button type="button" onClick={() => parent && setCwd(parent)} disabled={!parent} title="Up" className="flex size-7 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary disabled:opacity-40"><ArrowUp className="size-4" /></button>
                    <button type="button" onClick={() => fs.home && setCwd(fs.home)} title="Home" className="flex size-7 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary"><Home01 className="size-4" /></button>
                    <span className="min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-xs text-secondary" style={{ background: "var(--surface-2)" }} title={cwd}>{cwd || "—"}</span>
                    <button type="button" onClick={() => cwd && actions.fsListDir(cwd)} title="Refresh" className="flex size-7 shrink-0 items-center justify-center rounded-md text-tertiary transition hover:bg-secondary hover:text-primary"><RefreshCcw01 className="size-4" /></button>
                </div>

                {/* Drives row */}
                {fs.roots.length > 0 && (
                    <div className="flex shrink-0 flex-wrap gap-1.5 px-4 py-2" style={{ borderBottom: "1px solid var(--c-border)" }}>
                        {fs.roots.map((r) => (
                            <button key={r} type="button" onClick={() => setCwd(r)} className={cx("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition", cwd === r ? "text-white" : "text-secondary hover:bg-secondary")} style={cwd === r ? { background: "var(--brand)" } : { background: "var(--surface-2)" }}>
                                <HardDrive className="size-3.5" /> {r.replace(/[\\/]+$/, "")}
                            </button>
                        ))}
                    </div>
                )}

                {/* Folder list */}
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                    {listing?.error ? (
                        <p className="px-3 py-3 text-xs text-error-primary">{listing.error}</p>
                    ) : !listing ? (
                        <p className="px-3 py-3 text-xs text-quaternary">Loading…</p>
                    ) : folders.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-quaternary">No subfolders here. You can still select this folder.</p>
                    ) : (
                        folders.map((e) => (
                            <button key={e.path} type="button" onClick={() => setCwd(e.path)} className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-secondary transition hover:bg-secondary">
                                <Folder className="size-4 shrink-0 text-brand-secondary" />
                                <span className="min-w-0 flex-1 truncate text-primary">{e.name}</span>
                                <ChevronRight className="size-3.5 shrink-0 opacity-40" />
                            </button>
                        ))
                    )}
                </div>

                {/* Footer: select this folder */}
                <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3" style={{ borderColor: "var(--c-border)" }}>
                    <span className="min-w-0 flex-1 truncate text-xs text-tertiary">Selecting: <span className="font-mono text-secondary">{cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || cwd : "—"}</span></span>
                    <Button size="sm" color="secondary" onClick={onClose}>Cancel</Button>
                    <Button size="sm" color="primary" isDisabled={!cwd} onClick={() => onPick(cwd)}>Select folder</Button>
                </div>
            </div>
        </div>
    );
};
