"use client";

// Coretex — global GitHub workspace. This surface deliberately composes the same
// git:* state/actions used by every project's Source Control tab: one repository
// inventory, truthful local/remote status, topology-aware history, README details,
// project linking, and explicit confirmation for remote-changing operations.

import { useEffect, useMemo, useState } from "react";
import type { GitCommitInfo, GitRepoSummary, Project, ProjectRepo } from "@repo/coretex/types";
import {
    ArrowDown,
    ArrowUp,
    BookOpen01,
    Check,
    ChevronRight,
    Code01,
    Download01,
    Edit01,
    FilterLines,
    Folder,
    GitBranch01,
    LinkExternal01,
    Plus,
    RefreshCcw01,
    Rocket01,
    SearchLg,
    XClose,
} from "@untitledui/icons";
import { Badge, BadgeWithDot } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import type { NavTarget } from "../nav";
import { BrandLogo } from "../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../use-coretex";
import { resolveRepoPath } from "../workspace/git-tab";

const CARD = { background: "var(--surface)", border: "1px solid var(--c-border)" } as const;
const SOFT = { background: "var(--surface-2)", border: "1px solid var(--c-border)" } as const;
const GRAPH_COLORS = ["var(--brand)", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];

type RepoFilter = "all" | "local" | "remote" | "attention";
type RepoTab = "overview" | "changes" | "commits" | "branches" | "pulls" | "deployments";

interface GithubRepoRow {
    id: string;
    owner?: string;
    name: string;
    fullName: string;
    description?: string;
    url?: string;
    cloneUrl?: string;
    sshUrl?: string;
    visibility?: "public" | "private" | "internal" | "unknown";
    defaultBranch?: string;
    language?: string;
    stargazers?: number;
    forks?: number;
    openIssues?: number;
    updatedAt?: string;
    pushedAt?: string;
    localPath?: string;
    projectIds: string[];
    readme?: { name?: string; content: string; truncated?: boolean; url?: string };
    summary?: GitRepoSummary;
}

interface ConfirmAction {
    title: string;
    description: string;
    details: { label: string; value: string }[];
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
}

function norm(value: string | undefined): string {
    return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function repoKey(repo: Partial<GithubRepoRow> & { fullName?: string; localPath?: string; name?: string }): string {
    return repo.owner && repo.fullName
        ? `gh:${repo.fullName.toLowerCase()}`
        : `local:${norm(repo.localPath || repo.id || repo.name)}`;
}

function projectRepoPath(project: Project, repo: ProjectRepo): string | undefined {
    if (!repo.path?.trim()) return undefined;
    return resolveRepoPath(project.sourcePath, repo.path);
}

function normalizeReadme(value: unknown): GithubRepoRow["readme"] {
    if (typeof value === "string") return { content: value };
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    if (typeof v.content !== "string") return undefined;
    return {
        name: typeof v.name === "string" ? v.name : undefined,
        content: v.content,
        truncated: v.truncated === true,
        url: typeof v.url === "string" ? v.url : undefined,
    };
}

/** Merge GitHub discovery with the many-to-many repositories already attached to projects. */
function repositoryRows(state: CoretexState): GithubRepoRow[] {
    const rows = new Map<string, GithubRepoRow>();
    const overview = state.github.overview;
    const remoteRepos = overview?.repositories ?? [];

    for (const raw of remoteRepos) {
        const fullName = raw.fullName;
        const owner = raw.owner ?? undefined;
        const name = raw.name;
        const row: GithubRepoRow = {
            id: raw.id,
            owner,
            name,
            fullName: fullName || name,
            description: raw.description || undefined,
            url: raw.url ?? undefined,
            cloneUrl: raw.cloneUrl ?? undefined,
            sshUrl: raw.sshUrl ?? undefined,
            visibility: raw.visibility,
            defaultBranch: raw.defaultBranch ?? undefined,
            language: raw.language || undefined,
            stargazers: raw.stargazers,
            forks: raw.forks,
            openIssues: raw.openIssues,
            updatedAt: raw.updatedAt ?? undefined,
            pushedAt: raw.pushedAt ?? undefined,
            localPath: raw.localPath ?? undefined,
            projectIds: raw.projectIds,
            summary: raw.summary,
        };
        rows.set(repoKey(row), row);
    }

    for (const project of state.projects ?? []) {
        for (const repo of project.repos ?? []) {
            const fullName = repo.github ? `${repo.github.owner}/${repo.github.repo}` : repo.name;
            const localPath = projectRepoPath(project, repo);
            const draft: GithubRepoRow = {
                id: repo.github ? fullName : repo.id,
                owner: repo.github?.owner,
                name: repo.github?.repo ?? repo.name,
                fullName,
                description: repo.notes,
                url: repo.github?.url,
                cloneUrl: repo.github?.url ? `${repo.github.url.replace(/\.git$/, "")}.git` : undefined,
                visibility: repo.visibility,
                defaultBranch: repo.github?.defaultBranch,
                localPath,
                projectIds: [project.id],
            };
            const key = repoKey(draft);
            const previous = rows.get(key);
            rows.set(key, previous ? {
                ...draft,
                ...previous,
                localPath: previous.localPath || localPath,
                projectIds: Array.from(new Set([...(previous.projectIds ?? []), project.id])),
            } : draft);
        }
    }

    return Array.from(rows.values()).sort((a, b) => {
        if (!!a.localPath !== !!b.localPath) return a.localPath ? -1 : 1;
        return a.fullName.localeCompare(b.fullName);
    });
}

function sourceFor(state: CoretexState, repo?: GithubRepoRow | null) {
    if (!repo) return undefined;
    const local = repo.localPath ? state.sourceControl[repo.localPath] : undefined;
    const detailKey = repo.owner ? repo.fullName : repo.localPath || repo.id;
    const detail = state.github?.details?.[detailKey];
    const remote = state.sourceControl[repo.fullName];
    if (!local && !detail && !remote && !repo.summary) return undefined;
    return {
        ...remote,
        ...local,
        summary: local?.summary ?? repo.summary,
        branches: detail?.branches ?? local?.branches,
        commits: detail?.commits ?? local?.commits,
        prs: detail?.pullRequests ?? local?.prs,
        deployments: remote?.deployments ?? detail?.deployments,
        workflows: remote?.workflows ?? detail?.workflows,
        deploymentsError: remote?.deploymentsError ?? detail?.deploymentsError,
    };
}

function dirtyCount(summary?: GitRepoSummary): number {
    return (summary?.staged ?? 0) + (summary?.unstaged ?? 0) + (summary?.untracked ?? 0);
}

function formatRelative(value?: string): string {
    if (!value) return "Not available";
    const ts = new Date(value).getTime();
    if (!Number.isFinite(ts)) return value;
    const delta = Date.now() - ts;
    const mins = Math.max(0, Math.floor(delta / 60_000));
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** Remote metadata is untrusted renderer input. Only navigate to HTTPS GitHub pages. */
function safeGithubUrl(value?: string | null): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

/** Deployment providers may use their own domains; still require safe credential-free HTTPS. */
function safeHttpsUrl(value?: string | null): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return undefined;
        return url.toString();
    } catch {
        return undefined;
    }
}

function statusTone(value?: string | null): "success" | "error" | "warning" | "gray" {
    const status = (value ?? "").toLowerCase();
    if (["success", "succeeded", "active", "completed"].includes(status)) return "success";
    if (["failure", "failed", "error", "cancelled", "inactive"].includes(status)) return "error";
    if (["pending", "queued", "in_progress", "waiting", "requested"].includes(status)) return "warning";
    return "gray";
}

