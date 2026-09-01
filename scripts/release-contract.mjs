#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BETA_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
const NIGHTLY_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))*)$/;

function fail(message) {
    throw new Error(message);
}

export function classifyDesktopVersion(input) {
    const version = typeof input === "string" ? input.trim() : "";
    let match = STABLE_PATTERN.exec(version);
    if (match) {
        return {
            version,
            core: match.slice(1, 4).map(Number),
            stream: "stable",
            providerChannel: "latest",
            metadataFile: "latest.yml",
            prerelease: false,
            releaseType: "release",
        };
    }

    match = BETA_PATTERN.exec(version);
    if (match) {
        return {
            version,
            core: match.slice(1, 4).map(Number),
            stream: "beta",
            providerChannel: "beta",
            metadataFile: "beta.yml",
            prerelease: true,
            releaseType: "prerelease",
        };
    }

    match = NIGHTLY_PATTERN.exec(version);
    if (match) {
        return {
            version,
            core: match.slice(1, 4).map(Number),
            stream: "nightly",
            providerChannel: "nightly",
            metadataFile: "nightly.yml",
            prerelease: true,
            releaseType: "prerelease",
        };
    }

    fail(
        `Desktop version '${version || "(empty)"}' must be x.y.z, x.y.z-beta.n, or x.y.z-nightly.n[.n]. ` +
            "Release-candidate and arbitrary prerelease identifiers are not public update streams.",
    );
}

export function nightlyVersionFrom(currentVersion, { now = new Date(), runNumber = 1 } = {}) {
    const current = classifyDesktopVersion(currentVersion);
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) fail(`Invalid nightly timestamp '${String(now)}'.`);
    const run = Number(runNumber);
    if (!Number.isSafeInteger(run) || run < 1) fail(`Nightly run number '${String(runNumber)}' must be a positive integer.`);

    const [major, minor, currentPatch] = current.core;
    const patch = current.stream === "stable" ? currentPatch + 1 : currentPatch;
    const stamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    return `${major}.${minor}.${patch}-nightly.${stamp}.${run}`;
}

function parsedSemver(input) {
    const version = typeof input === "string" ? input.trim().replace(/^v/, "") : "";
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
    if (!match) return null;
    return {
        version,
        core: match.slice(1, 4).map(Number),
        prerelease: match[4]?.split(".") ?? [],
    };
}

export function compareDesktopVersions(left, right) {
    const a = parsedSemver(left);
    const b = parsedSemver(right);
    if (!a || !b) fail(`Cannot compare invalid SemVer '${String(!a ? left : right)}'.`);
    for (let index = 0; index < 3; index += 1) {
        if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
    }
    if (a.prerelease.length === 0 || b.prerelease.length === 0) {
        if (a.prerelease.length === b.prerelease.length) return 0;
        return a.prerelease.length === 0 ? 1 : -1;
    }
    const length = Math.max(a.prerelease.length, b.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const aPart = a.prerelease[index];
        const bPart = b.prerelease[index];
        if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1;
        if (aPart === bPart) continue;
        const aNumeric = /^\d+$/.test(aPart);
        const bNumeric = /^\d+$/.test(bPart);
        if (aNumeric && bNumeric) return BigInt(aPart) < BigInt(bPart) ? -1 : 1;
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return aPart < bPart ? -1 : 1;
    }
    return 0;
}

function publishedStream(version) {
    const parsed = parsedSemver(version);
    if (!parsed) return null;
    if (parsed.prerelease.length === 0) return "stable";
    if (parsed.prerelease[0] === "beta" || parsed.prerelease[0] === "rc") return "beta";
    if (parsed.prerelease[0] === "nightly") return "nightly";
    return null;
}

export function ensureRemoteMonotonic(candidateVersion, pages) {
    const candidate = classifyDesktopVersion(candidateVersion);
    if (!Array.isArray(pages)) fail("Published release response must be an array.");
    const releases = pages.flatMap((page) => (Array.isArray(page) ? page : [page]));
    const compatible = candidate.stream === "beta" ? new Set(["stable", "beta"]) : new Set([candidate.stream]);
    const existing = releases.flatMap((value) => {
        if (!value || typeof value !== "object" || value.draft === true || typeof value.tag_name !== "string") return [];
        const version = value.tag_name.trim().replace(/^v/, "");
        const stream = publishedStream(version);
        return stream && compatible.has(stream) ? [version] : [];
    });
    const maximum = existing.reduce(
        (current, version) => (current == null || compareDesktopVersions(version, current) > 0 ? version : current),
        null,
    );
    if (maximum && compareDesktopVersions(candidate.version, maximum) <= 0) {
        fail(
            `${candidate.stream} candidate ${candidate.version} must be newer than published compatible version ${maximum}. ` +
                "Bump the desktop version instead of replacing channel metadata with an older build.",
        );
    }
    return { candidate: candidate.version, maximum };
}

