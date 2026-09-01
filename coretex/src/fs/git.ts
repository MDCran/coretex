// Coretex — git CLI helpers for Files emblems + project Source Control.
// Shells out to system `git` (no extra dependency); degrades gracefully.

import { execFile } from "node:child_process";
import path from "node:path";
import type { GitBranchInfo, GitCommitInfo, GitFileChange, GitRepoSummary, GitStatusCode } from "../types.js";

function scrubSensitive(value: string): string {
    return value
        .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}\b/g, "[REDACTED]")
        .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
        .replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/gi, "$1")
        .replace(/([?&](?:access_token|auth|key|password|secret|signature|token)=)[^&#\s]+/gi, "$1[REDACTED]");
}

function publicRemoteUrl(value: string): string {
    const clean = value.trim();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(clean)) {
        try {
            const parsed = new URL(clean);
            parsed.username = "";
            parsed.password = "";
            parsed.search = "";
            parsed.hash = "";
            return scrubSensitive(parsed.toString().replace(/\/$/, ""));
        } catch {
            // Fall through to conservative string redaction for malformed URLs.
        }
    }
    // Preserve the conventional git@host:path SCP spelling, but never expose a
    // password-bearing or otherwise unusual user-info segment to the renderer.
    const scp = clean.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
    if (scp) {
        const [, userInfo, host, remotePath] = scp;
        return scrubSensitive(userInfo === "git" ? `git@${host}:${remotePath}` : `${host}:${remotePath}`);
    }
    return scrubSensitive(clean.replace(/(^|\s)[^\s/@:]+:[^\s/@]+@/g, "$1[REDACTED]@"));
}

function run(dir: string, args: string[], timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "git",
            ["-C", dir, ...args],
            { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
            (err, stdout, stderr) => {
                if (err) {
                    const msg = scrubSensitive((stderr || err.message || String(err)).trim());
                    reject(new Error(msg || "git failed"));
                } else resolve(stdout);
            },
        );
    });
}

function runGh(dir: string, args: string[], timeoutMs = 120_000): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            "gh",
            args,
            { cwd: dir, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
            (err, stdout, stderr) => {
                if (err) reject(new Error(scrubSensitive((stderr || err.message || String(err)).trim()) || "gh failed"));
                else resolve(stdout.trim());
            },
        );
    });
}

/** Map a 2-char porcelain XY code to a normalized emblem code. */
function classify(xy: string): GitStatusCode {
    if (xy === "??") return "untracked";
    if (xy === "!!") return "ignored";
    const x = xy[0];
    const y = xy[1];
    if (x === "U" || y === "U" || xy === "AA" || xy === "DD") return "conflict";
    if (x === "R" || y === "R") return "renamed";
    if (x === "A" || y === "A") return "added";
    if (x === "D" || y === "D") return "deleted";
    if (x === "M" || y === "M") return "modified";
    return "modified";
}

function toPosix(p: string): string {
    return p.replace(/\\/g, "/");
}

/** Parse `git diff --numstat` / `--cached --numstat` into path → {add, del}. */
function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const addRaw = parts[0]!;
        const delRaw = parts[1]!;
        // Renames appear as "old => new" in the path column.
        let filePath = parts.slice(2).join("\t");
        const rename = filePath.match(/\{(.+)\s=>\s(.+)\}/);
        if (rename) {
            // Prefer the new path.
            filePath = filePath.replace(/\{.+\s=>\s(.+)\}/, "$1");
        } else if (filePath.includes(" => ")) {
            filePath = filePath.split(" => ").pop() ?? filePath;
        }
        filePath = toPosix(filePath.trim());
        const additions = addRaw === "-" ? 0 : Number(addRaw) || 0;
        const deletions = delRaw === "-" ? 0 : Number(delRaw) || 0;
        const prev = map.get(filePath) ?? { additions: 0, deletions: 0 };
        map.set(filePath, { additions: prev.additions + additions, deletions: prev.deletions + deletions });
    }
    return map;
}

