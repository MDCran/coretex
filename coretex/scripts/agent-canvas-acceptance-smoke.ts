import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  AgentPersistenceStore,
  DEFAULT_AGENT_CANVAS_CARD_SETTINGS,
  normalizeAgentConfig,
  normalizeAgentConfigPatch,
  restorePersistedAgentsPaused,
} from "../src/agents/store.js";
import { AgentPool } from "../src/agents/pool.js";
import { Orchestrator } from "../src/orchestrator.js";
import {
  createConnection,
  deleteConnection,
  getCanvas,
  updateContactMeta,
} from "../src/lifeos/social-canvas.js";
import type {
  AgentConfig,
  OrchestratorConfig,
  Task,
  WebCommand,
} from "../src/types.js";

const prisma = new PrismaClient({ log: [] });

function step(label: string): void {
  process.stdout.write(`${label} ✓\n`);
}

function agentConfig(
  id: string,
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  return normalizeAgentConfig({
    id,
    name: `Agent ${id}`,
    role: "developer",
    provider: "ollama",
    model: "fixture-model",
    systemPrompt: "Work only on the assigned fixture.",
    temperature: 0.2,
    maxTokensPerStep: 2_000,
    maxSteps: 20,
    tokenBudget: 0,
    dailyTokenBudget: 50_000,
    permissionMode: "ask",
    terminalAccess: false,
    tags: [],
    ...overrides,
  });
}

const POOL_CONFIG: OrchestratorConfig = {
  wsPort: 0,
  tickIntervalMs: 500,
  maxConcurrentAgents: 4,
  dailyCostLimitUSD: 1,
  memoryWindowSize: 20,
  providers: { ollama: { baseUrl: "http://127.0.0.1:1" } },
};

function taskFixture(id = "task_fixture"): Task {
  const now = "2026-08-18T12:00:00.000Z";
  return {
    id,
    title: "Disposable task",
    description: "Must never dispatch during restore.",
    priority: "medium",
    status: "pending",
    dependencies: [],
    tags: [],
    retryCount: 0,
    maxRetries: 0,
    createdAt: now,
    updatedAt: now,
  };
}

