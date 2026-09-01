// Coretex — entrypoint. Boots the Orchestrator, configures providers from the
// environment, seeds a starter set of agents/projects/tasks to prove the loop
// runs end to end, and wires graceful shutdown on SIGINT/SIGTERM.

import { Orchestrator } from "./orchestrator.js";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
    AgentConfig,
    CreateAgentInput,
    CreateTaskInput,
    Project,
    ProviderConfig,
    Task,
} from "./types.js";

/** Default local model served by Ollama (override with CORETEX_LOCAL_MODEL). */
const LOCAL_MODEL: string = process.env.CORETEX_LOCAL_MODEL ?? "llama3.1:latest";
/** Anthropic model used when an API key is present. */
const ANTHROPIC_MODEL: string = "claude-haiku-4-5";
const DESKTOP_DEV = process.argv.includes("--desktop-dev");
const WS_PORT = DESKTOP_DEV ? 8766 : 8765;

// The bridge applies exact Origin matching. These are the known local development
// frontends; custom ports must be opted in explicitly as a comma-separated list.
if (!process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS) {
    process.env.CORETEX_BRIDGE_ALLOWED_ORIGINS = DESKTOP_DEV
        ? [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ].join(",")
        : "http://localhost:3000,http://127.0.0.1:3000";
}

if (DESKTOP_DEV && !process.env.CORETEX_DATA_DIR) {
    process.env.CORETEX_DATA_DIR = join(homedir(), ".coretex-dev");
}

try {
    const providers: ProviderConfig = {
        ollama: { baseUrl: "http://localhost:11434" },
        lmstudio: { baseUrl: "http://localhost:1234" },
        ...(process.env.ANTHROPIC_API_KEY !== undefined
            ? { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } }
            : {}),
        ...(process.env.OPENAI_API_KEY !== undefined
            ? { openai: { apiKey: process.env.OPENAI_API_KEY } }
            : {}),
    };

    const coretex: Orchestrator = new Orchestrator({ providers, wsPort: WS_PORT });

    await coretex.start();

    // ---- Seed agents ----
    // A full default team, one agent per specialist role (skip the generic
    // "custom" role — it has no fixed specialization to seed), plus a second
    // developer since implementation work is the most common bottleneck. All
    // run on the local Ollama model out of the box so a fresh install needs no
    // API keys; writer/analyst upgrade to Anthropic automatically once a key is
    // configured, matching how the rest of the roster would scale with paid
    // providers.
    const seedAgents: CreateAgentInput[] = [
        { name: "Atlas", role: "orchestrator", provider: "ollama", model: LOCAL_MODEL },
        { name: "Sage", role: "planner", provider: "ollama", model: LOCAL_MODEL },
        { name: "Scout", role: "researcher", provider: "ollama", model: LOCAL_MODEL },
        { name: "Dev One", role: "developer", provider: "ollama", model: LOCAL_MODEL },
        { name: "Dev Two", role: "developer", provider: "ollama", model: LOCAL_MODEL },
        { name: "Vera", role: "reviewer", provider: "ollama", model: LOCAL_MODEL },
        { name: "Ops", role: "devops", provider: "ollama", model: LOCAL_MODEL },
        { name: "Quill", role: "writer", provider: "ollama", model: LOCAL_MODEL },
        { name: "Lens", role: "analyst", provider: "ollama", model: LOCAL_MODEL },
        { name: "Q", role: "qa", provider: "ollama", model: LOCAL_MODEL },
    ];

    if (process.env.ANTHROPIC_API_KEY !== undefined) {
        for (const agent of seedAgents) {
            if (agent.role === "writer" || agent.role === "analyst") {
                agent.provider = "anthropic";
                agent.model = ANTHROPIC_MODEL;
            }
        }
    }

    if (coretex.getStatus().agents.length === 0) {
        for (const input of seedAgents) {
            const config: AgentConfig = coretex.addAgent(input);
            console.log(`[seed] agent ${config.name} (${config.role}) -> ${config.id}`);
        }
    } else {
        console.log(`[seed] ${coretex.getStatus().agents.length} persisted agent(s) restored paused — skipping demo agent seed.`);
    }

    // ---- Seed a project + starter tasks ONLY on a fresh install ----
    // Projects now persist to disk, so re-seeding every launch would duplicate them.
    if (coretex.getStatus().projects.length === 0) {
        const project: Project = coretex.createProject({
            name: "Coretex Bootstrap",
            description: "Starter project that proves the orchestration loop runs end to end.",
            tags: ["bootstrap", "demo"],
        });
        console.log(`[seed] project ${project.name} -> ${project.id}`);

        const seedTasks: CreateTaskInput[] = [
            {
                title: "Survey the local model landscape",
                description:
                    "Research which local models are available via Ollama and summarize their strengths.",
                priority: "high",
                requiredRole: "researcher",
                projectId: project.id,
                tags: ["research"],
            },
            {
                title: "Draft the orchestrator smoke test",
                description:
                    "Outline a minimal end-to-end smoke test that exercises the agent/task loop.",
                priority: "medium",
                requiredRole: "developer",
                projectId: project.id,
                tags: ["dev"],
            },
        ];

        for (const input of seedTasks) {
            const task: Task = coretex.createTask(input);
            console.log(`[seed] task "${task.title}" -> ${task.id}`);
        }
    } else {
        console.log(`[seed] ${coretex.getStatus().projects.length} persisted project(s) loaded — skipping demo seed.`);
    }

    // ---- Graceful shutdown ----
    const shutdown = async (signal: string): Promise<void> => {
        console.log(`\n[shutdown] received ${signal}, stopping Coretex...`);
        coretex.stop();
        let exitCode = 0;
        try {
            await coretex.agentStore.flush();
        } catch (error) {
            console.error(`[shutdown] agent settings could not be flushed: ${error instanceof Error ? error.message : String(error)}`);
            exitCode = 1;
        }
        process.exit(exitCode);
    };

    process.on("SIGINT", (): void => {
        void shutdown("SIGINT");
    });
    process.on("SIGTERM", (): void => {
        void shutdown("SIGTERM");
    });

    console.log("[main] Coretex is running. Press Ctrl+C to stop.");
} catch (err: unknown) {
    const message: string = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[main] fatal error during bootstrap:\n${message}`);
    process.exit(1);
}
