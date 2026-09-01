// Coretex — Docker Desktop integration via dockerode. Connects to the local
// engine (named pipe on Windows, unix socket on POSIX), lists objects, reports
// engine info / disk usage, and performs container + prune actions. All
// best-effort: when the engine is absent the state reports available:false.

import Docker from "dockerode";
import type {
    DockerAction,
    DockerConcretePruneTarget,
    DockerContainerInfo,
    DockerEngineInfo,
    DockerImageInfo,
    DockerNetworkInfo,
    DockerPruneTarget,
    DockerPruneSummary,
    DockerState,
    DockerVolumeInfo,
} from "../types.js";

const CONCRETE_PRUNE_TARGETS: readonly DockerConcretePruneTarget[] = [
    "containers",
    "images",
    "volumes",
    "networks",
    "buildcache",
] as const;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function validateContainerId(id: string): string {
    const value = typeof id === "string" ? id.trim() : "";
    if (!value || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error("A valid Docker container id is required.");
    }
    return value;
}

export interface DockerConnectOptions {
    /** Override socket path (empty = platform default). */
    socketPath?: string;
    /** DOCKER_HOST-style URL (tcp://… / http://… / https://…). Empty = socket/default. */
    host?: string;
    /** When connecting over TCP, prefer HTTPS (TLS). */
    tlsVerify?: boolean;
}

function buildDocker(opts: DockerConnectOptions = {}): Docker {
    const socketPath = opts.socketPath?.trim();
    const hostRaw = opts.host?.trim();
    if (hostRaw) {
        try {
            const u = new URL(hostRaw.includes("://") ? hostRaw : `tcp://${hostRaw}`);
            const protocol = opts.tlsVerify || u.protocol === "https:" ? "https" : u.protocol === "http:" || u.protocol === "tcp:" ? "http" : u.protocol.replace(":", "");
            const port = u.port ? Number(u.port) : protocol === "https" ? 2376 : 2375;
            return new Docker({
                protocol: protocol === "https" ? "https" : "http",
                host: u.hostname,
                port,
            });
        } catch {
            /* fall through to socket / default */
        }
    }
    if (socketPath) return new Docker({ socketPath });
    return new Docker();
}

export class DockerService {
    private docker: Docker;
    private connectKey = "";

    constructor(opts: DockerConnectOptions = {}) {
        this.docker = buildDocker(opts);
        this.connectKey = JSON.stringify({
            socketPath: opts.socketPath ?? "",
            host: opts.host ?? "",
            tlsVerify: opts.tlsVerify === true,
        });
    }

    /** Rebind to a different socket / host when settings change. */
    configure(opts: DockerConnectOptions): void {
        const key = JSON.stringify({
            socketPath: opts.socketPath ?? "",
            host: opts.host ?? "",
            tlsVerify: opts.tlsVerify === true,
        });
        if (key === this.connectKey) return;
        this.connectKey = key;
        this.docker = buildDocker(opts);
    }