function uniqueRepoId(): string {
    return `repo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GithubView = ({
    state,
    actions,
    onNavigate,
}: {
    state: CoretexState;
    actions: CoretexActions;
    onNavigate: (target: NavTarget) => void;
}) => {
    const repos = useMemo(() => repositoryRows(state), [state.projects, state.github]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<RepoFilter>("all");
    const [tab, setTab] = useState<RepoTab>("overview");
    const [cloneOpen, setCloneOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);
    const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
    const [commitMessage, setCommitMessage] = useState("");
    const [newBranch, setNewBranch] = useState("");
    const [mergeBranch, setMergeBranch] = useState("");
    const [busy, setBusy] = useState(false);
    const [pendingOp, setPendingOp] = useState<{ path: string; after: number; refresh: "summary" | "all" } | null>(null);

    const selected = repos.find((repo) => repoKey(repo) === selectedKey) ?? repos[0] ?? null;
    const selectedSource = sourceFor(state, selected);
    const summary = selectedSource?.summary;
    const branches = selectedSource?.branches ?? [];
    const commits = selectedSource?.commits ?? [];
    const prs = selectedSource?.prs ?? [];
    const deployments = selectedSource?.deployments ?? [];
    const workflows = selectedSource?.workflows ?? [];
    const deploymentsError = selectedSource?.deploymentsError;
    const githubState = state.github?.overview;
    const selectedDetailKey = selected ? (selected.owner ? selected.fullName : selected.localPath || selected.id) : undefined;
    const selectedDetail = selectedDetailKey ? state.github?.details?.[selectedDetailKey] : undefined;
    const selectedDetailError = selectedDetailKey ? state.github?.detailErrors?.[selectedDetailKey] : undefined;
    const connected = githubState?.connected === true;
    const githubError = githubState?.error as string | undefined;

    useEffect(() => {
        if (selectedKey && repos.some((repo) => repoKey(repo) === selectedKey)) return;
        setSelectedKey(repos[0] ? repoKey(repos[0]) : null);
    }, [repos, selectedKey]);

    const refreshOverview = (force = false): void => {
        actions.githubOverview(force);
    };

    const refreshLocal = (path: string, fullName?: string): void => {
        actions.gitSummary(path);
        actions.gitBranches(path);
        actions.gitLog(path, 100);
        actions.gitPrs(path, fullName);
    };

    const refreshRepo = (repo: GithubRepoRow | null): void => {
        if (!repo) return;
        actions.githubDetail(repo.owner ? repo.fullName : undefined, repo.localPath);
        if (repo.owner) actions.gitDeployments(repo.fullName);
        if (!repo.localPath) return;
        refreshLocal(repo.localPath, repo.owner ? repo.fullName : undefined);
    };

    useEffect(() => {
        refreshOverview(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        refreshRepo(selected);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected ? repoKey(selected) : null, selected?.localPath]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return repos.filter((repo) => {
            const sc = sourceFor(state, repo)?.summary;
            if (filter === "local" && !repo.localPath) return false;
            if (filter === "remote" && !repo.owner) return false;
            if (filter === "attention" && dirtyCount(sc) === 0 && (sc?.behind ?? 0) === 0 && (sc?.conflicts ?? 0) === 0) return false;
            if (!q) return true;
            return `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLowerCase().includes(q);
        });
    }, [repos, query, filter, state.sourceControl]);

    const localCount = repos.filter((repo) => repo.localPath).length;
    const dirtyRepos = repos.filter((repo) => dirtyCount(sourceFor(state, repo)?.summary) > 0).length;
    const behindRepos = repos.filter((repo) => (sourceFor(state, repo)?.summary?.behind ?? 0) > 0).length;
    const aheadRepos = repos.filter((repo) => (sourceFor(state, repo)?.summary?.ahead ?? 0) > 0).length;

    const run = (operation: () => boolean, refresh: "summary" | "all" = "all"): void => {
        const path = selected?.localPath;
        setBusy(true);
        if (path) setPendingOp({ path, after: state.sourceControl[path]?.lastOp?.at ?? 0, refresh });
        if (!operation()) {
            setBusy(false);
            setPendingOp(null);
        }
    };

    // Git operations report completion through the path-keyed lastOp cache. Only
    // then do we refresh status/history, avoiding timer races on slow networks.
    const completedOpAt = pendingOp ? state.sourceControl[pendingOp.path]?.lastOp?.at : undefined;
    useEffect(() => {
        if (!pendingOp || !completedOpAt || completedOpAt <= pendingOp.after) return;
        setBusy(false);
        setPendingOp(null);
        // Checkbox staging and local git operations should not fan out into the
        // GitHub account API. Refresh only the completed worktree's git caches.
        if (pendingOp.refresh === "summary") actions.gitSummary(pendingOp.path);
        else refreshLocal(pendingOp.path, selected?.owner ? selected.fullName : undefined);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [completedOpAt, pendingOp?.path, pendingOp?.after, pendingOp?.refresh]);

    return (
        <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 pb-24">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                    <BrandLogo domain="github.com" name="GitHub" size={44} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-2xl font-semibold tracking-tight text-primary">GitHub</h1>
                            {connected ? (
                                <BadgeWithDot size="sm" color="success" type="pill-color">Connected</BadgeWithDot>
                            ) : (
                                <BadgeWithDot size="sm" color="warning" type="pill-color">Local mode</BadgeWithDot>
                            )}
                        </div>
                        <p className="mt-1 max-w-2xl text-sm text-tertiary">
                            Browse accessible repositories, understand their history, link them to projects, and manage the local Git workflow from one place.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {!connected && (
                        <Button size="sm" color="secondary" onClick={() => onNavigate({ kind: "settings", page: "account" })}>
                            Account &amp; CLI info
                        </Button>
                    )}
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} isDisabled={busy} onClick={() => { refreshOverview(true); refreshRepo(selected); }}>
                        Refresh
                    </Button>
                    <Button size="sm" color="primary" iconLeading={Download01} onClick={() => setCloneOpen(true)}>
                        Clone repository
                    </Button>
                </div>
            </header>

            {!connected && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3" style={SOFT}>
                    <BrandLogo domain="github.com" name="GitHub" size={30} />
                    <div className="min-w-[12rem] flex-1">
                        <p className="text-sm font-medium text-primary">GitHub CLI sign-in required</p>
                        <p className="text-xs text-tertiary">Local repositories remain available. Run <code>gh auth login</code> in a terminal, then refresh to discover remote repositories, README files, pull requests, and deployments.</p>
                    </div>
                    <Button size="sm" color="secondary" onClick={() => onNavigate({ kind: "settings", page: "account" })}>Open account settings</Button>
                </div>
            )}

            {githubError && (
                <div role="alert" className="rounded-xl px-4 py-3 text-sm text-error-primary" style={{ background: "color-mix(in srgb, var(--c-error, #ef4444) 8%, var(--surface))", border: "1px solid color-mix(in srgb, var(--c-error, #ef4444) 28%, var(--c-border))" }}>
                    GitHub could not refresh: {githubError}
                </div>
            )}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Repositories" value={repos.length} detail={`${localCount} cloned locally`} icon={Code01} color="var(--brand)" />
                <Metric label="Working changes" value={dirtyRepos} detail={dirtyRepos ? "Repositories need a commit" : "Every worktree is clean"} icon={Edit01} color={dirtyRepos ? "#f59e0b" : "#22c55e"} />
                <Metric label="Ready to push" value={aheadRepos} detail={aheadRepos ? "Local commits ahead" : "No unpublished commits"} icon={ArrowUp} color="#8b5cf6" />
                <Metric label="Updates available" value={behindRepos} detail={behindRepos ? "Pull before continuing" : "Local branches are current"} icon={ArrowDown} color="#06b6d4" />
            </section>

            {repos.length === 0 ? (
                <EmptyRepositories connected={connected} onClone={() => setCloneOpen(true)} onConnect={() => onNavigate({ kind: "settings", page: "account" })} />
            ) : (
                <section className="grid min-h-[720px] overflow-hidden rounded-2xl xl:grid-cols-[320px_minmax(0,1fr)]" style={CARD}>
                    <aside className="flex h-[420px] min-h-0 flex-col border-b xl:h-auto xl:border-b-0 xl:border-r" style={{ borderColor: "var(--c-border)" }}>
                        <div className="flex flex-col gap-3 border-b p-3" style={{ borderColor: "var(--c-border)" }}>
                            <Input value={query} onChange={setQuery} icon={SearchLg} placeholder="Search repositories" aria-label="Search repositories" />
                            <div className="flex flex-wrap gap-1.5">
                                {(["all", "local", "remote", "attention"] as RepoFilter[]).map((item) => (
                                    <button key={item} type="button" onClick={() => setFilter(item)} className={cx("rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition", filter === item ? "text-primary" : "text-tertiary hover:text-secondary")} style={filter === item ? { background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--c-border)" } : undefined}>
                                        {item}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
                            {filtered.length === 0 ? (
                                <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                                    <FilterLines className="size-5 text-quaternary" />
                                    <p className="text-sm font-medium text-secondary">No matching repositories</p>
                                    <p className="text-xs text-quaternary">Try another name or status filter.</p>
                                </div>
                            ) : (
                                <ul className="flex flex-col gap-1">
                                    {filtered.map((repo) => {
                                        const repoSummary = sourceFor(state, repo)?.summary;
                                        const active = repoKey(repo) === repoKey(selected ?? {});
                                        const dirty = dirtyCount(repoSummary);
                                        return (
                                            <li key={repoKey(repo)}>
                                                <button type="button" onClick={() => { setSelectedKey(repoKey(repo)); setTab("overview"); }} className={cx("group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition", active ? "bg-[var(--surface-2)]" : "hover:bg-[var(--surface-2)]")} style={active ? { boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--brand) 28%, var(--c-border))" } : undefined}>
                                                    <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: active ? "color-mix(in srgb, var(--brand) 12%, var(--surface))" : "var(--surface)", border: "1px solid var(--c-border)" }}>
                                                        {repo.owner ? <BrandLogo domain="github.com" name="GitHub" size={22} chip={false} /> : <Folder className="size-4 text-tertiary" />}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-xs font-semibold text-primary">{repo.fullName}</span>
                                                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-quaternary">
                                                            <span className="truncate">{repo.localPath ? repoSummary?.branch || "Local" : "Remote only"}</span>
                                                            {dirty > 0 && <Badge size="sm" color="warning" type="pill-color">{dirty}</Badge>}
                                                            {(repoSummary?.conflicts ?? 0) > 0 && <Badge size="sm" color="error" type="pill-color">Conflict</Badge>}
                                                        </span>
                                                    </span>
                                                    <ChevronRight className={cx("mt-1 size-3.5 shrink-0 text-quaternary transition", active ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100")} />
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    </aside>

                    {selected && (
                        <div className="flex min-w-0 flex-col">
                            <RepositoryHeader
                                repo={selected}
                                summary={summary}
                                projects={state.projects}
                                busy={busy}
                                onLink={() => setLinkOpen(true)}
                                onRefresh={() => refreshRepo(selected)}
                                onFetch={() => { const path = selected.localPath; if (path) run(() => actions.gitFetch(path, selected.owner ? selected.fullName : undefined)); }}
                                onPull={() => { const path = selected.localPath; if (path) run(() => actions.gitPull(path, selected.owner ? selected.fullName : undefined)); }}
                                onPush={() => {
                                    if (!selected.localPath) return;
                                    const githubRemote = Boolean(selected.owner || summary?.github);
                                    const destination = githubRemote ? "GitHub" : "the configured remote";
                                    setConfirm({
                                        title: summary?.upstream ? `Push commits to ${destination}?` : `Publish this branch to ${destination}?`,
                                        description: summary?.upstream
                                            ? "This writes local commits to the configured remote. Review the exact destination before continuing."
                                            : "This creates the upstream remote branch and publishes the current local branch. Review the exact destination before continuing.",
                                        details: [
                                            { label: "Repository", value: selected.fullName },
                                            { label: "Branch", value: summary?.branch ?? "Current branch" },
                                            { label: summary?.upstream ? "Commits" : "Action", value: summary?.upstream ? `${summary?.ahead ?? 0} ahead` : "Create upstream branch" },
                                            { label: "Remote", value: selected.owner ? selected.fullName : summary?.upstream ?? summary?.remotes?.find((remote) => remote.push)?.url ?? "Configured remote" },
                                        ],
                                        confirmLabel: summary?.upstream ? "Push commits" : "Publish branch",
                                        run: () => run(() => actions.gitPush(selected.localPath!, !summary?.upstream, selected.owner ? selected.fullName : undefined)),
                                    });
                                }}
                            />

                            <nav className="flex min-w-0 gap-1 overflow-x-auto border-b px-4" style={{ borderColor: "var(--c-border)" }} aria-label="Repository views">
                                {([
                                    ["overview", "Overview"],
                                    ["changes", `Changes${dirtyCount(summary) ? ` ${dirtyCount(summary)}` : ""}`],
                                    ["commits", "History"],
                                    ["branches", `Branches ${branches.filter((branch) => !branch.remote).length}`],
                                    ["pulls", `Pull requests ${prs.length}`],
                                    ["deployments", `Deployments ${deployments.length + workflows.length}`],
                                ] as [RepoTab, string][]).map(([id, label]) => (
                                    <button key={id} type="button" onClick={() => setTab(id)} className={cx("relative shrink-0 px-3 py-3 text-xs font-medium transition", tab === id ? "text-primary" : "text-tertiary hover:text-secondary")}>
                                        {label}
                                        {tab === id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full" style={{ background: "var(--brand)" }} />}
                                    </button>
                                ))}
                            </nav>

                            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                                {selectedDetailError && <div role="alert" className="mb-4 rounded-xl px-4 py-3 text-xs text-error-primary" style={{ background: "color-mix(in srgb, var(--c-error, #ef4444) 8%, var(--surface))", border: "1px solid color-mix(in srgb, var(--c-error, #ef4444) 28%, var(--c-border))" }}>Repository details could not be refreshed: {selectedDetailError}</div>}
                                {tab === "overview" && <OverviewTab repo={{ ...selected, readme: normalizeReadme(selectedDetail?.readme) ?? selected.readme }} summary={summary} commits={commits} projects={state.projects} onLink={() => setLinkOpen(true)} />}
                                {tab === "changes" && (
                                    <ChangesTab
                                        repo={selected}
                                        summary={summary}
                                        commitMessage={commitMessage}
                                        onCommitMessage={setCommitMessage}
                                        busy={busy}
                                        actions={actions}
                                        onGitOp={run}
                                        onCommit={() => {
                                            if (!selected.localPath || !commitMessage.trim()) return;
                                            const message = commitMessage.trim();
                                            setConfirm({
                                                title: "Create this commit?",
                                                description: "Coretex will commit the files currently staged in this worktree. Unstaged changes remain untouched, and nothing is pushed automatically.",
                                                details: [
                                                    { label: "Repository", value: selected.fullName },
                                                    { label: "Branch", value: summary?.branch ?? "Current branch" },
                                                    { label: "Files", value: `${summary?.staged ?? 0} staged` },
                                                    { label: "Message", value: message },
                                                ],
                                                confirmLabel: "Create commit",
                                                run: () => {
                                                    setCommitMessage("");
                                                    run(() => actions.gitCommit(selected.localPath!, message, false));
                                                },
                                            });
                                        }}
                                    />
                                )}
                                {tab === "commits" && <HistoryTab commits={commits} repo={selected} />}
                                {tab === "branches" && (
                                    <BranchesTab
                                        repo={selected}
                                        summary={summary}
                                        branches={branches}
                                        newBranch={newBranch}
                                        onNewBranch={setNewBranch}
                                        mergeBranch={mergeBranch}
                                        onMergeBranch={setMergeBranch}
                                        busy={busy}
                                        onCheckout={(branch: string, create: boolean) => selected.localPath && run(() => actions.gitCheckout(selected.localPath!, branch, create))}
                                        onMerge={(branch: string) => {
                                            if (!selected.localPath) return;
                                            setConfirm({
                                                title: `Merge ${branch}?`,
                                                description: "This changes the local worktree and may require conflict resolution. It will not push automatically.",
                                                details: [
                                                    { label: "Repository", value: selected.fullName },
                                                    { label: "Into", value: summary?.branch ?? "Current branch" },
                                                    { label: "From", value: branch },
                                                ],
                                                confirmLabel: "Merge locally",
                                                run: () => run(() => actions.gitMerge(selected.localPath!, branch, "no-ff")),
                                            });
                                        }}
                                    />
                                )}
                                {tab === "pulls" && <PullRequestsTab repo={selected} summary={summary} prs={prs} actions={actions} busy={busy} onConfirm={setConfirm} run={run} />}
                                {tab === "deployments" && <DeploymentsTab repo={selected} deployments={deployments} workflows={workflows} error={deploymentsError} />}
                            </div>
                        </div>
                    )}
                </section>
            )}

            {cloneOpen && <CloneModal repo={selected} projects={state.projects} state={state} actions={actions} onClose={() => setCloneOpen(false)} />}
            {linkOpen && selected && <LinkProjectsModal repo={selected} projects={state.projects} actions={actions} onClose={() => setLinkOpen(false)} />}
            {confirm && <ConfirmModal action={confirm} onClose={() => setConfirm(null)} />}
        </div>
    );
};

function Metric({ label, value, detail, icon: Icon, color }: { label: string; value: number; detail: string; icon: typeof Code01; color: string }) {
    return (
        <article className="flex items-start gap-3 rounded-xl p-4" style={CARD}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ color, background: `color-mix(in srgb, ${color} 12%, var(--surface-2))` }}><Icon className="size-4" /></span>
            <div className="min-w-0">
                <p className="text-xs font-medium text-tertiary">{label}</p>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-primary">{value}</p>
                <p className="mt-0.5 truncate text-[11px] text-quaternary">{detail}</p>
            </div>
        </article>
    );
}

function EmptyRepositories({ connected, onClone, onConnect }: { connected: boolean; onClone: () => void; onConnect: () => void }) {
    return (
        <section className="relative grid min-h-[480px] place-items-center overflow-hidden rounded-2xl px-6 py-16 text-center" style={CARD}>
            <div aria-hidden className="absolute size-[420px] rounded-full opacity-50" style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--brand) 13%, transparent), transparent 68%)" }} />
            <div className="relative flex max-w-lg flex-col items-center">
                <span className="grid size-14 place-items-center rounded-2xl" style={SOFT}><BrandLogo domain="github.com" name="GitHub" size={34} chip={false} /></span>
                <h2 className="mt-5 text-lg font-semibold text-primary">Bring your repositories into Coretex</h2>
                <p className="mt-2 text-sm leading-6 text-tertiary">Clone a repository to this device or authenticate GitHub CLI to discover repositories your account can access. Nothing is modified until you choose an action.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button size="md" color="primary" iconLeading={Download01} onClick={onClone}>Clone repository</Button>
                    {!connected && <Button size="md" color="secondary" onClick={onConnect}>Account &amp; CLI info</Button>}
                </div>
            </div>
        </section>
    );
}

function RepositoryHeader({ repo, summary, projects, busy, onLink, onRefresh, onFetch, onPull, onPush }: {
    repo: GithubRepoRow;
    summary?: GitRepoSummary;
    projects: Project[];
    busy: boolean;
    onLink: () => void;
    onRefresh: () => void;
    onFetch: () => void;
    onPull: () => void;
    onPush: () => void;
}) {
    const linked = projects.filter((project) => repo.projectIds.includes(project.id));
    const remoteUrl = safeGithubUrl(repo.url);
    const hasPushRemote = Boolean(summary?.upstream || summary?.remotes?.some((remote) => remote.push));
    return (
        <div className="flex flex-wrap items-start justify-between gap-4 border-b p-4 sm:p-5" style={{ borderColor: "var(--c-border)" }}>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-primary">{repo.fullName}</h2>
                    <Badge size="sm" color="gray" type="pill-color">{repo.visibility ?? (repo.owner ? "remote" : "local")}</Badge>
                    {repo.localPath ? <BadgeWithDot size="sm" color={dirtyCount(summary) ? "warning" : "success"} type="pill-color">{dirtyCount(summary) ? `${dirtyCount(summary)} changes` : "Clean"}</BadgeWithDot> : <Badge size="sm" color="warning" type="pill-color">Not cloned</Badge>}
                </div>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-tertiary">{repo.description || "No repository description has been provided."}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-quaternary">
                    {repo.language && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: "var(--brand)" }} />{repo.language}</span>}
                    <span className="inline-flex items-center gap-1"><GitBranch01 className="size-3" /> {summary?.branch ?? repo.defaultBranch ?? "No branch"}</span>
                    {repo.localPath && <span className="max-w-xl truncate font-mono" title={repo.localPath}>{repo.localPath}</span>}
                    {linked.length > 0 && <span>{linked.map((project) => project.name).join(", ")}</span>}
                </div>
            </div>
            <div className="flex flex-wrap gap-2">
                {remoteUrl && <a href={remoteUrl} target="_blank" rel="noreferrer"><Button size="sm" color="tertiary" iconLeading={LinkExternal01}>Open</Button></a>}
                <Button size="sm" color="secondary" iconLeading={Plus} onClick={onLink}>{linked.length ? "Manage projects" : "Link project"}</Button>
                <Button size="sm" color="secondary" iconLeading={RefreshCcw01} isDisabled={busy || !repo.localPath} onClick={onRefresh} aria-label="Refresh repository" />
                <Button size="sm" color="secondary" iconLeading={Download01} isDisabled={busy || !repo.localPath} onClick={onFetch}>Fetch</Button>
                <Button size="sm" color="secondary" iconLeading={ArrowDown} isDisabled={busy || !repo.localPath || !summary?.upstream} onClick={onPull}>Pull{(summary?.behind ?? 0) > 0 ? ` ${summary!.behind}` : ""}</Button>
                <Button size="sm" color="primary" iconLeading={ArrowUp} isDisabled={busy || !repo.localPath || !hasPushRemote || (!!summary?.upstream && (summary?.ahead ?? 0) === 0)} onClick={onPush}>{summary?.upstream ? `Push${(summary?.ahead ?? 0) > 0 ? ` ${summary!.ahead}` : ""}` : "Publish branch"}</Button>
            </div>
        </div>
    );
}

function OverviewTab({ repo, summary, commits, projects, onLink }: { repo: GithubRepoRow; summary?: GitRepoSummary; commits: GitCommitInfo[]; projects: Project[]; onLink: () => void }) {
    const linked = projects.filter((project) => repo.projectIds.includes(project.id));
    return (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,.6fr)]">
            <div className="flex min-w-0 flex-col gap-4">
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <MiniStat label="Branch" value={summary?.branch ?? repo.defaultBranch ?? "—"} />
                    <MiniStat label="Changes" value={String(dirtyCount(summary))} tone={dirtyCount(summary) ? "warn" : "good"} />
                    <MiniStat label="Ahead / behind" value={`${summary?.ahead ?? 0} / ${summary?.behind ?? 0}`} />
                    <MiniStat label="Last activity" value={formatRelative(repo.pushedAt ?? repo.updatedAt ?? commits[0]?.date)} />
                </section>
                <ActivityChart commits={commits} />
                <ReadmeCard readme={repo.readme} repo={repo} />
            </div>
            <aside className="flex flex-col gap-4">
                <section className="rounded-xl p-4" style={CARD}>
                    <h3 className="text-sm font-semibold text-primary">Repository details</h3>
                    <dl className="mt-3 flex flex-col gap-3 text-xs">
                        <Detail label="Visibility" value={repo.visibility ?? "Unknown"} />
                        <Detail label="Default branch" value={repo.defaultBranch ?? summary?.branch ?? "Unknown"} />
                        <Detail label="Stars" value={String(repo.stargazers ?? 0)} />
                        <Detail label="Forks" value={String(repo.forks ?? 0)} />
                        <Detail label="Open issues" value={String(repo.openIssues ?? 0)} />
                    </dl>
                </section>
                <section className="rounded-xl p-4" style={CARD}>
                    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold text-primary">Linked projects</h3><Button size="sm" color="tertiary" iconLeading={Plus} onClick={onLink}>Manage</Button></div>
                    {linked.length ? (
                        <ul className="mt-3 flex flex-col gap-2">{linked.map((project) => <li key={project.id} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={SOFT}><Folder className="size-3.5 text-tertiary" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">{project.name}</span><Badge size="sm" color="gray" type="pill-color">{(project.repos ?? []).length} repos</Badge></li>)}</ul>
                    ) : <p className="mt-3 text-xs leading-5 text-tertiary">Not linked to a project yet. A repository can belong to more than one project.</p>}
                </section>
            </aside>
        </div>
    );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
    return <div className="rounded-xl px-3.5 py-3" style={SOFT}><p className="text-[10px] font-semibold uppercase tracking-wide text-quaternary">{label}</p><p className={cx("mt-1 truncate text-sm font-semibold", tone === "warn" ? "text-warning-primary" : tone === "good" ? "text-success-primary" : "text-primary")}>{value}</p></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
    return <div className="flex items-center justify-between gap-4"><dt className="text-tertiary">{label}</dt><dd className="truncate font-medium capitalize text-primary">{value}</dd></div>;
}

function ActivityChart({ commits }: { commits: GitCommitInfo[] }) {
    const days = useMemo(() => {
        const result = Array.from({ length: 14 }, (_, index) => {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - (13 - index));
            return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString([], { weekday: "short" }).slice(0, 1), count: 0 };
        });
        for (const commit of commits) {
            const key = commit.date ? new Date(commit.date).toISOString().slice(0, 10) : "";
            const day = result.find((item) => item.key === key);
            if (day) day.count += 1;
        }
        return result;
    }, [commits]);
    const max = Math.max(1, ...days.map((day) => day.count));
    return (
        <section className="rounded-xl p-4" style={CARD}>
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-primary">Commit activity</h3><p className="mt-0.5 text-xs text-tertiary">Last 14 days from the loaded repository history</p></div><Badge size="sm" color="gray" type="pill-color">{days.reduce((sum, day) => sum + day.count, 0)} commits</Badge></div>
            <div className="mt-5 grid h-36 grid-cols-14 items-end gap-1.5" aria-label="Commit activity bar chart">
                {days.map((day) => <div key={day.key} className="flex h-full min-w-0 flex-col justify-end gap-1.5" title={`${day.key}: ${day.count} commits`}><span className="mx-auto w-full max-w-5 rounded-t-sm transition-all" style={{ minHeight: day.count ? 5 : 2, height: `${Math.max(day.count ? 8 : 2, (day.count / max) * 100)}%`, background: day.count ? "linear-gradient(to top, var(--brand), color-mix(in srgb, var(--brand) 55%, #fff))" : "var(--surface-3, var(--c-border))" }} /><span className="text-center text-[9px] text-quaternary">{day.label}</span></div>)}
            </div>
        </section>
    );
}