export interface GitStatus {
    repoRoot: string | null;
    /** Absolute path → normalized status code. */
    statuses: Record<string, GitStatusCode>;
}

/** Read the git status of the repo containing `dir`, keyed by absolute path. */
export async function gitStatus(dir: string): Promise<GitStatus> {
    let repoRoot: string;
    try {
        repoRoot = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
        return { repoRoot: null, statuses: {} };
    }
    if (!repoRoot) return { repoRoot: null, statuses: {} };

    const statuses: Record<string, GitStatusCode> = {};
    try {
        const out = await run(repoRoot, ["status", "--porcelain", "--ignored", "-z"]);
        const tokens = out.split("\0");
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            if (tok.length < 4) continue;
            const xy = tok.slice(0, 2);
            const rel = tok.slice(3);
            if (xy[0] === "R" || xy[0] === "C") i++;
            const abs = path.resolve(repoRoot, rel);
            statuses[abs] = classify(xy);
        }
    } catch {
        // mid-rebase etc.
    }
    return { repoRoot, statuses };
}

export function githubRemoteIdentity(url: string): { owner: string; repo: string; url: string } | null {
    const cleaned = publicRemoteUrl(url).replace(/\.git$/, "");
    const ssh = cleaned.match(/^git@github\.com:([^/]+)\/(.+)$/i);
    if (ssh) return { owner: ssh[1]!, repo: ssh[2]!, url: cleaned };
    try {
        const parsed = new URL(cleaned);
        if (parsed.hostname.toLowerCase() !== "github.com" && parsed.hostname.toLowerCase() !== "www.github.com") return null;
        const [owner, repo] = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (owner && repo) return { owner, repo: repo.replace(/\.git$/i, ""), url: cleaned };
    } catch {
        // Not a URL with an explicit scheme.
    }
    return null;
}

function emptySummary(dir: string, error?: string): GitRepoSummary {
    return {
        cwd: dir,
        isRepo: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicts: 0,
        additions: 0,
        deletions: 0,
        files: [],
        headSha: null,
        headSubject: null,
        remotes: [],
        github: null,
        ...(error ? { error } : {}),
    };
}