    async getState(): Promise<DockerState> {
        try {
            const [versionRaw, infoRaw, dfRaw, containers, images, volumesRes, networks] = await Promise.all([
                this.docker.version().catch(() => ({})),
                this.docker.info().catch(() => ({})),
                this.docker.df().catch(() => null),
                this.docker.listContainers({ all: true }),
                this.docker.listImages(),
                this.docker.listVolumes(),
                this.docker.listNetworks(),
            ]);

            const version = versionRaw as { Version?: string; ApiVersion?: string; Os?: string; Arch?: string; Platform?: { Name?: string } };
            const info = infoRaw as Record<string, unknown>;
            const engineInfo = this.mapInfo(version, info, dfRaw);

            return {
                available: true,
                version: version.Version ?? (typeof info.ServerVersion === "string" ? info.ServerVersion : undefined),
                info: engineInfo,
                containers: containers.map((c): DockerContainerInfo => ({
                    id: c.Id,
                    name: (c.Names?.[0] ?? "").replace(/^\//, ""),
                    image: c.Image,
                    state: c.State,
                    status: c.Status,
                    ports: (c.Ports ?? [])
                        .filter((p) => typeof p.PrivatePort === "number")
                        .map((p) => ({ privatePort: p.PrivatePort, publicPort: p.PublicPort, type: p.Type ?? "tcp" })),
                    composeProject: c.Labels?.["com.docker.compose.project"],
                })),
                images: images.map((im): DockerImageInfo => ({
                    id: im.Id,
                    tags: im.RepoTags?.filter((t) => t && t !== "<none>:<none>") ?? [],
                    sizeBytes: im.Size ?? 0,
                    created: (im.Created ?? 0) * 1000,
                })),
                volumes: (volumesRes.Volumes ?? []).map((v): DockerVolumeInfo => ({ name: v.Name, driver: v.Driver })),
                networks: networks.map((n): DockerNetworkInfo => ({ id: n.Id, name: n.Name, driver: n.Driver })),
            };
        } catch (err: unknown) {
            return {
                available: false,
                error: err instanceof Error ? err.message : String(err),
                containers: [],
                images: [],
                volumes: [],
                networks: [],
            };
        }
    }

    private mapInfo(
        version: { Version?: string; ApiVersion?: string; Os?: string; Arch?: string; Platform?: { Name?: string } },
        info: Record<string, unknown>,
        dfRaw: unknown,
    ): DockerEngineInfo {
        const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
        const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

        let reclaimableBytes: number | undefined;
        let imagesSizeBytes: number | undefined;
        let containersSizeBytes: number | undefined;
        let volumesSizeBytes: number | undefined;
        let buildCacheSizeBytes: number | undefined;

        if (dfRaw && typeof dfRaw === "object") {
            const df = dfRaw as {
                Images?: Array<{ Size?: number; SharedSize?: number }>;
                Containers?: Array<{ SizeRw?: number; SizeRootFs?: number }>;
                Volumes?: Array<{ UsageData?: { Size?: number } }>;
                BuildCache?: Array<{ Size?: number }>;
                LayersSize?: number;
            };
            imagesSizeBytes = Array.isArray(df.Images)
                ? df.Images.reduce((s, i) => s + (i.Size ?? 0), 0)
                : num(df.LayersSize);
            containersSizeBytes = Array.isArray(df.Containers)
                ? df.Containers.reduce((s, c) => s + (c.SizeRw ?? 0), 0)
                : undefined;
            volumesSizeBytes = Array.isArray(df.Volumes)
                ? df.Volumes.reduce((s, v) => s + (v.UsageData?.Size ?? 0), 0)
                : undefined;
            buildCacheSizeBytes = Array.isArray(df.BuildCache)
                ? df.BuildCache.reduce((s, b) => s + (b.Size ?? 0), 0)
                : undefined;
            reclaimableBytes = buildCacheSizeBytes;
        }

        return {
            version: str(version.Version) ?? str(info.ServerVersion),
            apiVersion: str(version.ApiVersion),
            platformName: str(version.Platform?.Name) ?? str(info.Name),
            osType: str(version.Os) ?? str(info.OSType),
            architecture: str(version.Arch) ?? str(info.Architecture),
            kernelVersion: str(info.KernelVersion),
            operatingSystem: str(info.OperatingSystem),
            ncpu: num(info.NCPU),
            memTotal: num(info.MemTotal),
            driver: str(info.Driver),
            dockerRootDir: str(info.DockerRootDir),
            name: str(info.Name),
            serverVersion: str(info.ServerVersion),
            containers: num(info.Containers),
            containersRunning: num(info.ContainersRunning),
            containersPaused: num(info.ContainersPaused),
            containersStopped: num(info.ContainersStopped),
            images: num(info.Images),
            reclaimableBytes,
            imagesSizeBytes,
            containersSizeBytes,
            volumesSizeBytes,
            buildCacheSizeBytes,
        };
    }

    /**
     * Map host (published) port → owning container, for server-registry resolution.
     * Keep the image and container-side port: a database commonly publishes 5432 on an
     * arbitrary host port, so the host port alone cannot identify its protocol safely.
     */
    async publishedPorts(): Promise<Map<number, { name: string; compose?: string; id: string; image?: string; privatePort?: number }>> {
        const map = new Map<number, { name: string; compose?: string; id: string; image?: string; privatePort?: number }>();
        try {
            const containers = await this.docker.listContainers({ all: false });
            for (const c of containers) {
                const name = (c.Names?.[0] ?? "").replace(/^\//, "");
                const compose = c.Labels?.["com.docker.compose.project"];
                for (const p of c.Ports ?? []) {
                    if (typeof p.PublicPort === "number") {
                        map.set(p.PublicPort, {
                            name,
                            compose,
                            id: c.Id,
                            image: c.Image,
                            privatePort: typeof p.PrivatePort === "number" ? p.PrivatePort : undefined,
                        });
                    }
                }
            }
        } catch {
            /* engine not reachable — empty map */
        }
        return map;
    }

    async action(action: DockerAction, id: string): Promise<void> {
        const c = this.docker.getContainer(validateContainerId(id));
        switch (action) {
            case "start":
                await c.start();
                break;
            case "stop":
                await c.stop();
                break;
            case "restart":
                await c.restart();
                break;
            case "pause":
                await c.pause();
                break;
            case "unpause":
                await c.unpause();
                break;
            case "remove":
                // Never turn a regular Remove click into an implicit stop + force delete.
                // Docker rejects this for a running container, so the user must stop it
                // explicitly first. Anonymous/named volumes are preserved by default.
                await c.remove({ force: false, v: false });
                break;
            default:
                throw new Error(`Unsupported Docker container action: ${String(action)}`);
        }
    }

    /**
     * Engine cleanup. `all` runs every prune type; individual targets map 1:1 to
     * docker system / docker builder prune equivalents.
     */
    async prune(
        target: DockerPruneTarget,
        selected?: Partial<Record<"containers" | "images" | "volumes" | "networks" | "buildCache", boolean>>,
    ): Promise<DockerPruneSummary> {
        if (target !== "all" && !CONCRETE_PRUNE_TARGETS.includes(target as DockerConcretePruneTarget)) {
            throw new Error(`Unsupported Docker cleanup target: ${String(target)}`);
        }

        const targets: DockerConcretePruneTarget[] = target === "all"
            ? selected
                ? CONCRETE_PRUNE_TARGETS.filter((candidate) =>
                      candidate === "buildcache" ? selected.buildCache === true : selected[candidate] === true,
                  )
                : [...CONCRETE_PRUNE_TARGETS]
            : [target];
        const summary: DockerPruneSummary = {
            targets,
            deletedByTarget: {},
            spaceReclaimedBytes: 0,
            failures: [],
        };

        // Run sequentially to avoid putting a large engine under concurrent prune load.
        // Aggregate every failure so an `all` cleanup can never be reported as a false
        // success merely because one of its individual errors was swallowed.
        for (const concrete of targets) {
            try {
                const result = await this.pruneOne(concrete);
                summary.deletedByTarget[concrete] = result.deleted;
                summary.spaceReclaimedBytes += result.spaceReclaimedBytes;
            } catch (error: unknown) {
                summary.failures.push({ target: concrete, error: errorMessage(error) });
            }
        }
        return summary;
    }

    private async pruneOne(target: DockerConcretePruneTarget): Promise<{ deleted: number; spaceReclaimedBytes: number }> {
        switch (target) {
            case "containers": {
                const result = await this.docker.pruneContainers();
                return { deleted: result.ContainersDeleted?.length ?? 0, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
            }
            case "images": {
                const result = await this.docker.pruneImages();
                return { deleted: result.ImagesDeleted?.length ?? 0, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
            }
            case "volumes": {
                const result = await this.docker.pruneVolumes();
                return { deleted: result.VolumesDeleted?.length ?? 0, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
            }
            case "networks": {
                const result = await this.docker.pruneNetworks();
                return { deleted: result.NetworksDeleted?.length ?? 0, spaceReclaimedBytes: 0 };
            }
            case "buildcache": {
                const result = await this.docker.pruneBuilder();
                return { deleted: 0, spaceReclaimedBytes: result.SpaceReclaimed ?? 0 };
            }
        }
    }
}