function ReadmeCard({ readme, repo }: { readme?: GithubRepoRow["readme"]; repo: GithubRepoRow }) {
    const sourceUrl = safeGithubUrl(readme?.url);
    return (
        <section className="overflow-hidden rounded-xl" style={CARD}>
            <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}><div className="flex items-center gap-2"><BookOpen01 className="size-4 text-tertiary" /><h3 className="text-sm font-semibold text-primary">{readme?.name ?? "README"}</h3></div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-tertiary hover:text-primary">Open source <LinkExternal01 className="size-3" /></a>}</header>
            {readme?.content ? <SimpleMarkdown text={readme.content} /> : <div className="flex flex-col items-center px-6 py-12 text-center"><BookOpen01 className="size-6 text-quaternary" /><p className="mt-3 text-sm font-medium text-secondary">README is not available</p><p className="mt-1 max-w-md text-xs leading-5 text-quaternary">{repo.localPath ? "Refresh the repository or add a README file to its root." : "Clone this repository or connect GitHub to load its README."}</p></div>}
            {readme?.truncated && <p className="border-t px-4 py-2 text-[11px] text-quaternary" style={{ borderColor: "var(--c-border)" }}>Large README preview was truncated for renderer safety.</p>}
        </section>
    );
}

function SimpleMarkdown({ text }: { text: string }) {
    const lines = text.slice(0, 120_000).split(/\r?\n/);
    let inCode = false;
    return <div className="max-h-[620px] overflow-auto px-5 py-4 text-sm leading-6 text-secondary">{lines.map((line, index) => {
        if (line.trim().startsWith("```")) { inCode = !inCode; return <div key={index} className="h-2" />; }
        if (inCode) return <code key={index} className="block whitespace-pre-wrap bg-[var(--surface-2)] px-3 py-0.5 font-mono text-xs text-secondary">{line || " "}</code>;
        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) return <div key={index} className={cx("border-b pb-1 font-semibold text-primary", heading[1].length === 1 ? "mt-5 text-xl" : heading[1].length === 2 ? "mt-4 text-lg" : "mt-3 text-base")} style={{ borderColor: "var(--c-border)" }}>{heading[2]}</div>;
        const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
        if (bullet) return <div key={index} className="flex gap-2 pl-2"><span className="text-quaternary">•</span><span>{bullet[1]}</span></div>;
        if (!line.trim()) return <div key={index} className="h-3" />;
        return <p key={index} className="whitespace-pre-wrap">{line}</p>;
    })}</div>;
}