/** High-level repo snapshot for the Source Control UI (GitHub Desktop–style). */
export async function gitSummary(dir: string): Promise<GitRepoSummary> {
    let root: string;
    try {
        root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
        return emptySummary(dir, "Not a git repository");
    }

    const branch = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD")).trim();
    let upstream: string | null = null;
    let ahead = 0;
    let behind = 0;
    try {
        upstream = (await run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
        const ab = (await run(root, ["rev-list", "--left-right", "--count", `${upstream}...HEAD`])).trim();
        const [b, a] = ab.split(/\s+/).map((n) => Number(n) || 0);
        behind = b ?? 0;
        ahead = a ?? 0;
    } catch {
        // no upstream
    }

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    let conflicts = 0;
    const filesByPath = new Map<string, GitFileChange>();
    try {
        const porcelain = await run(root, ["status", "--porcelain", "-z"]);
        const tokens = porcelain.split("\0").filter(Boolean);
        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i]!;
            if (tok.length < 3) continue;
            const xy = tok.slice(0, 2);
            let rel = tok.slice(3);
            // Rename/copy: next token is the "from" path; current rel is "to".
            if (xy[0] === "R" || xy[0] === "C") {
                i++;
                // keep `rel` as the destination path
            }
            rel = toPosix(rel);
            const status = classify(xy);
            const isStaged = xy[0] !== " " && xy[0] !== "?" && xy !== "??";
            const isUnstaged = xy === "??" || (xy[1] !== " " && xy[1] !== "?");
            if (xy === "??") untracked++;
            else if (xy[0] === "U" || xy[1] === "U" || xy === "AA" || xy === "DD") conflicts++;
            else {
                if (isStaged) staged++;
                if (isUnstaged) unstaged++;
            }
            const prev = filesByPath.get(rel);
            filesByPath.set(rel, {
                path: rel,
                status: prev?.status === "conflict" ? "conflict" : status,
                staged: (prev?.staged ?? false) || isStaged,
                unstaged: (prev?.unstaged ?? false) || isUnstaged,
                additions: prev?.additions ?? 0,
                deletions: prev?.deletions ?? 0,
            });
        }
    } catch {
        /* ignore */
    }

    // Line-level adds/removes for staged + unstaged (and treat untracked as +N when possible).
    try {
        const [unstagedStat, stagedStat] = await Promise.all([
            run(root, ["diff", "--numstat"]).then(parseNumstat).catch(() => new Map()),
            run(root, ["diff", "--cached", "--numstat"]).then(parseNumstat).catch(() => new Map()),
        ]);
        const mergeStat = (stats: Map<string, { additions: number; deletions: number }>) => {
            for (const [p, s] of stats) {
                const cur = filesByPath.get(p) ?? {
                    path: p,
                    status: "modified" as GitStatusCode,
                    staged: false,
                    unstaged: true,
                    additions: 0,
                    deletions: 0,
                };
                cur.additions += s.additions;
                cur.deletions += s.deletions;
                filesByPath.set(p, cur);
            }
        };
        mergeStat(unstagedStat);
        mergeStat(stagedStat);
    } catch {
        /* ignore */
    }

    const files = [...filesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const additions = files.reduce((n, f) => n + f.additions, 0);
    const deletions = files.reduce((n, f) => n + f.deletions, 0);

    let headSha: string | null = null;
    let headSubject: string | null = null;
    try {
        headSha = (await run(root, ["rev-parse", "--short", "HEAD"])).trim();
        headSubject = (await run(root, ["log", "-1", "--pretty=%s"])).trim();
    } catch {
        /* empty repo */
    }

    const remotes: { name: string; url: string; fetch: boolean; push: boolean }[] = [];
    let github: GitRepoSummary["github"] = null;
    try {
        const remoteOut = await run(root, ["remote", "-v"]);
        const seen = new Map<string, { name: string; url: string; fetch: boolean; push: boolean }>();
        for (const line of remoteOut.split(/\r?\n/).filter(Boolean)) {
            const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
            if (!m) continue;
            const [, name, rawUrl, kind] = m;
            const url = publicRemoteUrl(rawUrl!);
            const cur = seen.get(name!) ?? { name: name!, url, fetch: false, push: false };
            if (kind === "fetch") cur.fetch = true;
            if (kind === "push") cur.push = true;
            cur.url = url;
            seen.set(name!, cur);
            if (!github) {
                const gh = githubRemoteIdentity(url);
                if (gh) github = gh;
            }
        }
        remotes.push(...seen.values());
    } catch {
        /* no remotes */
    }

    return {
        cwd: root,
        isRepo: true,
        branch: branch === "HEAD" ? null : branch,
        upstream,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
        conflicts,
        additions,
        deletions,
        files,
        headSha,
        headSubject,
        remotes,
        github,
    };
}

export async function gitBranches(dir: string): Promise<GitBranchInfo[]> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const out = await run(root, ["for-each-ref", "--format=%(refname)|%(refname:short)|%(HEAD)|%(upstream:short)|%(objectname:short)|%(committerdate:iso-strict)|%(subject)", "refs/heads", "refs/remotes"]);
    const rows: GitBranchInfo[] = [];
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const [refName, name, head, upstream, sha, date, ...rest] = line.split("|");
        if (!refName || !name) continue;
        const isRemote = refName.startsWith("refs/remotes/");
        rows.push({
            name,
            current: head === "*",
            remote: isRemote,
            upstream: upstream || null,
            sha: sha || null,
            date: date || null,
            subject: rest.join("|") || null,
        });
    }
    return rows;
}

