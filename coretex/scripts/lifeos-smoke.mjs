import WebSocket from "ws";
import { bridgeProtocols } from "./bridge-smoke-auth.mjs";

const commands = [
    "financial:getOverview", "financial:getNetWorth", "financial:getHealth", "financial:getAlerts",
    "financial:getForecast", "financial:getCalendar", "financial:getAccounts", "financial:getCards",
    "financial:getCredit", "financial:getDebt", "financial:getInstitutions", "financial:getTransactions",
    "financial:getStatements", "financial:getImportStatus", "financial:getSubscriptions", "financial:getIncome",
    "financial:getBudget", "financial:getGoals", "financial:getPaycheck", "financial:getReports",
    "financial:getDeductions", "financial:getCurrencies", "financial:getTax",
    "social:getOverview", "social:getCanvas", "social:getContacts", "social:getCalendar", "social:getDrafts", "social:getEvents",
    "workouts:getOverview", "workouts:getLog", "workouts:getSchedule", "workouts:getExercises",
    "workouts:getTemplates", "workouts:getBody", "workouts:getProgress",
    "health:getOverview", "health:getMetrics", "health:getGoals", "health:getVitals", "health:getSleep",
    "health:getHabits", "health:getJournal", "health:getMedical", "health:getPhotos", "health:getSobriety",
    "health:getPeptides", "health:getMedications",
    "nutrition:getOverview", "tasks:getDashboard", "tasks:getAnalytics",
];

const url = process.env.CORETEX_WS_URL ?? "ws://127.0.0.1:8765";
const socket = new WebSocket(url, await bridgeProtocols(url));
const pending = new Map();

socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (!message.requestId || !pending.has(message.requestId)) return;
    const { resolve, reject, timer } = pending.get(message.requestId);
    clearTimeout(timer);
    pending.delete(message.requestId);
    if (message.error) reject(new Error(`${message.type}: ${message.error}`));
    else resolve(message.result);
});

const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
});

function request(type, index) {
    const requestId = `lifeos_smoke_${index}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error(`${type}: timed out`));
        }, 15_000);
        pending.set(requestId, { resolve, reject, timer });
        socket.send(JSON.stringify({ type, requestId }));
    });
}

try {
    await opened;
    for (const [index, command] of commands.entries()) {
        await request(command, index);
        process.stdout.write(".");
    }
    process.stdout.write(`\nLifeOS smoke passed: ${commands.length} read contracts.\n`);
    socket.close();
} catch (error) {
    console.error(`\nLifeOS smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    socket.close();
    process.exitCode = 1;
}
