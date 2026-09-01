// Coretex — Terminal Buddy package-manager resolution. Given a probed
// TerminalEnvironment, decide the RIGHT package manager + install/search command
// shape for THIS exact environment, so the planner never emits an apt command on
// Alpine or a brew command on Ubuntu. The resolution is purely deterministic
// (driven by the probe), and is folded into the plan/system prompt as concrete
// guidance — the model still writes the final command, but anchored to reality.
//
// SSH/Docker/WSL note: the probe runs INSIDE the shell, so env.packageManagers and
// env.os already describe the REMOTE/inner environment. We resolve against those
// directly — no host-vs-remote ambiguity to special-case here.

import type { TerminalEnvironment, PackageManagerInfo } from "../types.js";

/** A resolved package-manager plan for install-style tasks. */
export interface PmResolution {
    /** The chosen system package manager (apt/dnf/brew/winget/apk/…) or undefined if none. */
    system?: string;
    /** Ordered fallbacks for the system layer (e.g. apt → snap → flatpak). */
    systemFallbacks: string[];
    /** Detected language-level managers (npm/pip/cargo/gem/…) for language packages. */
    language: string[];
    /** Whether sudo should prefix system mutations (Linux/macOS non-root with sudo). */
    needsSudo: boolean;
    /** Concrete command templates ({pkg} is replaced by the package name). */
    templates: {
        /** Refresh package indexes before install (may be empty — e.g. brew/winget). */
        update?: string;
        /** Install a named package non-interactively. */
        install?: string;
        /** Search for a package. */
        search?: string;
    };
    /** Human-readable one-liner the system prompt embeds verbatim. */
    summary: string;
}

const SYSTEM_PM_PRIORITY = ["apt", "dnf", "yum", "pacman", "zypper", "apk", "brew", "winget", "choco", "scoop", "snap", "flatpak", "nix", "port", "pkg"];
const LANG_PMS = new Set(["npm", "pnpm", "yarn", "bun", "pip", "pip3", "pipx", "cargo", "gem", "composer", "go", "deno"]);

/** System managers that can act as a secondary fallback after the native one. */
const FALLBACK_LAYERS = ["snap", "flatpak", "nix"];

function present(env: TerminalEnvironment): Set<string> {
    const names = new Set<string>();
    for (const p of env.packageManagers ?? []) names.add(p.name);
    for (const p of env.tools ?? []) names.add(p.name);
    return names;
}

/** Non-interactive install template for a given manager. {pkg} is the placeholder. */
function templatesFor(pm: string, sudo: string): { update?: string; install?: string; search?: string } {
    switch (pm) {
        case "apt":
            return { update: `${sudo}apt-get update`, install: `${sudo}apt-get install -y {pkg}`, search: `apt-cache search {pkg}` };
        case "dnf":
            return { install: `${sudo}dnf install -y {pkg}`, search: `dnf search {pkg}` };
        case "yum":
            return { install: `${sudo}yum install -y {pkg}`, search: `yum search {pkg}` };
        case "pacman":
            return { update: `${sudo}pacman -Sy`, install: `${sudo}pacman -S --noconfirm {pkg}`, search: `pacman -Ss {pkg}` };
        case "zypper":
            return { install: `${sudo}zypper --non-interactive install {pkg}`, search: `zypper search {pkg}` };
        case "apk":
            return { update: `${sudo}apk update`, install: `${sudo}apk add --no-cache {pkg}`, search: `apk search {pkg}` };
        case "brew":
            // Homebrew must NOT run under sudo.
            return { update: `brew update`, install: `brew install {pkg}`, search: `brew search {pkg}` };
        case "winget":
            return { install: `winget install --silent --accept-package-agreements --accept-source-agreements {pkg}`, search: `winget search {pkg}` };
        case "choco":
            return { install: `choco install {pkg} -y`, search: `choco search {pkg}` };
        case "scoop":
            return { update: `scoop update`, install: `scoop install {pkg}`, search: `scoop search {pkg}` };
        case "snap":
            return { install: `${sudo}snap install {pkg}`, search: `snap find {pkg}` };
        case "flatpak":
            return { install: `flatpak install -y {pkg}`, search: `flatpak search {pkg}` };
        case "nix":
            return { install: `nix-env -iA nixpkgs.{pkg}`, search: `nix search nixpkgs {pkg}` };
        case "port":
            return { install: `${sudo}port install {pkg}`, search: `port search {pkg}` };
        case "pkg":
            return { install: `${sudo}pkg install -y {pkg}`, search: `pkg search {pkg}` };
        default:
            return {};
    }
}