export async function gitLog(dir: string, limit = 40): Promise<GitCommitInfo[]> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const sep = "\x1f";
    const n = Math.max(1, Math.min(200, limit));
    // Pretty headers + name-status so we can attach file lists + line stats without N round-trips.
    const out = await run(root, [
        "log",
        `--pretty=format:${sep}%h${sep}%H${sep}%P${sep}%an${sep}%ae${sep}%aI${sep}%D${sep}%s`,
        `--numstat`,
        `-n`,
        String(n),
    ]);

    const commits: GitCommitInfo[] = [];
    let current: GitCommitInfo | null = null;

    for (const raw of out.split(/\r?\n/)) {
        if (raw.startsWith(sep)) {
            const line = raw.slice(sep.length);
            const [shortSha, sha, parentShas, author, email, date, refs, ...subj] = line.split(sep);
            current = {
                shortSha: shortSha ?? "",
                sha: sha ?? "",
                parents: (parentShas ?? "").split(/\s+/).filter(Boolean),
                author: author ?? "",
                email: email ?? "",
                date: date ?? "",
                refs: (refs ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                subject: subj.join(sep) ?? "",
                files: [],
                additions: 0,
                deletions: 0,
            };
            commits.push(current);
            continue;
        }
        if (!current || !raw.trim()) continue;
        const parts = raw.split("\t");
        if (parts.length < 3) continue;
        const addRaw = parts[0]!;
        const delRaw = parts[1]!;
        let filePath = parts.slice(2).join("\t");
        if (filePath.includes(" => ")) filePath = filePath.split(" => ").pop() ?? filePath;
        filePath = toPosix(filePath.trim());
        const add = addRaw === "-" ? 0 : Number(addRaw) || 0;
        const del = delRaw === "-" ? 0 : Number(delRaw) || 0;
        current.additions = (current.additions ?? 0) + add;
        current.deletions = (current.deletions ?? 0) + del;
        if ((current.files?.length ?? 0) < 40) current.files = [...(current.files ?? []), filePath];
    }

    return commits;
}

export async function gitCheckout(dir: string, branch: string, create = false): Promise<void> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    await validateBranch(root, branch);
    if (create) await run(root, ["switch", "--create", branch]);
    else await run(root, ["switch", branch]);
}

function normalizeGithubFullName(value: string): string {
    const clean = value.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git\/?$/i, "").replace(/\/+$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(clean)) throw new Error("Choose a valid GitHub owner/repository.");
    return clean;
}

interface NamedRemoteDestinations {
    name: string;
    urls: string[];
    github: Array<string | null>;
}

async function namedRemotes(root: string, kind: "fetch" | "push"): Promise<NamedRemoteDestinations[]> {
    const out = await run(root, ["remote", "-v"]);
    const seen = new Map<string, { name: string; urls: string[]; github: Array<string | null> }>();
    for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const match = line.match(new RegExp(`^(\\S+)\\s+(\\S+)\\s+\\(${kind}\\)$`));
        if (!match) continue;
        const [, name, rawUrl] = match;
        const url = publicRemoteUrl(rawUrl!);
        const identity = githubRemoteIdentity(url);
        const current = seen.get(name!) ?? { name: name!, urls: [], github: [] };
        if (!current.urls.includes(url)) {
            current.urls.push(url);
            current.github.push(identity ? `${identity.owner}/${identity.repo}`.toLowerCase() : null);
        }
        seen.set(name!, current);
    }
    return [...seen.values()];
}

async function selectRemote(root: string, kind: "fetch" | "push", expectedGithubFullName?: string): Promise<string> {
    const remotes = await namedRemotes(root, kind);
    if (remotes.length === 0) throw new Error(`Add a ${kind} remote before continuing.`);
    let candidates = remotes;
    if (expectedGithubFullName) {
        const expected = normalizeGithubFullName(expectedGithubFullName).toLowerCase();
        candidates = remotes.filter((remote) => remote.github.length > 0 && remote.github.every((identity) => identity === expected));
        if (candidates.length === 0) throw new Error(`This checkout has no unambiguous ${kind} remote for ${expectedGithubFullName}. Nothing was changed.`);
    }
    const upstream = await run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then((value) => value.trim()).catch(() => "");
    const upstreamRemote = upstream.includes("/") ? upstream.slice(0, upstream.indexOf("/")) : "";
    const selected = candidates.find((remote) => remote.name === upstreamRemote)
        ?? candidates.find((remote) => remote.name === "origin")
        ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!selected) throw new Error(`Several ${kind} remotes match this repository. Set the branch upstream explicitly before continuing.`);
    if (selected.urls.length !== 1) throw new Error(`Remote ${selected.name} has multiple ${kind} destinations. Coretex will not use an ambiguous remote.`);
    return selected.name;
}

