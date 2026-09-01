// Coretex — Terminal Buddy environment probe. Runs a single shell-specific
// one-liner in the live PTY (via the block-capture channel) that prints a set of
// `key=value` lines describing the shell's ACTUAL environment — OS, distro,
// shell+version, package managers, runtimes, user/privileges, connection kind —
// then parses them into a TerminalEnvironment. Because it runs IN the shell, an
// SSH/WSL/Docker session reports the REMOTE/inner environment, not the Brain host.

import type { TerminalManager } from "./manager.js";
import { runCaptured, type BuddyShellKind } from "./buddy-exec.js";
import type { TerminalEnvironment, PackageManagerInfo } from "../types.js";

export const PROBE_VERSION = "1";
/** Environment discovery is helpful, but it must never hold an interactive PTY for long. */
const PROBE_TIMEOUT_MS = 8_000;

// System package managers in priority order (first present → primary).
const SYSTEM_PMS = ["apt", "dnf", "yum", "pacman", "zypper", "apk", "brew", "winget", "choco", "scoop", "snap", "flatpak", "nix", "port", "pkg"];
const LANG_PMS = new Set(["npm", "pnpm", "yarn", "pip", "pip3", "pipx", "cargo", "gem", "composer", "go", "bun", "deno"]);

// One-line POSIX probe (bash/zsh/sh/fish-compatible enough via /bin/sh constructs).
const POSIX_PROBE = [
    `echo "os=$(uname -s 2>/dev/null)"`,
    `echo "kernel=$(uname -r 2>/dev/null)"`,
    `echo "arch=$(uname -m 2>/dev/null)"`,
    `if [ -r /etc/os-release ]; then . /etc/os-release 2>/dev/null; echo "distro=$ID"; echo "distrover=$VERSION_ID"; echo "osname=$PRETTY_NAME"; fi`,
    `echo "user=$(id -un 2>/dev/null || whoami 2>/dev/null)"`,
    `echo "uid=$(id -u 2>/dev/null)"`,
    `echo "home=$HOME"`,
    `echo "cwd=$(pwd 2>/dev/null)"`,
    `echo "shellpath=$SHELL"`,
    `if [ -n "$SSH_CONNECTION" ]; then echo "conn=ssh"; echo "sshconn=$SSH_CONNECTION"; fi`,
    `if [ -f /.dockerenv ]; then echo "conn=docker"; fi`,
    `if grep -qi microsoft /proc/version 2>/dev/null; then echo "conn=wsl"; fi`,
    `if [ -n "$WSL_DISTRO_NAME" ]; then echo "wsldistro=$WSL_DISTRO_NAME"; fi`,
    `if command -v systemctl >/dev/null 2>&1; then echo "init=systemd"; fi`,
    `if sudo -n true 2>/dev/null; then echo "sudo=passwordless"; elif command -v sudo >/dev/null 2>&1; then echo "sudo=yes"; else echo "sudo=no"; fi`,
    `for p in apt dnf yum pacman zypper apk brew winget choco scoop snap flatpak nix port pkg npm pnpm yarn pip pip3 pipx cargo gem composer go bun deno; do if command -v $p >/dev/null 2>&1; then echo "pm=$p|$(command -v $p)"; fi; done`,
    `for r in node python3 python ruby go rustc java php deno bun; do if command -v $r >/dev/null 2>&1; then echo "rt=$r|$(command -v $r)"; fi; done`,
    `command -v node >/dev/null 2>&1 && echo "rtv=node|$(node -v 2>/dev/null)"`,
    `command -v python3 >/dev/null 2>&1 && echo "rtv=python3|$(python3 --version 2>&1 | head -n1)"`,
    `command -v go >/dev/null 2>&1 && echo "rtv=go|$(go version 2>/dev/null)"`,
    `command -v rustc >/dev/null 2>&1 && echo "rtv=rustc|$(rustc --version 2>/dev/null)"`,
    `command -v java >/dev/null 2>&1 && echo "rtv=java|$(java -version 2>&1 | head -n1)"`,
].join("; ");