/**
 * Resolve the correct package-manager strategy for the probed environment.
 * Deterministic: never guesses a manager that wasn't detected, and respects the
 * OS family (Windows → winget/choco/scoop; macOS → brew; Linux → distro-native;
 * Alpine/Docker → apk) plus sudo/root state.
 */
export function resolvePackageManager(env: TerminalEnvironment | undefined): PmResolution {
    if (!env) {
        return { systemFallbacks: [], language: [], needsSudo: false, templates: {}, summary: "Environment unknown — probe before resolving package managers." };
    }

    const have = present(env);
    const isWindows = env.os === "windows";
    const isMac = env.os === "macos";

    // sudo prefix: only on POSIX, only when not root, only when sudo exists.
    const needsSudo = !isWindows && !env.isRoot && !!env.hasSudo;
    const sudoPrefix = needsSudo ? "sudo " : "";

    // Pick the primary system manager: honor the probe's flag first, else fall
    // back to OS-family-aware priority order over what's actually present.
    const probedPrimary = (env.packageManagers ?? []).find((p) => p.primary && !LANG_PMS.has(p.name))?.name;
    let system = probedPrimary;
    if (!system) {
        // Restrict the candidate set to the OS family so we never pick brew on Linux, etc.
        const candidates = SYSTEM_PM_PRIORITY.filter((n) => {
            if (isWindows) return n === "winget" || n === "choco" || n === "scoop";
            if (isMac) return n === "brew" || n === "port" || n === "nix";
            // Linux/BSD: distro-native + universal layers.
            return n !== "winget" && n !== "choco" && n !== "scoop" && n !== "brew" && n !== "port";
        });
        system = candidates.find((n) => have.has(n));
    }

    // Fallback layers (snap/flatpak/nix) that are present and aren't the primary.
    const systemFallbacks = FALLBACK_LAYERS.filter((n) => n !== system && have.has(n));

    // Language-level managers, in a stable, sensible order.
    const language: string[] = [];
    for (const p of [...(env.tools ?? []), ...(env.packageManagers ?? [])] as PackageManagerInfo[]) {
        if (LANG_PMS.has(p.name) && !language.includes(p.name)) language.push(p.name);
    }

    const templates = system ? templatesFor(system, sudoPrefix) : {};

    const where =
        env.connectionKind === "ssh"
            ? `the SSH remote${env.sshHost ? ` (${env.sshHost})` : ""}`
            : env.connectionKind === "docker"
              ? `the Docker container${env.dockerContainer ? ` (${env.dockerContainer})` : ""}`
              : env.connectionKind === "wsl"
                ? `WSL${env.wslDistro ? ` (${env.wslDistro})` : ""}`
                : "this machine";
    const osLabel = env.distro
        ? `${env.distro}${env.distroVersion ? ` ${env.distroVersion}` : ""}`
        : env.osName ?? env.os ?? "unknown OS";

    const parts: string[] = [];
    if (system) {
        parts.push(`On ${where} (${osLabel}), install system packages with ${system}${needsSudo ? " (prefix sudo)" : env.isRoot ? " (already root — no sudo)" : ""}.`);
        if (templates.install) parts.push(`Install: \`${templates.install}\``);
        if (templates.update) parts.push(`Refresh first if needed: \`${templates.update}\``);
        if (systemFallbacks.length) parts.push(`If a package is missing from ${system}, fall back to: ${systemFallbacks.join(", ")}.`);
    } else {
        parts.push(`No system package manager detected on ${where} (${osLabel}) — prefer language managers, or install one (e.g. ${isMac ? "Homebrew" : isWindows ? "winget" : "the distro's manager"}) first.`);
    }
    if (language.length) parts.push(`Use ${language.join("/")} for language-level packages.`);

    return { system, systemFallbacks, language, needsSudo, templates, summary: parts.join(" ") };
}

/** True when the request reads like a non-trivial install/setup task (web-search candidate). */
export function looksLikeComplexInstall(request: string): boolean {
    const r = request.toLowerCase();
    const installVerb = /\b(install|set ?up|configure|provision|deploy|build from source|compile|upgrade|add)\b/.test(r);
    if (!installVerb) return false;
    // Signals that the install is non-trivial (drivers, version pins, source builds, services).
    const complexSignal =
        /\b(driver|cuda|gpu|nvidia|kernel|from source|build|compile|toolchain|cross-compile|service|systemd|daemon|cluster|ppa|repository|repo|signing key|gpg|tarball|\.deb|\.rpm|version\s|v?\d+\.\d+|specific version|latest|docker|kubernetes|k8s|helm)\b/.test(r);
    // Or simply a long, multi-tool request.
    const longish = request.length > 80 || /\band\b/.test(r);
    return complexSignal || longish;
}