export async function gitFetch(dir: string, expectedGithubFullName?: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    if (!expectedGithubFullName) return run(root, ["fetch", "--all", "--prune"], 120_000);
    const remote = await selectRemote(root, "fetch", expectedGithubFullName);
    return run(root, ["fetch", remote, "--prune"], 120_000);
}

export async function gitPull(dir: string, expectedGithubFullName?: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    if (expectedGithubFullName) {
        const remote = await selectRemote(root, "fetch", expectedGithubFullName);
        const upstream = await run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).then((value) => value.trim()).catch(() => "");
        if (!upstream.startsWith(`${remote}/`)) throw new Error(`The current branch does not track ${expectedGithubFullName}. Nothing was pulled.`);
    }
    return run(root, ["pull", "--ff-only"], 120_000);
}

export async function gitPush(dir: string, setUpstream = false, expectedGithubFullName?: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const remote = await selectRemote(root, "push", expectedGithubFullName);
    return run(root, ["push", ...(setUpstream ? ["-u"] : []), remote, "HEAD"], 120_000);
}

export async function gitCommitAll(dir: string, message: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const cleanMessage = validateCommitMessage(message);
    await run(root, ["add", "-A"]);
    return run(root, ["commit", "-m", cleanMessage]);
}

function validateCommitMessage(message: string): string {
    const clean = message.trim();
    if (!clean) throw new Error("Enter a commit message.");
    if (clean.length > 10_000) throw new Error("Commit messages must be 10,000 characters or fewer.");
    if (clean.includes("\0")) throw new Error("Commit messages cannot contain null characters.");
    return clean;
}

async function validateBranch(root: string, branch: string): Promise<string> {
    const clean = branch.trim();
    if (!clean || clean.length > 250 || clean.startsWith("-")) throw new Error("Enter a valid branch name.");
    await run(root, ["check-ref-format", "--branch", clean]);
    return clean;
}

async function validatedRepoPaths(root: string, files: string[]): Promise<string[]> {
    if (!Array.isArray(files) || files.length === 0) throw new Error("Select at least one file.");
    if (files.length > 5_000) throw new Error("Select 5,000 files or fewer at a time.");
    const unique = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
    for (const file of unique) {
        if (file.includes("\0") || path.isAbsolute(file)) throw new Error("File selections must be relative to the repository.");
        const resolved = path.resolve(root, file);
        const relative = path.relative(root, resolved);
        if (!relative || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error("A selected file is outside the repository.");
        }
    }
    return unique;
}

/** Stage only the explicitly selected repository-relative files. */
export async function gitStage(dir: string, files: string[]): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const selected = await validatedRepoPaths(root, files);
    await run(root, ["add", "--", ...selected]);
    return `Staged ${selected.length} file${selected.length === 1 ? "" : "s"}.`;
}

/** Remove explicitly selected files from the index without discarding worktree edits. */
export async function gitUnstage(dir: string, files: string[]): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const selected = await validatedRepoPaths(root, files);
    const hasHead = await run(root, ["rev-parse", "--verify", "HEAD"]).then(() => true).catch(() => false);
    if (hasHead) await run(root, ["restore", "--staged", "--", ...selected]);
    else await run(root, ["rm", "--cached", "--ignore-unmatch", "--", ...selected]);
    return `Unstaged ${selected.length} file${selected.length === 1 ? "" : "s"}.`;
}

