import path from "node:path";
import type { Project, ProjectRepo } from "../types.js";
import { gitSummary, githubRemoteIdentity } from "../fs/git.js";

/** Normalize a local checkout path for identity comparisons without changing what is persisted. */
export function normalizeRepoPath(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const normalized = path.normalize(trimmed);
    const root = path.parse(normalized).root;
    const withoutTrailing = normalized === root ? root : normalized.replace(/[\\/]+$/, "");
    return process.platform === "win32" ? withoutTrailing.toLowerCase() : withoutTrailing;
}

/**
 * Resolve a checkout path using the documented project semantics. Relative
 * paths must remain inside sourcePath; repositories elsewhere must use an
 * explicit absolute path. Remote-only links resolve to null.
 */
export function resolveProjectRepoCheckout(project: Pick<Project, "sourcePath">, repo: Pick<ProjectRepo, "path">): string | null {
    const value = repo.path.trim();
    if (!value) return null;
    if (path.isAbsolute(value)) return path.normalize(value);
    const sourceRoot = project.sourcePath?.trim();
    if (!sourceRoot) throw new Error("A relative repository path requires a project source folder.");
    const root = path.resolve(sourceRoot);
    const resolved = path.resolve(root, value);
    const relative = path.relative(root, resolved);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("Relative repository paths must stay inside the project source folder. Use an absolute path for an external checkout.");
    }
    return resolved;
}

/** Stable identity used to prevent the same checkout/remote being linked twice to one project. */
export function projectRepoIdentity(repo: Pick<ProjectRepo, "id" | "path" | "github">): string {
    const owner = repo.github?.owner.trim().toLowerCase();
    const name = repo.github?.repo.trim().replace(/\.git$/i, "").toLowerCase();
    if (owner && name) return `github:${owner}/${name}`;
    const local = normalizeRepoPath(repo.path);
    if (local) return `local:${local}`;
    return `id:${repo.id.trim().toLowerCase()}`;
}

