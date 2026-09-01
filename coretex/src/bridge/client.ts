// Coretex Relay — browser-side WebSocket client.
// Consumed by the dashboard (browser). Uses the global DOM WebSocket.
// Do NOT import React or the "ws" package here.

import type { WebCommand, OrchestratorEvent, OrchestratorEventType } from "../types.js";

const BRIDGE_PROTOCOL = "coretex-v1";
const TOKEN_PROTOCOL_PREFIX = "coretex-auth.";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

type EventHandler = (ev: OrchestratorEvent) => void;
type AnyHandler = (ev: OrchestratorEvent) => void;
type ConnectListener = () => void;
type DisconnectListener = () => void;

export class BridgeClient {
    private readonly url: string;
    private readonly authToken: string | undefined;
    private ws: WebSocket | null = null;
    private handlers = new Map<string, Set<EventHandler>>();
    private anyHandlers = new Set<AnyHandler>();
    private connectListeners = new Set<ConnectListener>();
    private disconnectListeners = new Set<DisconnectListener>();
    private reconnectAttempts = 0;
    private shouldReconnect = true;
    private reconnectTimer: number | null = null;

    constructor(url: string = "ws://localhost:8765", authToken?: string) {
        this.url = url;
        this.authToken = authToken?.trim() || undefined;
        if (this.authToken && !TOKEN_PATTERN.test(this.authToken)) {
            throw new Error("Coretex bridge authentication token is not valid base64url.");
        }
    }

    connect(): void {
        this.shouldReconnect = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return;
        }
        this._createSocket();
    }

    disconnect(): void {
        this.shouldReconnect = false;
        this.reconnectAttempts = 0;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const ws = this.ws;
        this.ws = null;
        if (ws && ws.readyState < WebSocket.CLOSING) {
            ws.close();
        }
    }

    get connected(): boolean {
        return this.ws !== null && this.ws.readyState === 1;
    }

    onConnect(cb: ConnectListener): () => void {
        this.connectListeners.add(cb);
        return () => {
            this.connectListeners.delete(cb);
        };
    }

    onDisconnect(cb: DisconnectListener): () => void {
        this.disconnectListeners.add(cb);
        return () => {
            this.disconnectListeners.delete(cb);
        };
    }

    send(cmd: WebCommand): boolean {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify(cmd));
            return true;
        }
        return false;
    }

    requestStatus(): void {
        this.send({ type: "system:status" });
    }

    requestHealthCheck(): void {
        this.send({ type: "system:health_check" });
    }

    on(type: OrchestratorEventType, handler: EventHandler): () => void {
        let set = this.handlers.get(type);
        if (!set) {
            set = new Set<EventHandler>();
            this.handlers.set(type, set);
        }
        set.add(handler);
        return () => {
            this.off(type, handler);
        };
    }

    onAny(handler: AnyHandler): () => void {
        this.anyHandlers.add(handler);
        return () => {
            this.anyHandlers.delete(handler);
        };
    }

    /** Raw request/response listeners — the ported LifeOS dashboard views use this style
        (onMessage + send({type:"x:getDashboard"})). Thin aliases over the any-handler set so
        their existing code runs without throwing even when the Brain has no matching handler. */
    onMessage(handler: AnyHandler): void {
        this.anyHandlers.add(handler);
    }
    offMessage(handler: AnyHandler): void {
        this.anyHandlers.delete(handler);
    }

    off(type: OrchestratorEventType, handler: EventHandler): void {
        const set = this.handlers.get(type);
        if (set) {
            set.delete(handler);
            if (set.size === 0) {
                this.handlers.delete(type);
            }
        }
    }

    private _createSocket(): void {
        const protocols = this.authToken
            ? [BRIDGE_PROTOCOL, TOKEN_PROTOCOL_PREFIX + this.authToken]
            : [BRIDGE_PROTOCOL];
        const ws = new WebSocket(this.url, protocols);
        this.ws = ws;

        ws.onopen = (): void => {
            if (this.ws !== ws) {
                ws.close();
                return;
            }
            this.reconnectAttempts = 0;
            for (const cb of this.connectListeners) {
                cb();
            }
        };

        ws.onmessage = (event: MessageEvent): void => {
            if (this.ws !== ws) return;
            let parsed: OrchestratorEvent;
            try {
                parsed = JSON.parse(event.data as string) as OrchestratorEvent;
            } catch {
                return;
            }
            this._dispatch(parsed);
        };

        ws.onclose = (): void => {
            // A replacement may already be connecting/open (notably after React's
            // development mount -> cleanup -> mount cycle). A late close from the
            // retired socket must not notify or start another reconnect chain.
            if (this.ws !== ws) return;
            this.ws = null;
            for (const cb of this.disconnectListeners) {
                cb();
            }
            this._scheduleReconnect();
        };

        ws.onerror = (): void => {
            if (this.ws !== ws) return;
            ws.close();
        };
    }

    private _dispatch(event: OrchestratorEvent): void {
        const set = this.handlers.get(event.type);
        if (set) {
            for (const handler of set) {
                handler(event);
            }
        }
        for (const handler of this.anyHandlers) {
            handler(event);
        }
    }

    private _scheduleReconnect(): void {
        if (!this.shouldReconnect || this.reconnectTimer !== null ||
            (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN))) {
            return;
        }
        const delay = Math.min(30000, 2000 * (this.reconnectAttempts + 1));
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout((): void => {
            this.reconnectTimer = null;
            if (!this.shouldReconnect ||
                (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN))) {
                return;
            }
            this._createSocket();
        }, delay) as unknown as number;
    }
}