function ChangesTab({ repo, summary, commitMessage, onCommitMessage, busy, actions, onGitOp, onCommit }: { repo: GithubRepoRow; summary?: GitRepoSummary; commitMessage: string; onCommitMessage: (v: string) => void; busy: boolean; actions: CoretexActions; onGitOp: (operation: () => boolean, refresh?: "summary" | "all") => void; onCommit: () => void }) {
    if (!repo.localPath) return <LocalRequired repo={repo} />;
    const files = summary?.files ?? [];
    if (!summary) return <LoadingState label="Loading working tree status…" />;
    return (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="overflow-hidden rounded-xl" style={CARD}>
                <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}><div><h3 className="text-sm font-semibold text-primary">Working tree</h3><p className="mt-0.5 text-xs text-tertiary">{files.length ? `${files.length} files · +${summary.additions} −${summary.deletions}` : "No uncommitted changes"}</p></div>{files.length > 0 && <div className="flex gap-2"><Button size="sm" color="tertiary" isDisabled={busy} onClick={() => onGitOp(() => actions.gitStage(repo.localPath!, files.map((f) => f.path)), "summary")}>Stage all</Button><Button size="sm" color="tertiary" isDisabled={busy || summary.staged === 0} onClick={() => onGitOp(() => actions.gitUnstage(repo.localPath!, files.filter((f) => f.staged).map((f) => f.path)), "summary")}>Unstage all</Button></div>}</header>
                {files.length === 0 ? <div className="flex flex-col items-center px-6 py-16 text-center"><Check className="size-6 text-success-primary" /><p className="mt-3 text-sm font-medium text-secondary">Working tree is clean</p><p className="mt-1 text-xs text-quaternary">There is nothing to commit.</p></div> : <ul className="divide-y" style={{ borderColor: "var(--c-border)" }}>{files.map((file) => <li key={`${file.path}-${file.staged}`} className="flex items-center gap-3 px-4 py-2.5" style={{ borderColor: "var(--c-border)" }}><button type="button" disabled={busy} onClick={() => onGitOp(() => file.staged ? actions.gitUnstage(repo.localPath!, [file.path]) : actions.gitStage(repo.localPath!, [file.path]), "summary")} className={cx("grid size-4 shrink-0 place-items-center rounded border", file.staged ? "text-white" : "text-transparent")} style={{ background: file.staged ? "var(--brand)" : "transparent", borderColor: file.staged ? "var(--brand)" : "var(--c-border)" }} aria-label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}><Check className="size-3" /></button><Badge size="sm" color={file.status === "conflict" ? "error" : file.status === "untracked" || file.status === "added" ? "success" : "warning"} type="pill-color">{file.status}</Badge><span className="min-w-0 flex-1 truncate font-mono text-xs text-secondary" title={file.path}>{file.path}</span><span className="tabular-nums text-[11px]"><span className="text-success-primary">+{file.additions}</span> <span className="text-error-primary">−{file.deletions}</span></span></li>)}</ul>}
            </section>
            <aside className="h-fit rounded-xl p-4" style={CARD}>
                <h3 className="text-sm font-semibold text-primary">Commit changes</h3>
                <p className="mt-1 text-xs leading-5 text-tertiary">This creates a local commit only. Review and push separately when ready.</p>
                <div className="mt-4"><TextArea label="Commit message" value={commitMessage} onChange={onCommitMessage} rows={5} placeholder="Summarize this change…" /></div>
                <Button className="mt-3 w-full" size="md" color="primary" iconLeading={Edit01} isDisabled={busy || !commitMessage.trim() || summary.staged === 0 || (summary.conflicts ?? 0) > 0} onClick={onCommit}>Review commit{summary.staged > 0 ? ` · ${summary.staged} staged` : ""}</Button>
                {summary.staged === 0 && files.length > 0 && <p className="mt-2 text-xs text-tertiary">Select files in the working tree or use Stage all before committing.</p>}
                {(summary.conflicts ?? 0) > 0 && <p className="mt-2 text-xs text-error-primary">Resolve {summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"} before committing.</p>}
            </aside>
        </div>
    );
}