// One-line fish probe (fish syntax: command-substitution (cmd), `for … end`, `if … end`).
const FISH_PROBE = [
    `echo "os="(uname -s 2>/dev/null)`,
    `echo "kernel="(uname -r 2>/dev/null)`,
    `echo "arch="(uname -m 2>/dev/null)`,
    `if test -r /etc/os-release; echo "osname="(grep '^PRETTY_NAME=' /etc/os-release | cut -d= -f2- | tr -d '"'); echo "distro="(grep '^ID=' /etc/os-release | cut -d= -f2-); echo "distrover="(grep '^VERSION_ID=' /etc/os-release | cut -d= -f2- | tr -d '"'); end`,
    `echo "user="(id -un 2>/dev/null)`,
    `echo "uid="(id -u 2>/dev/null)`,
    `echo "home=$HOME"`,
    `echo "cwd="(pwd)`,
    `if set -q SSH_CONNECTION; echo "conn=ssh"; echo "sshconn=$SSH_CONNECTION"; end`,
    `if test -f /.dockerenv; echo "conn=docker"; end`,
    `if set -q WSL_DISTRO_NAME; echo "conn=wsl"; echo "wsldistro=$WSL_DISTRO_NAME"; end`,
    `if command -v systemctl >/dev/null 2>&1; echo "init=systemd"; end`,
    `if sudo -n true 2>/dev/null; echo "sudo=passwordless"; else if command -v sudo >/dev/null 2>&1; echo "sudo=yes"; else; echo "sudo=no"; end`,
    `for p in apt dnf yum pacman zypper apk brew winget choco scoop snap flatpak nix npm pnpm yarn pip pip3 pipx cargo gem composer go bun deno; if command -v $p >/dev/null 2>&1; echo "pm=$p|"(command -v $p); end; end`,
    `for r in node python3 python ruby go rustc java php deno bun; if command -v $r >/dev/null 2>&1; echo "rt=$r|"(command -v $r); end; end`,
    `if command -v node >/dev/null 2>&1; echo "rtv=node|"(node -v 2>/dev/null); end`,
    `if command -v python3 >/dev/null 2>&1; echo "rtv=python3|"(python3 --version 2>&1); end`,
].join("; ");

// One-line PowerShell probe.
const PS_PROBE = [
    `Write-Output "os=Windows"`,
    `Write-Output "osname=$((Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption)"`,
    `Write-Output "osver=$([Environment]::OSVersion.Version.ToString())"`,
    `Write-Output "arch=$env:PROCESSOR_ARCHITECTURE"`,
    `Write-Output "user=$env:USERNAME"`,
    `Write-Output "home=$env:USERPROFILE"`,
    `Write-Output "cwd=$((Get-Location).Path)"`,
    `Write-Output "shellver=$($PSVersionTable.PSVersion.ToString())"`,
    `Write-Output "shellpath=$((Get-Process -Id $PID -ErrorAction SilentlyContinue).Path)"`,
    `if($env:SSH_CONNECTION){ Write-Output "conn=ssh"; Write-Output "sshconn=$env:SSH_CONNECTION" }`,
    `$admin=$false; try{ $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }catch{}; Write-Output "admin=$admin"`,
    `foreach($p in 'winget','choco','scoop','npm','pnpm','yarn','pip','pip3','pipx','cargo','gem','composer','go','bun','deno'){ $c=Get-Command $p -ErrorAction SilentlyContinue; if($c){ Write-Output "pm=$p|$($c.Source)" } }`,
    `foreach($r in 'node','python','python3','ruby','go','rustc','java','deno','bun'){ $c=Get-Command $r -ErrorAction SilentlyContinue; if($c){ Write-Output "rt=$r|$($c.Source)" } }`,
    `$c=Get-Command node -ErrorAction SilentlyContinue; if($c){ Write-Output "rtv=node|$(node -v 2>$null)" }`,
    `$c=Get-Command python -ErrorAction SilentlyContinue; if($c){ Write-Output "rtv=python|$(python --version 2>&1)" }`,
    `$c=Get-Command go -ErrorAction SilentlyContinue; if($c){ Write-Output "rtv=go|$(go version 2>$null)" }`,
].join("; ");

/** Exact deterministic command used by the environment probe (exported for policy checks). */
export function probeScript(kind: BuddyShellKind): string {
    if (kind === "powershell") return PS_PROBE;
    if (kind === "fish") return FISH_PROBE;
    if (kind === "cmd") return `ver & echo user=%USERNAME% & echo home=%USERPROFILE% & echo cwd=%CD%`;
    return POSIX_PROBE;
}

