import assert from "node:assert/strict";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import {
    defaultUpdateChannelForVersion,
    normalizeUpdateChannel,
    parseReleaseHistoryOptions,
    parseUpdateCheckChannel,
    parseUpdatePreferencePatch,
    providerUpdateChannel,
    releaseChannelFromVersion,
    releaseMatchesUpdateStream,
    sanitizeReleaseNotes,
} from "../electron/update-contract.ts";
import { isTrustedRendererUrl, safeExternalUrl } from "../electron/navigation-security.ts";
import { compareSemver, parseSemver, releaseMatchesChannel } from "../../../shared/src/coretex/version.ts";

assert.equal(normalizeUpdateChannel("stable"), "stable");
assert.equal(normalizeUpdateChannel("beta"), "beta");
assert.equal(normalizeUpdateChannel("nightly"), "nightly");
assert.equal(normalizeUpdateChannel("release-candidate"), "beta");
assert.equal(defaultUpdateChannelForVersion("0.2.0"), "stable");
assert.equal(defaultUpdateChannelForVersion("0.3.0-beta.2"), "beta");
assert.equal(defaultUpdateChannelForVersion("0.3.0-rc.1"), "beta");
assert.equal(defaultUpdateChannelForVersion("0.4.0-nightly.20260818040506.42"), "nightly");
assert.equal(providerUpdateChannel("stable"), "latest");
assert.equal(providerUpdateChannel("beta"), "beta");
assert.equal(providerUpdateChannel("nightly"), "nightly");
assert.deepEqual(parseUpdatePreferencePatch({ channel: "nightly", automaticChecks: true }), {
    channel: "nightly",
    automaticChecks: true,
});
assert.equal(parseUpdateCheckChannel({ channel: "beta" }), "beta");
assert.deepEqual(parseReleaseHistoryOptions({ refresh: true, channel: "stable" }), {
    refresh: true,
    channel: "stable",
});
assert.throws(() => parseUpdatePreferencePatch("nightly"));
assert.throws(() => parseUpdatePreferencePatch({ channel: "invalid" }));
assert.throws(() => parseUpdateCheckChannel({ channel: "stable", extra: true }));
assert.throws(() => parseReleaseHistoryOptions({ refresh: "yes" }));

assert.equal(releaseChannelFromVersion("0.2.0", false), "stable");
assert.equal(releaseChannelFromVersion("0.3.0-beta.2", true), "beta");
assert.equal(releaseChannelFromVersion("0.3.0-rc.1", true), "beta");
assert.equal(releaseChannelFromVersion("0.4.0-nightly.9", true), "nightly");
assert.equal(releaseChannelFromVersion("0.4.0-nightly.20260818040506.42", true), "nightly");
assert.equal(releaseChannelFromVersion(`1.2.3-beta.${"9".repeat(90)}`, true), null);
assert.equal(releaseChannelFromVersion("0.4.0-alpha.1", true), null);
assert.equal(releaseMatchesUpdateStream("stable", "beta"), true);
assert.equal(releaseMatchesUpdateStream("beta", "stable"), false);
assert.equal(releaseMatchesUpdateStream("nightly", "nightly"), true);
assert.equal(releaseMatchesUpdateStream("stable", "nightly"), false);

const notes = sanitizeReleaseNotes(`# Heading
- Added [safe label](https://example.com) with **formatting**.

\`\`\`js
alert("not rendered")
\`\`\`
<script>ignored markup</script>Fixed a thing.`);
assert.deepEqual(notes, ["Added safe label with formatting.", "ignored markupFixed a thing."]);
assert.deepEqual(
    sanitizeReleaseNotes("- Requires Node < 20, verifies 2 > 1, and keeps <3 intact."),
    ["Requires Node < 20, verifies 2 > 1, and keeps <3 intact."],
);

const tooMany = sanitizeReleaseNotes(Array.from({ length: 12 }, (_, index) => `- Note ${index}`).join("\n"));
assert.equal(tooMany.length, 8);

assert.deepEqual(parseSemver("v2.10.4"), [2, 10, 4]);
assert.equal(parseSemver("2.10.4garbage"), null);
assert.equal(parseSemver("2.10.4-alpha.1"), null);
assert.equal(releaseMatchesChannel("stable", "v2.0.0-beta.1", true), false);
assert.equal(releaseMatchesChannel("beta", "v2.0.0", false), true);
assert.equal(releaseMatchesChannel("nightly", "v2.0.0-nightly.20260818.4", true), true);
assert.deepEqual(
    ["v1.8.0", "v3.0.0-beta.1", "v2.4.1"].sort((left, right) => compareSemver(right, left)),
    ["v3.0.0-beta.1", "v2.4.1", "v1.8.0"],
);

const packagedEntryPath = resolvePath("C:/Program Files/Coretex/resources/app.asar/dist/index.html");
const packagedEntryUrl = pathToFileURL(packagedEntryPath).toString();
assert.equal(
    isTrustedRendererUrl("http://localhost:5173/settings/about", {
        development: true,
        devServerUrl: "http://localhost:5173/",
        packagedEntryPath,
    }),
    true,
);
assert.equal(
    isTrustedRendererUrl("http://localhost.evil.example:5173/", {
        development: true,
        devServerUrl: "http://localhost:5173/",
        packagedEntryPath,
    }),
    false,
);
assert.equal(
    isTrustedRendererUrl(packagedEntryUrl, {
        development: false,
        packagedEntryPath,
    }),
    true,
);
assert.equal(
    isTrustedRendererUrl(pathToFileURL(resolvePath(packagedEntryPath, "../other.html")).toString(), {
        development: false,
        packagedEntryPath,
    }),
    false,
);
assert.equal(safeExternalUrl("https://github.com/MDCran/coretex/releases"), "https://github.com/MDCran/coretex/releases");
assert.equal(safeExternalUrl("javascript:alert(1)"), null);
    assert.equal(safeExternalUrl("file:///C:/Users/ExampleUser/.ssh/id_rsa"), null);
assert.equal(safeExternalUrl("http://127.0.0.1:8765/secrets"), null);
assert.equal(safeExternalUrl("https://10.0.0.1/secrets"), null);
assert.equal(safeExternalUrl("https://service.internal/secrets"), null);

console.info("update contract smoke passed");