function HistoryTab({ commits, repo }: { commits: GitCommitInfo[]; repo: GithubRepoRow }) {
    if (!commits.length) return <LoadingState label="No commit history was returned for this repository." />;
    return <section className="overflow-hidden rounded-xl" style={CARD}><header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}><div><h3 className="text-sm font-semibold text-primary">Commit graph</h3><p className="mt-0.5 text-xs text-tertiary">Branch and merge topology from the loaded repository history</p></div><Badge size="sm" color="gray" type="pill-color">{commits.length} loaded</Badge></header><CommitGraph commits={commits} /></section>;
}

function CommitGraph({ commits }: { commits: GitCommitInfo[] }) {
    const rowHeight = 66;
    const graphWidth = 86;
    const index = new Map(commits.map((commit, i) => [commit.sha, i]));
    const hasParents = commits.some((commit) => commit.parents?.length);
    const edges: { from: number; to: number; lane: number }[] = [];
    commits.forEach((commit, i) => {
        const parents = commit.parents ?? [];
        if (parents.length) parents.forEach((parent, p) => { const target = index.get(parent); if (target !== undefined) edges.push({ from: i, to: target, lane: p }); });
        else if (!hasParents && i < commits.length - 1) edges.push({ from: i, to: i + 1, lane: 0 });
    });
    return (
        <div className="relative min-w-[620px]">
            <svg aria-hidden className="absolute left-0 top-0" width={graphWidth} height={commits.length * rowHeight} viewBox={`0 0 ${graphWidth} ${commits.length * rowHeight}`}>
                {edges.map((edge, i) => { const x1 = 26; const x2 = edge.lane ? 26 + Math.min(3, edge.lane) * 15 : 26; const y1 = edge.from * rowHeight + rowHeight / 2; const y2 = edge.to * rowHeight + rowHeight / 2; return <path key={`${edge.from}-${edge.to}-${i}`} d={`M ${x1} ${y1} C ${x2} ${y1 + 18}, ${x2} ${y2 - 18}, ${x1} ${y2}`} fill="none" stroke={GRAPH_COLORS[edge.lane % GRAPH_COLORS.length]} strokeWidth="2" opacity=".78" />; })}
                {commits.map((commit, i) => <g key={commit.sha}><circle cx="26" cy={i * rowHeight + rowHeight / 2} r="6" fill="var(--surface)" stroke={GRAPH_COLORS[(commit.parents?.length ?? 1) > 1 ? 1 : 0]} strokeWidth="3" />{(commit.parents?.length ?? 0) > 1 && <circle cx="50" cy={i * rowHeight + rowHeight / 2} r="3.5" fill={GRAPH_COLORS[1]} />}</g>)}
            </svg>
            <ul>{commits.map((commit, i) => { const commitUrl = safeGithubUrl(commit.url); return <li key={commit.sha} className="flex h-[66px] items-center border-b pl-[86px] pr-4 last:border-0" style={{ borderColor: "var(--c-border)" }}><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2">{commitUrl ? <a href={commitUrl} target="_blank" rel="noreferrer" className="truncate text-xs font-medium text-primary hover:underline">{commit.subject}</a> : <p className="truncate text-xs font-medium text-primary">{commit.subject}</p>}{commit.refs?.slice(0, 3).map((ref) => <Badge key={ref} size="sm" color="gray" type="pill-color">{ref.replace(/^HEAD -> /, "")}</Badge>)}</div><p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-quaternary"><span className="font-mono text-tertiary">{commit.shortSha}</span><span>{commit.author}</span><span>{formatRelative(commit.date)}</span>{(commit.parents?.length ?? 0) > 1 && <span className="text-success-primary">Merge</span>}</p></div><span className="ml-4 shrink-0 tabular-nums text-[11px]"><span className="text-success-primary">+{commit.additions ?? 0}</span> <span className="text-error-primary">−{commit.deletions ?? 0}</span></span></li>; })}</ul>
        </div>
    );
}

