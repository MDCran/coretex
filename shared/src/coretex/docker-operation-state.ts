import type { DockerOperationState } from "@repo/coretex/types";

/** Renderer-side lifecycle state for Docker buttons and operation feedback. */
export interface DockerOperationsState {
    active: Record<string, DockerOperationState>;
    last: DockerOperationState | null;
}

export const EMPTY_DOCKER_OPERATIONS: DockerOperationsState = {
    active: {},
    last: null,
};

/**
 * Fold one server lifecycle event into UI state. This stays dependency-free so
 * request/result correlation and concurrent operations can be acceptance-tested
 * without importing the React hook or touching a Docker daemon.
 */
export function reduceDockerOperationState(
    previous: DockerOperationsState | null | undefined,
    operation: DockerOperationState,
): DockerOperationsState {
    const current = previous ?? EMPTY_DOCKER_OPERATIONS;
    const active = { ...current.active };
    if (operation.status === "running") active[operation.id] = operation;
    else delete active[operation.id];
    return {
        active,
        last: operation.status === "running" ? current.last : operation,
    };
}
