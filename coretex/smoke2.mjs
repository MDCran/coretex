import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:8765");
const got = { keyvault: null, env: null, health: null, healthMs: null };
let healthStart = 0;

ws.on("open", () => {
    console.log("connected");
    healthStart = Date.now();
    ws.send(JSON.stringify({ type: "system:health_check" }));
    ws.send(JSON.stringify({ type: "env:get" }));
});

ws.on("message", (buf) => {
    let ev; try { ev = JSON.parse(buf.toString()); } catch { return; }
    if (ev.type === "keyvault:state") got.keyvault = ev.state;
    if (ev.type === "env:state") got.env = ev.state;
    if (ev.type === "providers:health" && got.health === null) {
        got.health = ev.health;
        got.healthMs = Date.now() - healthStart;
    }
});

setTimeout(() => {
    console.log("\n=== RESULTS ===");
    console.log("keyvault keys (expect 0):", got.keyvault ? got.keyvault.keys.length : "n/a");
    console.log("keyvault integrations (expect 0):", got.keyvault ? got.keyvault.integrations.length : "n/a");
    console.log("env environments (expect 0):", got.env ? got.env.environments.length : "n/a");
    console.log("health check returned in ms (expect < 12000, not frozen):", got.healthMs ?? "NO RESPONSE");
    if (got.health) console.log("provider health:", got.health.map((h) => `${h.provider}:${h.healthy ? "up" : "down"}`).join(", "));
    ws.close(); process.exit(0);
}, 14000);
