#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
    changelogSection,
    classifyDesktopVersion,
    compareDesktopVersions,
    createReleasePlan,
    ensureRemoteMonotonic,
    nightlyVersionFrom,
    renderReleaseNotes,
    verifyReleaseArtifacts,
} from "./release-contract.mjs";
import {
    normalizeUpdateChannel,
    providerUpdateChannel,
    releaseChannelFromVersion,
    releaseMatchesUpdateStream,
    sanitizeReleaseNotes,
} from "../apps/desktop/electron/update-contract.ts";

const ROOT = resolve(import.meta.dirname, "..");
const MOCK_INSTALLER = "mock installer";
const MOCK_SHA512 = Buffer.from(
    "9b3fad1242f5858c6098e9b9d2d6097f955e89134b16b41357e80181bd5a4ffd" +
        "5a541b2a310dd3f3f70a4b71d717336573ba799f7e0c0cc4af4a4082b92432db",
    "hex",
).toString("base64");
const FIXTURE_CHANGELOG = `# Changelog

## [Unreleased]

### Added
- Nightly work.

## [1.3.0-beta.2] - 2026-08-18

### Added
- Beta work.

## [1.2.3] - 2026-08-17

### Fixed
- Stable work.
`;

function source(path) {
    return readFileSync(resolve(ROOT, path), "utf8");
}

function sourceSection(text, start, end) {
    const startIndex = text.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
    const endIndex = text.indexOf(end, startIndex + start.length);
    assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
    return text.slice(startIndex, endIndex);
}

function writeMockArtifactSet(directory, version, channel) {
    const installerName = `Coretex-Setup-${version}-x64.exe`;
    writeFileSync(join(directory, installerName), MOCK_INSTALLER);
    writeFileSync(join(directory, `${installerName}.blockmap`), "mock blockmap");
    writeFileSync(
        join(directory, `${channel}.yml`),
        `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: ${MOCK_SHA512}\n    size: 14\npath: ${installerName}\nsha512: ${MOCK_SHA512}\n`,
    );
}

function testVersionStreams() {
    assert.deepEqual(
        Object.fromEntries(
            ["1.2.3", "1.3.0-beta.2", "1.4.0-nightly.20260818040506.42"].map((version) => {
                const release = classifyDesktopVersion(version);
                return [release.stream, [release.providerChannel, release.metadataFile, release.releaseType]];
            }),
        ),
        {
            stable: ["latest", "latest.yml", "release"],
            beta: ["beta", "beta.yml", "prerelease"],
            nightly: ["nightly", "nightly.yml", "prerelease"],
        },
    );
    for (const invalid of ["1.2.3-rc.1", "1.2.3-alpha.1", "v1.2.3", "01.2.3", "1.2.3-beta.01"]) {
        assert.throws(() => classifyDesktopVersion(invalid), /must be x\.y\.z/);
    }
    assert.equal(
        nightlyVersionFrom("1.2.3", { now: new Date("2026-08-18T04:05:06Z"), runNumber: 42 }),
        "1.2.4-nightly.20260818040506.42",
    );
    assert.equal(compareDesktopVersions("1.2.3", "1.2.3-beta.9"), 1);
    assert.equal(compareDesktopVersions("1.3.0-beta.10", "1.3.0-beta.2"), 1);
    assert.equal(compareDesktopVersions("1.4.0-nightly.20260818.2", "1.4.0-nightly.20260818.1"), 1);
}

function testRemoteMonotonicity() {
    const published = [[
        { tag_name: "v1.2.3", draft: false },
        { tag_name: "v1.3.0-beta.2", draft: false },
        { tag_name: "v1.3.0-rc.1", draft: false },
        { tag_name: "v1.4.0-nightly.20260818040506.41", draft: false },
        { tag_name: "v9.0.0", draft: true },
        { tag_name: "v8.0.0-alpha.1", draft: false },
    ]];
    assert.deepEqual(ensureRemoteMonotonic("1.2.4", published), { candidate: "1.2.4", maximum: "1.2.3" });
    assert.deepEqual(ensureRemoteMonotonic("1.3.1-beta.1", published), {
        candidate: "1.3.1-beta.1",
        maximum: "1.3.0-rc.1",
    });
    assert.deepEqual(ensureRemoteMonotonic("1.4.0-nightly.20260818040506.42", published), {
        candidate: "1.4.0-nightly.20260818040506.42",
        maximum: "1.4.0-nightly.20260818040506.41",
    });
    assert.throws(() => ensureRemoteMonotonic("1.2.3", published), /must be newer than published compatible version 1\.2\.3/);
    assert.throws(() => ensureRemoteMonotonic("1.3.0-beta.9", published), /must be newer than published compatible version 1\.3\.0-rc\.1/);
    assert.throws(
        () => ensureRemoteMonotonic("1.4.0-nightly.20260818040506.40", published),
        /must be newer than published compatible version 1\.4\.0-nightly\.20260818040506\.41/,
    );
}

