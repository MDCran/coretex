// Coretex — renderer-safe GitHub workspace aggregation.
// Uses the authenticated `gh` CLI when it is already available. It never starts
// an auth flow, reads token values, or exports credentials to the renderer.

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
    GitBranchInfo,
    GitCommitInfo,
    GithubAccountInfo,
    GithubDeploymentInfo,
    GithubOverview,
    GithubReadmeInfo,
    GithubRepositoryDetail,
    GithubRepositoryInfo,
    GithubWorkflowRunInfo,
    GitPullRequestInfo,
    GitRepoSummary,
    Project,
} from "../types.js";
import { gitBranches, gitLog, gitSummary, githubRemoteIdentity, listPullRequests } from "./git.js";

const MAX_REMOTE_REPOS = 500;
const MAX_README_BYTES = 128 * 1024;
const MAX_DETAIL_COMMITS = 60;

/** Small persisted registry of user-selected clone destinations (never a recursive disk scan). */
export class GithubCheckoutRegistry {
    private readonly file: string;
    private paths: string[] = [];
    private persistChain: Promise<void> = Promise.resolve();

    constructor(dataDir: string) {
        this.file = path.join(dataDir, "github-workspace.json");
    }

    async load(): Promise<void> {
        try {
            const parsed = JSON.parse(await readFile(this.file, "utf8")) as { paths?: unknown };
            this.paths = Array.isArray(parsed.paths)
                ? [...new Set(parsed.paths.filter((value): value is string => typeof value === "string" && path.isAbsolute(value)).map((value) => path.resolve(value)))].slice(0, 500)
                : [];
        } catch {
            this.paths = [];
        }
    }

    list(): string[] {
        return [...this.paths];
    }

    async add(repoPath: string): Promise<void> {
        if (!path.isAbsolute(repoPath)) throw new Error("Repository paths must be absolute.");
        const resolved = path.resolve(repoPath);
        const key = pathKey(resolved);
        this.paths = [resolved, ...this.paths.filter((value) => pathKey(value) !== key)].slice(0, 500);
        const snapshot = [...this.paths];
        this.persistChain = this.persistChain.then(() => this.persist(snapshot), () => this.persist(snapshot));
        await this.persistChain;
    }

    private async persist(paths: string[]): Promise<void> {
        await mkdir(path.dirname(this.file), { recursive: true });
        const body = JSON.stringify({ version: 1, paths });
        const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, body, "utf8");
        try {
            await rename(temporary, this.file);
        } catch {
            // Windows cannot replace an existing file atomically with rename.
            await writeFile(this.file, body, "utf8");
            await unlink(temporary).catch(() => undefined);
        }
    }
}