/** Validate and normalize renderer-supplied repository metadata. */
export function normalizeProjectRepo(repo: ProjectRepo): ProjectRepo {
    const localPath = repo.path.trim();
    const owner = repo.github?.owner.trim();
    const remoteName = repo.github?.repo.trim().replace(/\.git$/i, "");
    if (!localPath && (!owner || !remoteName)) {
        throw new Error("A repository link needs a local checkout path or a GitHub owner/repository.");
    }
    if ((owner || remoteName) && (!owner || !remoteName || !/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(remoteName))) {
        throw new Error("GitHub repository links must use a valid owner and repository name.");
    }

    const github = owner && remoteName
        ? {
              owner,
              repo: remoteName,
              // Renderer-supplied links are canonicalized so they cannot smuggle
              // a non-GitHub or script URL into a clickable repository action.
              url: `https://github.com/${owner}/${remoteName}`,
              ...(repo.github?.defaultBranch?.trim() ? { defaultBranch: repo.github.defaultBranch.trim() } : {}),
          }
        : null;
    const fallbackName = remoteName || (localPath ? path.basename(path.normalize(localPath)) : "Repository");
    const id = repo.id.trim() || `repo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    return {
        ...repo,
        id,
        name: repo.name.trim() || fallbackName,
        path: localPath,
        github,
        ...(repo.notes?.trim() ? { notes: repo.notes.trim() } : { notes: undefined }),
        includeInIndex: localPath ? repo.includeInIndex !== false : false,
        isPrimary: repo.isPrimary === true,
        createdAt: Number.isFinite(repo.createdAt) && repo.createdAt > 0 ? repo.createdAt : Date.now(),
    };
}

/** Upsert a repository association while preserving a previously cloned checkout. */
export function upsertProjectRepo(repos: ProjectRepo[], candidate: ProjectRepo): ProjectRepo[] {
    const nextRepo = normalizeProjectRepo(candidate);
    const identity = projectRepoIdentity(nextRepo);
    const exactIndex = repos.findIndex((repo) => repo.id === nextRepo.id);
    const identityIndex = repos.findIndex((repo) => projectRepoIdentity(repo) === identity);
    const localPath = normalizeRepoPath(nextRepo.path);
    const pathIndex = localPath
        ? repos.findIndex((repo) => normalizeRepoPath(repo.path) === localPath)
        : -1;
    const existingIndex = exactIndex >= 0 ? exactIndex : identityIndex >= 0 ? identityIndex : pathIndex;
    const matchedIndices = [...new Set([exactIndex, identityIndex, pathIndex].filter((index) => index >= 0))];
    let next = [...repos];

    if (existingIndex >= 0) {
        const existing = normalizeProjectRepo(next[existingIndex]!);
        const checkoutSource = matchedIndices
            .map((index) => normalizeProjectRepo(repos[index]!))
            .find((repo) => repo.path);
        const effectivePath = nextRepo.path || checkoutSource?.path || existing.path;
        next[existingIndex] = {
            ...existing,
            ...nextRepo,
            id: existing.id,
            createdAt: existing.createdAt,
            // Linking a remote-only result must not discard an existing local checkout.
            path: effectivePath,
            // Nor should a metadata-only refresh silently disable a checkout the
            // user already selected as a project file source.
            includeInIndex: effectivePath
                ? nextRepo.path
                    ? nextRepo.includeInIndex !== false
                    : (checkoutSource ?? existing).includeInIndex !== false
                : false,
        };
        // Prefer an exact id when present, but collapse any secondary remote/path
        // match so one checkout cannot appear twice after legacy-root migration.
        next = next.filter((_repo, index) => index === existingIndex || !matchedIndices.includes(index));
    } else {
        next.push(nextRepo);
    }

    const selectedId = existingIndex >= 0
        ? next.find((repo) => repo.id === repos[existingIndex]!.id)?.id ?? nextRepo.id
        : nextRepo.id;
    const wantsPrimary = nextRepo.isPrimary || !next.some((repo) => repo.isPrimary);
    return next.map((repo) => ({
        ...repo,
        isPrimary: wantsPrimary ? repo.id === selectedId : repo.isPrimary === true,
    }));
}

/** Project-aware upsert that also treats relative and absolute spellings of the same checkout as one link. */
export function upsertProjectRepoForProject(
    project: Pick<Project, "sourcePath">,
    repos: ProjectRepo[],
    candidate: ProjectRepo,
): ProjectRepo[] {
    const candidateCheckout = resolveProjectRepoCheckout(project, candidate);
    if (!candidateCheckout) return upsertProjectRepo(repos, candidate);
    const checkoutKey = normalizeRepoPath(candidateCheckout);
    const sameCheckout = repos.find((repo) => {
        try {
            const resolved = resolveProjectRepoCheckout(project, repo);
            return resolved ? normalizeRepoPath(resolved) === checkoutKey : false;
        } catch {
            return false;
        }
    });
    return upsertProjectRepo(repos, sameCheckout ? { ...candidate, id: sameCheckout.id } : candidate);
}

/**
 * A checkout carrying GitHub metadata must actually have a matching GitHub
 * remote. This prevents a mislabeled project link from sending later pushes or
 * pull-request mutations to a different repository.
 */
export async function validateProjectRepoAssociation(
    project: Pick<Project, "sourcePath">,
    repo: ProjectRepo,
): Promise<void> {
    const checkout = resolveProjectRepoCheckout(project, repo);
    if (!checkout || !repo.github) return;
    const summary = await gitSummary(checkout);
    if (!summary.isRepo) throw new Error(`${checkout} is not a Git repository. Clone it first or leave the local path empty.`);
    const expected = `${repo.github.owner}/${repo.github.repo}`.toLowerCase();
    const matches = summary.remotes.some((remote) => {
        const identity = githubRemoteIdentity(remote.url);
        return identity ? `${identity.owner}/${identity.repo}`.toLowerCase() === expected : false;
    });
    if (!matches) throw new Error(`The selected checkout is not linked to ${repo.github.owner}/${repo.github.repo}. No project links were changed.`);
}

/** Unlink repository metadata only; callers must never remove the checkout from disk. */
export function unlinkProjectRepo(repos: ProjectRepo[], repoId: string): ProjectRepo[] {
    const removed = repos.find((repo) => repo.id === repoId);
    const next = repos.filter((repo) => repo.id !== repoId);
    if (removed?.isPrimary && next.length > 0 && !next.some((repo) => repo.isPrimary)) {
        return next.map((repo, index) => ({ ...repo, isPrimary: index === 0 }));
    }
    return next;
}

/**
 * Older projects stored their primary checkout only in `sourcePath`. Before an
 * additive repository operation, materialize that checkout so the new link does
 * not silently replace the files, index, or Git workflow the project already had.
 */
export function materializeProjectSourceRepo(
    project: Pick<Project, "id" | "name" | "sourcePath" | "repos" | "createdAt">,
): ProjectRepo[] {
    const existing = [...(project.repos ?? [])];
    if (!project.sourcePath?.trim() || existing.some((repo) => repo.path.trim().length > 0)) return existing;
    const parsedCreatedAt = Date.parse(project.createdAt);
    return [{
        id: `repo_${project.id}_root`,
        name: project.name,
        path: ".",
        github: null,
        includeInIndex: true,
        isPrimary: true,
        createdAt: Number.isFinite(parsedCreatedAt) ? parsedCreatedAt : Date.now(),
    }, ...existing.map((repo) => ({ ...repo, isPrimary: false }))];
}
