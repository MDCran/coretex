import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    GithubCheckoutRegistry,
    cloneGithubRepository,
    githubRepositoryDetail,
    normalizeGithubClone,
} from "../src/fs/github.js";
import {
    gitBranches,
    gitCheckout,
    gitCommitStaged,
    gitLog,
    gitMerge,
    gitPush,
    gitStage,
    gitSummary,
    gitUnstage,
} from "../src/fs/git.js";

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

const root = await mkdtemp(path.join(os.tmpdir(), "coretex-github-smoke-"));
const repo = path.join(root, "repo");
const data = path.join(root, "data");

try {
    const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const [navSource, sidebarSource, shellSource, viewSource, clientSource] = await Promise.all([
        readFile(path.join(workspaceRoot, "shared/src/coretex/nav.ts"), "utf8"),
        readFile(path.join(workspaceRoot, "shared/src/coretex/sidebar.tsx"), "utf8"),
        readFile(path.join(workspaceRoot, "shared/src/coretex/app-shell.tsx"), "utf8"),
        readFile(path.join(workspaceRoot, "shared/src/coretex/views/github-view.tsx"), "utf8"),
        readFile(path.join(workspaceRoot, "shared/src/coretex/use-coretex.ts"), "utf8"),
    ]);
    assert.match(navSource, /kind: "github"/, "GitHub must be a first-class navigation target");
    assert.match(sidebarSource, /onNavigate\(\{ kind: "github" \}\)/, "Sidebar must open the GitHub workspace");
    assert.match(shellSource, /<GithubView\b/, "App shell must render the GitHub workspace");
    assert.match(viewSource, /<CommitGraph\b/, "GitHub workspace must expose the commit graph");
    assert.match(viewSource, /githubClone\([\s\S]{0,240}Array\.from\(selectedProjects\)\)/, "Clone must defer project linking to the successful backend operation");
    assert.match(viewSource, /gitCommit\([^)]*false\)/, "Commit UI must commit the staged index instead of absorbing unrelated files");
    assert.doesNotMatch(viewSource, /dangerouslySetInnerHTML|window\.confirm|@ts-nocheck/, "GitHub UI must keep untrusted metadata escaped and use app-native confirmations");
    assert.match(clientSource, /case "github:detailResult"/, "GitHub repository details must reduce into renderer state");

    await mkdir(repo);
    git(repo, "init", "--initial-branch=main");
    git(repo, "config", "user.name", "Coretex Smoke");
    git(repo, "config", "user.email", "coretex-smoke@example.invalid");
    await writeFile(path.join(repo, "README.md"), "# Smoke repository\n", "utf8");
    await writeFile(path.join(repo, "base.txt"), "base\n", "utf8");
    git(repo, "add", "README.md", "base.txt");
    git(repo, "commit", "-m", "Initial commit");
    git(repo, "remote", "add", "origin", "https://example-user:secret-token@github.com/example/smoke.git");
    git(repo, "remote", "add", "credential-test", "ssh://user:password@example.com/repo.git?token=secret#fragment");
    const sanitizedSummary = await gitSummary(repo);
    assert.ok(sanitizedSummary.remotes.some((remote) => remote.url === "https://github.com/example/smoke.git"));
    assert.equal(sanitizedSummary.github?.owner, "example");
    assert.doesNotMatch(JSON.stringify(sanitizedSummary), /secret-token|password|token=|fragment/);
    git(repo, "remote", "remove", "credential-test");

    await writeFile(path.join(repo, "selected.txt"), "selected\n", "utf8");
    await writeFile(path.join(repo, "not-selected.txt"), "leave me unstaged\n", "utf8");
    await gitStage(repo, ["selected.txt"]);
    let summary = await gitSummary(repo);
    assert.equal(summary.staged, 1);
    assert.equal(summary.untracked, 1);
    await gitUnstage(repo, ["selected.txt"]);
    summary = await gitSummary(repo);
    assert.equal(summary.staged, 0);
    await gitStage(repo, ["selected.txt"]);
    await gitCommitStaged(repo, "Commit only selected file");
    assert.equal((await readFile(path.join(repo, "not-selected.txt"), "utf8")).trim(), "leave me unstaged");
    assert.equal((await gitSummary(repo)).untracked, 1, "staged-only commit must not absorb unrelated files");

    await assert.rejects(() => gitStage(repo, ["../outside.txt"]), /outside the repository/i);
    await assert.rejects(() => gitCommitStaged(repo, "No staged changes"), /Stage at least one change/i);
    await rm(path.join(repo, "not-selected.txt"));

    // Make a real merge commit so the graph must expose two parents.
    await gitCheckout(repo, "feature/github-smoke", true);
    assert.equal((await gitBranches(repo)).find((branch) => branch.name === "feature/github-smoke")?.remote, false, "slash-delimited feature branches must remain local");
    await writeFile(path.join(repo, "feature.txt"), "feature\n", "utf8");
    await gitStage(repo, ["feature.txt"]);
    await gitCommitStaged(repo, "Feature commit");
    await gitCheckout(repo, "main");
    await writeFile(path.join(repo, "main.txt"), "main\n", "utf8");
    await gitStage(repo, ["main.txt"]);
    await gitCommitStaged(repo, "Main commit");
    await gitMerge(repo, "feature/github-smoke", "no-ff");
    const log = await gitLog(repo, 20);
    assert.ok(log.some((commit) => commit.parents?.length === 2), "merge graph must expose both parent SHAs");

    const bare = path.join(root, "remote.git");
    const secondBare = path.join(root, "remote-two.git");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", bare], { encoding: "utf8", windowsHide: true });
    execFileSync("git", ["init", "--bare", "--initial-branch=main", secondBare], { encoding: "utf8", windowsHide: true });
    git(repo, "remote", "remove", "origin");
    git(repo, "remote", "add", "mirror", bare);
    await gitPush(repo, true);
    assert.equal(git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"), "mirror/main", "publishing must work with a single non-origin remote");
    git(repo, "remote", "set-url", "--add", "--push", "mirror", bare);
    git(repo, "remote", "set-url", "--add", "--push", "mirror", secondBare);
    await assert.rejects(() => gitPush(repo), /multiple push destinations/i, "Coretex must reject remotes that push to several destinations");

    const detail = await githubRepositoryDetail([], { path: repo });
    assert.equal(detail.repository.localPath?.replace(/\\/g, "/").toLowerCase(), repo.replace(/\\/g, "/").toLowerCase());
    assert.match(detail.readme?.content ?? "", /Smoke repository/);
    assert.ok(detail.commits.length >= 4);

    assert.equal(normalizeGithubClone("openai/codex")?.cloneUrl, "https://github.com/openai/codex.git");
    assert.equal(normalizeGithubClone("git@github.com:openai/codex.git")?.cloneUrl, "git@github.com:openai/codex.git");
    assert.equal(normalizeGithubClone("file:///tmp/repo"), null);
    assert.equal(normalizeGithubClone("https://example.com/openai/codex"), null);
    await assert.rejects(() => cloneGithubRepository("file:///tmp/repo", path.join(root, "clone")), /Use owner\/repository/i);

    const registry = new GithubCheckoutRegistry(data);
    await registry.load();
    await registry.add(repo);
    const restored = new GithubCheckoutRegistry(data);
    await restored.load();
    assert.deepEqual(restored.list(), [repo]);

    console.log("GitHub workspace smoke passed: safe staging, staged-only commits, merge graph parents, README detail, clone validation, and checkout persistence.");
} finally {
    await rm(root, { recursive: true, force: true });
}