async function testMinimalCreateAndSafePatchContract(): Promise<void> {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "coretex-agent-create-smoke-"),
  );
  const previousDataDir = process.env.CORETEX_DATA_DIR;
  let orchestrator: Orchestrator | undefined;
  process.env.CORETEX_DATA_DIR = dataDir;
  try {
    orchestrator = new Orchestrator({ wsPort: 0 });
    const created = orchestrator.addAgent({
      name: "Minimal fixture",
      role: "developer",
      provider: "ollama",
      model: "fixture-model",
    });
    assert.equal(created.name, "Minimal fixture");
    assert.equal(created.permissionMode, "ask");
    assert.equal(created.terminalAccess, undefined);
    assert.equal(
      orchestrator.pool.get(created.id)?.status,
      "idle",
      "fresh user-created agents remain a deliberate current-session action",
    );

    let runtimeMutations = 0;
    const poolHarness = orchestrator.pool as AgentPool & {
      pause: (id: string) => void;
      resume: (id: string) => void;
      halt: (id: string) => void;
    };
    poolHarness.pause = () => {
      runtimeMutations++;
    };
    poolHarness.resume = () => {
      runtimeMutations++;
    };
    poolHarness.halt = () => {
      runtimeMutations++;
    };
    const route = (command: WebCommand): void => {
      (
        orchestrator as unknown as {
          _handleCommand(command: WebCommand, clientId: string): void;
        }
      )._handleCommand(command, "disposable-client");
    };
    route({
      type: "agent:canvas:setPosition",
      agentId: created.id,
      position: { x: 72, y: 96 },
    });
    route({
      type: "agent:canvas:updatePreferences",
      patch: { showConnections: false },
    });
    route({
      type: "agent:canvas:updateCard",
      agentId: created.id,
      patch: { density: "compact", pinned: true },
    });
    route({
      type: "agent:update",
      agentId: created.id,
      patch: { name: "Minimal fixture updated", permissionMode: "plan" },
    });
    assert.equal(
      runtimeMutations,
      0,
      "canvas and settings commands must not call pause, resume, or halt",
    );
    assert.equal(
      orchestrator.pool.get(created.id)?.config.name,
      "Minimal fixture updated",
    );
    assert.deepEqual(
      orchestrator.agentStore.getCanvas().positions[created.id],
      { x: 72, y: 96 },
    );
    assert.equal(
      orchestrator.agentStore.getCanvas().cards[created.id]?.pinned,
      true,
    );
    route({
      type: "agent:update",
      agentId: created.id,
      patch: { status: "working" } as unknown as Partial<AgentConfig>,
    });
    assert.equal(
      orchestrator.pool.get(created.id)?.status,
      "idle",
      "forged runtime state must not cross the config route",
    );

    await orchestrator.agentStore.flush();
    const persisted = new AgentPersistenceStore(dataDir);
    await persisted.load();
    assert.deepEqual(
      persisted.listConfigs().map((config) => config.id),
      [created.id],
    );
    assert.equal(
      persisted.getConfig(created.id)?.name,
      "Minimal fixture updated",
    );
    assert.deepEqual(persisted.getCanvas().positions[created.id], {
      x: 72,
      y: 96,
    });

    const safe = normalizeAgentConfigPatch({
      name: "Renamed fixture",
      permissionMode: "plan",
      executionMode: "assisted",
      terminalAccess: true,
      connectorIds: ["vault-a", "vault-a", "vault-b"],
      mcpServerIds: ["mcp-a"],
      skills: [{ name: "Fixture skill", content: "# Safe", enabled: true }],
      identity: {
        icon: { kind: "untitled-ui", name: "Code02" },
        themeColor: "#2563eb",
      },
      tags: ["project-a"],
    });
    assert.deepEqual(safe.connectorIds, ["vault-a", "vault-b"]);
    assert.throws(
      () => normalizeAgentConfigPatch({ status: "working" }),
      /cannot be changed/i,
    );
    assert.throws(
      () => normalizeAgentConfigPatch({ currentTaskId: "task_live" }),
      /cannot be changed/i,
    );
    assert.throws(
      () => normalizeAgentConfigPatch({ id: "forged" }),
      /cannot be changed/i,
    );
    assert.throws(
      () => normalizeAgentConfigPatch({ temperature: Number.NaN }),
      /finite number/i,
    );
    assert.throws(
      () => normalizeAgentConfigPatch({ tokenBudget: -1 }),
      /between 0/i,
    );
    assert.throws(
      () => normalizeAgentConfigPatch({ permissionMode: "unrestricted" }),
      /unsupported/i,
    );
    assert.throws(
      () =>
        normalizeAgentConfig({ ...agentConfig("safe_id"), id: "__proto__" }),
      /unsupported characters/i,
    );
  } finally {
    if (orchestrator)
      await orchestrator.agentStore.flush().catch(() => undefined);
    if (previousDataDir === undefined) delete process.env.CORETEX_DATA_DIR;
    else process.env.CORETEX_DATA_DIR = previousDataDir;
    await rm(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

async function testDurableConfigAndCanvasStore(): Promise<void> {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "coretex-agent-store-smoke-"),
  );
  const stores: AgentPersistenceStore[] = [];
  try {
    const store = new AgentPersistenceStore(dataDir);
    stores.push(store);
    await store.load();
    const alpha = store.upsertConfig(agentConfig("agent_alpha"));
    const beta = store.upsertConfig(
      agentConfig("agent_beta", { role: "researcher" }),
    );
    const allowed = new Set([alpha.id, beta.id]);
    assert.throws(
      () =>
        store.updateConfig(alpha.id, {
          name: "Must not partially apply",
          showConnections: true,
        } as unknown as Partial<AgentConfig>),
      /cannot be changed/i,
    );
    assert.equal(
      store.getConfig(alpha.id)?.name,
      agentConfig(alpha.id).name,
      "rejected patches must be atomic in memory",
    );

    const updated = store.updateConfig(alpha.id, {
      name: "Alpha updated",
      temperature: 0.7,
      maxSteps: 41,
      dailyTokenBudget: 91_000,
      permissionMode: "accept-edits",
    });
    assert.equal(updated.id, alpha.id);
    assert.equal(updated.name, "Alpha updated");

    store.setPosition(alpha.id, { x: 120, y: -48 }, allowed);
    store.setLayout(
      {
        [alpha.id]: { x: 0, y: 0 },
        [beta.id]: { x: 296, y: 0 },
      },
      allowed,
    );
    store.updatePreferences({ showConnections: false });
    store.updateCard(
      alpha.id,
      {
        density: "compact",
        accentSource: "custom",
        customColor: "#7c3aed",
        showModel: false,
        pinned: true,
      },
      allowed,
    );
    await store.flush();

    const reloaded = new AgentPersistenceStore(dataDir);
    stores.push(reloaded);
    await reloaded.load();
    assert.deepEqual(
      reloaded.listConfigs().map((config) => config.id),
      [alpha.id, beta.id],
    );
    assert.equal(reloaded.getConfig(alpha.id)?.name, "Alpha updated");
    assert.deepEqual(reloaded.getCanvas().positions, {
      [alpha.id]: { x: 0, y: 0 },
      [beta.id]: { x: 296, y: 0 },
    });
    assert.equal(reloaded.getCanvas().showConnections, false);
    assert.deepEqual(reloaded.getCanvas().cards[alpha.id], {
      ...DEFAULT_AGENT_CANVAS_CARD_SETTINGS,
      density: "compact",
      accentSource: "custom",
      customColor: "#7c3aed",
      showModel: false,
      pinned: true,
    });
    const detachedCanvas = reloaded.getCanvas();
    detachedCanvas.positions[alpha.id]!.x = 999_999;
    detachedCanvas.cards[alpha.id]!.pinned = false;
    assert.deepEqual(
      reloaded.getCanvas().positions[alpha.id],
      { x: 0, y: 0 },
      "canvas getters must not leak mutable point references",
    );
    assert.equal(
      reloaded.getCanvas().cards[alpha.id]?.pinned,
      true,
      "canvas getters must not leak mutable card settings",
    );

    const beforeResetRevision = reloaded.getCanvas().revision;
    reloaded.resetLayout();
    assert.deepEqual(reloaded.getCanvas().positions, {});
    assert.equal(
      reloaded.getCanvas().cards[alpha.id]?.pinned,
      true,
      "layout reset must preserve card customization",
    );
    assert.equal(
      reloaded.getCanvas().showConnections,
      false,
      "layout reset must preserve canvas preferences",
    );
    assert.equal(reloaded.getCanvas().revision, beforeResetRevision + 1);

    assert.throws(
      () => reloaded.setPosition("missing", { x: 1, y: 2 }, allowed),
      /not found/i,
    );
    assert.throws(
      () => reloaded.setPosition(alpha.id, { x: Number.NaN, y: 0 }, allowed),
      /finite number/i,
    );
    assert.throws(
      () => reloaded.setPosition(alpha.id, { x: 1_000_001, y: 0 }, allowed),
      /between/i,
    );
    assert.throws(
      () =>
        reloaded.setLayout(JSON.parse('{"__proto__":{"x":0,"y":0}}'), allowed),
      /invalid/i,
    );
    assert.throws(
      () =>
        reloaded.updatePreferences({ showConnections: true, runAgent: true }),
      /unsupported/i,
    );
    assert.throws(
      () => reloaded.updateCard(alpha.id, { status: "working" }, allowed),
      /unsupported/i,
    );
    assert.throws(
      () =>
        reloaded.updateCard(
          alpha.id,
          { customColor: "url(javascript:alert(1))" },
          allowed,
        ),
      /hex color or theme variable/i,
    );
    assert.throws(
      () =>
        reloaded.setLayout(
          Object.fromEntries(
            Array.from({ length: 1_001 }, (_, index) => [
              `agent_${index}`,
              { x: 0, y: 0 },
            ]),
          ),
          undefined,
        ),
      /at most 1,?000/i,
    );

    for (let index = 0; index < 25; index++) {
      reloaded.setPosition(beta.id, { x: index * 24, y: index * -24 }, allowed);
    }
    await reloaded.flush();
    const burstReload = new AgentPersistenceStore(dataDir);
    stores.push(burstReload);
    await burstReload.load();
    assert.deepEqual(
      burstReload.getCanvas().positions[beta.id],
      { x: 576, y: -576 },
      "burst writes must persist the final snapshot",
    );

    reloaded.setPosition(alpha.id, { x: 24, y: 48 }, allowed);
    reloaded.removeConfig(alpha.id);
    assert.equal(reloaded.getConfig(alpha.id), undefined);
    assert.equal(reloaded.getCanvas().positions[alpha.id], undefined);
    assert.equal(reloaded.getCanvas().cards[alpha.id], undefined);
    await reloaded.flush();
    const raw = JSON.parse(
      await readFile(path.join(dataDir, "agents.json"), "utf8"),
    ) as { version: number; agents: AgentConfig[] };
    assert.equal(raw.version, 1);
    assert.deepEqual(
      raw.agents.map((config) => config.id),
      [beta.id],
    );
  } finally {
    await Promise.allSettled(stores.map((store) => store.flush()));
    await rm(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

async function testLegacyAndMalformedIsolation(): Promise<void> {
  const dataDir = await mkdtemp(
    path.join(tmpdir(), "coretex-agent-migration-smoke-"),
  );
  try {
    const legacy = agentConfig("agent_legacy");
    await writeFile(
      path.join(dataDir, "agents.json"),
      JSON.stringify([legacy, { id: "broken", name: "Missing fields" }]),
      "utf8",
    );
    const migrated = new AgentPersistenceStore(dataDir);
    await migrated.load();
    assert.deepEqual(
      migrated.listConfigs().map((config) => config.id),
      [legacy.id],
    );
    assert.deepEqual(migrated.getCanvas(), {
      positions: {},
      cards: {},
      showConnections: true,
      revision: 0,
    });

    await writeFile(
      path.join(dataDir, "agents.json"),
      JSON.stringify({
        version: 1,
        agents: [legacy],
        canvas: {
          positions: {
            [legacy.id]: { x: 10, y: 20 },
            stale_agent: { x: 30, y: 40 },
          },
          cards: {
            [legacy.id]: DEFAULT_AGENT_CANVAS_CARD_SETTINGS,
            stale_agent: DEFAULT_AGENT_CANVAS_CARD_SETTINGS,
          },
          showConnections: true,
          revision: 8,
        },
      }),
      "utf8",
    );
    await migrated.load();
    assert.deepEqual(
      migrated.getCanvas().positions,
      { [legacy.id]: { x: 10, y: 20 } },
      "stale cards must not survive reload",
    );
    assert.deepEqual(Object.keys(migrated.getCanvas().cards), [legacy.id]);
  } finally {
    await rm(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

function testPausedRestoreRequiresExplicitResume(): void {
  const configs = [
    agentConfig("agent_restore_a"),
    agentConfig("agent_restore_b", { role: "qa" }),
  ];
  const pool = new AgentPool(POOL_CONFIG);
  let providerOrRuntimeCalls = 0;
  pool.capabilityProvider = () => {
    providerOrRuntimeCalls++;
    return undefined;
  };
  pool.taskContextProvider = async () => {
    providerOrRuntimeCalls++;
    return undefined;
  };

  const restored = restorePersistedAgentsPaused(configs, pool);
  assert.deepEqual(restored, ["agent_restore_a", "agent_restore_b"]);
  assert.deepEqual(
    pool.snapshots().map((agent) => agent.status),
    ["paused", "paused"],
  );
  assert.equal(
    pool.findAvailableForTask(taskFixture()),
    undefined,
    "restored definitions must be unschedulable",
  );
  assert.equal(
    providerOrRuntimeCalls,
    0,
    "restore must not call capability, context, provider, or runtime seams",
  );

  assert.deepEqual(
    restorePersistedAgentsPaused(configs, pool),
    [],
    "repeated restore must preserve stable ids without duplicates",
  );
  pool.resume("agent_restore_a");
  assert.equal(
    pool.findAvailableForTask(taskFixture("after_explicit_resume"))?.id,
    "agent_restore_a",
  );
  assert.equal(pool.get("agent_restore_b")?.status, "paused");
  assert.equal(
    providerOrRuntimeCalls,
    0,
    "explicit availability selection still must not invoke a provider",
  );
}

async function testDisposableSocialGraphContracts(): Promise<void> {
  const suffix = randomUUID().replaceAll("-", "");
  const userId = `agent_canvas_social_${suffix}`;
  const outsiderId = `agent_canvas_social_outsider_${suffix}`;
  try {
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          email: `${userId}@example.invalid`,
          name: "Canvas owner",
          passwordHash: "disposable",
        },
        {
          id: outsiderId,
          email: `${outsiderId}@example.invalid`,
          name: "Canvas outsider",
          passwordHash: "disposable",
        },
      ],
    });
    const [alpha, beta, gamma, outsider] = await Promise.all([
      prisma.socialContact.create({
        data: { userId, displayName: "Alpha", relationshipType: "Friend" },
      }),
      prisma.socialContact.create({
        data: { userId, displayName: "Beta", relationshipType: "Friend" },
      }),
      prisma.socialContact.create({
        data: { userId, displayName: "Gamma", relationshipType: "Colleague" },
      }),
      prisma.socialContact.create({
        data: { userId: outsiderId, displayName: "Outsider" },
      }),
    ]);

    await assert.rejects(
      createConnection(userId, { contact1Id: alpha.id, contact2Id: alpha.id }),
      /different contacts/i,
    );
    const first = await createConnection(userId, {
      contact1Id: alpha.id,
      contact2Id: beta.id,
      relationshipType: "friend",
      notes: "Met at school",
    });
    const reverse = await createConnection(userId, {
      contact1Id: beta.id,
      contact2Id: alpha.id,
      relationshipType: "close friend",
    });
    assert.equal(
      reverse.id,
      first.id,
      "reverse linking must be idempotent instead of creating a parallel edge",
    );
    const edge = await prisma.socialConnection.findUnique({
      where: { id: first.id },
    });
    assert.equal(edge?.relationshipType, "close friend");
    assert.equal(
      await prisma.socialConnection.count({
        where: {
          OR: [
            { contact1Id: alpha.id, contact2Id: beta.id },
            { contact1Id: beta.id, contact2Id: alpha.id },
          ],
        },
      }),
      1,
    );

    const second = await createConnection(userId, {
      contact1Id: beta.id,
      contact2Id: gamma.id,
      relationshipType: "coworker",
    });
    await assert.rejects(
      createConnection(userId, {
        contact1Id: alpha.id,
        contact2Id: outsider.id,
      }),
      /not found/i,
      "cross-tenant graph edges must be rejected",
    );
    await assert.rejects(
      deleteConnection(outsiderId, { id: first.id }),
      /not found/i,
      "another user must not delete an edge",
    );
    await assert.rejects(
      updateContactMeta(outsiderId, { id: alpha.id, howWeMet: "forged" }),
      /not found/i,
    );

    const canvas = await getCanvas(userId);
    assert.deepEqual(
      new Set(canvas.contacts.map((contact) => contact.id)),
      new Set([alpha.id, beta.id, gamma.id]),
    );
    assert.deepEqual(
      new Set(canvas.connections.map((connection) => connection.id)),
      new Set([first.id, second.id]),
    );
    const outsiderCanvas = await getCanvas(outsiderId);
    assert.deepEqual(
      outsiderCanvas.contacts.map((contact) => contact.id),
      [outsider.id],
    );
    assert.equal(outsiderCanvas.connections.length, 0);

    await deleteConnection(userId, { id: second.id });
    assert.equal(
      await prisma.socialConnection.count({ where: { id: second.id } }),
      0,
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [userId, outsiderId] } },
    });
    assert.equal(
      await prisma.user.count({ where: { id: { in: [userId, outsiderId] } } }),
      0,
      "disposable social fixtures were not cleaned up",
    );
  }
}