export function changelogSection(markdown, name, { allowEmpty = false } = {}) {
    if (typeof markdown !== "string") fail("CHANGELOG.md must be text.");
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const headings = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = /^## \[([^\]]+)\](?:\s+-\s+.+)?\s*$/.exec(lines[index]);
        if (match) headings.push({ index, name: match[1] });
    }
    const headingIndex = headings.findIndex((entry) => entry.name === name);
    if (headingIndex < 0) fail(`CHANGELOG.md is missing a '## [${name}]' section.`);
    const start = headings[headingIndex].index + 1;
    const end = headings[headingIndex + 1]?.index ?? lines.length;
    const body = lines
        .slice(start, end)
        .filter((line) => !/^\[[^\]]+\]:\s+\S+/.test(line))
        .join("\n")
        .trim();
    if (!allowEmpty && body.length === 0) fail(`CHANGELOG.md section '${name}' has no release notes.`);
    return body;
}

export function renderReleaseNotes({ changelog, version, stream, commit = "" }) {
    const sectionName = stream === "nightly" ? "Unreleased" : version;
    const body = changelogSection(changelog, sectionName, { allowEmpty: stream === "nightly" });
    const provenance = stream === "nightly"
        ? `\n\n> Nightly snapshot${commit ? ` from commit \`${commit.slice(0, 12)}\`` : ""}. It may contain unfinished changes.`
        : "";
    const notes = body || "No user-facing changes have been recorded since the previous release.";
    return `# Coretex ${version}${provenance}\n\n${notes}\n`;
}

function requireWorkspaceVersion(packageVersion, rootLockVersion) {
    if (rootLockVersion !== packageVersion) {
        fail(
            `apps/desktop/package.json is ${packageVersion}, but root package-lock.json records ${rootLockVersion || "no version"}. ` +
                "Run npm install from the monorepo root and commit both files before releasing.",
        );
    }
}

function requireStream(requested, actual) {
    if (requested && requested !== actual) {
        fail(`Requested ${requested} stream does not match desktop version stream ${actual}.`);
    }
}

export function createReleasePlan({
    eventName = "local",
    refName = "",
    requestedStream = "",
    requestedVersion = "",
    publishRequested = false,
    packageVersion,
    rootLockVersion,
    changelog,
    now = new Date(),
    runNumber = 1,
    commit = "",
}) {
    if (!packageVersion) fail("apps/desktop/package.json has no version.");
    const event = eventName || "local";
    let version = requestedVersion?.trim() || packageVersion;
    let publish = Boolean(publishRequested);
    let generatedVersion = false;

    // Every release starts from the committed workspace graph. Nightly preparation
    // mutates only the ephemeral desktop package version after this check.
    requireWorkspaceVersion(packageVersion, rootLockVersion);

    if (event === "push") {
        const packageRelease = classifyDesktopVersion(packageVersion);
        if (refName !== `v${packageVersion}`) {
            fail(`Tag '${refName || "(empty)"}' does not match apps/desktop version 'v${packageVersion}'.`);
        }
        requireStream(requestedStream, packageRelease.stream);
        version = packageVersion;
        publish = true;
    } else if (event === "schedule") {
        if (requestedStream && requestedStream !== "nightly") fail("Scheduled releases are nightly-only.");
        version = nightlyVersionFrom(packageVersion, { now, runNumber });
        generatedVersion = true;
        publish = true;
    } else if (event === "workflow_dispatch") {
        const stream = requestedStream || "nightly";
        if (!new Set(["stable", "beta", "nightly"]).has(stream)) fail(`Unknown release stream '${stream}'.`);
        if (stream === "nightly") {
            if (publish && requestedVersion) {
                fail("Publishing a manual nightly must use the workflow-generated timestamp and run number.");
            }
            if (!requestedVersion) version = nightlyVersionFrom(packageVersion, { now, runNumber });
        }
        const selected = classifyDesktopVersion(version);
        requireStream(stream, selected.stream);
        if (stream === "nightly") {
            const allowedCore = classifyDesktopVersion(nightlyVersionFrom(packageVersion, { now, runNumber })).core.join(".");
            if (selected.core.join(".") !== allowedCore) {
                fail(`Nightly version ${version} must use next release core ${allowedCore}. Bump the committed desktop version first.`);
            }
            generatedVersion = version !== packageVersion;
        }
        if (stream !== "nightly") {
            if (version !== packageVersion) fail("Stable and beta manual validation must use the committed desktop version.");
            if (publish) fail("Stable and beta releases must be published by pushing their exact v<version> tag.");
        }
    } else {
        const local = classifyDesktopVersion(version);
        requireStream(requestedStream, local.stream);
        if (version !== packageVersion) fail("Local release preparation must use the committed desktop version.");
        publish = false;
    }

    const release = classifyDesktopVersion(version);
    changelogSection(changelog, release.stream === "nightly" ? "Unreleased" : version, {
        allowEmpty: release.stream === "nightly",
    });
    return {
        ...release,
        tag: `v${version}`,
        publish,
        generatedVersion,
        releaseNotes: renderReleaseNotes({ changelog, version, stream: release.stream, commit }),
    };
}