/** Commit the current index exactly as shown in the staged-files UI. */
export async function gitCommitStaged(dir: string, message: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const cleanMessage = validateCommitMessage(message);
    const staged = (await run(root, ["diff", "--cached", "--name-only"])).trim();
    if (!staged) throw new Error("Stage at least one change before committing.");
    return run(root, ["commit", "-m", cleanMessage]);
}

/** Merge a named local/remote branch after verifying that the worktree is clean. */
export async function gitMerge(dir: string, branch: string, mode: "ff-only" | "no-ff" = "ff-only"): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const source = await validateBranch(root, branch);
    const dirty = (await run(root, ["status", "--porcelain"])).trim();
    if (dirty) throw new Error("Commit or stash local changes before merging.");
    const current = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (source === current) throw new Error(`${source} is already checked out.`);
    return mode === "no-ff"
        ? run(root, ["merge", "--no-ff", "--no-edit", source])
        : run(root, ["merge", "--ff-only", source]);
}

/** Create the standard local branch refs without changing the active checkout. */
export async function ensureBranchTaxonomy(dir: string, branches: string[] = ["sandbox", "devel", "staging", "main"]): Promise<string[]> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const created: string[] = [];
    for (const branch of branches) {
        const exists = await run(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).then(() => true).catch(() => false);
        if (!exists) {
            await run(root, ["branch", branch, "HEAD"]);
            created.push(branch);
        }
    }
    return created;
}

/** Create a PR from the active branch through the authenticated GitHub CLI. */
export async function createPullRequest(dir: string, fullName: string, base: string, title: string, body: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const repository = normalizeGithubFullName(fullName);
    const target = await validateBranch(root, base);
    const cleanTitle = title.trim();
    if (!cleanTitle || cleanTitle.length > 256 || cleanTitle.includes("\0")) throw new Error("Enter a pull request title of 256 characters or fewer.");
    if (body.length > 65_000 || body.includes("\0")) throw new Error("Pull request descriptions must be 65,000 characters or fewer.");
    const branch = (await run(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (!branch || branch === "HEAD" || branch === target) throw new Error(`Create or switch to a feature branch before opening a PR to ${target}.`);
    await gitPush(root, true, repository);
    return runGh(root, ["pr", "create", "--repo", repository, "--base", target, "--head", branch, "--title", cleanTitle, "--body", body]);
}

/** Enable GitHub auto-merge after required checks pass. */
export async function mergePullRequest(dir: string, fullName: string, pr: string): Promise<string> {
    const root = (await run(dir, ["rev-parse", "--show-toplevel"])).trim();
    const repository = normalizeGithubFullName(fullName);
    await selectRemote(root, "push", repository);
    const target = pr.trim();
    if (!/^\d{1,10}$/.test(target) && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/i.test(target)) {
        throw new Error("Choose a pull request number or github.com pull request URL.");
    }
    return runGh(root, ["pr", "merge", target, "--repo", repository, "--auto", "--squash", "--delete-branch"]);
}

/** Best-effort PR list via GitHub CLI when installed and authenticated. */
export async function listPullRequests(dir: string, fullName?: string): Promise<{ number: number; title: string; state: string; url: string; author: string; branch: string }[]> {
    return new Promise((resolve) => {
        execFile(
            "gh",
            ["pr", "list", ...(fullName ? ["--repo", normalizeGithubFullName(fullName)] : []), "--json", "number,title,state,url,author,headRefName", "--limit", "20"],
            { cwd: dir, windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    resolve([]);
                    return;
                }
                try {
                    const rows = JSON.parse(stdout) as { number: number; title: string; state: string; url: string; author: { login?: string }; headRefName: string }[];
                    resolve(
                        rows.map((r) => ({
                            number: r.number,
                            title: r.title,
                            state: r.state,
                            url: r.url,
                            author: r.author?.login ?? "",
                            branch: r.headRefName,
                        })),
                    );
                } catch {
                    resolve([]);
                }
            },
        );
    });
}