function scrubError(value: unknown): string {
    const raw = value instanceof Error ? value.message : String(value || "GitHub request failed.");
    return raw
        .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
        .replace(/([?&](?:access_token|auth|key|password|secret|signature|token)=)[^&#\s]+/gi, "$1[REDACTED]")
        .slice(0, 800);
}

function exec(command: string, args: string[], cwd = process.cwd(), timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(scrubError((stderr || error.message || String(error)).trim())));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

function gh(args: string[], cwd?: string, timeoutMs?: number): Promise<string> {
    return exec("gh", args, cwd, timeoutMs);
}

function git(args: string[], cwd?: string, timeoutMs?: number): Promise<string> {
    return exec("git", args, cwd, timeoutMs);
}

function parseJson<T>(text: string, fallback: T): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function count(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function visibility(value: unknown, isPrivate?: unknown): GithubRepositoryInfo["visibility"] {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";
    if (normalized === "public" || normalized === "private" || normalized === "internal") return normalized;
    if (typeof isPrivate === "boolean") return isPrivate ? "private" : "public";
    return "unknown";
}

function githubName(value: string): { owner: string; name: string; fullName: string } | null {
    const clean = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/^git@github\.com:/i, "").replace(/\.git\/?$/i, "").replace(/\/+$/, "");
    const match = clean.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    return match ? { owner: match[1]!, name: match[2]!, fullName: `${match[1]}/${match[2]}` } : null;
}

export function normalizeGithubClone(value: string): { owner: string; name: string; fullName: string; cloneUrl: string } | null {
    const clean = value.trim();
    if (clean.includes("\0") || clean.startsWith("-") || clean.length > 1_000) return null;
    const parsed = githubName(clean);
    if (!parsed) return null;
    const isSsh = /^git@github\.com:/i.test(clean);
    const isHttps = /^https:\/\/github\.com\//i.test(clean);
    const isShort = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(clean);
    if (!isSsh && !isHttps && !isShort) return null;
    return {
        ...parsed,
        cloneUrl: isSsh ? `git@github.com:${parsed.fullName}.git` : `https://github.com/${parsed.fullName}.git`,
    };
}

type ApiUser = { login?: unknown; name?: unknown; avatar_url?: unknown; html_url?: unknown };
type ApiRepo = {
    id?: unknown;
    name?: unknown;
    full_name?: unknown;
    owner?: { login?: unknown };
    description?: unknown;
    html_url?: unknown;
    clone_url?: unknown;
    ssh_url?: unknown;
    visibility?: unknown;
    private?: unknown;
    default_branch?: unknown;
    language?: unknown;
    stargazers_count?: unknown;
    forks_count?: unknown;
    open_issues_count?: unknown;
    updated_at?: unknown;
    pushed_at?: unknown;
    fork?: unknown;
    archived?: unknown;
};

function accountFromApi(raw: ApiUser): GithubAccountInfo | null {
    const login = text(raw.login);
    if (!login) return null;
    return { login, name: text(raw.name), avatarUrl: text(raw.avatar_url), url: text(raw.html_url) };
}

function repositoryFromApi(raw: ApiRepo): GithubRepositoryInfo | null {
    const fullName = text(raw.full_name);
    const parsed = fullName ? githubName(fullName) : null;
    const owner = parsed?.owner ?? text(raw.owner?.login);
    const name = parsed?.name ?? text(raw.name);
    if (!owner || !name) return null;
    const canonical = `${owner}/${name}`;
    const apiId = typeof raw.id === "number" || typeof raw.id === "string" ? String(raw.id) : null;
    return {
        id: apiId ?? `github:${canonical.toLowerCase()}`,
        owner,
        name,
        fullName: canonical,
        description: text(raw.description),
        url: text(raw.html_url) ?? `https://github.com/${canonical}`,
        cloneUrl: text(raw.clone_url) ?? `https://github.com/${canonical}.git`,
        sshUrl: text(raw.ssh_url) ?? `git@github.com:${canonical}.git`,
        visibility: visibility(raw.visibility, raw.private),
        defaultBranch: text(raw.default_branch),
        language: text(raw.language),
        stargazers: count(raw.stargazers_count),
        forks: count(raw.forks_count),
        openIssues: count(raw.open_issues_count),
        updatedAt: text(raw.updated_at),
        pushedAt: text(raw.pushed_at),
        isFork: raw.fork === true,
        isArchived: raw.archived === true,
        localPath: null,
        localPaths: [],
        projectIds: [],
    };
}

type LocalRepo = {
    path: string;
    projectIds: string[];
    displayName: string;
    configuredGithub: string | null;
    configuredVisibility: "public" | "private" | undefined;
    summary: GitRepoSummary;
};

function pathKey(value: string): string {
    const normalized = path.resolve(value);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function mapLimit<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
    const result = new Array<R>(values.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < values.length) {
            const index = next++;
            result[index] = await mapper(values[index]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
    return result;
}

async function knownLocalRepos(projects: Project[], extraPaths: string[]): Promise<LocalRepo[]> {
    const candidates = new Map<string, Omit<LocalRepo, "summary">>();
    const add = (repoPath: string, displayName: string, projectId?: string, configuredGithub?: string | null, configuredVisibility?: "public" | "private"): void => {
        if (!path.isAbsolute(repoPath)) return;
        const resolved = path.resolve(repoPath);
        const key = pathKey(resolved);
        const current = candidates.get(key) ?? {
            path: resolved,
            projectIds: [],
            displayName: displayName || path.basename(resolved),
            configuredGithub: configuredGithub ?? null,
            configuredVisibility,
        };
        if (projectId && !current.projectIds.includes(projectId)) current.projectIds.push(projectId);
        current.configuredGithub ??= configuredGithub ?? null;
        current.configuredVisibility ??= configuredVisibility;
        candidates.set(key, current);
    };

    for (const project of projects) {
        const repos = project.repos?.length
            ? project.repos
            : project.sourcePath
              ? [{ name: project.name, path: ".", github: null, visibility: undefined }]
              : [];
        for (const repo of repos) {
            // An empty path is an explicit remote-only association. It must not
            // accidentally resolve to the project root and claim that checkout.
            if (!repo.path.trim()) continue;
            const repoPath = path.isAbsolute(repo.path) ? repo.path : project.sourcePath ? path.resolve(project.sourcePath, repo.path) : "";
            if (!repoPath) continue;
            const configured = repo.github?.owner && repo.github.repo ? `${repo.github.owner}/${repo.github.repo}` : null;
            add(repoPath, repo.name || project.name, project.id, configured, repo.visibility);
        }
    }
    for (const extraPath of extraPaths) if (path.isAbsolute(extraPath)) add(extraPath, path.basename(extraPath));

    const inspected = await mapLimit([...candidates.values()], 6, async (candidate): Promise<LocalRepo | null> => {
        const summary = await gitSummary(candidate.path).catch(() => null);
        return summary?.isRepo ? { ...candidate, path: summary.cwd, summary } : null;
    });

    // Multiple configured paths may resolve into the same enclosing worktree.
    const byRoot = new Map<string, LocalRepo>();
    for (const entry of inspected) {
        if (!entry) continue;
        const key = pathKey(entry.path);
        const current = byRoot.get(key);
        if (!current) byRoot.set(key, entry);
        else {
            current.projectIds = [...new Set([...current.projectIds, ...entry.projectIds])];
            current.configuredGithub ??= entry.configuredGithub;
            current.configuredVisibility ??= entry.configuredVisibility;
        }
    }
    return [...byRoot.values()];
}

async function remoteRepositories(): Promise<GithubRepositoryInfo[]> {
    const output = await gh([
        "api",
        "--paginate",
        "--slurp",
        "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=updated",
    ], undefined, 60_000);
    const pages = parseJson<unknown>(output, []);
    const flat = Array.isArray(pages) ? pages.flatMap((page) => Array.isArray(page) ? page : [page]) : [];
    const deduped = new Map<string, GithubRepositoryInfo>();
    for (const raw of flat.slice(0, MAX_REMOTE_REPOS * 2)) {
        const repo = repositoryFromApi((raw ?? {}) as ApiRepo);
        if (repo) deduped.set(repo.fullName.toLowerCase(), repo);
        if (deduped.size >= MAX_REMOTE_REPOS) break;
    }
    return [...deduped.values()];
}

function localRepositoryInfo(local: LocalRepo): GithubRepositoryInfo {
    const github = local.summary.github ? githubName(`${local.summary.github.owner}/${local.summary.github.repo}`) : local.configuredGithub ? githubName(local.configuredGithub) : null;
    const fullName = github?.fullName ?? local.displayName;
    const remoteUrl = local.summary.github?.url ?? (github ? `https://github.com/${github.fullName}` : null);
    return {
        id: github ? `github:${github.fullName.toLowerCase()}` : `local:${pathKey(local.path)}`,
        owner: github?.owner ?? null,
        name: github?.name ?? local.displayName,
        fullName,
        description: null,
        url: github ? `https://github.com/${github.fullName}` : null,
        cloneUrl: github ? (remoteUrl?.startsWith("git@") ? remoteUrl : `https://github.com/${github.fullName}.git`) : null,
        sshUrl: github ? `git@github.com:${github.fullName}.git` : null,
        visibility: local.configuredVisibility ?? "unknown",
        defaultBranch: local.summary.branch,
        language: null,
        stargazers: 0,
        forks: 0,
        openIssues: 0,
        updatedAt: null,
        pushedAt: null,
        isFork: false,
        isArchived: false,
        localPath: local.path,
        localPaths: [local.path],
        projectIds: [...local.projectIds],
        summary: local.summary,
    };
}

function mergeLocal(remote: GithubRepositoryInfo, local: GithubRepositoryInfo): GithubRepositoryInfo {
    const localPaths = [...new Set([...remote.localPaths, ...local.localPaths])];
    return {
        ...remote,
        localPath: remote.localPath ?? local.localPath,
        localPaths,
        projectIds: [...new Set([...remote.projectIds, ...local.projectIds])],
        summary: local.summary ?? remote.summary,
    };
}

export async function githubOverview(projects: Project[], extraPaths: string[] = []): Promise<GithubOverview> {
    const locals = (await knownLocalRepos(projects, extraPaths)).map(localRepositoryInfo);
    let cliAvailable = false;
    let connected = false;
    let account: GithubAccountInfo | null = null;
    let remote: GithubRepositoryInfo[] = [];
    let error: string | undefined;

    try {
        await gh(["--version"]);
        cliAvailable = true;
        const user = parseJson<ApiUser>(await gh(["api", "user"]), {});
        account = accountFromApi(user);
        connected = account !== null;
        if (connected) remote = await remoteRepositories();
    } catch (reason) {
        error = scrubError(reason);
    }

    const repositories = new Map<string, GithubRepositoryInfo>();
    for (const repo of remote) repositories.set(repo.fullName.toLowerCase(), repo);
    for (const local of locals) {
        const key = local.owner ? local.fullName.toLowerCase() : local.id;
        repositories.set(key, repositories.has(key) ? mergeLocal(repositories.get(key)!, local) : local);
    }

    const rows = [...repositories.values()].sort((a, b) => {
        if (Boolean(a.localPath) !== Boolean(b.localPath)) return a.localPath ? -1 : 1;
        return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.fullName.localeCompare(b.fullName);
    });
    return { cliAvailable, connected, account, repositories: rows, checkedAt: Date.now(), ...(error ? { error } : {}) };
}

async function localReadme(repoPath: string): Promise<GithubReadmeInfo | null> {
    try {
        const names = (await readdir(repoPath)).filter((name) => /^readme(?:\.[^.]+)?$/i.test(name)).sort((a, b) => a.localeCompare(b));
        const name = names[0];
        if (!name) return null;
        const filePath = path.join(repoPath, name);
        const data = await readFile(filePath);
        const truncated = data.length > MAX_README_BYTES;
        return { name, content: data.subarray(0, MAX_README_BYTES).toString("utf8"), truncated, url: null };
    } catch {
        return null;
    }
}

async function remoteReadme(fullName: string): Promise<GithubReadmeInfo | null> {
    type ApiReadme = { name?: unknown; content?: unknown; encoding?: unknown; html_url?: unknown };
    try {
        const raw = parseJson<ApiReadme>(await gh(["api", `repos/${fullName}/readme`]), {});
        const encoded = text(raw.content)?.replace(/\s+/g, "") ?? "";
        if (!encoded || raw.encoding !== "base64") return null;
        const data = Buffer.from(encoded, "base64");
        return {
            name: text(raw.name) ?? "README",
            content: data.subarray(0, MAX_README_BYTES).toString("utf8"),
            truncated: data.length > MAX_README_BYTES,
            url: text(raw.html_url),
        };
    } catch {
        return null;
    }
}

async function remoteCommits(fullName: string): Promise<GitCommitInfo[]> {
    type ApiCommit = {
        sha?: unknown;
        html_url?: unknown;
        commit?: { message?: unknown; author?: { name?: unknown; email?: unknown; date?: unknown } };
        author?: { login?: unknown };
        parents?: { sha?: unknown }[];
    };
    const raw = parseJson<ApiCommit[]>(await gh(["api", `repos/${fullName}/commits?per_page=${MAX_DETAIL_COMMITS}`]), []);
    return raw.slice(0, MAX_DETAIL_COMMITS).flatMap((row) => {
        const sha = text(row.sha);
        if (!sha) return [];
        const message = text(row.commit?.message) ?? "Commit";
        return [{
            shortSha: sha.slice(0, 7),
            sha,
            parents: (row.parents ?? []).map((parent) => text(parent.sha)).filter((value): value is string => Boolean(value)),
            url: text(row.html_url) ?? undefined,
            author: text(row.author?.login) ?? text(row.commit?.author?.name) ?? "Unknown",
            email: text(row.commit?.author?.email) ?? "",
            date: text(row.commit?.author?.date) ?? "",
            refs: [],
            subject: message.split(/\r?\n/, 1)[0]!,
            files: [],
            additions: 0,
            deletions: 0,
        }];
    });
}

async function remoteBranches(fullName: string): Promise<GitBranchInfo[]> {
    type ApiBranch = { name?: unknown; commit?: { sha?: unknown } };
    const raw = parseJson<ApiBranch[]>(await gh(["api", `repos/${fullName}/branches?per_page=100`]), []);
    return raw.slice(0, 100).flatMap((row) => {
        const name = text(row.name);
        return name ? [{ name, current: false, remote: true, upstream: null, sha: text(row.commit?.sha), date: null, subject: null }] : [];
    });
}

async function remotePullRequests(fullName: string): Promise<GitPullRequestInfo[]> {
    type GhPr = {
        number?: unknown; title?: unknown; state?: unknown; url?: unknown; author?: { login?: unknown };
        headRefName?: unknown; baseRefName?: unknown; isDraft?: unknown; createdAt?: unknown; updatedAt?: unknown;
        mergeStateStatus?: unknown; reviewDecision?: unknown;
    };
    const raw = parseJson<GhPr[]>(await gh([
        "pr", "list", "--repo", fullName, "--state", "all", "--limit", "50",
        "--json", "number,title,state,url,author,headRefName,baseRefName,isDraft,createdAt,updatedAt,mergeStateStatus,reviewDecision",
    ]), []);
    return raw.flatMap((row) => typeof row.number === "number" ? [{
        number: row.number,
        title: text(row.title) ?? `Pull request #${row.number}`,
        state: text(row.state) ?? "UNKNOWN",
        url: text(row.url) ?? `https://github.com/${fullName}/pull/${row.number}`,
        author: text(row.author?.login) ?? "",
        branch: text(row.headRefName) ?? "",
        baseBranch: text(row.baseRefName) ?? undefined,
        isDraft: row.isDraft === true,
        createdAt: text(row.createdAt) ?? undefined,
        updatedAt: text(row.updatedAt) ?? undefined,
        mergeStateStatus: text(row.mergeStateStatus) ?? undefined,
        reviewDecision: text(row.reviewDecision) ?? undefined,
    }] : []);
}

export async function githubDeployments(fullName: string): Promise<{ deployments: GithubDeploymentInfo[]; workflows: GithubWorkflowRunInfo[] }> {
    const parsed = githubName(fullName);
    if (!parsed) throw new Error("Choose a valid owner/repository.");
    type ApiDeployment = { id?: unknown; environment?: unknown; ref?: unknown; sha?: unknown; description?: unknown; creator?: { login?: unknown }; created_at?: unknown; updated_at?: unknown; statuses_url?: unknown };
    type ApiStatus = { state?: unknown; environment_url?: unknown; target_url?: unknown; updated_at?: unknown };
    type ApiRuns = { workflow_runs?: Array<{ id?: unknown; name?: unknown; display_title?: unknown; event?: unknown; head_branch?: unknown; head_sha?: unknown; status?: unknown; conclusion?: unknown; created_at?: unknown; updated_at?: unknown; html_url?: unknown }> };

    const [deploymentText, workflowText] = await Promise.all([
        gh(["api", `repos/${parsed.fullName}/deployments?per_page=30`]),
        gh(["api", `repos/${parsed.fullName}/actions/runs?per_page=30`]),
    ]);
    const rawDeployments = parseJson<ApiDeployment[]>(deploymentText, []).slice(0, 30);
    const statusRows = await mapLimit(rawDeployments, 5, async (deployment): Promise<ApiStatus | null> => {
        const id = typeof deployment.id === "number" || typeof deployment.id === "string" ? String(deployment.id) : "";
        if (!id || !/^\d+$/.test(id)) return null;
        return parseJson<ApiStatus[]>(await gh(["api", `repos/${parsed.fullName}/deployments/${id}/statuses?per_page=1`]).catch(() => "[]"), [])[0] ?? null;
    });
    const deployments = rawDeployments.flatMap((row, index) => {
        const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id) : "";
        if (!id) return [];
        const status = statusRows[index];
        return [{
            id,
            environment: text(row.environment) ?? "Production",
            state: text(status?.state) ?? "pending",
            ref: text(row.ref) ?? "",
            sha: text(row.sha) ?? "",
            description: text(row.description),
            creator: text(row.creator?.login),
            createdAt: text(row.created_at),
            updatedAt: text(status?.updated_at) ?? text(row.updated_at),
            url: text(status?.environment_url) ?? text(status?.target_url),
        }];
    });
    const rawRuns = parseJson<ApiRuns>(workflowText, {}).workflow_runs ?? [];
    const workflows = rawRuns.slice(0, 30).flatMap((row) => {
        const id = typeof row.id === "number" || typeof row.id === "string" ? String(row.id) : "";
        if (!id) return [];
        return [{
            id,
            name: text(row.display_title) ?? text(row.name) ?? "Workflow run",
            workflowName: text(row.name) ?? "Workflow",
            event: text(row.event) ?? "",
            branch: text(row.head_branch),
            sha: text(row.head_sha) ?? "",
            status: text(row.status) ?? "unknown",
            conclusion: text(row.conclusion),
            createdAt: text(row.created_at),
            updatedAt: text(row.updated_at),
            url: text(row.html_url),
        }];
    });
    return { deployments, workflows };
}

export async function githubRepositoryDetail(projects: Project[], input: { fullName?: string; path?: string }): Promise<GithubRepositoryDetail> {
    const localPath = input.path && path.isAbsolute(input.path) ? path.resolve(input.path) : null;
    let summary = localPath ? await gitSummary(localPath).catch(() => null) : null;
    if (summary && !summary.isRepo) summary = null;
    const requested = input.fullName ? githubName(input.fullName) : summary?.github ? githubName(`${summary.github.owner}/${summary.github.repo}`) : null;
    if (!requested && !summary) throw new Error("Choose a local repository or owner/repository.");
    if (summary && requested) {
        const expected = requested.fullName.toLowerCase();
        const matches = summary.remotes.some((remote) => {
            const identity = githubRemoteIdentity(remote.url);
            return identity ? `${identity.owner}/${identity.repo}`.toLowerCase() === expected : false;
        });
        if (!matches) throw new Error(`The selected checkout is not linked to ${requested.fullName}. Repository details were not mixed.`);
    }

    let repository: GithubRepositoryInfo | null = null;
    if (requested) {
        const remoteText = await gh(["api", `repos/${requested.fullName}`]).catch(() => "");
        if (remoteText) repository = repositoryFromApi(parseJson<ApiRepo>(remoteText, {}));
    }
    if (!repository && summary) {
        repository = localRepositoryInfo({
            path: summary.cwd,
            projectIds: [],
            displayName: path.basename(summary.cwd),
            configuredGithub: requested?.fullName ?? null,
            configuredVisibility: undefined,
            summary,
        });
    }
    if (!repository) throw new Error("Repository metadata is unavailable.");

    const known = await knownLocalRepos(projects, []);
    const matches = known.filter((entry) => {
        if (summary && pathKey(entry.path) === pathKey(summary.cwd)) return true;
        const linked = entry.summary.github ? `${entry.summary.github.owner}/${entry.summary.github.repo}` : entry.configuredGithub;
        return requested && linked?.toLowerCase() === requested.fullName.toLowerCase();
    });
    if (matches.length) {
        const localInfo = localRepositoryInfo(matches[0]!);
        localInfo.localPaths = [...new Set(matches.map((entry) => entry.path))];
        localInfo.projectIds = [...new Set(matches.flatMap((entry) => entry.projectIds))];
        repository = mergeLocal(repository, localInfo);
        summary ??= matches[0]!.summary;
    } else if (summary) repository = mergeLocal(repository, localRepositoryInfo({ path: summary.cwd, projectIds: [], displayName: path.basename(summary.cwd), configuredGithub: requested?.fullName ?? null, configuredVisibility: undefined, summary }));

    const fullName = requested?.fullName ?? (repository.owner ? repository.fullName : null);
    const [readme, commits, branches, pullRequests, deployData] = await Promise.all([
        summary ? localReadme(summary.cwd) : fullName ? remoteReadme(fullName) : Promise.resolve(null),
        summary ? gitLog(summary.cwd, MAX_DETAIL_COMMITS) : fullName ? remoteCommits(fullName) : Promise.resolve([]),
        summary ? gitBranches(summary.cwd) : fullName ? remoteBranches(fullName) : Promise.resolve([]),
        summary ? (fullName ? listPullRequests(summary.cwd, fullName) : Promise.resolve([])) : fullName ? remotePullRequests(fullName) : Promise.resolve([]),
        fullName
            ? githubDeployments(fullName).catch((reason: unknown) => ({
                  deployments: [],
                  workflows: [],
                  deploymentsError: scrubError(reason),
              }))
            : Promise.resolve({ deployments: [], workflows: [] }),
    ]);
    if (fullName) {
        for (const commit of commits) commit.url ??= `https://github.com/${fullName}/commit/${commit.sha}`;
        if (readme && !readme.url) readme.url = `https://github.com/${fullName}/blob/${repository.defaultBranch ?? "HEAD"}/${encodeURIComponent(readme.name)}`;
    }
    return { repository, readme, commits, branches, pullRequests, ...deployData };
}

/** Clone only GitHub HTTPS/SSH or owner/repository inputs into an explicit absolute path. */
export async function cloneGithubRepository(value: string, destinationPath: string): Promise<string> {
    const remote = normalizeGithubClone(value);
    if (!remote) throw new Error("Use owner/repository, an https://github.com URL, or a git@github.com SSH URL.");
    if (!path.isAbsolute(destinationPath) || destinationPath.includes("\0")) throw new Error("Choose an absolute local destination folder.");
    const destination = path.resolve(destinationPath);
    if (destination === path.parse(destination).root) throw new Error("A drive root cannot be used as a clone destination.");
    const parent = path.dirname(destination);
    const parentStat = await stat(parent).catch(() => null);
    if (!parentStat?.isDirectory()) throw new Error("The destination's parent folder does not exist.");
    const destinationStat = await stat(destination).catch(() => null);
    if (destinationStat) {
        if (!destinationStat.isDirectory()) throw new Error("The destination already exists and is not a folder.");
        if ((await readdir(destination)).length > 0) throw new Error("The destination folder must be empty.");
    }
    await git(["clone", "--origin", "origin", "--", remote.cloneUrl, destination], parent, 10 * 60_000);
    const root = (await git(["-C", destination, "rev-parse", "--show-toplevel"], parent)).trim();
    if (pathKey(root) !== pathKey(destination)) throw new Error("Git cloned to an unexpected location.");
    return root;
}