function BranchesTab({ repo, summary, branches, newBranch, onNewBranch, mergeBranch, onMergeBranch, busy, onCheckout, onMerge }: any) {
    if (!repo.localPath) return <section className="overflow-hidden rounded-xl" style={CARD}><header className="border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}><h3 className="text-sm font-semibold text-primary">Remote branches</h3><p className="mt-0.5 text-xs text-tertiary">Clone this repository to switch, create, or merge branches locally.</p></header>{branches.length ? <ul className="divide-y" style={{ borderColor: "var(--c-border)" }}>{branches.map((branch: any) => <li key={branch.name} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: "var(--c-border)" }}><GitBranch01 className="size-4 text-tertiary" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-primary">{branch.name}</p><p className="mt-0.5 truncate font-mono text-[11px] text-quaternary">{branch.sha ?? "Commit unavailable"}</p></div>{branch.name === repo.defaultBranch && <Badge size="sm" color="success" type="pill-color">Default</Badge>}</li>)}</ul> : <LoadingState label="No remote branches were returned." />}</section>;
    const local = branches.filter((branch: any) => !branch.remote);
    return <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]"><section className="overflow-hidden rounded-xl" style={CARD}><header className="border-b px-4 py-3" style={{ borderColor: "var(--c-border)" }}><h3 className="text-sm font-semibold text-primary">Local branches</h3><p className="mt-0.5 text-xs text-tertiary">Switching branches changes the checked-out files in this worktree.</p></header><ul className="divide-y" style={{ borderColor: "var(--c-border)" }}>{local.map((branch: any) => <li key={branch.name} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: "var(--c-border)" }}><GitBranch01 className="size-4 shrink-0 text-tertiary" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-primary">{branch.name}</p><p className="mt-0.5 truncate text-[11px] text-quaternary">{branch.subject ?? branch.sha ?? "No commit details"}</p></div>{branch.current ? <BadgeWithDot size="sm" color="success" type="pill-color">Current</BadgeWithDot> : <Button size="sm" color="tertiary" isDisabled={busy || dirtyCount(summary) > 0} onClick={() => onCheckout(branch.name, false)}>Switch</Button>}</li>)}</ul></section><aside className="flex h-fit flex-col gap-4 rounded-xl p-4" style={CARD}><div><h3 className="text-sm font-semibold text-primary">Create branch</h3><p className="mt-1 text-xs text-tertiary">Create from the current HEAD and switch to it.</p><div className="mt-3 flex gap-2"><Input value={newBranch} onChange={onNewBranch} placeholder="feature/name" aria-label="New branch name" /><Button size="md" color="secondary" iconLeading={Plus} isDisabled={busy || !newBranch.trim()} onClick={() => { const name = newBranch.trim(); onNewBranch(""); onCheckout(name, true); }}>Create</Button></div></div><div className="border-t pt-4" style={{ borderColor: "var(--c-border)" }}><h3 className="text-sm font-semibold text-primary">Merge locally</h3><p className="mt-1 text-xs text-tertiary">Merge another local branch into <span className="font-medium text-secondary">{summary?.branch ?? "current"}</span>.</p><div className="mt-3 flex gap-2"><select value={mergeBranch} onChange={(event) => onMergeBranch(event.target.value)} className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm text-primary outline-none focus:ring-2 focus:ring-[var(--brand)]" style={SOFT}><option value="">Select branch</option>{local.filter((branch: any) => !branch.current).map((branch: any) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}</select><Button size="md" color="secondary" iconLeading={GitBranch01} isDisabled={busy || !mergeBranch || dirtyCount(summary) > 0} onClick={() => onMerge(mergeBranch)}>Merge</Button></div>{dirtyCount(summary) > 0 && <p className="mt-2 text-[11px] text-warning-primary">Commit or stash working changes first.</p>}</div></aside></div>;
}

