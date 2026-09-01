import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reduceDockerOperationState } from "../../shared/src/coretex/docker-operation-state.js";
import { getContainerActionState } from "../../shared/src/coretex/views/docker-action-state.js";
import { DockerService } from "../src/docker/service.js";
import { classifyDockerPort } from "../src/servers/scanner.js";
import type { DockerAction, DockerOperationState, DockerPruneTarget } from "../src/types.js";

type Call = { method: string; args: unknown[] };

class FakeContainer {
    constructor(
        private readonly id: string,
        private readonly calls: Call[],
    ) {}

    start = async (...args: unknown[]) => this.record("container.start", args);
    stop = async (...args: unknown[]) => this.record("container.stop", args);
    restart = async (...args: unknown[]) => this.record("container.restart", args);
    pause = async (...args: unknown[]) => this.record("container.pause", args);
    unpause = async (...args: unknown[]) => this.record("container.unpause", args);
    remove = async (...args: unknown[]) => this.record("container.remove", args);

    private record(method: string, args: unknown[]): void {
        this.calls.push({ method, args: [this.id, ...args] });
    }
}

class FakeDocker {
    readonly calls: Call[] = [];
    failState = false;
    failPruneMethod: string | null = null;

    version = async () => ({
        Version: "27.1.2",
        ApiVersion: "1.46",
        Os: "linux",
        Arch: "amd64",
        Platform: { Name: "Docker Desktop" },
    });

    info = async () => ({
        Name: "coretex-fixture",
        ServerVersion: "27.1.2",
        NCPU: 8,
        MemTotal: 16_000_000_000,
        Driver: "overlay2",
        OSType: "linux",
        Architecture: "x86_64",
        KernelVersion: "6.6",
        OperatingSystem: "Docker Desktop",
        Containers: 2,
        ContainersRunning: 1,
        ContainersPaused: 0,
        ContainersStopped: 1,
        Images: 2,
    });

    df = async () => ({
        Images: [{ Size: 1_000 }, { Size: 2_000 }],
        Containers: [{ SizeRw: 30 }, { SizeRw: 40 }],
        Volumes: [{ UsageData: { Size: 500 } }],
        BuildCache: [{ Size: 60 }, { Size: 70 }],
    });

    listContainers = async (options?: unknown) => {
        this.calls.push({ method: "listContainers", args: [options] });
        if (this.failState) throw new Error("fixture engine unavailable");
        return [
            {
                Id: "running-id",
                Names: ["/api"],
                Image: "example/api:latest",
                State: "running",
                Status: "Up 3 minutes (healthy)",
                Ports: [
                    { PrivatePort: 3000, PublicPort: 4100, Type: "tcp" },
                    { PrivatePort: 3001, Type: "tcp" },
                    { Type: "udp" },
                ],
                Labels: { "com.docker.compose.project": "fixture" },
            },
            {
                Id: "stopped-id",
                Names: ["/worker"],
                Image: "example/worker:latest",
                State: "exited",
                Status: "Exited (0)",
                Ports: [],
                Labels: {},
            },
        ];
    };

    listImages = async () => [
        { Id: "sha256:image-a", RepoTags: ["example/api:latest", "<none>:<none>"], Size: 1_000, Created: 10 },
        { Id: "sha256:image-b", RepoTags: null, Size: 2_000, Created: 20 },
    ];

    listVolumes = async () => ({ Volumes: [{ Name: "fixture-data", Driver: "local" }] });
    listNetworks = async () => [{ Id: "network-id", Name: "fixture_default", Driver: "bridge" }];

    getContainer = (id: string) => {
        this.calls.push({ method: "getContainer", args: [id] });
        return new FakeContainer(id, this.calls);
    };

    pruneContainers = async () => {
        this.record("pruneContainers");
        return { ContainersDeleted: ["stopped-a"], SpaceReclaimed: 11 };
    };
    pruneImages = async () => {
        this.record("pruneImages");
        return { ImagesDeleted: [{ Deleted: "image-a" }, { Untagged: "image-b" }], SpaceReclaimed: 22 };
    };
    pruneVolumes = async () => {
        this.record("pruneVolumes");
        return { VolumesDeleted: ["volume-a"], SpaceReclaimed: 33 };
    };
    pruneNetworks = async () => {
        this.record("pruneNetworks");
        return { NetworksDeleted: ["network-a"] };
    };
    pruneBuilder = async () => {
        this.record("pruneBuilder");
        return { CachesDeleted: ["cache-a"], SpaceReclaimed: 55 };
    };