/*
// ---- Reference: React hook for the dashboard (provided separately as a .tsx) ----
// This block is commented out so it does not affect the Node typecheck.
//
// import { useEffect, useRef, useState, useCallback } from "react";
// import { BridgeClient } from "./client.js";
// import type {
//     OrchestratorEvent,
//     AgentState,
//     Task,
//     Project,
//     CostSummary,
//     ProviderHealth,
//     WebCommand,
// } from "../types.js";
//
// export interface CoretexState {
//     connected: boolean;
//     agents: AgentState[];
//     tasks: Task[];
//     projects: Project[];
//     cost: CostSummary | null;
//     health: ProviderHealth[];
//     logs: { level: string; message: string; timestamp: string }[];
// }
//
// export function useCoretex(url: string = "ws://localhost:8765") {
//     const clientRef = useRef<BridgeClient | null>(null);
//     const [connected, setConnected] = useState(false);
//     const [agents, setAgents] = useState<AgentState[]>([]);
//     const [tasks, setTasks] = useState<Task[]>([]);
//     const [projects, setProjects] = useState<Project[]>([]);
//     const [cost, setCost] = useState<CostSummary | null>(null);
//     const [health, setHealth] = useState<ProviderHealth[]>([]);
//     const [logs, setLogs] = useState<CoretexState["logs"]>([]);
//
//     useEffect(() => {
//         const client = new BridgeClient(url);
//         clientRef.current = client;
//
//         client.onConnect(() => {
//             setConnected(true);
//             client.requestStatus();
//             client.requestHealthCheck();
//         });
//         client.onDisconnect(() => setConnected(false));
//
//         const upsertTask = (task: Task) =>
//             setTasks((prev) => {
//                 const next = prev.filter((t) => t.id !== task.id);
//                 next.push(task);
//                 return next;
//             });
//
//         const unsubscribers: Array<() => void> = [];
//
//         unsubscribers.push(
//             client.on("system:status", (ev) => {
//                 if (ev.type !== "system:status") return;
//                 setAgents(ev.agents);
//                 setTasks(ev.tasks);
//                 setProjects(ev.projects);
//             }),
//         );
//         unsubscribers.push(
//             client.on("agent:status", (ev) => {
//                 if (ev.type !== "agent:status") return;
//                 setAgents((prev) =>
//                     prev.map((a) =>
//                         a.id === ev.agentId
//                             ? { ...a, status: ev.status, currentTaskId: ev.taskId }
//                             : a,
//                     ),
//                 );
//             }),
//         );
//         unsubscribers.push(client.on("task:created", (ev) => ev.type === "task:created" && upsertTask(ev.task)));
//         unsubscribers.push(client.on("task:updated", (ev) => ev.type === "task:updated" && upsertTask(ev.task)));
//         unsubscribers.push(client.on("task:completed", (ev) => ev.type === "task:completed" && upsertTask(ev.task)));
//         unsubscribers.push(client.on("task:failed", (ev) => ev.type === "task:failed" && upsertTask(ev.task)));
//         unsubscribers.push(
//             client.on("project:created", (ev) => {
//                 if (ev.type !== "project:created") return;
//                 setProjects((prev) => [...prev.filter((p) => p.id !== ev.project.id), ev.project]);
//             }),
//         );
//         unsubscribers.push(
//             client.on("project:updated", (ev) => {
//                 if (ev.type !== "project:updated") return;
//                 setProjects((prev) => prev.map((p) => (p.id === ev.project.id ? ev.project : p)));
//             }),
//         );
//         unsubscribers.push(client.on("cost:update", (ev) => ev.type === "cost:update" && setCost(ev.summary)));
//         unsubscribers.push(client.on("providers:health", (ev) => ev.type === "providers:health" && setHealth(ev.health)));
//         unsubscribers.push(
//             client.on("system:log", (ev) => {
//                 if (ev.type !== "system:log") return;
//                 setLogs((prev) => [...prev.slice(-199), { level: ev.level, message: ev.message, timestamp: ev.timestamp }]);
//             }),
//         );
//
//         client.connect();
//
//         return () => {
//             for (const off of unsubscribers) off();
//             client.disconnect();
//         };
//     }, [url]);
//
//     const send = useCallback((cmd: WebCommand): boolean => {
//         return clientRef.current?.send(cmd) ?? false;
//     }, []);
//
//     return { connected, agents, tasks, projects, cost, health, logs, send } as const;
// }
*/