function PullRequestsTab({ repo, summary, prs, actions, busy, onConfirm, run }: { repo: GithubRepoRow; summary?: GitRepoSummary; prs: any[]; actions: CoretexActions; busy: boolean; onConfirm: (action: ConfirmAction) => void; run: (operation: () => boolean) => void }) {
    const [base, setBase] = useState(repo.defaultBranch ?? "main");
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    if (!repo.owner) return <RemoteRequired repo={repo} feature="pull requests" />;
    const pullsUrl = safeGithubUrl(repo.url ? `${repo.url}/pulls` : undefined);
    const createPanel = repo.localPath ? <section className="rounded-xl p-4" style={CARD}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-primary">Open a pull request</h3><p className="mt-1 text-xs text-tertiary">Push <span className="font-medium text-secondary">{summary?.branch ?? "current branch"}</span> and request a merge into the selected base.</p></div>{pullsUrl && <a href={pullsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-tertiary hover:text-primary">View all on GitHub <LinkExternal01 className="size-3" /></a>}</div><div className="mt-4 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]"><Input label="Base branch" value={base} onChange={setBase} placeholder="main" /><Input label="Title" value={title} onChange={setTitle} placeholder="Describe the proposed change" /></div><div className="mt-3"><TextArea label="Description (optional)" value={body} onChange={setBody} rows={3} placeholder="Context, testing notes, or rollout details…" /></div><div className="mt-3 flex justify-end"><Button size="sm" color="primary" iconLeading={GitBranch01} isDisabled={busy || !base.trim() || !title.trim() || !summary?.branch || summary.branch === base.trim()} onClick={() => onConfirm({ title: "Create this pull request?", description: "Coretex will push the current branch to the selected GitHub repository and open a pull request. Review the exact repository and branches before continuing.", details: [{ label: "Repository", value: repo.fullName }, { label: "From", value: summary?.branch ?? "Current branch" }, { label: "Into", value: base.trim() }, { label: "Title", value: title.trim() }], confirmLabel: "Push & create PR", run: () => { const prTitle = title.trim(); const prBody = body.trim(); setTitle(""); setBody(""); run(() => actions.gitCreatePr(repo.localPath!, repo.fullName, base.trim(), prTitle, prBody || undefined)); } })}>Review pull request</Button></div></section> : null;
    const list = !prs.length ? <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><GitBranch01 className="size-6 text-quaternary" /><p className="mt-3 text-sm font-medium text-secondary">No pull requests returned</p><p className="mt-1 max-w-md text-xs leading-5 text-quaternary">Authenticate GitHub CLI to list pull requests for this repository.</p>{pullsUrl && <a className="mt-4" href={pullsUrl} target="_blank" rel="noreferrer"><Button size="sm" color="secondary" iconLeading={LinkExternal01}>Open on GitHub</Button></a>}</div> : <section className="overflow-hidden rounded-xl" style={CARD}><ul className="divide-y" style={{ borderColor: "var(--c-border)" }}>{prs.map((pr) => { const url = safeGithubUrl(pr.url); const open = String(pr.state).toUpperCase() === "OPEN"; return <li key={pr.number} className="flex flex-wrap items-start gap-3 px-4 py-3" style={{ borderColor: "var(--c-border)" }}><Badge size="sm" color={open ? "success" : "gray"} type="pill-color">#{pr.number}</Badge><div className="min-w-[12rem] flex-1">{url ? <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">{pr.title}</a> : <p className="text-sm font-medium text-primary">{pr.title}</p>}<p className="mt-1 text-xs text-quaternary">{pr.author} · {pr.branch}{pr.baseBranch ? ` → ${pr.baseBranch}` : ""}{pr.isDraft ? " · Draft" : ""}</p></div>{pr.reviewDecision && <Badge size="sm" color={pr.reviewDecision === "APPROVED" ? "success" : "warning"} type="pill-color">{String(pr.reviewDecision).toLowerCase().replace(/_/g, " ")}</Badge>}{open && repo.localPath && <Button size="sm" color="secondary" iconLeading={GitBranch01} isDisabled={busy || pr.isDraft} onClick={() => onConfirm({ title: `Merge pull request #${pr.number}?`, description: "This enables GitHub auto-merge after required checks pass, squashes the pull request into one commit, and deletes its source branch after merge.", details: [{ label: "Repository", value: repo.fullName }, { label: "Pull request", value: `#${pr.number} · ${pr.title}` }, { label: "From", value: pr.branch }, { label: "Into", value: pr.baseBranch ?? repo.defaultBranch ?? "Default branch" }, { label: "Strategy", value: "Auto-merge · squash · delete source branch" }], confirmLabel: "Enable auto-merge", run: () => run(() => actions.gitMergePr(repo.localPath!, repo.fullName, String(pr.number))) })}>Merge</Button>}</li>; })}</ul></section>;
    return <div className="flex flex-col gap-4">{createPanel}{list}</div>;
}

function DeploymentsTab({ repo, deployments, workflows, error }: { repo: GithubRepoRow; deployments: any[]; workflows: any[]; error?: string }) {
    if (!repo.owner) return <RemoteRequired repo={repo} feature="deployments" />;
    const actionsUrl = safeGithubUrl(repo.url ? `${repo.url}/actions` : undefined);
    if (error && !deployments.length && !workflows.length) return <div role="alert" className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><Rocket01 className="size-6 text-error-primary" /><p className="mt-3 text-sm font-medium text-secondary">Deployment history could not be loaded</p><p className="mt-1 max-w-lg text-xs leading-5 text-quaternary">{error}</p><p className="mt-2 max-w-lg text-xs leading-5 text-quaternary">Refresh after authenticating GitHub CLI with repository and Actions access.</p>{actionsUrl && <a className="mt-4" href={actionsUrl} target="_blank" rel="noreferrer"><Button size="sm" color="secondary" iconLeading={LinkExternal01}>Open Actions</Button></a>}</div>;
    if (!deployments.length && !workflows.length) return <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><Rocket01 className="size-6 text-quaternary" /><p className="mt-3 text-sm font-medium text-secondary">No deployments or workflow runs returned</p><p className="mt-1 max-w-md text-xs leading-5 text-quaternary">Deployments appear here when GitHub Actions or a connected deployment provider reports them. Coretex does not invent deploy controls for repositories without workflows.</p>{actionsUrl && <a className="mt-4" href={actionsUrl} target="_blank" rel="noreferrer"><Button size="sm" color="secondary" iconLeading={LinkExternal01}>Open Actions</Button></a>}</div>;
    return <div className="flex flex-col gap-5">
        {deployments.length > 0 && <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-primary">Environments</h3><Badge size="sm" color="gray" type="pill-color">{deployments.length}</Badge></div><div className="grid gap-3 lg:grid-cols-2">{deployments.map((deployment) => { const url = safeHttpsUrl(deployment.url); const tone = statusTone(deployment.state); return <article key={deployment.id} className="rounded-xl p-4" style={CARD}><div className="flex items-start justify-between gap-3"><span className="grid size-9 place-items-center rounded-lg" style={SOFT}><Rocket01 className="size-4 text-tertiary" /></span><BadgeWithDot size="sm" color={tone} type="pill-color">{deployment.state || "Pending"}</BadgeWithDot></div><h3 className="mt-3 text-sm font-semibold text-primary">{deployment.environment || "Deployment"}</h3><p className="mt-1 text-xs text-tertiary">{deployment.ref || repo.defaultBranch || "Default branch"} · {formatRelative(deployment.updatedAt ?? deployment.createdAt)}</p>{deployment.description && <p className="mt-2 text-xs leading-5 text-quaternary">{deployment.description}</p>}{url && <a className="mt-4 inline-flex" href={url} target="_blank" rel="noreferrer"><Button size="sm" color="secondary" iconLeading={LinkExternal01}>View deployment</Button></a>}</article>; })}</div></section>}
        {workflows.length > 0 && <section><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-primary">Workflow runs</h3><Badge size="sm" color="gray" type="pill-color">{workflows.length}</Badge></div><div className="overflow-hidden rounded-xl" style={CARD}><ul className="divide-y" style={{ borderColor: "var(--c-border)" }}>{workflows.map((workflow) => { const url = safeGithubUrl(workflow.url); const label = workflow.conclusion ?? workflow.status ?? "Queued"; return <li key={workflow.id} className="flex items-center gap-3 px-4 py-3" style={{ borderColor: "var(--c-border)" }}><span className="grid size-8 shrink-0 place-items-center rounded-lg" style={SOFT}><Rocket01 className="size-3.5 text-tertiary" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-primary">{workflow.name || workflow.workflowName}</p><p className="mt-0.5 truncate text-[11px] text-quaternary">{workflow.branch ?? "No branch"} · {workflow.event} · {formatRelative(workflow.updatedAt ?? workflow.createdAt)}</p></div><BadgeWithDot size="sm" color={statusTone(label)} type="pill-color">{label}</BadgeWithDot>{url && <a href={url} target="_blank" rel="noreferrer" className="grid size-7 place-items-center rounded-md text-quaternary hover:bg-[var(--surface-2)] hover:text-secondary" aria-label={`Open ${workflow.name || workflow.workflowName}`}><LinkExternal01 className="size-3.5" /></a>}</li>; })}</ul></div></section>}
    </div>;
}

function LocalRequired({ repo }: { repo: GithubRepoRow }) { return <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><Download01 className="size-6 text-quaternary" /><p className="mt-3 text-sm font-medium text-secondary">Clone required</p><p className="mt-1 max-w-md text-xs leading-5 text-quaternary">{repo.fullName} is visible remotely, but local Git operations require a cloned worktree.</p></div>; }
function RemoteRequired({ repo, feature }: { repo: GithubRepoRow; feature: string }) { return <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><BrandLogo domain="github.com" name="GitHub" size={32} /><p className="mt-3 text-sm font-medium text-secondary">GitHub connection required</p><p className="mt-1 max-w-md text-xs leading-5 text-quaternary">Link a GitHub remote to {repo.name} to manage {feature}.</p></div>; }
function LoadingState({ label }: { label: string }) { return <div className="flex flex-col items-center rounded-xl px-6 py-16 text-center" style={CARD}><RefreshCcw01 className="size-5 text-quaternary" /><p className="mt-3 text-xs text-tertiary">{label}</p></div>; }

