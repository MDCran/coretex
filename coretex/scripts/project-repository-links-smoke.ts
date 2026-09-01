import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Project, ProjectRepo } from "../src/types.js";
import { CodeIndexer } from "../src/rag/indexer.js";
import { ProjectIndexStore } from "../src/rag/store.js";
import {
    materializeProjectSourceRepo,
    projectRepoIdentity,
    resolveProjectRepoCheckout,
    unlinkProjectRepo,
    upsertProjectRepo,
    upsertProjectRepoForProject,
    validateProjectRepoAssociation,
} from "../src/projects/repository-links.js";

const project = { sourcePath: process.platform === "win32" ? "C:\\work\\product" : "/work/product" } satisfies Pick<Project, "sourcePath">;
const local: ProjectRepo = {
    id: "repo-local",
    name: "Web",
    path: "apps/web",
    github: { owner: "Acme", repo: "Web", url: "https://github.com/Acme/Web" },
    includeInIndex: true,
    isPrimary: true,
    createdAt: "2026-01-01T00:00:00.000Z",
};

const resolved = resolveProjectRepoCheckout(project, local);
assert.ok(resolved?.endsWith(process.platform === "win32" ? "work\\product\\apps\\web" : "work/product/apps/web"));
assert.throws(
    () => resolveProjectRepoCheckout(project, { path: "../outside" }),
    /must stay inside/i,
    "relative paths must not escape the project source root",
);

const migrated = materializeProjectSourceRepo({
    id: "legacy-project",
    name: "Legacy",
    sourcePath: project.sourcePath,
    repos: [],
    createdAt: "2026-01-01T00:00:00.000Z",
});
assert.deepEqual(
    migrated.map((repo) => ({ path: repo.path, primary: repo.isPrimary, indexed: repo.includeInIndex })),
    [{ path: ".", primary: true, indexed: true }],
    "the legacy project root must remain an explicit primary file source before additive links",
);
const migratedWithRemote = materializeProjectSourceRepo({
    id: "legacy-project",
    name: "Legacy",
    sourcePath: project.sourcePath,
    repos: [{ id: "remote", name: "Remote", path: "", github: { owner: "acme", repo: "remote" }, isPrimary: true, createdAt: 2 }],
    createdAt: "2026-01-01T00:00:00.000Z",
});
assert.deepEqual(migratedWithRemote.map((repo) => repo.path), [".", ""], "remote-only links must not hide the legacy source checkout");
assert.equal(migratedWithRemote.filter((repo) => repo.isPrimary).length, 1);

const absoluteRootRelink = upsertProjectRepoForProject(project, migrated, {
    id: "absolute-spelling",
    name: "Legacy remote",
    path: project.sourcePath,
    github: { owner: "acme", repo: "legacy" },
    includeInIndex: true,
    createdAt: 2,
});
assert.equal(absoluteRootRelink.length, 1, "relative and absolute spellings of one checkout must not create duplicate links");
assert.equal(absoluteRootRelink[0]?.github?.repo, "legacy");

let repos = upsertProjectRepo([], local);
repos = upsertProjectRepo(repos, {
    ...local,
    id: "duplicate-id",
    path: "",
    github: { owner: "acme", repo: "web.git" },
    createdAt: 2,
});
assert.equal(repos.length, 1, "GitHub owner/repository identity is case-insensitive and deduplicated");
assert.equal(repos[0]?.path, "apps/web", "a remote-only relink must preserve an existing checkout path");
assert.equal(repos[0]?.includeInIndex, true, "a metadata-only relink must preserve the checkout's indexing choice");
assert.equal(repos[0]?.github?.url, "https://github.com/acme/web", "GitHub links must be canonical renderer-safe URLs");
assert.equal(projectRepoIdentity(repos[0]!), "github:acme/web");

repos = upsertProjectRepo(repos, {
    id: "repo-api",
    name: "API",
    path: process.platform === "win32" ? "D:\\code\\api" : "/srv/code/api",
    includeInIndex: true,
    isPrimary: true,
    createdAt: 3,
});
assert.equal(repos.length, 2);
assert.equal(repos.filter((repo) => repo.isPrimary).length, 1, "only one repository may be primary");
assert.equal(repos.find((repo) => repo.id === "repo-api")?.isPrimary, true);

repos = unlinkProjectRepo(repos, "repo-api");
assert.equal(repos.length, 1);
assert.equal(repos[0]?.isPrimary, true, "unlinking the primary promotes a remaining repository");

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "coretex-project-repos-"));
try {
    const web = path.join(tempRoot, "web");
    const api = path.join(tempRoot, "api");
    await Promise.all([mkdir(web), mkdir(api)]);
    await Promise.all([
        writeFile(path.join(web, "alpha.ts"), "export const alpha = 1;\n", "utf8"),
        writeFile(path.join(api, "beta.ts"), "export const beta = 2;\n", "utf8"),
    ]);
    execFileSync("git", ["-C", web, "init", "--initial-branch=main"], { windowsHide: true });
    execFileSync("git", ["-C", web, "remote", "add", "origin", "https://github.com/acme/web.git"], { windowsHide: true });
    await validateProjectRepoAssociation({ sourcePath: tempRoot }, { ...local, path: "web" });
    await assert.rejects(
        () => validateProjectRepoAssociation({ sourcePath: tempRoot }, { ...local, path: "web", github: { owner: "other", repo: "web" } }),
        /not linked to other\/web/i,
        "a checkout must not be labeled as a different GitHub repository",
    );
    const store = new ProjectIndexStore(path.join(tempRoot, "index"));
    await store.load("multi-root");
    // Closed localhost port makes embeddings fail fast and exercises the lexical fallback.
    const indexer = new CodeIndexer(store, "http://127.0.0.1:1");
    const state = await indexer.indexCodeRoots(
        "multi-root",
        [
            { path: web, label: "app", repoId: "repo-web" },
            { path: api, label: "app", repoId: "repo-api" },
        ],
        () => undefined,
    );
    assert.equal(state.status, "ready");
    assert.equal(state.filesScanned, 2);
    assert.deepEqual(state.indexedRepoIds, ["repo-web", "repo-api"]);
    assert.deepEqual(
        store.getChunks("multi-root").map((chunk) => chunk.path).sort(),
        ["app--repo-api/beta.ts", "app--repo-web/alpha.ts"],
        "multi-root citations must keep stable unique repository prefixes",
    );
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

console.log("project repository links smoke: ok");
