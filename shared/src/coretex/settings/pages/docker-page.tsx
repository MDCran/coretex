// @ts-nocheck
"use client";

// Coretex Relay — Docker settings (not the live Docker dashboard). Engine
// connection, behavior, disk cleanup (prune), and container registries
// (Docker Hub, GHCR, AWS ECR, GCR, ACR, Quay, GitLab, custom). Live engine
// info/version comes from DockerState; preferences persist under settings.docker.
import { useEffect, useMemo, useState } from "react";
import type { CoretexConfig, DockerPruneTarget, DockerRegistry, DockerRegistryKind } from "@repo/coretex/types";
import { Cloud01, Container, Cube01, Database01, HardDrive, Plus, RefreshCcw01, Server01, Settings01, Trash01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { RichSelect } from "@/components/base/select/rich-select";
import { BrandLogo } from "../../ui/brand-logo";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingSlider, SettingText, SettingToggle, SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";

function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "—";
    const gb = bytes / 1e9;
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / 1e6;
    if (mb >= 1) return `${Math.round(mb)} MB`;
    return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

const REGISTRY_KINDS: {
    value: DockerRegistryKind;
    label: string;
    supportingText: string;
    defaultUrl: string;
    domain: string;
}[] = [
    {
        value: "dockerhub",
        label: "Docker Hub",
        supportingText: "docker.io — public and private Hub repos",
        defaultUrl: "docker.io",
        domain: "docker.com",
    },
    {
        value: "ghcr",
        label: "GitHub Container Registry",
        supportingText: "ghcr.io — GitHub Packages",
        defaultUrl: "ghcr.io",
        domain: "github.com",
    },
    {
        value: "ecr",
        label: "Amazon ECR",
        supportingText: "AWS Elastic Container Registry",
        defaultUrl: "",
        domain: "aws.amazon.com",
    },
    {
        value: "gcr",
        label: "Google Container Registry",
        supportingText: "gcr.io — legacy GCR",
        defaultUrl: "gcr.io",
        domain: "cloud.google.com",
    },
    {
        value: "gar",
        label: "Google Artifact Registry",
        supportingText: "pkg.dev — Artifact Registry",
        defaultUrl: "",
        domain: "cloud.google.com",
    },
    {
        value: "acr",
        label: "Azure Container Registry",
        supportingText: "*.azurecr.io",
        defaultUrl: "",
        domain: "azure.com",
    },
    {
        value: "quay",
        label: "Quay.io",
        supportingText: "Red Hat Quay",
        defaultUrl: "quay.io",
        domain: "quay.io",
    },
    {
        value: "gitlab",
        label: "GitLab Registry",
        supportingText: "registry.gitlab.com",
        defaultUrl: "registry.gitlab.com",
        domain: "gitlab.com",
    },
    {
        value: "custom",
        label: "Custom registry",
        supportingText: "Private or self-hosted registry",
        defaultUrl: "",
        domain: "docker.com",
    },
];

const KIND_DOMAIN: Record<DockerRegistryKind, string> = Object.fromEntries(REGISTRY_KINDS.map((k) => [k.value, k.domain])) as Record<
    DockerRegistryKind,
    string
>;

function makeId(): string {
    return "reg-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function defaultEcrUrl(region: string): string {
    const r = region.trim() || "us-east-1";
    return `XXXXXXXXXXXX.dkr.ecr.${r}.amazonaws.com`;
}

export const DockerPage = ({ settings, state, actions }: { settings: CoretexConfig; state: CoretexState; actions: CoretexActions }) => {
    const docker = state.docker;
    const cfg = settings.docker ?? {
        enabled: true,
        socketPath: "",
        host: "",
        tlsVerify: false,
        autoRefresh: true,
        pollIntervalSec: 6,
        showStoppedContainers: true,
        confirmDestructive: true,
        pruneDefaults: {
            containers: true,
            images: true,
            volumes: true,
            networks: true,
            buildCache: true,
        },
        registries: [],
    };
    const destructiveAction = useConfirm();
    const info = docker?.info;

    useEffect(() => {
        if (cfg.enabled !== false) actions.dockerRefresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cfg.enabled, cfg.socketPath, cfg.host, cfg.tlsVerify]);

    const patchDocker = (partial: Partial<typeof cfg>): void => {
        actions.updateSettings({ docker: { ...cfg, ...partial } });
    };

    const writeRegistries = (registries: DockerRegistry[]): void => {
        patchDocker({ registries });
    };

    const prune = (target: DockerPruneTarget): void => {
        if (cfg.confirmDestructive) {
            const labels: Record<DockerPruneTarget, string> = {
                containers: "stopped containers",
                images: "unused images",
                volumes: "unused volumes",
                networks: "unused networks",
                buildcache: "build cache",
                all: "all selected Docker resources",
            };
            destructiveAction.confirm({
                title: `Prune ${labels[target]}?`,
                description: "Docker will permanently remove resources that are currently unused. This cannot be undone.",
                confirmLabel: target === "all" ? "Prune everything" : "Prune",
                onConfirm: () => actions.dockerPrune(target),
            });
            return;
        }
        actions.dockerPrune(target);
    };

    const addRegistry = (kind: DockerRegistryKind = "dockerhub"): void => {
        const meta = REGISTRY_KINDS.find((k) => k.value === kind) ?? REGISTRY_KINDS[REGISTRY_KINDS.length - 1]!;
        const reg: DockerRegistry = {
            id: makeId(),
            name: meta.label,
            url: kind === "ecr" ? defaultEcrUrl("us-east-1") : meta.defaultUrl,
            kind,
            username: kind === "ecr" ? "AWS" : "",
            passwordConfigured: false,
            awsRegion: kind === "ecr" ? "us-east-1" : undefined,
        };
        writeRegistries([...cfg.registries, reg]);
    };

    const engineRows = useMemo(() => {
        if (!docker?.available || !info) return [];
        return [
            { label: "Engine version", value: info.version ?? docker.version ?? "—" },
            { label: "API version", value: info.apiVersion ?? "—" },
            {
                label: "OS / Arch",
                value: [info.operatingSystem ?? info.osType, info.architecture].filter(Boolean).join(" · ") || "—",
            },
            { label: "Kernel", value: info.kernelVersion ?? "—" },
            { label: "CPUs", value: info.ncpu != null ? String(info.ncpu) : "—" },
            { label: "Memory", value: formatBytes(info.memTotal) },
            { label: "Storage driver", value: info.driver ?? "—" },
            { label: "Docker root", value: info.dockerRootDir ?? "—" },
            { label: "Hostname", value: info.name ?? "—" },
        ];
    }, [docker, info]);

    const kindOptions = REGISTRY_KINDS.map((k) => ({
        value: k.value,
        label: k.label,
        supportingText: k.supportingText,
        hint: k.label,
    }));

    return (
        <div className="flex flex-col gap-6">
            {destructiveAction.dialog}
            <SettingsPageHeader
                icon={Container}
                title="Docker"
                subtitle="Engine connection, cleanup, and container registries. Manage running containers in the Docker view."
                badges={
                    docker?.available ? (
                        <SettingsStatusBadge label={`v${docker.version ?? info?.version ?? "?"}`} color="success" />
                    ) : cfg.enabled === false ? (
                        <SettingsStatusBadge label="Disabled" color="gray" />
                    ) : (
                        <SettingsStatusBadge label="Not detected" color="error" />
                    )
                }
                actions={
                    <Button size="sm" color="secondary" iconLeading={RefreshCcw01} onClick={() => actions.dockerRefresh()} isDisabled={cfg.enabled === false}>
                        Refresh engine
                    </Button>
                }
            />

            {/* —— Engine status —— */}
            <SettingsSection title="Engine status" description="Live information from the Docker daemon (docker info / version / system df).">
                {!docker?.available ? (
                    <div className="py-2">
                        <p className="text-sm text-tertiary">
                            {cfg.enabled === false
                                ? "Docker integration is turned off below."
                                : "Docker engine not reachable. Start Docker Desktop (or the daemon), or adjust the connection settings."}
                        </p>
                        {docker?.error && <p className="mt-2 font-mono text-xs text-quaternary">{docker.error}</p>}
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4">
                            <MiniStat
                                icon={Server01}
                                label="Containers"
                                value={`${info?.containersRunning ?? 0} / ${info?.containers ?? docker.containers.length}`}
                            />
                            <MiniStat
                                icon={Cube01}
                                label="Images"
                                value={String(info?.images ?? docker.images.length)}
                                hint={formatBytes(info?.imagesSizeBytes)}
                            />
                            <MiniStat icon={Database01} label="Volumes" value={String(docker.volumes.length)} hint={formatBytes(info?.volumesSizeBytes)} />
                            <MiniStat icon={HardDrive} label="Build cache" value={formatBytes(info?.buildCacheSizeBytes)} hint="reclaimable" />
                        </div>
                        <div className="grid gap-x-8 gap-y-2 py-2 sm:grid-cols-2">
                            {engineRows.map((row) => (
                                <div
                                    key={row.label}
                                    className="flex items-baseline justify-between gap-3 border-b border-[color:var(--c-divider,color-mix(in_srgb,var(--c-text-muted)_18%,transparent))] py-2 last:border-0 sm:last:border-b"
                                >
                                    <span className="text-xs text-tertiary">{row.label}</span>
                                    <span className="min-w-0 truncate text-right font-mono text-xs text-secondary" title={row.value}>
                                        {row.value}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </SettingsSection>

            {/* —— Connection —— */}
            <SettingsSection title="Connection" description="How Coretex talks to the Docker engine. Leave blank to use the platform default socket.">
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.enabled"
                    label="Enable Docker integration"
                    description="When off, Coretex stops polling the engine and hides live Docker data."
                />
                <SettingText
                    settings={settings}
                    actions={actions}
                    path="docker.socketPath"
                    label="Socket path"
                    description="Windows named pipe or Unix socket. Example: //./pipe/docker_engine or /var/run/docker.sock"
                    placeholder="(platform default)"
                />
                <SettingText
                    settings={settings}
                    actions={actions}
                    path="docker.host"
                    label="DOCKER_HOST"
                    description="Remote or TCP engine, e.g. tcp://192.168.1.10:2375 or https://docker.example:2376"
                    placeholder="(use socket)"
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.tlsVerify"
                    label="TLS verify"
                    description="Use HTTPS when connecting over TCP (DOCKER_TLS_VERIFY-style)."
                />
            </SettingsSection>

            {/* —— Dashboard behavior —— */}
            <SettingsSection title="Dashboard behavior" description="How the Docker view refreshes and what it shows.">
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.autoRefresh"
                    label="Auto-refresh"
                    description="Poll the engine while the Docker view is open."
                />
                <SettingSlider
                    settings={settings}
                    actions={actions}
                    path="docker.pollIntervalSec"
                    label="Poll interval"
                    description="Seconds between automatic refreshes."
                    min={3}
                    max={60}
                    unit="s"
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.showStoppedContainers"
                    label="Show stopped containers"
                    description="Include exited and created containers in the Docker view list."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.confirmDestructive"
                    label="Confirm destructive actions"
                    description="Require a second click before remove or prune."
                />
            </SettingsSection>

            {/* —— Disk cleanup —— */}
            <SettingsSection
                title="Disk cleanup"
                description="Same as docker system prune / docker builder prune. Safe defaults reclaim unused resources only."
            >
                <div className="grid gap-3 py-2 sm:grid-cols-2">
                    <PruneCard
                        title="Stopped containers"
                        description="docker container prune — remove exited containers."
                        onClick={() => prune("containers")}
                        disabled={!docker?.available}
                    />
                    <PruneCard
                        title="Unused images"
                        description="docker image prune — remove dangling and unused images."
                        onClick={() => prune("images")}
                        disabled={!docker?.available}
                        hint={formatBytes(info?.imagesSizeBytes)}
                    />
                    <PruneCard
                        title="Unused volumes"
                        description="docker volume prune — remove volumes not used by any container."
                        onClick={() => prune("volumes")}
                        disabled={!docker?.available}
                        hint={formatBytes(info?.volumesSizeBytes)}
                    />
                    <PruneCard
                        title="Unused networks"
                        description="docker network prune — remove networks not used by containers."
                        onClick={() => prune("networks")}
                        disabled={!docker?.available}
                    />
                    <PruneCard
                        title="Build cache"
                        description="docker builder prune — clear BuildKit / builder cache."
                        onClick={() => prune("buildcache")}
                        disabled={!docker?.available}
                        hint={formatBytes(info?.buildCacheSizeBytes)}
                    />
                    <PruneCard
                        title="Clean up everything"
                        description="Runs the prune types enabled under “Clean up includes” below."
                        onClick={() => prune("all")}
                        disabled={!docker?.available}
                        primary
                    />
                </div>

                <p className="pt-3 text-xs font-medium text-secondary">Clean up includes</p>
                <p className="pb-1 text-xs text-quaternary">Controls what the Docker view “Clean up” button and “Clean up everything” reclaim.</p>
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.pruneDefaults.containers"
                    label="Containers"
                    description="Remove stopped containers."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.pruneDefaults.images"
                    label="Images"
                    description="Prune unused / dangling images."
                />
                <SettingToggle settings={settings} actions={actions} path="docker.pruneDefaults.volumes" label="Volumes" description="Prune unused volumes." />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.pruneDefaults.networks"
                    label="Networks"
                    description="Prune unused networks."
                />
                <SettingToggle
                    settings={settings}
                    actions={actions}
                    path="docker.pruneDefaults.buildCache"
                    label="Build cache"
                    description="Clear builder / BuildKit cache."
                />
            </SettingsSection>

            <p className="text-xs text-quaternary">
                Live containers, compose linking, and per-object actions live in the Docker view — this page is for engine preferences and cleanup only.
                {Object.keys(settings.dockerLinks ?? {}).length > 0 && (
                    <>
                        {" "}
                        · {Object.keys(settings.dockerLinks).length} compose project link
                        {Object.keys(settings.dockerLinks).length === 1 ? "" : "s"} saved.
                    </>
                )}
            </p>
        </div>
    );
};

const MiniStat = ({ icon: Icon, label, value, hint }: { icon: typeof Cube01; label: string; value: string; hint?: string }) => (
    <div
        className="rounded-xl p-3"
        style={{
            background: "var(--surface-2)",
            border: "1px solid var(--c-border)",
        }}
    >
        <div className="flex items-center gap-2 text-xs text-tertiary">
            <Icon className="size-3.5" />
            {label}
        </div>
        <p className="mt-1.5 text-sm font-semibold text-primary">{value}</p>
        {hint && <p className="text-[11px] text-quaternary">{hint}</p>}
    </div>
);

const PruneCard = ({
    title,
    description,
    onClick,
    disabled,
    hint,
    primary,
}: {
    title: string;
    description: string;
    onClick: () => void;
    disabled?: boolean;
    hint?: string;
    primary?: boolean;
}) => (
    <div
        className="flex flex-col justify-between gap-3 rounded-xl p-4"
        style={{
            background: "var(--surface-2)",
            border: "1px solid var(--c-border)",
        }}
    >
        <div>
            <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-primary">{title}</p>
                {hint && hint !== "—" && (
                    <Badge size="sm" color="gray">
                        {hint}
                    </Badge>
                )}
            </div>
            <p className="mt-1 text-xs text-tertiary">{description}</p>
        </div>
        <Button
            size="sm"
            color={primary ? "primary-destructive" : "tertiary-destructive"}
            iconLeading={Trash01}
            onClick={onClick}
            isDisabled={disabled}
            className="self-start"
        >
            Prune
        </Button>
    </div>
);

const RegistryCard = ({
    reg,
    kindOptions,
    onChange,
    onRemove,
    onSavePassword,
}: {
    reg: DockerRegistry;
    kindOptions: {
        value: string;
        label: string;
        supportingText?: string;
        hint?: string;
    }[];
    onChange: (next: DockerRegistry) => void;
    onRemove: () => void;
    onSavePassword: (password: string) => void;
}) => {
    const [password, setPassword] = useState("");
    const [note, setNote] = useState<string | null>(null);
    const isEcr = reg.kind === "ecr";

    return (
        <div
            className="rounded-xl p-4"
            style={{
                background: "var(--surface-2)",
                border: "1px solid var(--c-border)",
            }}
        >
            <div className="flex flex-wrap items-center gap-3">
                <BrandLogo domain={KIND_DOMAIN[reg.kind] ?? "docker.com"} name={reg.kind} size={22} className="shrink-0" />
                <div className="min-w-0 flex-1">
                    <Input aria-label="Registry name" value={reg.name} placeholder="Name" onChange={(v: string) => onChange({ ...reg, name: v })} />
                </div>
                <div className="w-full shrink-0 sm:w-56">
                    <RichSelect
                        aria-label="Registry type"
                        options={kindOptions}
                        value={reg.kind}
                        rich
                        onChange={(e) => {
                            const kind = e.target.value as DockerRegistryKind;
                            const meta = REGISTRY_KINDS.find((k) => k.value === kind);
                            onChange({
                                ...reg,
                                kind,
                                url: meta?.defaultUrl || (kind === "ecr" ? defaultEcrUrl(reg.awsRegion ?? "us-east-1") : reg.url),
                                username: kind === "ecr" ? reg.username || "AWS" : reg.username,
                                awsRegion: kind === "ecr" ? reg.awsRegion || "us-east-1" : undefined,
                                name: reg.name === REGISTRY_KINDS.find((k) => k.value === reg.kind)?.label ? (meta?.label ?? reg.name) : reg.name,
                            });
                        }}
                    />
                </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className={isEcr ? "sm:col-span-2" : ""}>
                    <label className="mb-1.5 block text-xs font-medium text-secondary">Registry URL / host</label>
                    <Input
                        aria-label="Registry URL"
                        value={reg.url}
                        placeholder={isEcr ? "123456789012.dkr.ecr.us-east-1.amazonaws.com" : "registry.example.com"}
                        onChange={(v: string) => onChange({ ...reg, url: v })}
                    />
                </div>
                {isEcr && (
                    <>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-secondary">AWS region</label>
                            <Input
                                aria-label="AWS region"
                                value={reg.awsRegion ?? ""}
                                placeholder="us-east-1"
                                onChange={(v: string) =>
                                    onChange({
                                        ...reg,
                                        awsRegion: v,
                                        url: reg.url.includes(".dkr.ecr.")
                                            ? defaultEcrUrl(v).replace("XXXXXXXXXXXX", reg.url.split(".")[0] || "XXXXXXXXXXXX")
                                            : reg.url,
                                    })
                                }
                            />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-secondary">AWS profile (optional)</label>
                            <Input
                                aria-label="AWS profile"
                                value={reg.awsProfile ?? ""}
                                placeholder="default"
                                onChange={(v: string) => onChange({ ...reg, awsProfile: v || undefined })}
                            />
                        </div>
                    </>
                )}
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-secondary">Username</label>
                    <Input
                        aria-label="Username"
                        value={reg.username ?? ""}
                        placeholder={isEcr ? "AWS" : "username"}
                        onChange={(v: string) => onChange({ ...reg, username: v })}
                    />
                </div>
                <div>
                    <label className="mb-1.5 block text-xs font-medium text-secondary">Password / token</label>
                    <div className="flex gap-2">
                        <div className="min-w-0 flex-1">
                            <Input
                                aria-label="Password"
                                type="password"
                                value={password}
                                placeholder={reg.passwordConfigured ? "••••••••  (saved)" : isEcr ? "aws ecr get-login-password" : "Token or password"}
                                onChange={(v: string) => {
                                    setPassword(v);
                                    setNote(null);
                                }}
                            />
                        </div>
                        <Button
                            size="md"
                            color="secondary"
                            onClick={() => {
                                if (!password) {
                                    setNote("Enter a password or token first.");
                                    return;
                                }
                                onSavePassword(password);
                                setPassword("");
                                setNote(isEcr ? "ECR token saved. Tokens expire ~12h — refresh when pulls fail." : "Password saved.");
                            }}
                        >
                            Save
                        </Button>
                    </div>
                    {note ? (
                        <p className="mt-1.5 text-xs text-tertiary">{note}</p>
                    ) : reg.passwordConfigured ? (
                        <p className="mt-1.5 text-xs text-quaternary">Credentials stored in the protected local credential store.</p>
                    ) : isEcr ? (
                        <p className="mt-1.5 text-xs text-quaternary">
                            Paste output of <code className="text-[11px]">aws ecr get-login-password --region {reg.awsRegion || "us-east-1"}</code>
                        </p>
                    ) : null}
                </div>
            </div>

            <div className="mt-3 flex justify-end">
                <Button size="sm" color="link-destructive" iconLeading={Trash01} onClick={onRemove}>
                    Remove
                </Button>
            </div>
        </div>
    );
};