function sourceSection(source: string, start: string, end: string): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const from = normalized.indexOf(start);
  const to = normalized.indexOf(end, from + start.length);
  assert.ok(from >= 0, `Missing source marker: ${start}`);
  assert.ok(to > from, `Missing source end marker: ${end}`);
  return normalized.slice(from, to);
}

async function testUiAndRouterWiringContracts(): Promise<void> {
  const [
    agentsCanvas,
    agentsView,
    socialCanvas,
    sharedCanvas,
    canvasActionDock,
    socialView,
    projectsListView,
    projectWorkspace,
    projectCanvas,
    useCoretex,
    orchestrator,
    storeSource,
    mainSource,
  ] = await Promise.all([
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/agents-canvas.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/agents-view.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/social-canvas.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/shared-canvas.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/canvas-action-dock.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/social-view.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/views/projects-list-view.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/workspace/project-workspace.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL(
          "../../shared/src/coretex/workspace/canvas/project-canvas-tab.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(
        new URL("../../shared/src/coretex/use-coretex.ts", import.meta.url),
      ),
      "utf8",
    ),
    readFile(
      fileURLToPath(new URL("../src/orchestrator.ts", import.meta.url)),
      "utf8",
    ),
    readFile(
      fileURLToPath(new URL("../src/agents/store.ts", import.meta.url)),
      "utf8",
    ),
    readFile(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8"),
  ]);

  for (const contract of [
    "agentCanvas",
    "agentCanvasLoaded",
    "requestAgentCanvas",
    "setAgentCanvasPosition",
    "setAgentCanvasLayout",
    "resetAgentCanvasLayout",
    "setAgentCanvasPreferences",
    "setAgentCanvasCardSettings",
  ]) {
    assert.match(
      useCoretex,
      new RegExp(`\\b${contract}\\b`),
      `renderer state/actions omitted ${contract}`,
    );
  }
  assert.match(
    useCoretex,
    /ev\.state\.revision < state\.agentCanvas\.revision/,
    "renderer must ignore stale multi-window canvas broadcasts",
  );
  assert.match(
    useCoretex,
    /agentCanvasLoaded:\s*true/,
    "legacy migration must wait for an authoritative Brain snapshot",
  );
  const connectionReducer = sourceSection(
    useCoretex,
    'if (action.type === "connection")',
    "const ev = action.event",
  );
  assert.match(
    connectionReducer,
    /connected:\s*false,[\s\S]*?agentCanvasLoaded:\s*false/,
    "disconnect must permit a restarted Brain's lower authoritative revision",
  );
  assert.match(
    connectionReducer,
    /connected:\s*true,\s*agentCanvasLoaded:\s*false/,
    "reconnect must wait for a fresh authoritative canvas snapshot",
  );
  for (const command of [
    "agent:canvas:get",
    "agent:canvas:setPosition",
    "agent:canvas:setLayout",
    "agent:canvas:reset",
    "agent:canvas:updatePreferences",
    "agent:canvas:updateCard",
  ]) {
    assert.match(
      useCoretex,
      new RegExp(command.replaceAll(":", "\\:")),
      `renderer transport omitted ${command}`,
    );
    assert.match(
      orchestrator,
      new RegExp(command.replaceAll(":", "\\:")),
      `Brain router omitted ${command}`,
    );
  }

  assert.match(agentsCanvas, /state\.agentCanvas/);
  assert.match(
    agentsCanvas,
    /setSelected\(id\)/,
    "card pointer selection must update selected state",
  );
  assert.match(
    agentsCanvas,
    /setAgentCanvasPosition/,
    "drag completion must persist one card position",
  );
  assert.match(
    agentsCanvas,
    /setAgentCanvasLayout/,
    "auto-layout and legacy migration must persist a full layout",
  );
  assert.match(
    agentsCanvas,
    /resetAgentCanvasLayout/,
    "canvas must expose a durable layout reset distinct from zoom reset",
  );
  assert.match(
    agentsCanvas,
    /setAgentCanvasPreferences/,
    "connection visibility must persist",
  );
  assert.match(
    agentsCanvas,
    /setAgentCanvasCardSettings/,
    "per-card appearance settings must persist",
  );
  assert.match(
    agentsCanvas,
    /Restored paused|restore[^\n]{0,40}paused/i,
    "canvas must explain that persisted agents require explicit resume",
  );

  const pinSection = sourceSection(
    agentsCanvas,
    "const setPinned =",
    "// ---- native wheel",
  );
  assert.match(
    pinSection,
    /pinned[\s\S]*?layout\[agentId\][\s\S]*?setAgentCanvasPosition\(agentId, layout\[agentId\]\)/,
    "pinning an auto-derived card must first persist its current coordinate",
  );
  assert.ok(
    pinSection.indexOf("setAgentCanvasPosition") <
      pinSection.indexOf("setAgentCanvasCardSettings"),
    "pinning must queue the current coordinate before the pinned preference",
  );
  const keyboardSection = sourceSection(
    agentsCanvas,
    "// ---- keyboard:",
    "// ---- pointer drag",
  );
  assert.match(
    keyboardSection,
    /isInteractive\(e\.target\)/,
    "canvas shortcuts must not swallow Space or activation keys from focused controls",
  );

  const dragSection = sourceSection(
    agentsCanvas,
    "const move =",
    "const nodeMenu",
  );
  assert.doesNotMatch(
    dragSection,
    /actions\.(?:pauseAgent|resumeAgent|haltAgent|removeAgent|createAgent|terminalCreate)/,
    "selection/drag/layout code must never invoke runtime actions",
  );
  const canvasRouter = sourceSection(
    orchestrator,
    'case "agent:canvas:get"',
    'case "project:create"',
  );
  assert.doesNotMatch(
    canvasRouter,
    /pool\.(?:pause|resume|halt|run|dispatch|remove)|terminal|topology|planner/,
    "canvas commands must remain presentation-only",
  );
  assert.match(
    storeSource,
    /restored\.setStatus\("paused"\)|agent\.setStatus\("paused"\)/,
  );
  assert.ok(
    orchestrator.indexOf("restorePersistedAgentsPaused") <
      orchestrator.indexOf("this.pool.init"),
    "paused restore must happen before pool/runtime initialization",
  );
  assert.match(
    mainSource,
    /if \(coretex\.getStatus\(\)\.agents\.length === 0\)/,
    "demo seeds must not duplicate a restored fleet",
  );
  assert.match(
    mainSource,
    /await coretex\.agentStore\.flush\(\)/,
    "graceful shutdown must flush pending agent/canvas writes before exit",
  );

  for (const primitive of [
    "CanvasToolRail",
    "CanvasToolButton",
    "CanvasCommandBar",
    "CanvasUtilityButton",
    "CanvasZoomControls",
    "CanvasGuidePanel",
    "CanvasInspectorPanel",
  ]) {
    assert.match(
      sharedCanvas,
      new RegExp(`export function ${primitive}\\b`),
      `shared canvas primitives omitted ${primitive}`,
    );
  }
  for (const canvas of [agentsCanvas, socialCanvas]) {
    assert.match(
      canvas,
      /from "\.\/shared-canvas"/,
      "agent and social surfaces must consume the shared canvas primitives",
    );
    assert.match(
      canvas,
      /<CanvasToolRail\b[\s\S]*?<CanvasCommandBar\b[\s\S]*?<CanvasZoomControls\b/,
      "canvas tool, command, and zoom surfaces must use the shared accessible controls",
    );
  }

  assert.match(
    canvasActionDock,
    /export function CanvasActionDock\b/,
    "shared bottom action dock must remain reusable across graph and grid surfaces",
  );
  assert.match(
    canvasActionDock,
    /role="toolbar"[\s\S]*?aria-orientation="horizontal"/,
    "dock must expose one horizontal toolbar to assistive technology",
  );
  assert.match(
    canvasActionDock,
    /data-canvas-dock-control="true"[\s\S]*?aria-label=[\s\S]*?aria-pressed=/,
    "dock controls must retain accessible names and selected state",
  );
  assert.match(
    canvasActionDock,
    /ArrowLeft[\s\S]*?ArrowRight[\s\S]*?Home[\s\S]*?End[\s\S]*?\.focus\(\)/,
    "dock must support arrow, Home, and End keyboard focus movement",
  );
  assert.match(
    canvasActionDock,
    /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/,
    "dock interaction must not leak pointer presses into a draggable canvas",
  );
  assert.match(
    canvasActionDock,
    /max-w-full[^"]*overflow-x-auto/,
    "dock must stay usable through horizontal scrolling at compact widths",
  );
  assert.match(
    canvasActionDock,
    /inspectorOpen && "md:pr-80"/,
    "dock must reserve the standard inspector rail before desktop actions grow labels",
  );
  assert.match(
    canvasActionDock,
    /calc\(5rem \+ env\(safe-area-inset-bottom, 0px\)\)/,
    "dock must clear the global Ask AI launcher and honor device safe areas",
  );

  assert.match(
    projectsListView,
    /<CanvasActionDock[\s\S]*?label="Project portfolio actions"[\s\S]*?viewModes=\{PROJECT_VIEW_MODES\}[\s\S]*?activeView=\{viewMode\}[\s\S]*?onViewChange=\{chooseView\}/,
    "project portfolio must expose a real Grid/Graph switch in the shared dock",
  );
  assert.match(
    projectsListView,
    /PROJECTS_VIEW_KEY[\s\S]*?localStorage\.setItem\(PROJECTS_VIEW_KEY, next\)/,
    "project portfolio view choice must persist",
  );
  assert.match(
    projectsListView,
    /relative flex size-full min-h-0 flex-col overflow-hidden[\s\S]*?min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-32/,
    "project list content must scroll inside a non-scrolling dock host with bottom reserve",
  );
  assert.match(
    projectsListView,
    /aria-label="Project portfolio graph"[\s\S]*?role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?event\.key !== "Enter"[\s\S]*?event\.key !== " "/,
    "project graph cards must be keyboard-openable",
  );
  const projectPortfolioDock = sourceSection(
    projectsListView,
    "<CanvasActionDock",
    "{/* Right-click context menu",
  );
  assert.match(
    projectPortfolioDock,
    /id: "new-project"[\s\S]*?onClick: openCreateForm/,
    "project dock primary action must reuse the existing create form",
  );
  assert.doesNotMatch(
    projectPortfolioDock,
    /actions\.createProject/,
    "opening the project composer must not create a project immediately",
  );

  const projectOverviewDock = sourceSection(
    projectWorkspace,
    '{tab === "overview" && (',
    "</div>\n    );",
  );
  assert.match(
    projectOverviewDock,
    /<CanvasActionDock[\s\S]*?activeView="overview"[\s\S]*?view === "graph"[\s\S]*?setTab\("canvas"\)/,
    "project overview dock must switch to the project graph",
  );
  assert.match(
    projectOverviewDock,
    /id: "add-task"[\s\S]*?setTab\("kanban"\)/,
    "project overview primary action must open its scoped task workflow",
  );
  const projectGraphDock = sourceSection(
    projectCanvas,
    '<CanvasActionDock\n                label="Project graph actions"',
    "{inspectorOpen && (",
  );
  for (const actionId of [
    "add-note",
    "add-frame",
    "connect-objects",
    "fit-project-graph",
    "add-task",
  ]) {
    assert.match(
      projectGraphDock,
      new RegExp(`id: "${actionId}"`),
      `project graph dock omitted ${actionId}`,
    );
  }
  assert.match(
    projectGraphDock,
    /activeView="graph"[\s\S]*?view === "overview"[\s\S]*?onOpenTab\("overview"\)/,
    "project graph dock must switch back to Overview",
  );
  assert.match(
    projectGraphDock,
    /inspectorOpen=\{inspectorOpen\}/,
    "project graph dock must avoid the inspector rail",
  );
  assert.doesNotMatch(
    projectGraphDock,
    /actions\.(?:createProject|createTask|pauseAgent|resumeAgent|haltAgent)/,
    "project dock controls must only select tools or open existing workflows",
  );

  assert.match(
    agentsView,
    /<CanvasActionDock[\s\S]*?label="Agent views and canvas actions"[\s\S]*?activeView=\{agents\.length === 0 \? "grid" : view\}/,
    "agent roster must expose Grid/Graph through the shared dock",
  );
  assert.match(
    agentsView,
    /\{selected\.size === 0 && \([\s\S]*?<CanvasActionDock/,
    "agent dock must yield to the selected-agent bulk action bar",
  );
  assert.match(
    agentsView,
    /relative flex h-full min-h-0 w-full flex-col gap-5 overflow-hidden pb-28[\s\S]*?flex min-h-0 flex-1 flex-col gap-5 pr-1[\s\S]*?overflow-y-auto/,
    "agent roster must use an internal scroller beneath the pinned dock",
  );
  const agentDock = sourceSection(
    agentsView,
    "<CanvasActionDock",
    "{assignOpen && (",
  );
  const agentGraphActions = sourceSection(
    agentDock,
    'actions={view === "canvas" ? [',
    "primaryAction={{",
  );
  for (const method of ["autoArrange", "toggleConnections", "fit"]) {
    assert.match(
      agentGraphActions,
      new RegExp(`canvasControls\\.current\\?\\.${method}\\(\\)`),
      `agent graph dock omitted ${method}`,
    );
  }
  assert.doesNotMatch(
    agentGraphActions,
    /actions\.(?:createAgent|pauseAgent|resumeAgent|haltAgent|removeAgent)/,
    "agent graph dock actions must remain presentation-only",
  );
  assert.match(
    agentDock,
    /id: "deploy-agent"[\s\S]*?label: showDeploy \? "Close deploy" : "Deploy agent"[\s\S]*?setShowDeploy\(\(open\) => !open\)/,
    "agent dock primary action must toggle the existing deploy form",
  );
  assert.doesNotMatch(
    agentDock,
    /actions\.createAgent/,
    "opening agent deployment must not create an agent immediately",
  );
  const agentTopCommandBar = sourceSection(
    agentsCanvas,
    '<CanvasCommandBar label="Agent canvas view controls"',
    "</CanvasCommandBar>",
  );
  assert.doesNotMatch(
    agentTopCommandBar,
    /Auto-arrange|Hide connections|Show connections|Zoom to fit|Fit graph/,
    "agent top bar must not duplicate actions moved to the bottom dock",
  );
  assert.match(
    agentsCanvas,
    /onInspectorOpenChange\?\.\(!expanded\)/,
    "agent dock must reserve the visible inspector rail even before selection",
  );

  assert.match(
    socialView,
    /const dockMode = activeTab === "contacts" \|\| activeTab === "canvas"/,
    "social dock must stay scoped to directory and graph modes",
  );
  assert.match(
    socialView,
    /view === "graph" \? "canvas" : "contacts"/,
    "social Grid/Graph switch must route to the real contact and canvas tabs",
  );
  assert.match(
    socialView,
    /hero=\{dockMode \? undefined : \{/,
    "social directory and graph must use compact chrome so the dock fits at smaller heights",
  );
  assert.match(
    socialView,
    /relative flex h-full min-h-0 flex-col pb-28/,
    "social dock host must reserve bottom space without forcing compact-height overflow",
  );
  const socialDock = sourceSection(
    socialView,
    "<CanvasActionDock",
    "</div>\n                </QueryBoundary>",
  );
  const socialGraphActions = sourceSection(
    socialDock,
    'actions={activeTab === "canvas" ? [',
    "primaryAction={{",
  );
  for (const method of [
    "toggleConnectMode",
    "autoArrange",
    "toggleWires",
    "toggleDepth",
    "fit",
  ]) {
    assert.match(
      socialGraphActions,
      new RegExp(`canvasControls\\.current\\?\\.${method}\\(\\)`),
      `social graph dock omitted ${method}`,
    );
  }
  assert.doesNotMatch(
    socialGraphActions,
    /actions\.(?:createContact|createConnection|deleteConnection)/,
    "social dock controls must not mutate relationship data directly",
  );
  const openAddPerson = sourceSection(
    socialView,
    "const openAddPerson =",
    "const chooseDockView =",
  );
  assert.match(
    openAddPerson,
    /setOpenContactComposer\(true\)[\s\S]*?setActiveTab\("contacts"\)/,
    "Add person must open the existing contact composer",
  );
  assert.doesNotMatch(
    openAddPerson,
    /actions\./,
    "opening the contact composer must not create a person immediately",
  );
  assert.match(
    socialDock,
    /label: activeTab === "contacts" && openContactComposer \? "Close form" : "Add person"[\s\S]*?onClick: activeTab === "contacts" && openContactComposer \? \(\) => setOpenContactComposer\(false\) : openAddPerson/,
    "social dock primary action must toggle the existing contact composer",
  );
  assert.match(
    socialView,
    /<ContactsSection[\s\S]*?showComposerAction=\{false\}/,
    "social directory must not duplicate the dock-owned Add person action",
  );
  assert.match(
    socialGraphActions,
    /id: "wire"[\s\S]*?disabled: socialContactCount < 2/,
    "social wire mode must stay disabled until two people can be connected",
  );
  for (const actionId of ["arrange", "fit"]) {
    assert.match(
      socialGraphActions,
      new RegExp(`id: "${actionId}"[\\s\\S]*?disabled: socialContactCount < 1`),
      `social ${actionId} action must stay disabled on an empty graph`,
    );
  }
  assert.match(
    socialCanvas,
    /inspectorOpen: !expanded/,
    "social dock must reserve the empty inspector rail until full-canvas mode",
  );
  const socialTopCommandBar = sourceSection(
    socialCanvas,
    '<CanvasCommandBar label="Social canvas view controls"',
    "</CanvasCommandBar>",
  );
  assert.doesNotMatch(
    socialTopCommandBar,
    /Auto-arrange|Hide wires|Show wires|Hide depth|Show depth|Zoom to fit|Fit graph/,
    "social top bar must not duplicate actions moved to the bottom dock",
  );

  assert.match(
    socialCanvas,
    /function depthMap[\s\S]*?queue\.push\(next\)/,
    "social canvas must compute graph depth through BFS",
  );
  const storedLayout = sourceSection(
    socialCanvas,
    "function loadPositions",
    "function platformUrl",
  );
  assert.match(
    storedLayout,
    /parsed == null[\s\S]*?typeof parsed !== "object"[\s\S]*?Array\.isArray\(parsed\)/,
    "social layout storage must reject non-object and array payloads",
  );
  assert.match(
    storedLayout,
    /Number\.isFinite\(\(point as XY\)\.x\)[\s\S]*?Number\.isFinite\(\(point as XY\)\.y\)/,
    "social layout storage must reject non-finite coordinates",
  );
  const socialLayout = sourceSection(
    socialCanvas,
    "const layout = useMemo",
    "const depths = useMemo",
  );
  assert.match(
    socialLayout,
    /liveIds\.has\(id\)[\s\S]*?Number\.isFinite\(point\.x\)[\s\S]*?Number\.isFinite\(point\.y\)/,
    "social layout must sanitize stale ids and malformed coordinates before rendering",
  );
  assert.match(
    socialLayout,
    /do \{[\s\S]*?candidate = \{[\s\S]*?\} while \(Object\.values\(pos\)\.some/,
    "missing social cards must probe for a collision-free slot",
  );

  const socialKeyboard = sourceSection(
    socialCanvas,
    "const isInteractive =",
    "const kRef =",
  );
  assert.match(
    socialKeyboard,
    /if \(isInteractive\(e\.target\)\) return/,
    "social canvas shortcuts must not swallow Space from focused controls",
  );
  assert.match(
    socialKeyboard,
    /e\.code === "Space"[\s\S]*?e\.preventDefault\(\)[\s\S]*?setSpaceDown\(true\)/,
    "social canvas must retain Space-to-pan outside interactive controls",
  );
  assert.match(
    socialCanvas,
    /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?onKeyDown=\{\(event\) => \{[\s\S]*?event\.key !== "Enter"[\s\S]*?event\.key !== " "[\s\S]*?activateNode\(contact\.id\)/,
    "social cards must support keyboard selection and connection activation",
  );
  assert.match(
    socialCanvas,
    /if \(selected && !contacts\.some\(\(contact\) => contact\.id === selected\)\) setSelected\(null\)/,
    "removed contacts must clear stale canvas selection",
  );

  const socialDrag = sourceSection(
    socialCanvas,
    "const move = (e: PointerEvent)",
    "const startPan =",
  );
  assert.match(
    socialDrag,
    /!d\.moved && Math\.abs\(ddx\) <= 3 && Math\.abs\(ddy\) <= 3/,
    "social drag must preserve a click-sized movement threshold",
  );
  assert.match(
    socialDrag,
    /d\.last = \{ x, y \}/,
    "social drag must retain the exact latest pointer-derived coordinate",
  );
  assert.match(
    socialDrag,
    /cancelled[\s\S]*?\{ x: d\.ox, y: d\.oy \}/,
    "cancelled social drags must restore their origin",
  );
  assert.match(
    socialDrag,
    /d\.moved && d\.last[\s\S]*?\[d\.id\]: d\.last[\s\S]*?localStorage\.setItem\(POS_KEY/,
    "pointer-up must persist the exact final coordinate instead of stale React state",
  );
  assert.match(
    socialDrag,
    /addEventListener\("pointercancel", cancel\)[\s\S]*?removeEventListener\("pointercancel", cancel\)/,
    "social drag must handle and clean up pointer cancellation",
  );

  const linkFriends = sourceSection(
    socialCanvas,
    "const linkFriends =",
    "const activateNode =",
  );
  assert.match(
    linkFriends,
    /a === b \|\| pending !== null \|\| connectPendingRef\.current/,
    "social link creation must reject self-links and be single-flight",
  );
  assert.match(
    linkFriends,
    /edge\.contact1Id === a && edge\.contact2Id === b[\s\S]*?edge\.contact1Id === b && edge\.contact2Id === a/,
    "social link creation must reject forward and reverse duplicates",
  );
  assert.match(
    linkFriends,
    /connectPendingRef\.current = true[\s\S]*?finally[\s\S]*?connectPendingRef\.current = false/,
    "social link single-flight guard must always release",
  );
  const socialMenu = sourceSection(
    socialCanvas,
    "const nodeMenu =",
    "// Right-click empty canvas",
  );
  assert.match(
    socialMenu,
    /window\.confirm\(`Remove \$\{edges\.length\} saved relationship link/,
    "bulk unlink must require explicit confirmation",
  );
  assert.ok(
    socialMenu.indexOf("window.confirm") <
      socialMenu.indexOf('run("social:deleteConnection"'),
    "bulk unlink confirmation must precede every destructive request",
  );

  assert.match(
    socialView,
    /<QueryBoundary loading=\{query\.loading && !query\.data\}/,
    "background social refresh must keep the mounted canvas, selection, viewport, and drafts intact",
  );
  assert.match(socialCanvas, /social:createConnection/);
  assert.match(socialCanvas, /social:deleteConnection/);
  assert.match(
    socialCanvas,
    /localStorage\.setItem\(POS_KEY/,
    "social drag/auto-layout must persist card positions across remounts",
  );
  assert.doesNotMatch(
    socialCanvas,
    /(?:pauseAgent|resumeAgent|haltAgent|createAgent|agent:resume|agent:halt)/,
    "social graph behavior must never control agent runtimes",
  );
}

async function main(): Promise<void> {
  await testMinimalCreateAndSafePatchContract();
  step("Minimal agent creation and strict editable-setting allow-list");
  await testDurableConfigAndCanvasStore();
  step(
    "Durable config, drag, auto-layout, reset, preferences, and card appearance",
  );
  await testLegacyAndMalformedIsolation();
  step("Legacy migration and malformed/stale record isolation");
  testPausedRestoreRequiresExplicitResume();
  step("Paused-only restart restore with explicit-resume scheduling gate");
  await testDisposableSocialGraphContracts();
  step("Disposable social graph ownership, idempotency, and tenant isolation");
  await testUiAndRouterWiringContracts();
  step("Agent canvas, router safety, and social canvas UI wiring");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