    private record(method: string): void {
        this.calls.push({ method, args: [] });
        if (this.failPruneMethod === method) throw new Error(`${method} fixture failure`);
    }
}

const injectDocker = (fake: FakeDocker): DockerService => {
    const service = new DockerService();
    (service as unknown as { docker: FakeDocker }).docker = fake;
    return service;
};

const methods = (fake: FakeDocker): string[] => fake.calls.map((call) => call.method);

async function testContainerActions(): Promise<void> {
    const expected: Record<DockerAction, string> = {
        start: "container.start",
        stop: "container.stop",
        restart: "container.restart",
        pause: "container.pause",
        unpause: "container.unpause",
        remove: "container.remove",
    };

    for (const [action, expectedMethod] of Object.entries(expected) as [DockerAction, string][]) {
        const fake = new FakeDocker();
        await injectDocker(fake).action(action, "fixture-id");
        assert.deepEqual(methods(fake), ["getContainer", expectedMethod], `${action} must map to ${expectedMethod}`);
        assert.equal(fake.calls[1]?.args[0], "fixture-id");
        if (action === "remove") {
            assert.deepEqual(
                fake.calls[1]?.args[1],
                { force: false, v: false },
                "remove must never force-stop a running container or delete attached volumes",
            );
        } else {
            assert.equal(fake.calls[1]?.args.length, 1, `${action} must not receive remove options`);
        }
    }
}

async function testPruneTargets(): Promise<void> {
    const expected: Record<Exclude<DockerPruneTarget, "all">, string> = {
        containers: "pruneContainers",
        images: "pruneImages",
        volumes: "pruneVolumes",
        networks: "pruneNetworks",
        buildcache: "pruneBuilder",
    };

    for (const [target, expectedMethod] of Object.entries(expected) as [Exclude<DockerPruneTarget, "all">, string][]) {
        const fake = new FakeDocker();
        const summary = await injectDocker(fake).prune(target);
        assert.deepEqual(methods(fake), [expectedMethod], `${target} must map to ${expectedMethod}`);
        assert.deepEqual(summary.targets, [target]);
        assert.deepEqual(summary.failures, []);
    }

    const all = new FakeDocker();
    const allSummary = await injectDocker(all).prune("all");
    assert.deepEqual(methods(all), ["pruneContainers", "pruneImages", "pruneVolumes", "pruneNetworks", "pruneBuilder"]);
    assert.equal(allSummary.spaceReclaimedBytes, 121);
    assert.deepEqual(allSummary.deletedByTarget, { containers: 1, images: 2, volumes: 1, networks: 1, buildcache: 0 });

    const selected = new FakeDocker();
    const selectedSummary = await injectDocker(selected).prune("all", {
        containers: true,
        images: false,
        volumes: true,
        networks: false,
        buildCache: true,
    });
    assert.deepEqual(methods(selected), ["pruneContainers", "pruneVolumes", "pruneBuilder"], "cleanup must honor saved selections");
    assert.deepEqual(selectedSummary.targets, ["containers", "volumes", "buildcache"]);

    const none = new FakeDocker();
    const noneSummary = await injectDocker(none).prune("all", {
        containers: false,
        images: false,
        volumes: false,
        networks: false,
        buildCache: false,
    });
    assert.deepEqual(methods(none), [], "cleanup with no selected resource types must be a no-op");
    assert.deepEqual(noneSummary.targets, []);

    const partialFailure = new FakeDocker();
    partialFailure.failPruneMethod = "pruneVolumes";
    const partialSummary = await injectDocker(partialFailure).prune("all");
    assert.deepEqual(
        methods(partialFailure),
        ["pruneContainers", "pruneImages", "pruneVolumes", "pruneNetworks", "pruneBuilder"],
        "cleanup must continue through independent targets after one target fails",
    );
    assert.deepEqual(partialSummary.failures, [{ target: "volumes", error: "pruneVolumes fixture failure" }]);
    assert.equal(partialSummary.spaceReclaimedBytes, 88, "failed target reclaim bytes must not be counted");
}