function testReleasePlanningAndNotes() {
    const stable = createReleasePlan({
        eventName: "push",
        refName: "v1.2.3",
        packageVersion: "1.2.3",
        rootLockVersion: "1.2.3",
        changelog: FIXTURE_CHANGELOG,
    });
    assert.equal(stable.publish, true);
    assert.equal(stable.providerChannel, "latest");
    assert.match(stable.releaseNotes, /Stable work/);

    const beta = createReleasePlan({
        eventName: "push",
        refName: "v1.3.0-beta.2",
        packageVersion: "1.3.0-beta.2",
        rootLockVersion: "1.3.0-beta.2",
        changelog: FIXTURE_CHANGELOG,
    });
    assert.equal(beta.prerelease, true);
    assert.equal(beta.providerChannel, "beta");
    assert.match(beta.releaseNotes, /Beta work/);

    const nightly = createReleasePlan({
        eventName: "schedule",
        packageVersion: "1.2.3",
        rootLockVersion: "1.2.3",
        changelog: FIXTURE_CHANGELOG,
        now: new Date("2026-08-18T04:05:06Z"),
        runNumber: 42,
        commit: "abcdef1234567890",
    });
    assert.equal(nightly.version, "1.2.4-nightly.20260818040506.42");
    assert.equal(nightly.providerChannel, "nightly");
    assert.equal(nightly.generatedVersion, true);
    assert.match(nightly.releaseNotes, /Nightly snapshot from commit `abcdef123456`/);
    assert.match(nightly.releaseNotes, /Nightly work/);

    assert.throws(
        () => createReleasePlan({
            eventName: "schedule",
            packageVersion: "1.2.3",
            rootLockVersion: "1.2.2",
            changelog: FIXTURE_CHANGELOG,
        }),
        /root package-lock\.json records/,
    );

    const dispatchedNightly = createReleasePlan({
        eventName: "workflow_dispatch",
        requestedStream: "nightly",
        publishRequested: true,
        packageVersion: "1.3.0-beta.2",
        rootLockVersion: "1.3.0-beta.2",
        changelog: FIXTURE_CHANGELOG,
        now: new Date("2026-08-18T04:05:06Z"),
        runNumber: 42,
    });
    assert.equal(dispatchedNightly.publish, true);
    assert.equal(dispatchedNightly.generatedVersion, true);
    assert.equal(dispatchedNightly.version, "1.3.0-nightly.20260818040506.42");

    const dryExplicitNightly = createReleasePlan({
        eventName: "workflow_dispatch",
        requestedStream: "nightly",
        requestedVersion: "1.3.0-nightly.7",
        publishRequested: false,
        packageVersion: "1.3.0-beta.2",
        rootLockVersion: "1.3.0-beta.2",
        changelog: FIXTURE_CHANGELOG,
    });
    assert.equal(dryExplicitNightly.publish, false);
    assert.equal(dryExplicitNightly.version, "1.3.0-nightly.7");

    assert.throws(
        () => createReleasePlan({
            eventName: "workflow_dispatch",
            requestedStream: "nightly",
            requestedVersion: "1.3.0-nightly.7",
            publishRequested: true,
            packageVersion: "1.3.0-beta.2",
            rootLockVersion: "1.3.0-beta.2",
            changelog: FIXTURE_CHANGELOG,
        }),
        /must use the workflow-generated timestamp/,
    );

    assert.throws(
        () => createReleasePlan({
            eventName: "workflow_dispatch",
            requestedStream: "nightly",
            requestedVersion: "9.0.0-nightly.1",
            publishRequested: false,
            packageVersion: "1.3.0-beta.2",
            rootLockVersion: "1.3.0-beta.2",
            changelog: FIXTURE_CHANGELOG,
        }),
        /must use next release core/,
    );

    assert.throws(
        () => createReleasePlan({
            eventName: "workflow_dispatch",
            requestedStream: "stable",
            publishRequested: true,
            packageVersion: "1.2.3",
            rootLockVersion: "1.2.3",
            changelog: FIXTURE_CHANGELOG,
        }),
        /must be published by pushing their exact/,
    );
    assert.throws(
        () => createReleasePlan({
            eventName: "push",
            refName: "v1.2.4",
            packageVersion: "1.2.3",
            rootLockVersion: "1.2.3",
            changelog: FIXTURE_CHANGELOG,
        }),
        /does not match/,
    );
    assert.throws(
        () => createReleasePlan({
            eventName: "push",
            refName: "v1.2.3",
            packageVersion: "1.2.3",
            rootLockVersion: "1.2.2",
            changelog: FIXTURE_CHANGELOG,
        }),
        /root package-lock\.json records/,
    );

    assert.match(changelogSection(FIXTURE_CHANGELOG, "Unreleased"), /Nightly work/);
    const rendered = renderReleaseNotes({ changelog: FIXTURE_CHANGELOG, version: "1.2.3", stream: "stable" });
    assert.match(rendered, /^# Coretex 1\.2\.3/m);
    assert.doesNotMatch(rendered, /^\[[^\]]+\]:/m);
}