export function verifyReleaseArtifacts({ releaseDir, version, providerChannel }) {
    const release = classifyDesktopVersion(version);
    if (providerChannel !== release.providerChannel) {
        fail(`Version ${version} belongs to ${release.providerChannel}.yml, not ${providerChannel || "(empty)"}.yml.`);
    }
    const installerName = `Coretex-Setup-${version}-x64.exe`;
    const installer = join(releaseDir, installerName);
    const blockmap = `${installer}.blockmap`;
    const metadata = join(releaseDir, `${providerChannel}.yml`);
    for (const file of [installer, blockmap, metadata]) {
        if (!existsSync(file)) fail(`Missing release artifact: ${file}`);
        const info = statSync(file);
        if (!info.isFile() || info.size === 0) fail(`Release artifact is not a non-empty file: ${file}`);
    }

    const lines = readFileSync(metadata, "utf8").replace(/\r\n/g, "\n").split("\n");
    const scalar = (pattern, label) => {
        const values = lines.flatMap((line) => {
            const match = pattern.exec(line);
            if (!match) return [];
            let value = match[1].trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            return [value];
        });
        if (values.length !== 1) fail(`${providerChannel}.yml must declare exactly one ${label}.`);
        return values[0];
    };
    const metadataVersion = scalar(/^version:\s*(.+)$/, "top-level version");
    const metadataPath = scalar(/^path:\s*(.+)$/, "top-level path");
    const metadataSha = scalar(/^sha512:\s*(.+)$/, "top-level sha512");
    const fileUrl = scalar(/^\s{2}-\s+url:\s*(.+)$/, "files URL");
    const fileSha = scalar(/^\s{4}sha512:\s*(.+)$/, "files sha512");
    const fileSize = scalar(/^\s{4}size:\s*(.+)$/, "files size");
    const validSha512 = (value) => {
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
        try {
            return Buffer.from(value, "base64").length === 64;
        } catch {
            return false;
        }
    };

    if (metadataVersion !== version) {
        fail(`${providerChannel}.yml does not declare version ${version}.`);
    }
    if (metadataPath !== installerName || fileUrl !== installerName) {
        fail(`${providerChannel}.yml must reference only ${installerName} in path and files.`);
    }
    const actualInstallerSha = createHash("sha512").update(readFileSync(installer)).digest("base64");
    if (!validSha512(metadataSha) || fileSha !== metadataSha || metadataSha !== actualInstallerSha) {
        fail(`${providerChannel}.yml must carry one matching SHA-512 digest for ${installerName}.`);
    }
    if (!/^[1-9]\d*$/.test(fileSize) || Number(fileSize) !== statSync(installer).size) {
        fail(`${providerChannel}.yml must declare the exact files size for ${installerName}.`);
    }
    return { installer, blockmap, metadata };
}