function CloneModal({ repo, projects, state, actions, onClose }: { repo: GithubRepoRow | null; projects: Project[]; state: CoretexState; actions: CoretexActions; onClose: () => void }) {
    const suggestedUrl = repo?.cloneUrl ?? repo?.url ?? "";
    const [remote, setRemote] = useState(suggestedUrl);
    const [destination, setDestination] = useState("");
    const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
    const [requestId, setRequestId] = useState<string | null>(null);
    const [refreshedAfterClone, setRefreshedAfterClone] = useState(false);
    const result = requestId ? state.sourceControl[requestId]?.lastOp : undefined;
    const submitted = requestId !== null;
    const canClone = remote.trim().length > 0 && destination.trim().length > 0;
    const submit = (): void => {
        if (!canClone) return;
        const id = actions.githubClone(remote.trim(), destination.trim(), Array.from(selectedProjects));
        if (!id) return;
        setRequestId(id);
    };
    useEffect(() => {
        if (!result?.ok || refreshedAfterClone) return;
        actions.githubOverview(true);
        setRefreshedAfterClone(true);
    }, [actions, refreshedAfterClone, result?.ok]);
    return <Modal title="Clone a repository" description="Create a local worktree. Coretex never overwrites a non-empty destination, and project links are saved only after Git reports success." icon={<Download01 className="size-4" />} onClose={onClose}><div className="flex flex-col gap-4"><Input label="Repository URL" value={remote} onChange={setRemote} placeholder="https://github.com/owner/repository.git" /><Input label="Local destination" value={destination} onChange={setDestination} placeholder="C:\\Projects\\repository" hint="Enter the exact absolute folder where the clone should be created." /><ProjectChecks projects={projects} selected={selectedProjects} onChange={setSelectedProjects} label="Link cloned repository to projects after success (optional)" />{submitted && !result && <div className="rounded-lg px-3 py-2 text-xs text-tertiary" style={SOFT}>Cloning… The project links above will be created atomically after the checkout succeeds.</div>}{result?.ok && <div className="rounded-lg px-3 py-2 text-xs text-success-primary" style={SOFT}>{result.message || "Repository cloned successfully."}{result.repoPath ? ` Local path: ${result.repoPath}` : ""}</div>}{result && !result.ok && <div className="rounded-lg px-3 py-2 text-xs text-error-primary" style={SOFT}>{result.error || result.message || "Clone failed. No project links were created."}</div>}<div className="rounded-lg px-3 py-3 text-xs text-tertiary" style={SOFT}><p className="font-medium text-secondary">Review</p><p className="mt-1 break-all"><span className="text-quaternary">From:</span> {remote || "—"}</p><p className="mt-1 break-all"><span className="text-quaternary">To:</span> {destination || "—"}</p><p className="mt-1"><span className="text-quaternary">Projects:</span> {selectedProjects.size ? `${selectedProjects.size} selected` : "None"}</p></div><div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--c-border)" }}><Button size="md" color="secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</Button><Button size="md" color="primary" iconLeading={Download01} isDisabled={!canClone || submitted} onClick={submit}>{submitted ? "Clone requested" : "Clone locally"}</Button></div></div></Modal>;
}

function LinkProjectsModal({ repo, projects, actions, onClose }: { repo: GithubRepoRow; projects: Project[]; actions: CoretexActions; onClose: () => void }) {
    const initial = new Set(repo.projectIds);
    const [selected, setSelected] = useState<Set<string>>(initial);
    const [path, setPath] = useState(repo.localPath ?? "");
    const save = (): void => {
        const repoData: ProjectRepo = { id: uniqueRepoId(), name: repo.name, path: path.trim(), github: repo.owner ? { owner: repo.owner, repo: repo.name, url: repo.url, defaultBranch: repo.defaultBranch } : null, notes: repo.description, visibility: repo.visibility === "public" ? "public" : "private", createdAt: Date.now(), includeInIndex: path.trim().length > 0 };
        // Upsert every selected project, not only newly checked ones: this also
        // applies an edited clone path to associations that already existed.
        for (const project of projects.filter((item) => selected.has(item.id))) {
            const existing = (project.repos ?? []).find((candidate) =>
                candidate.id === repo.id ||
                (candidate.github && repo.owner
                    ? candidate.github.owner.toLowerCase() === repo.owner.toLowerCase() && candidate.github.repo.toLowerCase() === repo.name.toLowerCase()
                    : norm(projectRepoPath(project, candidate)) === norm(repo.localPath)),
            );
            // Preserve the association id when editing a local-only path; changing
            // the path must update that link rather than create a second repo.
            actions.linkRepoToProjects([project.id], { ...repoData, id: existing?.id ?? repoData.id });
        }
        for (const project of projects.filter((project) => initial.has(project.id) && !selected.has(project.id))) {
            const match = (project.repos ?? []).find((candidate) => candidate.github && repo.owner ? candidate.github.owner.toLowerCase() === repo.owner.toLowerCase() && candidate.github.repo.toLowerCase() === repo.name.toLowerCase() : norm(projectRepoPath(project, candidate)) === norm(repo.localPath));
            if (!match) continue;
            actions.unlinkProjectRepo(project.id, match.id);
        }
        onClose();
    };
    return <Modal title="Link repository to projects" description="A repository can supply files to more than one project. Unlinking never deletes local files." icon={<Folder className="size-4" />} onClose={onClose}><div className="flex flex-col gap-4"><div className="rounded-lg px-3 py-3" style={SOFT}><p className="text-sm font-medium text-primary">{repo.fullName}</p><p className="mt-1 text-xs text-tertiary">{repo.description || "No description"}</p></div><Input label="Local repository path (optional)" value={path} onChange={setPath} placeholder="Remote only, or C:\\Projects\\repository" hint="Leave blank for a remote-only link. Absolute paths can live outside a project's root." /><ProjectChecks projects={projects} selected={selected} onChange={setSelected} label="Projects with access to this repository" /><div className="flex justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--c-border)" }}><Button size="md" color="secondary" onClick={onClose}>Cancel</Button><Button size="md" color="primary" iconLeading={Check} onClick={save}>Save project links</Button></div></div></Modal>;
}

function ProjectChecks({ projects, selected, onChange, label }: { projects: Project[]; selected: Set<string>; onChange: (value: Set<string>) => void; label: string }) {
    return <fieldset><legend className="mb-2 text-xs font-medium text-tertiary">{label}</legend>{projects.length === 0 ? <div className="rounded-lg px-3 py-5 text-center text-xs text-quaternary" style={SOFT}>Create a project before linking repositories.</div> : <div className="max-h-52 overflow-y-auto rounded-lg p-1" style={SOFT}>{projects.map((project) => { const checked = selected.has(project.id); return <label key={project.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 hover:bg-[var(--surface)]"><input type="checkbox" checked={checked} onChange={() => { const next = new Set(selected); if (checked) next.delete(project.id); else next.add(project.id); onChange(next); }} className="sr-only" /><span className={cx("grid size-4 place-items-center rounded border", checked ? "text-white" : "text-transparent")} style={{ background: checked ? "var(--brand)" : "transparent", borderColor: checked ? "var(--brand)" : "var(--c-border)" }}><Check className="size-3" /></span><Folder className="size-4 text-tertiary" /><span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">{project.name}</span><span className="text-[11px] text-quaternary">{(project.repos ?? []).length} repos</span></label>; })}</div>}</fieldset>;
}

function ConfirmModal({ action, onClose }: { action: ConfirmAction; onClose: () => void }) {
    return <Modal title={action.title} description={action.description} icon={action.danger ? <XClose className="size-4" /> : <GitBranch01 className="size-4" />} onClose={onClose}><dl className="flex flex-col gap-2 rounded-lg p-3" style={SOFT}>{action.details.map((detail) => <div key={detail.label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-3 text-xs"><dt className="text-quaternary">{detail.label}</dt><dd className="break-words font-medium text-primary">{detail.value}</dd></div>)}</dl><div className="mt-5 flex justify-end gap-2 border-t pt-4" style={{ borderColor: "var(--c-border)" }}><Button size="md" color="secondary" onClick={onClose}>Cancel</Button><Button size="md" color={action.danger ? "primary-destructive" : "primary"} onClick={() => { action.run(); onClose(); }}>{action.confirmLabel}</Button></div></Modal>;
}

function Modal({ title, description, icon, onClose, children }: { title: string; description: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
    return <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-xl rounded-2xl p-5 shadow-2xl" style={CARD}><header className="mb-5 flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg text-tertiary" style={SOFT}>{icon}</span><div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-primary">{title}</h2><p className="mt-1 text-xs leading-5 text-tertiary">{description}</p></div><button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-quaternary hover:bg-[var(--surface-2)] hover:text-secondary" aria-label="Close"><XClose className="size-4" /></button></header>{children}</section></div>;
}
