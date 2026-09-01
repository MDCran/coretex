// @ts-nocheck
"use client";

// Coretex — project Source Control. GitHub Desktop–inspired Untitled UI surface:
// multi-repo list under the project source path, branch/sync controls, history
// graph, and PRs (via `gh` when available). Local-only repos work without GitHub.

import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectGithubRemote, ProjectRepo } from "@repo/coretex/types";
import {
    Plus,
    RefreshCcw01,
    GitBranch01,
    ArrowUp,
    ArrowDown,
    Edit01,
    Trash01,
    Folder,
    LinkExternal01,
    Check,
    ChevronRight,
    CodeBrowser,
} from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { NativeSelect } from "@/components/base/select/select-native";
import { Toggle } from "@/components/base/toggle/toggle";
import { BrandLogo } from "../ui/brand-logo";
import { HelpTooltip } from "../ui/help-tooltip";
import { FolderPicker } from "../files/folder-picker";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { cx } from "@/utils/cx";

const CARD = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;

/** Resolve a repo path against the project source root (browser-safe). */
export function resolveRepoPath(sourcePath: string | undefined, repoPath: string): string {
    const rel = repoPath.trim();
    if (!rel) return ""; // Linked remote only; no local checkout yet.
    if (rel === ".") return (sourcePath ?? "").trim();
    if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith("/") || rel.startsWith("\\\\")) return rel;
    const base = (sourcePath ?? "").trim();
    if (!base) return rel;
    const sep = base.includes("\\") ? "\\" : "/";
    return `${base.replace(/[\\/]+$/, "")}${sep}${rel.replace(/^[\\/]+/, "")}`;
}

function uniqueId(): string {
    return `repo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

/** Match a dirty relative path to the most recent agent/UI edit log entry. */
function findFileAuthor(
    repoRoot: string,
    relPath: string,
    changes: { path: string; agentName: string; agentId: string; tool: string; ts: number }[],
): { agentName: string; tool: string; ts: number } | null {
    const rel = normPath(relPath);
    const abs = normPath(`${repoRoot.replace(/[\\/]+$/, "")}/${relPath}`);
    const baseName = rel.split("/").pop() ?? rel;
    for (const c of changes) {
        const p = normPath(c.path);
        if (p === abs || p === rel || p.endsWith(`/${rel}`) || p.endsWith(`/${baseName}`)) {
            return { agentName: c.agentName, tool: c.tool, ts: c.ts };
        }
    }
    return null;
}

function LineDelta({ add, del }: { add?: number; del?: number }) {
    const a = add ?? 0;
    const d = del ?? 0;
    if (a === 0 && d === 0) return null;
    return (
        <span className="tabular-nums text-[11px]">
            {a > 0 && <span className="text-success-primary">+{a}</span>}
            {a > 0 && d > 0 && <span className="text-quaternary">{" / "}</span>}
            {d > 0 && <span className="text-error-primary">−{d}</span>}
        </span>
    );
}

function parseGithubInput(raw: string): ProjectGithubRemote | null {
    const s = raw.trim().replace(/\.git$/, "");
    if (!s) return null;
    const ssh = s.match(/^git@github\.com:([^/]+)\/([^/]+)$/i);
    if (ssh) return { owner: ssh[1]!, repo: ssh[2]!, url: `https://github.com/${ssh[1]}/${ssh[2]}` };
    const https = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i);
    if (https) return { owner: https[1]!, repo: https[2]!, url: `https://github.com/${https[1]}/${https[2]}` };
    const short = s.match(/^([^/\s]+)\/([^/\s]+)$/);
    if (short) return { owner: short[1]!, repo: short[2]!, url: `https://github.com/${short[1]}/${short[2]}` };
    return null;
}

type Pane = "changes" | "history" | "branches" | "prs";