function testMockedArtifacts() {
    const directory = mkdtempSync(join(tmpdir(), "coretex-release-smoke-"));
    try {
        writeMockArtifactSet(directory, "1.2.3", "latest");
        const stable = verifyReleaseArtifacts({ releaseDir: directory, version: "1.2.3", providerChannel: "latest" });
        assert.match(stable.metadata, /latest\.yml$/);

        writeMockArtifactSet(directory, "1.3.0-beta.2", "beta");
        const beta = verifyReleaseArtifacts({ releaseDir: directory, version: "1.3.0-beta.2", providerChannel: "beta" });
        assert.match(beta.metadata, /beta\.yml$/);

        writeMockArtifactSet(directory, "1.4.0-nightly.7", "nightly");
        const nightly = verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" });
        assert.match(nightly.metadata, /nightly\.yml$/);

        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.3.0-beta.2", providerChannel: "latest" }),
            /belongs to beta\.yml/,
        );
        writeFileSync(
            join(directory, "nightly.yml"),
            `version: 1.4.0-nightly.8\nfiles:\n  - url: Coretex-Setup-1.4.0-nightly.7-x64.exe\n    sha512: ${MOCK_SHA512}\n    size: 14\npath: Coretex-Setup-1.4.0-nightly.7-x64.exe\nsha512: ${MOCK_SHA512}\n`,
        );
        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" }),
            /does not declare version/,
        );

        writeMockArtifactSet(directory, "1.4.0-nightly.7", "nightly");
        writeFileSync(
            join(directory, "nightly.yml"),
            `version: 1.4.0-nightly.7\nfiles:\n  - url: wrong.exe\n    sha512: ${MOCK_SHA512}\n    size: 14\npath: Coretex-Setup-1.4.0-nightly.7-x64.exe\nsha512: ${MOCK_SHA512}\n`,
        );
        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" }),
            /must reference only/,
        );

        writeMockArtifactSet(directory, "1.4.0-nightly.7", "nightly");
        writeFileSync(
            join(directory, "nightly.yml"),
            `version: 1.4.0-nightly.7\nfiles:\n  - url: Coretex-Setup-1.4.0-nightly.7-x64.exe\n    sha512: invalid\n    size: 14\npath: Coretex-Setup-1.4.0-nightly.7-x64.exe\nsha512: invalid\n`,
        );
        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" }),
            /matching SHA-512 digest/,
        );

        writeMockArtifactSet(directory, "1.4.0-nightly.7", "nightly");
        writeFileSync(join(directory, "Coretex-Setup-1.4.0-nightly.7-x64.exe"), `${MOCK_INSTALLER} tampered`);
        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" }),
            /matching SHA-512 digest/,
        );

        writeMockArtifactSet(directory, "1.4.0-nightly.7", "nightly");
        const wrongSize = readFileSync(join(directory, "nightly.yml"), "utf8").replace("    size: 14", "    size: 15");
        writeFileSync(join(directory, "nightly.yml"), wrongSize);
        assert.throws(
            () => verifyReleaseArtifacts({ releaseDir: directory, version: "1.4.0-nightly.7", providerChannel: "nightly" }),
            /exact files size/,
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function testCleanReleaseNotesPreparation() {
    const directory = mkdtempSync(join(tmpdir(), "coretex-release-prepare-"));
    try {
        mkdirSync(join(directory, "apps", "desktop"), { recursive: true });
        writeFileSync(join(directory, "apps", "desktop", "package.json"), '{"version":"1.2.3"}\n');
        writeFileSync(
            join(directory, "package-lock.json"),
            '{"lockfileVersion":3,"packages":{"apps/desktop":{"version":"1.2.3"}}}\n',
        );
        writeFileSync(join(directory, "CHANGELOG.md"), FIXTURE_CHANGELOG);
        const childEnv = { ...process.env };
        for (const name of [
            "RELEASE_EVENT",
            "RELEASE_TAG",
            "RELEASE_STREAM",
            "RELEASE_VERSION",
            "RELEASE_PUBLISH",
            "RELEASE_COMMIT",
            "RELEASE_REPO_ROOT",
            "RELEASE_CHANNEL",
            "GITHUB_EVENT_NAME",
            "GITHUB_REF_NAME",
            "GITHUB_SHA",
            "GITHUB_RUN_NUMBER",
            "GITHUB_OUTPUT",
        ]) {
            delete childEnv[name];
        }
        const result = spawnSync(
            process.execPath,
            [resolve(ROOT, "scripts/release-contract.mjs"), "prepare", "--root", directory],
            { encoding: "utf8", env: childEnv },
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(readFileSync(join(directory, "apps", "desktop", "build", "release-notes.md"), "utf8"), /Stable work/);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

function testRepositoryContracts() {
    const rootPackage = JSON.parse(source("package.json"));
    const desktopPackage = JSON.parse(source("apps/desktop/package.json"));
    const rootLock = JSON.parse(source("package-lock.json"));
    const changelog = source("CHANGELOG.md");
    const workflow = source(process.env.RELEASE_WORKFLOW_PATH || ".github/workflows/release-windows.yml");
    const readme = source("apps/desktop/README.md");

    const current = classifyDesktopVersion(desktopPackage.version);
    assert.equal(rootLock.packages?.["apps/desktop"]?.version, desktopPackage.version, "root lock must carry the desktop release version");
    changelogSection(changelog, current.stream === "nightly" ? "Unreleased" : desktopPackage.version);
    if (current.stream !== "nightly") {
        const escapedVersion = desktopPackage.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const datedHeading = new RegExp(`^## \\[${escapedVersion}\\] - (\\d{4}-\\d{2}-\\d{2})$`, "m").exec(changelog);
        assert.ok(datedHeading, "current desktop changelog section must carry an ISO release date");
        const rendererContract = source("shared/src/coretex/version.ts");
        assert.match(
            rendererContract,
            new RegExp(`version: "${escapedVersion}"[\\s\\S]*?date: "${datedHeading[1]}"`),
            "bundled release history date must match root CHANGELOG.md",
        );
        const currentEntry = new RegExp(
            `version: "${escapedVersion}"[\\s\\S]*?notes: \\[([\\s\\S]*?)\\]`,
        ).exec(rendererContract);
        assert.ok(currentEntry, "bundled release history must include current release notes");
        const bundledNotes = [...currentEntry[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
            JSON.parse(`"${match[1]}"`),
        );
        const canonicalNotes = changelogSection(changelog, desktopPackage.version).replace(/\s+/g, " ");
        assert.ok(bundledNotes.length > 0, "bundled current release must have notes");
        for (const note of bundledNotes) {
            assert.ok(canonicalNotes.includes(note.replace(/\s+/g, " ")), `bundled release note drifted from CHANGELOG.md: ${note}`);
        }
    }
    assert.equal(desktopPackage.build?.publish?.provider, "github");
    assert.equal(desktopPackage.build?.publish?.channel, "${channel}");
    assert.equal(desktopPackage.build?.releaseInfo?.releaseNotesFile, "build/release-notes.md");
    assert.match(
        rootPackage.scripts?.["desktop:installer"] ?? "",
        /^npm run release:prepare && npm run electron:build -w apps\/desktop$/,
        "the documented local installer command must generate release notes on a clean checkout",
    );

    assert.doesNotMatch(
        workflow,
        /schedule:[\s\S]*?cron:/,
        "unsigned release builds must not run on a schedule; use an explicit dry run or signed tag",
    );
    assert.match(workflow, /options:[\s\S]*?stable[\s\S]*?beta[\s\S]*?nightly/);
    assert.match(workflow, /npm run smoke:release/);
    assert.match(workflow, /node scripts\/release-contract\.mjs prepare/);
    assert.match(workflow, /node scripts\/release-contract\.mjs verify/);
    assert.match(workflow, /permissions:[\s\S]*?contents: read/);
    assert.match(workflow, /publish:[\s\S]*?permissions:[\s\S]*?contents: write/);
    assert.match(workflow, /npm run electron:build -w apps\/desktop/);
    assert.doesNotMatch(workflow, /desktop:publish|electron:publish|--publish always/);
    const rootScripts = Object.values(rootPackage.scripts ?? {}).join("\n");
    const desktopScripts = Object.values(desktopPackage.scripts ?? {}).join("\n");
    assert.doesNotMatch(rootScripts, /desktop:publish|electron:publish|--publish always/);
    assert.doesNotMatch(desktopScripts, /electron:publish|--publish always/);
    assert.match(workflow, /gh release create/);
    assert.match(workflow, /--target[\s\S]*?github\.sha/);
    assert.match(workflow, /WILL_PUBLISH:[\s\S]*?needs both Windows signing secrets/);
    assert.match(workflow, /gh api --paginate --slurp[\s\S]*?release-contract\.mjs guard-remote/);
    assert.match(workflow, /concurrency:[\s\S]*?group: coretex-windows-release\s/);
    assert.match(workflow, /Get-AuthenticodeSignature[\s\S]*?Status -ne 'Valid'/);
    const verifyIndex = workflow.indexOf("Verify updater artifacts and channel metadata");
    const remoteGuardIndex = workflow.indexOf("release-contract.mjs guard-remote");
    const publishIndex = workflow.indexOf("gh release create");
    assert.ok(
        verifyIndex >= 0 && remoteGuardIndex > verifyIndex && publishIndex > remoteGuardIndex,
        "artifact and remote monotonicity verification must precede release publication",
    );
    const draftIndex = workflow.indexOf("'--draft'");
    const finalizeIndex = workflow.indexOf("gh release edit");
    assert.ok(
        draftIndex >= 0 && publishIndex > draftIndex && finalizeIndex > publishIndex,
        "verified assets must upload to a draft before it is public",
    );
    for (const action of ["actions/checkout", "actions/setup-node", "actions/upload-artifact", "actions/download-artifact"]) {
        assert.match(workflow, new RegExp(`${action.replace("/", "\\/")}@[0-9a-f]{40}`), `${action} must be commit-pinned`);
    }
    assert.doesNotMatch(workflow, /(?:^|[^a-z])rc(?:[^a-z]|$)|release.?candidate/i);

    assert.match(readme, /Stable:[\s\S]*?latest\.yml/);
    assert.match(readme, /Beta:[\s\S]*?beta\.yml/);
    assert.match(readme, /Nightly:[\s\S]*?nightly\.yml/);
    assert.match(readme, /CHANGELOG\.md/);
    assert.doesNotMatch(readme, /release candidate|\brc\.yml\b/i);
}

function testUpdaterConsumptionAndSafetyContracts() {
    const desktopPackage = JSON.parse(source("apps/desktop/package.json"));
    const main = source("apps/desktop/electron/main.ts");
    const updateContract = source("apps/desktop/electron/update-contract.ts");
    const updateManager = source("apps/desktop/electron/update-manager.ts");
    const rendererContract = source("shared/src/coretex/version.ts");
    const aboutPage = source("shared/src/coretex/settings/pages/about-page.tsx");

    assert.match(main, /import \{ createDesktopUpdater \} from "\.\/update-manager"/);
    assert.match(updateContract, /DesktopUpdateChannel = "stable" \| "beta" \| "nightly"/);
    assert.match(
        updateContract,
        /value === "beta" \|\| value === "release-candidate" \|\| value === "rc"\) return "beta"/,
        "legacy RC preferences must migrate to beta",
    );
    assert.match(rendererContract, /raw === "release-candidate" \|\| raw === "rc"\) return "beta"/);

    assert.equal(normalizeUpdateChannel("release-candidate"), "beta");
    assert.equal(normalizeUpdateChannel("rc"), "beta");
    assert.equal(providerUpdateChannel("stable"), "latest");
    assert.equal(providerUpdateChannel("beta"), "beta");
    assert.equal(providerUpdateChannel("nightly"), "nightly");
    assert.equal(releaseChannelFromVersion("1.2.3", false), "stable");
    assert.equal(releaseChannelFromVersion("1.3.0-beta.2", true), "beta");
    assert.equal(releaseChannelFromVersion("1.3.0-rc.1", true), "beta");
    assert.equal(releaseChannelFromVersion("1.4.0-nightly.7", true), "nightly");
    assert.equal(releaseMatchesUpdateStream("stable", "beta"), true);
    assert.equal(releaseMatchesUpdateStream("nightly", "beta"), false);

    const hostileNotes = [
        "# Hidden heading",
        "![tracking](https://evil.example/pixel.png)",
        "- [Visible label](https://evil.example) <script>alert(1)</script> **safe**",
        "```js",
        "window.location = 'https://evil.example'",
        "```",
        ...Array.from({ length: 10 }, (_, index) => `- Item ${index} ${"x".repeat(280)}`),
    ].join("\n");
    const sanitized = sanitizeReleaseNotes(hostileNotes);
    assert.equal(sanitized.length, 8);
    assert.ok(sanitized.every((note) => note.length <= 240));
    assert.ok(sanitized.every((note) => !/[<>]|https?:|javascript:|window\.location/i.test(note)));
    assert.match(sanitized[0], /^Visible label alert\(1\) safe$/);

    const sanitizer = updateContract.slice(updateContract.indexOf("export function sanitizeReleaseNotes"));
    assert.match(sanitizer, /insideCodeBlock/);
    assert.match(sanitizer, /text\.length > 240[\s\S]*?text\.slice\(0, 237\)/);
    assert.match(sanitizer, /notes\.length === 8/);
    assert.match(updateManager, /RELEASES_API_URL = "https:\/\/api\.github\.com\/repos\/MDCran\/coretex\/releases\?per_page=50"/);
    assert.match(updateManager, /notes: sanitizeReleaseNotes\(item\.body\)/);

    assert.ok(
        updateManager.includes('const CHANGELOG_URL = `${REPOSITORY_URL}/blob/main/CHANGELOG.md`;'),
        "changelog target must be a fixed repository URL",
    );
    const external = sourceSection(updateManager, "const openExternal = async", "ipcMain.handle(UPDATE_IPC.getState");
    assert.match(external, /join\(process\.resourcesPath, "THIRD-PARTY-NOTICES\.md"\)/);
    assert.match(external, /changelog: CHANGELOG_URL/);
    assert.match(external, /parsed\.protocol !== "https:"[\s\S]*?parsed\.hostname !== "github\.com"/);
    assert.doesNotMatch(external, /payload\.(?:path|url)|target\.(?:path|url)/);

    const notices = desktopPackage.build?.extraResources?.find((entry) => entry.to === "THIRD-PARTY-NOTICES.md");
    assert.deepEqual(notices, { from: "../../THIRD-PARTY-NOTICES.md", to: "THIRD-PARTY-NOTICES.md" });

    const refreshHistory = sourceSection(aboutPage, "const refreshHistory = async", "useEffect(() =>");
    assert.match(refreshHistory, /if \(result\.ok\)[\s\S]*?else \{[\s\S]*?setHistoryError\(result\.reason\)/);
    const launchResource = sourceSection(aboutPage, "const launchResource = async", "const headerBadge");
    assert.match(launchResource, /if \(!result\.ok\)[\s\S]*?setActionError\(result\.reason/);
}

testVersionStreams();
console.log("Stable, beta, and nightly version contracts ✓");
testRemoteMonotonicity();
console.log("Published-stream monotonicity guards ✓");
testReleasePlanningAndNotes();
console.log("Tag gates, changelog notes, and nightly planning ✓");
testMockedArtifacts();
console.log("Mocked installer, blockmap, and channel metadata consumption ✓");
testCleanReleaseNotesPreparation();
console.log("Clean-checkout release notes preparation ✓");
testUpdaterConsumptionAndSafetyContracts();
console.log("Updater channel, history sanitization, fixed resources, and failure surfacing ✓");
testRepositoryContracts();
console.log("Release workflow, builder, version, and documentation wiring ✓");