/** Parse the probe's key=value lines into a TerminalEnvironment. */
function parseEnv(text: string, kind: BuddyShellKind): TerminalEnvironment {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const single = new Map<string, string>();
    const pms: PackageManagerInfo[] = [];
    const runtimes = new Map<string, PackageManagerInfo>();
    const runtimeVer = new Map<string, string>();

    for (const line of lines) {
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1).trim();
        if (key === "pm") {
            const [name, path] = value.split("|");
            if (name) pms.push({ name, path: path || undefined });
        } else if (key === "rt") {
            const [name, path] = value.split("|");
            if (name && !runtimes.has(name)) runtimes.set(name, { name, path: path || undefined });
        } else if (key === "rtv") {
            const [name, ver] = value.split("|");
            if (name && ver) runtimeVer.set(name, cleanVersion(ver));
        } else if (value) {
            single.set(key, value);
        }
    }

    // Fold runtime versions in.
    for (const [name, ver] of runtimeVer) {
        const ex = runtimes.get(name);
        if (ex) ex.version = ver;
        else runtimes.set(name, { name, version: ver });
    }

    // Mark the primary system package manager.
    const present = new Set(pms.map((p) => p.name));
    const primary = SYSTEM_PMS.find((n) => present.has(n));
    const packageManagers = pms.filter((p) => !LANG_PMS.has(p.name));
    const langTools = pms.filter((p) => LANG_PMS.has(p.name));
    for (const p of packageManagers) if (p.name === primary) p.primary = true;

    const osRaw = (single.get("os") ?? "").toLowerCase();
    const os: TerminalEnvironment["os"] = osRaw.includes("linux")
        ? "linux"
        : osRaw.includes("darwin") || osRaw.includes("mac")
          ? "macos"
          : osRaw.includes("windows") || kind === "powershell" || kind === "cmd"
            ? "windows"
            : osRaw.includes("bsd")
              ? "bsd"
              : "unknown";

    const conn = single.get("conn");
    const isWSL = conn === "wsl" || single.has("wsldistro");
    const connectionKind: TerminalEnvironment["connectionKind"] =
        conn === "ssh" ? "ssh" : conn === "docker" ? "docker" : isWSL ? "wsl" : "local";

    const uid = single.get("uid");
    const admin = single.get("admin");
    const isRoot = uid === "0" || admin === "True";
    const sudo = single.get("sudo");

    const env: TerminalEnvironment = {
        connectionKind,
        os,
        osName: single.get("osname") ?? (os === "windows" ? "Windows" : single.get("os")),
        osVersion: single.get("osver") ?? single.get("distrover"),
        kernelVersion: single.get("kernel"),
        arch: single.get("arch"),
        isWSL: isWSL || undefined,
        wslDistro: single.get("wsldistro"),
        shell: kindLabel(kind),
        shellVersion: single.get("shellver"),
        shellPath: single.get("shellpath"),
        distro: single.get("distro"),
        distroVersion: single.get("distrover"),
        initSystem: single.get("init"),
        packageManagers,
        runtimes: [...runtimes.values()],
        tools: langTools,
        username: single.get("user"),
        homeDir: single.get("home"),
        cwd: single.get("cwd"),
        isRoot: isRoot || undefined,
        hasSudo: sudo === "yes" || sudo === "passwordless" || isRoot || undefined,
        sudoPasswordless: sudo === "passwordless" || undefined,
        probeCompletedAt: Date.now(),
        probeVersion: PROBE_VERSION,
    };

    if (connectionKind === "ssh") {
        const sc = (single.get("sshconn") ?? "").split(/\s+/);
        // SSH_CONNECTION = "<client-ip> <client-port> <server-ip> <server-port>"
        if (sc.length >= 3) {
            env.sshHost = sc[2];
            env.sshPort = sc[3] ? Number(sc[3]) : undefined;
        }
    }
    return env;
}

function cleanVersion(s: string): string {
    return s.replace(/^v/, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

function kindLabel(kind: BuddyShellKind): string {
    switch (kind) {
        case "powershell":
            return "powershell";
        case "cmd":
            return "cmd";
        default:
            return kind;
    }
}

/**
 * Probe the environment of a live terminal session. Resolves a best-effort
 * TerminalEnvironment even on a partial/timed-out probe (so the eye never lies
 * about having no data when the shell simply answered slowly).
 */
export async function probeEnvironment(
    manager: TerminalManager,
    sessionId: string,
    kind: BuddyShellKind,
    opts?: { signal?: AbortSignal },
): Promise<TerminalEnvironment> {
    const res = await runCaptured(manager, sessionId, kind, probeScript(kind), {
        timeoutMs: PROBE_TIMEOUT_MS,
        signal: opts?.signal,
    });
    const env = parseEnv(res.stdout, kind);
    if (res.timedOut) env.probeTimedOut = true;
    return env;
}
