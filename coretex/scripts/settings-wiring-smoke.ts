import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMcpArgs } from "../src/mcp/args.js";
import { McpClient } from "../src/mcp/client.js";
import { MemoryStore } from "../src/memory/store.js";
import { computeCompletions, makeContext } from "../../shared/src/coretex/terminal/completion-engine";

async function main(): Promise<void> {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const settingsPagesDir = path.join(repoRoot, "shared/src/coretex/settings/pages");
    const pageFiles = (await readdir(settingsPagesDir)).filter((file) => file.endsWith("-page.tsx"));
    assert.ok(pageFiles.length >= 20, "Expected the complete Settings page catalog");
    for (const pageFile of pageFiles) {
        const source = await readFile(path.join(settingsPagesDir, pageFile), "utf8");
        assert.match(source, /<SettingsPageHeader\b/, `${pageFile} must use the shared page header`);
        assert.match(source, /<SettingsSection\b/, `${pageFile} must use shared section surfaces`);
        assert.doesNotMatch(source, /window\.confirm\s*\(/, `${pageFile} must use the shared confirmation dialog`);
    }

    const settingsWindow = await readFile(path.join(repoRoot, "shared/src/coretex/settings/settings-window.tsx"), "utf8");
    const settingsNav = await readFile(path.join(repoRoot, "shared/src/coretex/settings/settings-nav.ts"), "utf8");
    const navPageIds = [...settingsNav.matchAll(/\{ id: "([^"]+)"/g)].map((match) => match[1]).sort();
    const renderedPageIds = [...settingsWindow.matchAll(/page === "([^"]+)" &&/g)].map((match) => match[1]).sort();
    assert.deepEqual(renderedPageIds, navPageIds, "Every Settings navigation entry must have exactly one rendered page");
    assert.equal(new Set(navPageIds).size, navPageIds.length, "Settings navigation ids must be unique");
    assert.doesNotMatch(settingsNav, /\bextensions\b/i, "Roadmap-only Extensions must stay out of live Settings navigation and search");
    assert.match(settingsWindow, /max-w-\[1680px\]/, "Settings pages must share the same readable-width frame");
    assert.doesNotMatch(settingsWindow, /page === "model-pricing"\s*\?/, "Model pricing must not bypass the shared page frame");
    assert.match(settingsWindow, /AnimatePresence mode="popLayout"/, "Settings route transitions must keep the incoming page mounted without a blank wait state");
    assert.doesNotMatch(settingsWindow, /AnimatePresence mode="wait"/, "Settings route transitions must not blank the content pane between pages");
    const settingsShell = await readFile(path.join(repoRoot, "shared/src/coretex/settings/settings-shell.tsx"), "utf8");
    assert.match(settingsShell, /@5xl\/settings-page:grid-cols-2/, "Settings columns must wait for a genuinely wide content area");
    assert.doesNotMatch(settingsShell, /(?:^|\s)(?:2xl|xl|lg):grid-cols-2/, "Settings columns must respond to their pane rather than the outer viewport");
    const controls = await readFile(path.join(repoRoot, "shared/src/coretex/settings/controls.tsx"), "utf8");
    assert.match(controls, /sm:flex-row/, "Settings rows must stack before the small breakpoint");
    assert.match(controls, /sm:w-80 2xl:w-96/, "Wide Settings controls must be fluid and leave room for full selected labels");
    assert.match(controls, /const \[draft, setDraft\]/, "Number settings must preserve partial input until commit");
    const security = await readFile(path.join(settingsPagesDir, "security-page.tsx"), "utf8");
    assert.doesNotMatch(security, /OS keychain|hard denylist/i, "Security copy must match the implemented protection model");
    assert.doesNotMatch(security, /not connected|not active yet|unavailable policy/i, "Security must not render placeholder controls");
    for (const pathName of [
        "security.autonomousTerminal",
        "security.denylist",
        "security.allowlist",
        "security.maxCommandLength",
        "security.telemetry",
        "security.crashReports",
        "security.redactSecrets",
    ]) {
        assert.match(security, new RegExp(pathName.replace(".", "\\.")), `${pathName} must be editable from Security`);
    }
    for (const actionName of ["securityGet", "securityCheckCommand", "securityClearSecrets", "securityClearDiagnostics"]) {
        assert.match(security, new RegExp(`actions\\.${actionName}\\b`), `${actionName} must be wired into the Security page`);
    }
    const useCoretex = await readFile(path.join(repoRoot, "shared/src/coretex/use-coretex.ts"), "utf8");
    assert.match(useCoretex, /case "security:state"/, "Security status events must be reduced into UI state");
    assert.match(useCoretex, /type: "security:checkCommand"/, "Security policy previews must round-trip through the Brain");
    const email = await readFile(path.join(settingsPagesDir, "email-settings-page.tsx"), "utf8");
    assert.doesNotMatch(email, /if\s*\(!email\)\s*return\s*<div/, "Email loading must keep the shared Settings page chrome");
    const profiles = await readFile(path.join(settingsPagesDir, "profiles-page.tsx"), "utf8");
    assert.match(profiles, /@5xl\/settings-page:grid-cols-\[18rem_minmax\(0,1fr\)\]/, "Profile master/detail must remain stacked until the Settings pane itself is wide");
    assert.doesNotMatch(profiles, /Add from detected shells|Automatic shell discovery/, "Unavailable shell discovery must not appear in Profiles");
    const providers = await readFile(path.join(settingsPagesDir, "ai-providers-page.tsx"), "utf8");
    assert.match(providers, /@5xl\/settings-page:flex-row/, "Provider master/detail must respond to the Settings pane rather than the outer viewport");

    const account = await readFile(path.join(settingsPagesDir, "account-page.tsx"), "utf8");
    assert.doesNotMatch(account, /ComingSoonNotice|Cloud services coming soon|title="Cloud account"|title="Cross-device sync"|title="Coretex companion"/, "Account must show only working local profile and GitHub surfaces");
    const notifications = await readFile(path.join(settingsPagesDir, "notifications-page.tsx"), "utf8");
    assert.doesNotMatch(notifications, /Mobile notifications|Mobile coming soon|title="Mobile"/, "Notifications must not devote live UI to the unavailable companion app");
    const remote = await readFile(path.join(settingsPagesDir, "remote-page.tsx"), "utf8");
    assert.doesNotMatch(remote, /<MobileCompanionSection|<CoretexAsMcp/, "Remote must render only working SSH and connector surfaces");
    const docker = await readFile(path.join(settingsPagesDir, "docker-page.tsx"), "utf8");
    assert.doesNotMatch(docker, /<RegistryCard\b/, "Docker must not expose registry credentials until the runtime consumes them");
    const startup = await readFile(path.join(settingsPagesDir, "startup-page.tsx"), "utf8");
    for (const deadPath of ["startup.defaultTerminalApp", "session.restore", "session.workspacePresetId"]) {
        assert.doesNotMatch(startup, new RegExp(deadPath.replace(".", "\\.")), `${deadPath} must not expose an ineffective control`);
    }
    const rendering = await readFile(path.join(settingsPagesDir, "rendering-page.tsx"), "utf8");
    assert.doesNotMatch(rendering, /rendering\.render\.webglTerminals/, "Rendering must not expose the unavailable xterm WebGL add-on");
    const speech = await readFile(path.join(settingsPagesDir, "speech-page.tsx"), "utf8");
    assert.doesNotMatch(speech, /speech\.injectIntoTerminal/, "Microphone must not expose an unconsumed PTY injection setting");
    const interaction = await readFile(path.join(settingsPagesDir, "interaction-page.tsx"), "utf8");
    assert.doesNotMatch(interaction, /interaction\.ai\.commandBar/, "Interaction must not expose the unconsumed AI command-bar setting");
    const keybindsPage = await readFile(path.join(settingsPagesDir, "keybinds-page.tsx"), "utf8");
    assert.match(keybindsPage, /SUPPORTED_ACTION_IDS/, "Keybinds must filter to actions handled by the live app dispatcher");
    assert.match(keybindsPage, /replace\(\/\\bAi\\b\/g, "AI"\)/, "Keybind labels must preserve the AI acronym");

    assert.deepEqual(
        parseMcpArgs('-y package "C:\\Program Files\\Coretex" --flag="hello world"'),
        ["-y", "package", "C:\\Program Files\\Coretex", "--flag=hello world"],
    );

    const completions = await computeCompletions(
        makeContext("cd Pro", 6, { cwd: "C:\\", shell: "powershell", os: "windows" }),
        {
            history: [],
            listDir: async () => [{ name: "Program Files", isDir: true }],
            pathExecutables: [],
            providers: { history: false, path: true, specs: false, pathExecutables: false },
        },
    );
    assert.equal(completions[0]?.kind, "path");
    assert.match(completions[0]?.insert ?? "", /` /, "PowerShell path completion must escape spaces");

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "coretex-memory-smoke-"));
    try {
        const memory = new MemoryStore(tempDir);
        await memory.load();
        const base = { category: "fact" as const, source: "manual" as const, createdAt: Date.now(), enabled: true };
        await memory.upsert({ ...base, id: "global", text: "global memory", scope: "global" });
        await memory.upsert({ ...base, id: "agent", text: "agent memory", scope: "agent:agent-1" });
        await memory.upsert({ ...base, id: "project", text: "project memory", scope: "project:project-1" });
        assert.deepEqual(memory.enabledForAgentText("agent-1", "project-1"), ["global memory", "agent memory", "project memory"]);
        assert.deepEqual(memory.enabledForAssistantText(undefined, undefined), ["global memory"]);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }

    if (process.argv.includes("--live-mcp")) {
        const client = new McpClient("npx", ["-y", "@modelcontextprotocol/server-sequential-thinking"]);
        try {
            const result = await client.connect(60_000);
            assert.ok(result.tools.length > 0, "Official reference server returned no MCP tools");
            console.log(`Live MCP handshake passed (${result.serverName ?? "server"}; tools: ${result.tools.map((tool) => tool.name).join(", ")}).`);
        } finally {
            client.disconnect();
        }
    }

    console.log("Settings wiring smoke passed.");
}

void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