function readJson(file) {
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function parseArgs(argv) {
    const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "prepare";
    const start = command === argv[0] ? 1 : 0;
    const flags = {};
    for (let index = start; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) fail(`Unexpected argument '${token}'.`);
        const key = token.slice(2);
        const value = argv[index + 1];
        if (value == null || value.startsWith("--")) flags[key] = "true";
        else {
            flags[key] = value;
            index += 1;
        }
    }
    return { command, flags };
}

function boolFlag(value) {
    return value === true || value === "true" || value === "1";
}

function writeOutputs(file, values) {
    if (!file) return;
    const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
    writeFileSync(file, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

function workspace(root) {
    const desktopPackageFile = join(root, "apps", "desktop", "package.json");
    const rootLockFile = join(root, "package-lock.json");
    const changelogFile = join(root, "CHANGELOG.md");
    const desktopPackage = readJson(desktopPackageFile);
    const rootLock = readJson(rootLockFile);
    return {
        desktopPackageFile,
        desktopPackage,
        rootLockVersion: rootLock.packages?.["apps/desktop"]?.version,
        changelog: readFileSync(changelogFile, "utf8"),
    };
}

function prepare(flags) {
    const root = resolve(flags.root || process.env.RELEASE_REPO_ROOT || SCRIPT_ROOT);
    const files = workspace(root);
    const eventName = flags.event || process.env.RELEASE_EVENT || process.env.GITHUB_EVENT_NAME || "local";
    const refName = flags.tag || process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "";
    const requestedStream = flags.stream || process.env.RELEASE_STREAM || "";
    const requestedVersion = flags.version || process.env.RELEASE_VERSION || "";
    const publishRequested = boolFlag(flags.publish || process.env.RELEASE_PUBLISH || "false");
    const runNumber = Number(flags["run-number"] || process.env.GITHUB_RUN_NUMBER || 1);
    const now = flags.timestamp ? new Date(flags.timestamp) : new Date();
    const commit = flags.commit || process.env.RELEASE_COMMIT || process.env.GITHUB_SHA || "";
    const plan = createReleasePlan({
        eventName,
        refName,
        requestedStream,
        requestedVersion,
        publishRequested,
        packageVersion: files.desktopPackage.version,
        rootLockVersion: files.rootLockVersion,
        changelog: files.changelog,
        now,
        runNumber,
        commit,
    });

    if (plan.generatedVersion) {
        files.desktopPackage.version = plan.version;
        writeFileSync(files.desktopPackageFile, `${JSON.stringify(files.desktopPackage, null, 4)}\n`, "utf8");
    }
    const notesFile = join(root, "apps", "desktop", "build", "release-notes.md");
    mkdirSync(dirname(notesFile), { recursive: true });
    writeFileSync(notesFile, plan.releaseNotes, "utf8");
    writeOutputs(flags["github-output"] || process.env.GITHUB_OUTPUT, {
        version: plan.version,
        stream: plan.stream,
        channel: plan.providerChannel,
        metadata: plan.metadataFile,
        prerelease: plan.prerelease,
        release_type: plan.releaseType,
        publish: plan.publish,
        tag: plan.tag,
        notes_file: "apps/desktop/build/release-notes.md",
    });
    process.stdout.write(`${JSON.stringify({ ...plan, releaseNotes: undefined }, null, 2)}\n`);
}

function verify(flags) {
    const root = resolve(flags.root || process.env.RELEASE_REPO_ROOT || SCRIPT_ROOT);
    const version = flags.version || process.env.RELEASE_VERSION;
    const providerChannel = flags.channel || process.env.RELEASE_CHANNEL;
    if (!version || !providerChannel) fail("verify requires --version and --channel.");
    const result = verifyReleaseArtifacts({
        releaseDir: resolve(flags.dir || join(root, "apps", "desktop", "release")),
        version,
        providerChannel,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function guardRemote(flags) {
    const version = flags.version || process.env.RELEASE_VERSION;
    const releasesFile = flags.releases;
    if (!version || !releasesFile) fail("guard-remote requires --version and --releases.");
    const result = ensureRemoteMonotonic(version, readJson(resolve(releasesFile)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function main() {
    const { command, flags } = parseArgs(process.argv.slice(2));
    if (command === "prepare") prepare(flags);
    else if (command === "verify") verify(flags);
    else if (command === "guard-remote") guardRemote(flags);
    else fail(`Unknown release-contract command '${command}'. Use prepare, verify, or guard-remote.`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
    try {
        main();
    } catch (error) {
        process.stderr.write(`release-contract: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