async function testStateMapping(): Promise<void> {
    const fake = new FakeDocker();
    const service = injectDocker(fake);
    const state = await service.getState();

    assert.equal(state.available, true);
    assert.equal(state.version, "27.1.2");
    assert.equal(state.info?.ncpu, 8);
    assert.equal(state.info?.imagesSizeBytes, 3_000);
    assert.equal(state.info?.containersSizeBytes, 70);
    assert.equal(state.info?.volumesSizeBytes, 500);
    assert.equal(state.info?.buildCacheSizeBytes, 130);
    assert.equal(state.info?.reclaimableBytes, 130);
    assert.deepEqual(state.containers[0], {
        id: "running-id",
        name: "api",
        image: "example/api:latest",
        state: "running",
        status: "Up 3 minutes (healthy)",
        ports: [
            { privatePort: 3000, publicPort: 4100, type: "tcp" },
            { privatePort: 3001, publicPort: undefined, type: "tcp" },
        ],
        composeProject: "fixture",
    });
    assert.deepEqual(state.images[0]?.tags, ["example/api:latest"]);
    assert.deepEqual(state.images[1]?.tags, []);
    assert.deepEqual(state.volumes, [{ name: "fixture-data", driver: "local" }]);
    assert.deepEqual(state.networks, [{ id: "network-id", name: "fixture_default", driver: "bridge" }]);

    fake.calls.length = 0;
    const ports = await service.publishedPorts();
    assert.deepEqual(fake.calls[0], { method: "listContainers", args: [{ all: false }] });
    assert.deepEqual(ports.get(4100), {
        name: "api",
        compose: "fixture",
        id: "running-id",
        image: "example/api:latest",
        privatePort: 3000,
    });
    assert.equal(ports.has(3001), false, "unpublished private ports must not appear in host-port lookup");
}

function testPublishedDatabaseClassification(): void {
    const unknown = { type: "unknown", tech: "", probe: true } as const;
    assert.deepEqual(
        classifyDockerPort(
            { id: "postgres-id", name: "db", image: "postgres:17", privatePort: 5432 },
            unknown,
        ),
        { type: "database", tech: "PostgreSQL", probe: false },
        "an arbitrary published host port must inherit the database protocol from its container port",
    );
    assert.deepEqual(
        classifyDockerPort(
            { id: "redis-id", name: "cache", image: "valkey/valkey:8", privatePort: 10001 },
            unknown,
        ),
        { type: "database", tech: "Valkey", probe: false },
        "database images must not be treated as failed HTTP services",
    );
}

async function testUnavailableState(): Promise<void> {
    const fake = new FakeDocker();
    fake.failState = true;
    const service = injectDocker(fake);
    const state = await service.getState();
    assert.equal(state.available, false);
    assert.match(state.error ?? "", /fixture engine unavailable/);
    assert.deepEqual(state.containers, []);
    assert.deepEqual(state.images, []);
    assert.deepEqual(state.volumes, []);
    assert.deepEqual(state.networks, []);

    const ports = await service.publishedPorts();
    assert.equal(ports.size, 0, "published port discovery must fail closed when Docker is unavailable");
}

async function testInputValidation(): Promise<void> {
    for (const invalidId of ["", "   ", "bad\u0000id", "x".repeat(257)]) {
        const fake = new FakeDocker();
        await assert.rejects(injectDocker(fake).action("start", invalidId), /valid Docker container id/);
        assert.deepEqual(fake.calls, [], "invalid ids must be rejected before a Docker object is resolved");
    }

    const invalidActionDocker = new FakeDocker();
    await assert.rejects(
        injectDocker(invalidActionDocker).action("destroy" as DockerAction, "fixture-id"),
        /Unsupported Docker container action/,
    );
    assert.deepEqual(methods(invalidActionDocker), ["getContainer"]);

    const invalidPruneDocker = new FakeDocker();
    await assert.rejects(
        injectDocker(invalidPruneDocker).prune("everything" as DockerPruneTarget),
        /Unsupported Docker cleanup target/,
    );
    assert.deepEqual(invalidPruneDocker.calls, []);
}

