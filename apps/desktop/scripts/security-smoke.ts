import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desktopContentSecurityPolicy } from "../electron/content-security-policy.ts";
import { isAllowedDesktopIpcChannel } from "../electron/ipc-security.ts";
import { isSafeWebviewUrl } from "../electron/navigation-security.ts";

assert.equal(isAllowedDesktopIpcChannel("send", "window:apply"), true);
assert.equal(isAllowedDesktopIpcChannel("receive", "updates:status"), true);
assert.equal(isAllowedDesktopIpcChannel("invoke", "bridge:getConnection"), true);
assert.equal(isAllowedDesktopIpcChannel("invoke", "updates:get-state"), true);
assert.equal(isAllowedDesktopIpcChannel("send", "updates:get-state"), false);
assert.equal(isAllowedDesktopIpcChannel("invoke", "shell:execute"), false);
assert.equal(isAllowedDesktopIpcChannel("receive", "arbitrary:event"), false);

assert.equal(isSafeWebviewUrl("https://example.com/path"), true);
assert.equal(isSafeWebviewUrl("http://localhost:3001/"), true);
assert.equal(isSafeWebviewUrl("about:blank"), true);
assert.equal(isSafeWebviewUrl("file:///C:/Users/ExampleUser/.ssh/id_rsa"), false);
assert.equal(isSafeWebviewUrl("javascript:alert(1)"), false);
assert.equal(isSafeWebviewUrl("data:text/html,<script>alert(1)</script>"), false);

const productionCsp = desktopContentSecurityPolicy(false);
assert.match(productionCsp, /script-src 'self'(?:;|$)/);
assert.doesNotMatch(productionCsp, /script-src[^;]*'unsafe-inline'/);
assert.match(productionCsp, /object-src 'none'/);
assert.match(productionCsp, /base-uri 'none'/);
assert.match(productionCsp, /ws:\/\/127\.0\.0\.1:8765/);
assert.match(productionCsp, /img-src[^;]*http:\/\/localhost:\*/);

const developmentCsp = desktopContentSecurityPolicy(true);
assert.match(developmentCsp, /script-src[^;]*'unsafe-inline'/);
assert.match(developmentCsp, /ws:\/\/localhost:\*/);

const desktopRoot = resolve(import.meta.dirname, "..");
const indexHtml = readFileSync(resolve(desktopRoot, "index.html"), "utf8");
const mainSource = readFileSync(resolve(desktopRoot, "electron/main.ts"), "utf8");
assert.doesNotMatch(indexHtml, /fonts\.(?:googleapis|gstatic)\.com/i);
assert.doesNotMatch(indexHtml, /<script(?![^>]*\bsrc=)[^>]*>/i);
assert.match(mainSource, /contextIsolation:\s*true/);
assert.match(mainSource, /nodeIntegration:\s*false/);
assert.match(mainSource, /sandbox:\s*true/);
assert.match(mainSource, /will-attach-webview/);
assert.match(mainSource, /setPermissionRequestHandler/);

console.info("desktop security smoke passed");
