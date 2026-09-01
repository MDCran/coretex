import assert from "node:assert/strict";
import { normalizeBrowserUrl } from "../src/browser/url.js";

const valid = new Map([
    ["localhost:3000", "http://localhost:3000/"],
    ["api:3000", "http://api:3000/"],
    ["frontend:5173/path", "http://frontend:5173/path"],
    ["example.com:8080", "https://example.com:8080/"],
    ["127.0.0.1:8765", "http://127.0.0.1:8765/"],
    ["192.168.1.8:8080", "http://192.168.1.8:8080/"],
    ["8.8.8.8:8443", "https://8.8.8.8:8443/"],
    ["134744072:8080", "https://8.8.8.8:8080/"],
    ["010.010.010.010:8080", "https://8.8.8.8:8080/"],
    ["[::1]:8765", "http://[::1]:8765/"],
    ["host.docker.internal:3000", "http://host.docker.internal:3000/"],
    ["example.com", "https://example.com/"],
]);
for (const [input, expected] of valid) assert.equal(normalizeBrowserUrl(input), expected, input);

for (const input of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "https://user:password@example.com/",
    "example.com:99999",
    "https://",
]) {
    assert.equal(normalizeBrowserUrl(input), null, input);
}

console.log("browser URL normalization smoke passed");