function testContainerActionStates(): void {
    assert.deepEqual(getContainerActionState("running"), {
        primaryAction: null,
        primaryLabel: null,
        canStop: true,
        canRestart: true,
        canRemove: false,
    });
    assert.deepEqual(getContainerActionState("paused"), {
        primaryAction: "unpause",
        primaryLabel: "Resume",
        canStop: false,
        canRestart: false,
        canRemove: false,
    });
    assert.deepEqual(getContainerActionState("restarting"), {
        primaryAction: null,
        primaryLabel: null,
        canStop: true,
        canRestart: false,
        canRemove: false,
    });
    assert.deepEqual(getContainerActionState("exited"), {
        primaryAction: "start",
        primaryLabel: "Start",
        canStop: false,
        canRestart: false,
        canRemove: true,
    });
    assert.deepEqual(getContainerActionState("created"), getContainerActionState("exited"));
    assert.deepEqual(getContainerActionState("dead"), {
        primaryAction: null,
        primaryLabel: null,
        canStop: false,
        canRestart: false,
        canRemove: true,
    });
    assert.deepEqual(getContainerActionState("Running"), getContainerActionState("running"), "engine state matching must be case-insensitive");
    for (const transitionalOrUnknown of ["removing", "unknown", "", "mystery-state"]) {
        assert.deepEqual(
            getContainerActionState(transitionalOrUnknown),
            { primaryAction: null, primaryLabel: null, canStop: false, canRestart: false, canRemove: false },
            `${transitionalOrUnknown || "empty"} state must fail closed`,
        );
    }
}

function testOperationCorrelation(): void {
    const firstRunning: DockerOperationState = {
        id: "docker_action_alpha",
        kind: "container-action",
        status: "running",
        startedAt: 100,
        action: "restart",
        containerId: "alpha",
    };
    const secondRunning: DockerOperationState = {
        id: "docker_prune_beta",
        kind: "prune",
        status: "running",
        startedAt: 110,
        target: "images",
    };

    const afterFirst = reduceDockerOperationState(undefined, firstRunning);
    assert.deepEqual(Object.keys(afterFirst.active), [firstRunning.id]);
    assert.equal(afterFirst.last, null);

    const afterSecond = reduceDockerOperationState(afterFirst, secondRunning);
    assert.deepEqual(Object.keys(afterSecond.active), [firstRunning.id, secondRunning.id], "concurrent operation IDs must be tracked independently");
    assert.deepEqual(Object.keys(afterFirst.active), [firstRunning.id], "operation folding must not mutate prior renderer state");

    const firstSucceeded: DockerOperationState = {
        ...firstRunning,
        status: "succeeded",
        finishedAt: 140,
        message: "Restarted container alpha.",
    };
    const afterFirstTerminal = reduceDockerOperationState(afterSecond, firstSucceeded);
    assert.deepEqual(Object.keys(afterFirstTerminal.active), [secondRunning.id], "a terminal event must clear only its matching running ID");
    assert.equal(afterFirstTerminal.last?.id, firstRunning.id);
    assert.equal(afterFirstTerminal.last?.status, "succeeded");

    const unrelatedTerminal: DockerOperationState = {
        id: "docker_refresh_unrelated",
        kind: "refresh",
        status: "failed",
        startedAt: 115,
        finishedAt: 145,
        error: "fixture refresh failure",
    };
    const afterUnrelated = reduceDockerOperationState(afterFirstTerminal, unrelatedTerminal);
    assert.deepEqual(Object.keys(afterUnrelated.active), [secondRunning.id], "an unrelated terminal event must not clear active work");
    assert.equal(afterUnrelated.last?.id, unrelatedTerminal.id);

    const secondFailed: DockerOperationState = {
        ...secondRunning,
        status: "failed",
        finishedAt: 150,
        error: "fixture prune failure",
    };
    const finished = reduceDockerOperationState(afterUnrelated, secondFailed);
    assert.deepEqual(finished.active, {});
    assert.equal(finished.last?.id, secondRunning.id);
    assert.equal(finished.last?.status, "failed");
}