export const GitTab = ({
    project,
    state,
    actions,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
}) => {
    const repos = project.repos ?? [];
    const defaultRepo = repos.find((repo) => repo.isPrimary) ?? repos[0];
    const [selectedId, setSelectedId] = useState<string | null>(defaultRepo?.id ?? null);
    const [pane, setPane] = useState<Pane>("changes");
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<ProjectRepo | null>(null);
    const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
    const [commitMsg, setCommitMsg] = useState("");
    const [newBranch, setNewBranch] = useState("");
    const [busy, setBusy] = useState(false);
    const [pendingOpAt, setPendingOpAt] = useState<number | null>(null);

    const selected = repos.find((r) => r.id === selectedId) ?? defaultRepo ?? null;
    const absPath = selected ? resolveRepoPath(project.sourcePath, selected.path) : "";
    const sc = absPath ? state.sourceControl[absPath] : undefined;
    const summary = sc?.summary;
    const branches = sc?.branches ?? [];
    const commits = sc?.commits ?? [];
    const selectedFullName = selected?.github ? `${selected.github.owner}/${selected.github.repo}` : undefined;
    const prs = sc?.prsFullName?.toLowerCase() === selectedFullName?.toLowerCase() ? (sc?.prs ?? []) : [];

    useEffect(() => {
        if (selectedId && repos.some((r) => r.id === selectedId)) return;
        setSelectedId(defaultRepo?.id ?? null);
    }, [repos, selectedId]);

    const refresh = (path: string): void => {
        if (!path) return;
        actions.gitSummary(path);
        actions.gitBranches(path);
        actions.gitLog(path, 50);
        actions.gitPrs(path, selectedFullName);
    };

    useEffect(() => {
        if (!absPath) return;
        refresh(absPath);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [absPath, selected?.github?.owner, selected?.github?.repo]);

    useEffect(() => {
        setBusy(false);
        setPendingOpAt(null);
    }, [absPath]);

    const runOp = (fn: () => boolean): void => {
        setBusy(true);
        const after = sc?.lastOp?.at ?? 0;
        if (!fn()) {
            setBusy(false);
            setPendingOpAt(null);
            return;
        }
        setPendingOpAt(after);
    };

    useEffect(() => {
        const completedAt = sc?.lastOp?.at;
        if (pendingOpAt === null || !completedAt || completedAt <= pendingOpAt) return;
        if (absPath) refresh(absPath);
        setBusy(false);
        setPendingOpAt(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sc?.lastOp?.at, pendingOpAt, absPath]);

    const persistRepos = (next: ProjectRepo[]): void => {
        actions.setProjectRepos(project.id, next);
    };

    const removeRepo = (id: string): void => {
        actions.unlinkProjectRepo(project.id, id);
        if (selectedId === id) setSelectedId(null);
        setUnlinkingId(null);
    };

    const patchRepo = (id: string, patch: Partial<ProjectRepo>): void => {
        persistRepos(repos.map((repo) => repo.id === id ? { ...repo, ...patch } : repo));
    };

    const makePrimary = (id: string): void => {
        persistRepos(repos.map((repo) => ({ ...repo, isPrimary: repo.id === id })));
    };

    const dirtyCount = (summary?.staged ?? 0) + (summary?.unstaged ?? 0) + (summary?.untracked ?? 0);

    const localBranches = useMemo(() => branches.filter((b) => !b.remote), [branches]);

    return (
        <div className="flex w-full min-w-0 flex-col gap-4">
            {!project.sourcePath && (
                <div className="rounded-xl px-4 py-3 text-sm text-secondary" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                    Set a project folder under <span className="font-medium text-primary">Documents</span> first. Repo paths below can be the root (`.`) or nested folders such as <code className="text-xs">apps/web</code>.
                </div>
            )}

            <div className="grid w-full min-w-0 gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
                {/* Repo sidebar — like GitHub Desktop's repository list */}
                <aside className="flex flex-col gap-2 rounded-xl p-3" style={CARD}>
                    <div className="mb-1 flex items-center justify-between gap-2 px-1">
                        <div className="flex items-center gap-1.5">
                            <h2 className="text-sm font-semibold text-primary">Repositories</h2>
                            <HelpTooltip text="Add one or more git repos under this project’s source folder — the monorepo root, or nested package folders with their own remotes." />
                        </div>
                        <Button size="sm" color="secondary" iconLeading={Plus} onClick={() => setAdding(true)}>
                            Add
                        </Button>
                    </div>

                    {repos.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 rounded-lg px-3 py-8 text-center" style={{ border: "1px dashed var(--c-border)" }}>
                            <GitBranch01 className="size-5 text-quaternary" />
                            <p className="text-xs font-medium text-secondary">No repositories yet</p>
                            <p className="text-[11px] text-quaternary">Link a local folder or a GitHub remote to start.</p>
                            <Button size="sm" color="primary" iconLeading={Plus} onClick={() => setAdding(true)}>
                                Add repository
                            </Button>
                        </div>
                    ) : (
                        <ul className="flex flex-col gap-1">
                            {repos.map((r) => {
                                const on = r.id === (selected?.id ?? "");
                                const p = resolveRepoPath(project.sourcePath, r.path);
                                const sum = state.sourceControl[p]?.summary;
                                return (
                                    <li key={r.id}>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedId(r.id)}
                                            className={cx("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition", on ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]")}
                                            style={on ? { boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--c-text-primary) 10%, transparent)" } : undefined}
                                        >
                                            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: "var(--surface)", border: "1px solid var(--c-border)" }}>
                                                {r.github ? <BrandLogo domain="github.com" name="GitHub" size={16} /> : <Folder className="size-3.5 text-tertiary" />}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex min-w-0 items-center gap-1.5">
                                                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-primary">{r.name}</p>
                                                    {r.isPrimary && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-tertiary">Primary</span>}
                                                </div>
                                                <p className="truncate text-[10px] text-quaternary">{r.path || "Remote only · not cloned"}</p>
                                                {sum?.isRepo && (
                                                    <p className="mt-0.5 truncate text-[10px] text-tertiary">
                                                        {sum.branch ?? "detached"}
                                                        {sum.ahead > 0 ? ` ↑${sum.ahead}` : ""}
                                                        {sum.behind > 0 ? ` ↓${sum.behind}` : ""}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </aside>

                {/* Main — current repo */}
                <div className="flex min-w-0 flex-col gap-3">
                    {!selected ? (
                        <div className="flex flex-col items-center justify-center gap-2 rounded-xl px-6 py-16 text-center" style={CARD}>
                            <CodeBrowser className="size-8 text-quaternary" />
                            <p className="text-sm font-semibold text-primary">Select or add a repository</p>
                            <p className="max-w-sm text-xs text-tertiary">Manage branches, commits, pull/push, and history — local or linked to GitHub.</p>
                        </div>
                    ) : (
                        <>
                            {/* Header bar */}
                            <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3" style={CARD}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="truncate text-sm font-semibold text-primary">{selected.name}</h2>
                                        {!absPath ? (
                                            <Badge size="sm" color="brand" type="pill-color">
                                                Remote only
                                            </Badge>
                                        ) : summary?.isRepo ? (
                                            <BadgeWithDot size="sm" color={dirtyCount > 0 ? "warning" : "success"} type="pill-color">
                                                {dirtyCount > 0 ? `${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "Clean"}
                                            </BadgeWithDot>
                                        ) : (
                                            <Badge size="sm" color="gray" type="pill-color">
                                                Not a git repo
                                            </Badge>
                                        )}
                                        {selected.github && (
                                            <a
                                                href={selected.github.url ?? `https://github.com/${selected.github.owner}/${selected.github.repo}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-[11px] text-tertiary hover:text-secondary"
                                            >
                                                <BrandLogo domain="github.com" name="GitHub" size={14} />
                                                {selected.github.owner}/{selected.github.repo}
                                                <LinkExternal01 className="size-3" />
                                            </a>
                                        )}
                                    </div>
                                    <p className="mt-0.5 truncate font-mono text-[11px] text-quaternary" title={absPath || undefined}>
                                        {absPath || "Link is saved to this project; clone it to enable local files and commits."}
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} isDisabled={!absPath || busy} onClick={() => absPath && refresh(absPath)}>
                                        Refresh
                                    </Button>
                                    <Button size="sm" color="secondary" iconLeading={ArrowDown} isDisabled={!absPath || busy} onClick={() => absPath && runOp(() => actions.gitFetch(absPath, selected.github ? `${selected.github.owner}/${selected.github.repo}` : undefined))}>
                                        Fetch
                                    </Button>
                                    <Button size="sm" color="secondary" iconLeading={ArrowDown} isDisabled={!absPath || busy} onClick={() => absPath && runOp(() => actions.gitPull(absPath, selected.github ? `${selected.github.owner}/${selected.github.repo}` : undefined))}>
                                        Pull
                                    </Button>
                                    <Button
                                        size="sm"
                                        color="secondary"
                                        iconLeading={ArrowUp}
                                        isDisabled={!absPath || busy}
                                        onClick={() => absPath && runOp(() => actions.gitPush(absPath, !summary?.upstream, selected.github ? `${selected.github.owner}/${selected.github.repo}` : undefined))}
                                    >
                                        Push
                                    </Button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                <label className="flex items-center gap-2 text-xs text-secondary" title={!absPath ? "Clone this repository before adding it to the project file index." : undefined}>
                                    <Toggle
                                        size="sm"
                                        isSelected={Boolean(absPath) && selected.includeInIndex !== false}
                                        isDisabled={!absPath}
                                        onChange={(value) => patchRepo(selected.id, { includeInIndex: value })}
                                    />
                                    Use files in project search and AI
                                </label>
                                {selected.isPrimary ? (
                                    <Badge size="sm" color="brand" type="pill-color">Primary repository</Badge>
                                ) : (
                                    <Button size="sm" color="link-gray" onClick={() => makePrimary(selected.id)}>Make primary</Button>
                                )}
                                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                    <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => setEditing(selected)}>Edit link</Button>
                                    <Button
                                        size="sm"
                                        color={unlinkingId === selected.id ? "primary-destructive" : "tertiary"}
                                        iconLeading={Trash01}
                                        onClick={() => unlinkingId === selected.id ? removeRepo(selected.id) : setUnlinkingId(selected.id)}
                                    >
                                        {unlinkingId === selected.id ? "Confirm unlink" : "Unlink"}
                                    </Button>
                                </div>
                                {unlinkingId === selected.id && (
                                    <p className="w-full text-[11px] text-tertiary">This removes the project association only. Local files and the GitHub repository are never deleted.</p>
                                )}
                            </div>

                            {summary?.error && !summary.isRepo && (
                                <p className="text-xs text-error-primary">{summary.error}. Check the path is a git worktree under the project folder.</p>
                            )}

                            {!absPath && selected.github && (
                                <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3" style={CARD}>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs font-semibold text-primary">Clone to work with files locally</p>
                                        <p className="mt-0.5 text-[11px] text-tertiary">Choose Clone from the GitHub page, then link the checkout path back to this project. The remote association is already saved.</p>
                                    </div>
                                    <a href={selected.github.url ?? `https://github.com/${selected.github.owner}/${selected.github.repo}`} target="_blank" rel="noreferrer">
                                        <Button size="sm" color="secondary" iconLeading={LinkExternal01}>Open on GitHub</Button>
                                    </a>
                                </div>
                            )}

                            {sc?.lastOp && (
                                <p className={cx("text-xs", sc.lastOp.ok ? "text-success-primary" : "text-error-primary")}>
                                    {sc.lastOp.ok ? sc.lastOp.message || "Done" : sc.lastOp.error || "Operation failed"}
                                </p>
                            )}

                            {/* Branch + ahead/behind — Desktop chrome */}
                            {summary?.isRepo && (
                                <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-2.5" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                                    <GitBranch01 className="size-4 text-secondary" />
                                    <NativeSelect
                                        aria-label="Current branch"
                                        value={summary.branch ?? ""}
                                        onChange={(e) => {
                                            const b = e.target.value;
                                            if (!b || !absPath || b === summary.branch) return;
                                            runOp(() => actions.gitCheckout(absPath, b));
                                        }}
                                        options={[
                                            ...(summary.branch ? [{ label: summary.branch, value: summary.branch }] : []),
                                            ...localBranches.filter((b) => b.name !== summary.branch).map((b) => ({ label: b.name, value: b.name })),
                                        ]}
                                    />
                                    <span className="text-xs tabular-nums text-tertiary">
                                        {summary.ahead > 0 && <span className="mr-2 text-secondary">↑ {summary.ahead} ahead</span>}
                                        {summary.behind > 0 && <span className="mr-2 text-secondary">↓ {summary.behind} behind</span>}
                                        {summary.ahead === 0 && summary.behind === 0 && summary.upstream && <span>In sync with {summary.upstream}</span>}
                                        {!summary.upstream && <span>No upstream</span>}
                                    </span>
                                    {summary.headSha && (
                                        <span className="ml-auto font-mono text-[11px] text-quaternary" title={summary.headSubject ?? ""}>
                                            {summary.headSha}
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Pane tabs */}
                            <div className="flex gap-1 border-b" style={{ borderColor: "var(--c-border)" }}>
                                {(
                                    [
                                        ["changes", "Changes"],
                                        ["history", "History"],
                                        ["branches", "Branches"],
                                        ["prs", "Pull requests"],
                                    ] as const
                                ).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setPane(id)}
                                        className={cx("border-b-2 px-3 py-2 text-xs font-medium transition", pane === id ? "text-primary" : "border-transparent text-tertiary hover:text-secondary")}
                                        style={pane === id ? { borderColor: "var(--brand)" } : undefined}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {pane === "changes" && summary?.isRepo && (
                                <div className="flex flex-col gap-3 rounded-xl p-4" style={CARD}>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                        <Stat label="Staged" value={summary.staged} />
                                        <Stat label="Unstaged" value={summary.unstaged} />
                                        <Stat label="Untracked" value={summary.untracked} />
                                        <Stat label="Conflicts" value={summary.conflicts} warn={summary.conflicts > 0} />
                                        <Stat label="Lines +" value={summary.additions ?? 0} tone="add" />
                                        <Stat label="Lines −" value={summary.deletions ?? 0} tone="del" />
                                    </div>

                                    {(summary.files?.length ?? 0) > 0 ? (
                                        <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                                            <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--c-border)" }}>
                                                <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                                                    Changed files · {summary.files.length}
                                                </span>
                                                <LineDelta add={summary.additions} del={summary.deletions} />
                                            </div>
                                            <ul className="max-h-72 overflow-y-auto">
                                                {summary.files.map((f) => {
                                                    const author = findFileAuthor(summary.cwd, f.path, state.agentFileChanges);
                                                    return (
                                                        <li
                                                            key={f.path}
                                                            className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                                                            style={{ borderTop: "1px solid color-mix(in srgb, var(--c-border) 70%, transparent)" }}
                                                        >
                                                            <Badge size="sm" color={statusColor(f.status)} type="pill-color">
                                                                {f.status}
                                                            </Badge>
                                                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-secondary" title={f.path}>
                                                                {f.path}
                                                            </span>
                                                            <span className="shrink-0 text-[10px] text-quaternary">
                                                                {f.staged && f.unstaged ? "staged+WT" : f.staged ? "staged" : f.unstaged ? "worktree" : ""}
                                                            </span>
                                                            <LineDelta add={f.additions} del={f.deletions} />
                                                            {author ? (
                                                                <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "color-mix(in srgb, var(--brand) 14%, transparent)", color: "var(--brand-secondary)" }} title={`${author.tool} · ${new Date(author.ts).toLocaleString()}`}>
                                                                    {author.agentName}
                                                                </span>
                                                            ) : (
                                                                <span className="shrink-0 text-[10px] text-quaternary">unattributed</span>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-quaternary">Working tree clean — no file changes.</p>
                                    )}

                                    {/* Agent / UI edit log under this repo */}
                                    {(() => {
                                        const root = normPath(summary.cwd);
                                        const list = state.agentFileChanges
                                            .filter((c) => {
                                                if (c.projectId === project.id) return true;
                                                const p = normPath(c.path);
                                                return p === root || p.startsWith(`${root}/`);
                                            })
                                            .slice(0, 12);
                                        if (list.length === 0) return null;
                                        return (
                                            <div className="flex flex-col gap-1.5">
                                                <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">Recent editors</span>
                                                <ul className="flex flex-col gap-1">
                                                    {list.map((c) => (
                                                        <li key={c.id} className="flex flex-wrap items-center gap-2 text-[11px] text-tertiary">
                                                            <span className="font-medium text-secondary">{c.agentName}</span>
                                                            <span className="text-quaternary">{c.tool}</span>
                                                            <span className="min-w-0 flex-1 truncate font-mono text-quaternary">{c.path}</span>
                                                            <span className="tabular-nums text-quaternary">{new Date(c.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        );
                                    })()}

                                    <div className="flex flex-col gap-2">
                                        <span className="text-xs font-medium text-tertiary">Commit message</span>
                                        <TextArea value={commitMsg} onChange={setCommitMsg} rows={3} placeholder="Summary of this change…" />
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                color="primary"
                                                iconLeading={Edit01}
                                                isDisabled={!commitMsg.trim() || !absPath || busy || dirtyCount === 0}
                                                onClick={() => {
                                                    if (!absPath || !commitMsg.trim()) return;
                                                    const msg = commitMsg.trim();
                                                    setCommitMsg("");
                                                    runOp(() => actions.gitCommit(absPath, msg));
                                                }}
                                            >
                                                Commit all changes
                                            </Button>
                                            <p className="self-center text-[11px] text-quaternary">Stages everything (`git add -A`) then commits — same flow as a simple desktop commit.</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {pane === "history" && (
                                <div className="rounded-xl p-2" style={CARD}>
                                    {commits.length === 0 ? (
                                        <p className="px-3 py-8 text-center text-xs text-quaternary">No commits loaded.</p>
                                    ) : (
                                        <ul className="relative flex flex-col">
                                            <span aria-hidden className="absolute top-3 bottom-3 left-[1.15rem] w-px" style={{ background: "var(--c-border)" }} />
                                            {commits.map((c) => (
                                                <li key={c.sha} className="relative flex gap-3 px-2 py-2.5">
                                                    <span className="relative z-[1] mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: "var(--brand)", boxShadow: "0 0 0 3px var(--surface)" }} />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-medium text-primary">{c.subject}</p>
                                                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-quaternary">
                                                            <span className="font-mono text-tertiary">{c.shortSha}</span>
                                                            <span>{c.author}</span>
                                                            <span>{c.date ? new Date(c.date).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                                                            <LineDelta add={c.additions} del={c.deletions} />
                                                            {(c.files?.length ?? 0) > 0 && (
                                                                <span>{c.files!.length} file{c.files!.length === 1 ? "" : "s"}</span>
                                                            )}
                                                        </p>
                                                        {(c.files?.length ?? 0) > 0 && (
                                                            <p className="mt-1 truncate font-mono text-[10px] text-quaternary" title={c.files!.join(", ")}>
                                                                {c.files!.slice(0, 6).join(", ")}
                                                                {(c.files!.length ?? 0) > 6 ? ` +${c.files!.length - 6} more` : ""}
                                                            </p>
                                                        )}
                                                        {c.refs.length > 0 && (
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {c.refs.slice(0, 4).map((ref) => (
                                                                    <Badge key={ref} size="sm" color="gray" type="pill-color">
                                                                        {ref.replace(/^HEAD -> /, "")}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}

                            {pane === "branches" && (
                                <div className="flex flex-col gap-3 rounded-xl p-4" style={CARD}>
                                    <div className="flex flex-wrap items-end gap-2">
                                        <div className="min-w-[12rem] flex-1">
                                            <Input label="New branch" placeholder="feature/…" value={newBranch} onChange={setNewBranch} />
                                        </div>
                                        <Button
                                            size="md"
                                            color="secondary"
                                            iconLeading={Plus}
                                            isDisabled={!newBranch.trim() || !absPath || busy}
                                            onClick={() => {
                                                if (!absPath || !newBranch.trim()) return;
                                                const name = newBranch.trim();
                                                setNewBranch("");
                                                runOp(() => actions.gitCheckout(absPath, name, true));
                                            }}
                                        >
                                            Create &amp; switch
                                        </Button>
                                    </div>
                                    <ul className="flex flex-col gap-1">
                                        {localBranches.map((b) => (
                                            <li key={b.name} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                                                <GitBranch01 className="size-3.5 text-tertiary" />
                                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{b.name}</span>
                                                {b.current && (
                                                    <Badge size="sm" color="success" type="pill-color">
                                                        Current
                                                    </Badge>
                                                )}
                                                {!b.current && (
                                                    <Button size="sm" color="tertiary" iconLeading={ChevronRight} isDisabled={busy} onClick={() => absPath && runOp(() => actions.gitCheckout(absPath, b.name))}>
                                                        Switch
                                                    </Button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {pane === "prs" && (
                                <div className="rounded-xl p-4" style={CARD}>
                                    {prs.length === 0 ? (
                                        <div className="flex flex-col items-center gap-2 py-8 text-center">
                                            <p className="text-xs font-medium text-secondary">No pull requests listed</p>
                                            <p className="max-w-sm text-[11px] text-quaternary">
                                                Install and authenticate the <code className="text-[10px]">gh</code> CLI for PR lists, or open the repo on GitHub.
                                            </p>
                                            {selected.github && (
                                                <a
                                                    href={`${selected.github.url ?? `https://github.com/${selected.github.owner}/${selected.github.repo}`}/pulls`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    <Button size="sm" color="secondary" iconLeading={LinkExternal01}>
                                                        Open PRs on GitHub
                                                    </Button>
                                                </a>
                                            )}
                                        </div>
                                    ) : (
                                        <ul className="flex flex-col gap-2">
                                            {prs.map((pr) => (
                                                <li key={pr.number} className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ background: "var(--surface-2)" }}>
                                                    <Badge size="sm" color={pr.state === "OPEN" ? "success" : "gray"} type="pill-color">
                                                        #{pr.number}
                                                    </Badge>
                                                    <div className="min-w-0 flex-1">
                                                        <a href={pr.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">
                                                            {pr.title}
                                                        </a>
                                                        <p className="mt-0.5 text-[11px] text-quaternary">
                                                            {pr.author} · {pr.branch}
                                                        </p>
                                                    </div>
                                                    <LinkExternal01 className="size-3.5 shrink-0 text-quaternary" />
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {adding && (
                <AddRepoModal
                    project={project}
                    state={state}
                    actions={actions}
                    onClose={() => setAdding(false)}
                    onAdd={(repo) => {
                        const next = [...repos, repo];
                        persistRepos(next);
                        setSelectedId(repo.id);
                        setAdding(false);
                    }}
                />
            )}
            {editing && (
                <AddRepoModal
                    project={project}
                    state={state}
                    actions={actions}
                    initialRepo={editing}
                    onClose={() => setEditing(null)}
                    onAdd={(repo) => {
                        persistRepos(repos.map((current) => current.id === editing.id ? { ...repo, id: editing.id, createdAt: editing.createdAt } : current));
                        setEditing(null);
                    }}
                />
            )}
        </div>
    );
};

function Stat({ label, value, warn, tone }: { label: string; value: number; warn?: boolean; tone?: "add" | "del" }) {
    const color =
        tone === "add" ? "var(--c-success, #22c55e)" : tone === "del" ? "var(--c-error, #ef4444)" : warn && value > 0 ? "var(--c-warning)" : "var(--c-text-primary)";
    return (
        <div className="rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-quaternary">{label}</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums" style={{ color }}>
                {value}
            </p>
        </div>
    );
}

function statusColor(status: string): "gray" | "success" | "warning" | "error" {
    switch (status) {
        case "added":
        case "untracked":
            return "success";
        case "deleted":
        case "conflict":
            return "error";
        case "modified":
        case "renamed":
            return "warning";
        default:
            return "gray";
    }
}

function AddRepoModal({
    project,
    state,
    actions,
    initialRepo,
    onClose,
    onAdd,
}: {
    project: Project;
    state: CoretexState;
    actions: CoretexActions;
    initialRepo?: ProjectRepo;
    onClose: () => void;
    onAdd: (repo: ProjectRepo) => void;
}) {
    const [name, setName] = useState(initialRepo?.name ?? "");
    const [linkMode, setLinkMode] = useState<"local" | "remote">(initialRepo && !initialRepo.path ? "remote" : "local");
    const [relPath, setRelPath] = useState(initialRepo?.path ?? (project.sourcePath ? "." : ""));
    const [githubRaw, setGithubRaw] = useState(initialRepo?.github ? `${initialRepo.github.owner}/${initialRepo.github.repo}` : "");
    const [picking, setPicking] = useState(false);
    const [notes, setNotes] = useState(initialRepo?.notes ?? "");
    const [visibility, setVisibility] = useState<"public" | "private">(initialRepo?.visibility ?? "private");
    const [includeInIndex, setIncludeInIndex] = useState(initialRepo?.includeInIndex !== false);
    const [isPrimary, setIsPrimary] = useState(initialRepo?.isPrimary === true);

    const abs = linkMode === "local" ? resolveRepoPath(project.sourcePath, relPath) : "";
    const gh = parseGithubInput(githubRaw);
    const localPath = relPath.trim();
    const localPathIsAbsolute = /^[a-zA-Z]:[\\/]/.test(localPath) || localPath.startsWith("/") || localPath.startsWith("\\\\");
    const localPathValid = Boolean(localPath) && (Boolean(project.sourcePath) || localPathIsAbsolute);
    const canSubmit = linkMode === "remote" ? Boolean(gh) : localPathValid;

    const submit = (): void => {
        const pathVal = linkMode === "remote" ? "" : relPath.trim();
        const display = name.trim() || (gh ? gh.repo : pathVal === "." ? project.name : pathVal.split(/[\\/]/).filter(Boolean).pop() || "Repository");
        onAdd({
            id: initialRepo?.id ?? uniqueId(),
            name: display,
            path: pathVal,
            github: gh,
            notes: notes.trim() || undefined,
            visibility,
            includeInIndex: Boolean(pathVal) && includeInIndex,
            isPrimary,
            createdAt: initialRepo?.createdAt ?? Date.now(),
        });
    };

    const toRelative = (picked: string): string => {
        const base = (project.sourcePath ?? "").replace(/[\\/]+$/, "");
        if (!base) return picked;
        const norm = (s: string) => s.replace(/\\/g, "/").toLowerCase();
        if (norm(picked) === norm(base)) return ".";
        const prefix = norm(base) + "/";
        if (norm(picked).startsWith(prefix)) {
            return picked.slice(base.length).replace(/^[\\/]+/, "");
        }
        return picked; // outside base — store absolute
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
            <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl p-5 shadow-2xl" style={CARD}>
                <div className="flex items-start justify-between gap-2">
                    <div>
                        <h3 className="text-sm font-semibold text-primary">{initialRepo ? "Edit repository link" : "Add repository"}</h3>
                        <p className="mt-0.5 text-xs text-tertiary">Attach a local checkout, or save a GitHub remote now and clone it later.</p>
                    </div>
                    <button type="button" onClick={onClose} className="text-quaternary hover:text-secondary">
                        ✕
                    </button>
                </div>

                <Input label="Display name" placeholder="Web app" value={name} onChange={setName} />

                <div className="grid grid-cols-2 gap-1 rounded-xl p-1" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                    <button
                        type="button"
                        onClick={() => setLinkMode("local")}
                        className={cx("rounded-lg px-3 py-2 text-xs font-medium transition", linkMode === "local" ? "bg-[var(--surface)] text-primary shadow-sm" : "text-tertiary hover:text-secondary")}
                    >
                        Local checkout
                    </button>
                    <button
                        type="button"
                        onClick={() => setLinkMode("remote")}
                        className={cx("rounded-lg px-3 py-2 text-xs font-medium transition", linkMode === "remote" ? "bg-[var(--surface)] text-primary shadow-sm" : "text-tertiary hover:text-secondary")}
                    >
                        Link remote only
                    </button>
                </div>

                {linkMode === "local" && <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-tertiary">Path relative to project folder</span>
                    <div className="flex gap-2">
                        <Input aria-label="Relative path" placeholder=". or apps/api" value={relPath} onChange={setRelPath} />
                        <Button size="md" color="secondary" iconLeading={Folder} onClick={() => setPicking(true)}>
                            Browse
                        </Button>
                    </div>
                    <p className="font-mono text-[10px] text-quaternary">Resolves to: {abs || "—"}</p>
                    {!project.sourcePath && localPath && !localPathIsAbsolute && (
                        <p className="text-[11px] text-error-primary">Choose an absolute checkout path, or set the project source folder first.</p>
                    )}
                </div>}

                <Input
                    label={linkMode === "remote" ? "GitHub repository" : "GitHub (optional)"}
                    placeholder="owner/repo or https://github.com/…"
                    value={githubRaw}
                    onChange={setGithubRaw}
                    hint={gh ? `Linked: ${gh.owner}/${gh.repo}` : linkMode === "remote" ? "Required for a remote-only link" : "Leave blank for a local-only repository"}
                />

                <label className="flex flex-col gap-1.5 text-xs font-medium text-tertiary">
                    Repository visibility
                    <select value={visibility} onChange={(event) => setVisibility(event.target.value as "public" | "private")} className="rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                        <option value="private">Private</option>
                        <option value="public">Public</option>
                    </select>
                </label>

                <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="Optional…" />

                <div className="grid gap-2 rounded-xl p-3 sm:grid-cols-2" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
                    <label className="flex items-center gap-2 text-xs text-secondary" title={linkMode === "remote" ? "Clone this repository before indexing its files." : undefined}>
                        <Toggle size="sm" isSelected={linkMode === "local" && includeInIndex} isDisabled={linkMode === "remote"} onChange={setIncludeInIndex} />
                        Use files in search and AI
                    </label>
                    <label className="flex items-center gap-2 text-xs text-secondary">
                        <Toggle size="sm" isSelected={isPrimary} onChange={setIsPrimary} />
                        Primary repository
                    </label>
                </div>

                <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: "var(--c-border)" }}>
                    <Button size="md" color="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button size="md" color="primary" iconLeading={Check} isDisabled={!canSubmit} onClick={submit}>
                        {initialRepo ? "Save link" : "Add repository"}
                    </Button>
                </div>

                {picking && (
                    <FolderPicker
                        state={state}
                        actions={actions}
                        title="Choose a git repository folder"
                        initialPath={abs || project.sourcePath || undefined}
                        onPick={(p) => {
                            setRelPath(toRelative(p));
                            setPicking(false);
                        }}
                        onClose={() => setPicking(false)}
                    />
                )}
            </div>
        </div>
    );
}