function testUiSafetyContract(): void {
    const viewPath = fileURLToPath(new URL("../../shared/src/coretex/views/docker-view.tsx", import.meta.url));
    const source = readFileSync(viewPath, "utf8");
    const menuStart = source.indexOf("const containerMenu");
    const menuEnd = source.indexOf("const refresh", menuStart);
    assert.ok(menuStart >= 0 && menuEnd > menuStart, "container menu implementation must remain discoverable for its safety audit");
    const menu = source.slice(menuStart, menuEnd);
    assert.match(menu, /label:\s*"Remove container"[\s\S]*onClick:\s*\(\)\s*=>\s*requestRemove\(c\)/, "context-menu remove must use the shared confirmation path");
    assert.doesNotMatch(menu, /dockerAction\(\s*"remove"/, "context-menu remove must never bypass confirmation");

    const requestRemoveStart = source.indexOf("const requestRemove");
    const requestRemoveEnd = source.indexOf("const runPrune", requestRemoveStart);
    const requestRemove = source.slice(requestRemoveStart, requestRemoveEnd);
    assert.match(requestRemove, /confirmDestructive/, "remove must honor the destructive-confirmation setting");
    assert.match(requestRemove, /confirm\(\{/, "remove must present the shared confirmation dialog when confirmations are enabled");
    assert.match(requestRemove, /named volumes are kept/, "remove confirmation must explain what data is preserved");

    assert.ok((source.match(/isLoading=/g) ?? []).length >= 6, "refresh, cleanup, and lifecycle actions must expose loading states");
    assert.ok((source.match(/isDisabled=/g) ?? []).length >= 6, "actions must be disabled while conflicting work is active");
    assert.ok((source.match(/aria-label=/g) ?? []).length >= 6, "icon and lifecycle buttons must expose accessible labels");
    assert.match(source, /overflow-x-hidden/, "dashboard must prevent horizontal overflow on narrow windows");
    assert.match(source, /sm:w-auto/, "container controls must stack on narrow windows and return inline on larger screens");
    assert.doesNotMatch(source, /confirmRemove/, "legacy timed two-click removal confirmation must not coexist with the dialog flow");
    assert.match(source, /state\.dockerOperations\?\.last/, "pending buttons must clear from correlated operation events, not incidental state refreshes");
    assert.match(source, /current\?\.id === completed\.id/, "only a matching terminal operation ID may clear optimistic UI state");
}

function testOperationWiringContract(): void {
    const hookPath = fileURLToPath(new URL("../../shared/src/coretex/use-coretex.ts", import.meta.url));
    const orchestratorPath = fileURLToPath(new URL("../src/orchestrator.ts", import.meta.url));
    const hook = readFileSync(hookPath, "utf8");
    const orchestrator = readFileSync(orchestratorPath, "utf8");

    assert.match(hook, /dockerAction:\s*\(action, id, operationId\)\s*=>\s*client\.send\(\{[\s\S]*?type:\s*"docker:action",[\s\S]*?action,[\s\S]*?id,[\s\S]*?operationId:/, "renderer action helper must send action, container id, and operation id");
    assert.match(hook, /dockerPrune:\s*\(target, operationId\)\s*=>\s*client\.send\(\{[\s\S]*?type:\s*"docker:prune",[\s\S]*?target,[\s\S]*?operationId:/, "renderer prune helper must send target and operation id");
    assert.match(hook, /dockerRefresh:\s*\(operationId\)\s*=>\s*client\.send\(\{[\s\S]*?type:\s*"docker:refresh",[\s\S]*?operationId:/, "renderer refresh helper must send an operation id");
    assert.match(hook, /reduceDockerOperationState\(state\.dockerOperations, ev\.operation\)/, "renderer must fold lifecycle events with the tested correlation helper");

    assert.match(orchestrator, /case\s+"docker:action"[\s\S]*?_dockerAction\(cmd\.action, cmd\.id, cmd\.operationId\)/, "brain must preserve action operation ids");
    assert.match(orchestrator, /case\s+"docker:prune"[\s\S]*?_dockerPrune\(cmd\.target, cmd\.operationId\)/, "brain must preserve prune operation ids");
    assert.match(orchestrator, /case\s+"docker:refresh"[\s\S]*?_dockerRefresh\(false, cmd\.operationId, true\)/, "brain must preserve refresh operation ids");
    assert.match(orchestrator, /type:\s*"docker:operation",\s*operation:\s*next/, "brain must broadcast a running lifecycle event");
    assert.match(orchestrator, /operation:\s*\{\s*\.\.\.operation,\s*\.\.\.patch,\s*status,\s*finishedAt:/, "brain must broadcast a terminal lifecycle event with the same operation payload");
}

async function main(): Promise<void> {
    await testContainerActions();
    await testPruneTargets();
    await testStateMapping();
    testPublishedDatabaseClassification();
    await testUnavailableState();
    await testInputValidation();
    testContainerActionStates();
    testOperationCorrelation();
    testUiSafetyContract();
    testOperationWiringContract();
    console.log("Docker acceptance smoke passed: backend actions/prunes, state mapping, UI lifecycle rules, confirmations, loading, accessibility, and responsive safety.");
    console.log("No Docker socket, daemon, container, image, volume, network, or build cache was accessed.");
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
