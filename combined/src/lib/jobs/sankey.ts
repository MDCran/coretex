import type { JobStatus } from "@prisma/client";
import { STATUS_LABELS, STATUS_HEX } from "@/lib/jobs/enums";

/**
 * The forward progression "spine": the ordered stages an application advances
 * through once it has APPLIED, left → right. Unlike a single linear funnel, an
 * application flows from each stage to whichever stage it ACTUALLY advanced to next
 * (skips allowed, e.g. Under review → Interviewing), or branches OFF the spine into a
 * terminal outcome. OFFER_ACCEPTED is the happy-path terminus at the end of the spine.
 *
 * NOT_STARTED is NOT part of the spine: it's a parallel "haven't applied yet" bucket.
 * A synthetic source node ("All applications") sits in column 0 and SPLITS into the
 * Not started branch and the Applied trunk, so the chart opens with not-started vs
 * started sized proportionally instead of pretending every Applied app passed through
 * a Not started predecessor.
 */
const SPINE_ORDER: JobStatus[] = ["APPLIED", "UNDER_REVIEW", "ASSESSMENT", "INTERVIEWING", "OFFERED", "OFFER_ACCEPTED"];
const SPINE_RANK = new Map<JobStatus, number>(SPINE_ORDER.map((s, i) => [s, i]));
const isSpine = (s: JobStatus) => SPINE_RANK.has(s);

/** Synthetic origin node that splits into Not started vs the Applied trunk. */
const SOURCE_ID = "source";
const SOURCE_NAME = "All applications";
const SOURCE_COLOR = "#a1a1aa";
const NOT_STARTED_ID = "branch:NOT_STARTED";

/**
 * Terminal outcomes that pull an application OUT of the active pipeline. Each one
 * branches off the spine and is rendered as an end-cap in the column immediately
 * right of the stage it exited from. Fixed top→bottom order keeps exit bands from
 * crossing each other within a column.
 */
const TERMINAL_ORDER: JobStatus[] = ["OFFER_DECLINED", "REJECTED", "GHOSTED", "WITHDRAWN"];
const TERMINAL_SET = new Set<JobStatus>(TERMINAL_ORDER);

/**
 * Synthetic terminal outcome: an AI-applied application (mass-applied via AIApply) that
 * was rejected. It branches off the spine as its OWN end-cap, distinct from a manual
 * Rejected, so bulk AI rejections don't visually swamp hand-applied ones.
 */
const REJECTED_AI = "REJECTED_AI" as const;
type Outcome = JobStatus | typeof REJECTED_AI;

/** Top→bottom render order of terminal end-caps within a column (incl. the AI reject). */
const OUTCOME_ORDER: Outcome[] = ["OFFER_DECLINED", "REJECTED", REJECTED_AI, "GHOSTED", "WITHDRAWN"];
const REJECTED_AI_COLOR = "#9f1239"; // deeper rose — clearly distinct from Rejected's red

const outcomeLabel = (o: Outcome): string => (o === REJECTED_AI ? "Rejected (AI)" : STATUS_LABELS[o]);
const outcomeColor = (o: Outcome): string => (o === REJECTED_AI ? REJECTED_AI_COLOR : STATUS_HEX[o]);
/** Closest real status, used for the node's `status` field. */
const outcomeStatus = (o: Outcome): JobStatus => (o === REJECTED_AI ? "REJECTED" : o);

/** A node placed in the stepped flow. */
export type FlowNode = {
    id: string;
    name: string;
    /** Status this node represents, or `null` for the synthetic source. */
    status: JobStatus | null;
    color: string;
    count: number;
    /** Column index (0 = first stage reached). Terminals sit one column past their exit stage. */
    column: number;
    /** Vertical slot within the column, top → bottom (spine stage = slot 0). */
    slot: number;
    /** Terminal outcome end-cap (label-left) vs. spine stage. */
    isTerminal: boolean;
    isSource: boolean;
};

/** A smooth band from one node to the next. */
export type FlowLink = {
    id: string;
    source: string;
    target: string;
    value: number;
    sourceName: string;
    targetName: string;
    /** Source status color → target status color gradient endpoints. */
    fromColor: string;
    toColor: string;
};

export type SankeyFlowData = {
    nodes: FlowNode[];
    links: FlowLink[];
    /** Number of distinct columns. */
    columns: number;
    total: number;
};

/** One application's status-change events (transitions) plus its current status. */
export type AppFlowInput = {
    status: JobStatus;
    events: { fromStatus: JobStatus | null; toStatus: JobStatus | null }[];
    /** True when the application was mass-applied via AIApply (splits Rejected → Rejected (AI)). */
    isAi?: boolean;
};

/** Reconstruct the ordered list of statuses an application passed through. */
function statusPath(app: AppFlowInput): JobStatus[] {
    const transitions = app.events.filter(
        (e): e is { fromStatus: JobStatus; toStatus: JobStatus } => e.fromStatus != null && e.toStatus != null,
    );
    const path: JobStatus[] = [];
    const push = (s: JobStatus) => {
        if (path[path.length - 1] !== s) path.push(s);
    };
    if (transitions.length > 0) {
        push(transitions[0].fromStatus);
        for (const t of transitions) push(t.toStatus);
    } else if (app.status !== "NOT_STARTED") {
        push(app.status);
    }
    return path;
}

/** One application resolved onto the branching pipeline. */
type AppFlow = {
    /** Whether it has entered the pipeline (applied) or is still a not-started entry. */
    kind: "not_started" | "started";
    /** Distinct spine stages it occupied, ascending by rank — empty when not started. */
    stages: JobStatus[];
    /** Terminal outcome it ended on, if any (incl. the synthetic AI reject). */
    terminal: Outcome | null;
    /** Spine stage it occupied immediately before exiting to `terminal`. */
    exitStage: JobStatus | null;
};

/**
 * Map a single application onto the branching pipeline.
 *
 * Observed status-change events are trusted: we take the distinct spine stages the
 * application passed through (honoring real skips like Under review → Interviewing) and
 * the terminal it ended on. Two backfills keep band weights matching the true numbers
 * with no artificial bottleneck:
 *  - Unobserved PREFIX: if the first observed stage is past Applied, the earlier stages
 *    it must have occupied are filled in (we only fill BELOW the first observed stage, so
 *    a genuine mid-pipeline skip is never overwritten).
 *  - No history at all: a linear chain is inferred from the current / terminal status,
 *    so a snapshot-only application still flows through every stage it implies.
 */
function resolveFlow(app: AppFlowInput): AppFlow | null {
    const path = statusPath(app);
    let terminalStatus: JobStatus | null = null;
    for (const s of path) if (TERMINAL_SET.has(s)) terminalStatus = s;
    // Snapshot-only apps (no recorded transitions, e.g. bulk imports) still branch to a
    // terminal when their CURRENT status is itself an outcome.
    if (!terminalStatus && TERMINAL_SET.has(app.status)) terminalStatus = app.status;

    const occupied = new Set<JobStatus>(path.filter(isSpine));

    // "Started" once it has applied: any spine stage occupied, any terminal reached, or
    // a current status past Not started. Otherwise it's a not-started (pre-apply) entry.
    const started = occupied.size > 0 || terminalStatus != null || app.status !== "NOT_STARTED";
    if (!started) return { kind: "not_started", stages: [], terminal: null, exitStage: null };

    if (occupied.size > 0) {
        // Trust observed history; fill only the unobserved prefix (Applied .. firstObserved).
        const minRank = Math.min(...[...occupied].map((s) => SPINE_RANK.get(s)!));
        for (let r = SPINE_RANK.get("APPLIED")!; r < minRank; r++) occupied.add(SPINE_ORDER[r]);
    } else {
        // No spine history — infer a linear chain from the current / terminal status.
        // Offer-declined implies it reached an offer; otherwise anchor at the current
        // active stage, falling back to "right after applying" for a bare terminal.
        const anchor = terminalStatus === "OFFER_DECLINED" ? "OFFERED" : isSpine(app.status) ? app.status : "APPLIED";
        for (let r = SPINE_RANK.get("APPLIED")!; r <= SPINE_RANK.get(anchor)!; r++) occupied.add(SPINE_ORDER[r]);
    }

    const stages = [...occupied].sort((a, b) => SPINE_RANK.get(a)! - SPINE_RANK.get(b)!);
    const exitStage = stages.length ? stages[stages.length - 1] : null;
    // AI-applied rejections branch to their own synthetic end-cap.
    const terminal: Outcome | null = terminalStatus === "REJECTED" && app.isAi ? REJECTED_AI : terminalStatus;
    return { kind: "started", stages, terminal, exitStage };
}

/**
 * Collapse applications into a BRANCHING left→right flow.
 *
 * Layout:
 *  - Each reached spine stage (NOT started → Applied → … → Offer accepted) becomes a
 *    node in its own column (slot 0), sized by how many applications passed through it.
 *  - Spine links connect a stage to the next stage applications actually advanced to,
 *    so a skip (Under review → Interviewing) is its own band — not a forced funnel.
 *  - Terminal outcomes (Rejected / Ghosted / Withdrawn / Offer declined) branch OFF the
 *    spine as end-caps placed in the column immediately right of the stage they exited
 *    from, weighted by the true count that exited there.
 *
 * No-crossing guarantee:
 *  - Spine stages occupy contiguous columns in fixed rank order, so the spine is
 *    monotonic left→right and every band advances exactly one column.
 *  - Within each column the spine stage is slot 0 and terminal end-caps stack beneath it
 *    in fixed TERMINAL_ORDER, so exit bands always leave below the spine and fan out
 *    without crossing each other or the spine.
 */
export function buildStatusFlow(apps: AppFlowInput[]): SankeyFlowData {
    const total = apps.length;
    const empty: SankeyFlowData = { nodes: [], links: [], columns: 0, total };
    if (total === 0) return empty;

    // stageCount[s]      = applications that passed through spine stage `s`.
    // spineEdge["a|b"]   = applications that advanced directly from stage a → stage b.
    // termExit[rank|out] = applications that exited from a stage (by rank) to outcome `out`.
    const stageCount = new Map<JobStatus, number>();
    const spineEdge = new Map<string, number>();
    const termExit = new Map<string, { exit: JobStatus; outcome: Outcome; value: number }>();
    let notStarted = 0; // applications that haven't applied yet (parked branch off the source)

    let charted = 0;
    for (const app of apps) {
        const flow = resolveFlow(app);
        if (!flow) continue;
        charted++;
        if (flow.kind === "not_started") {
            notStarted++;
            continue;
        }

        for (const s of flow.stages) stageCount.set(s, (stageCount.get(s) ?? 0) + 1);
        for (let i = 0; i < flow.stages.length - 1; i++) {
            const key = `${flow.stages[i]}|${flow.stages[i + 1]}`;
            spineEdge.set(key, (spineEdge.get(key) ?? 0) + 1);
        }
        if (flow.terminal && flow.exitStage) {
            const key = `${SPINE_RANK.get(flow.exitStage)}|${flow.terminal}`;
            const entry = termExit.get(key);
            if (entry) entry.value += 1;
            else termExit.set(key, { exit: flow.exitStage, outcome: flow.terminal, value: 1 });
        }
    }

    if (charted === 0) return empty;

    // Spine stages reached occupy contiguous columns starting at 1 — the source is column 0.
    const usedStages = SPINE_ORDER.filter((s) => (stageCount.get(s) ?? 0) > 0);
    if (usedStages.length === 0 && notStarted === 0) return empty;
    const stageColumn = new Map<JobStatus, number>();
    usedStages.forEach((s, i) => stageColumn.set(s, i + 1));

    const appliedColumn = stageColumn.get("APPLIED") ?? 1; // Not started parks alongside Applied
    const startedCount = stageCount.get("APPLIED") ?? 0; // everyone who applied enters via Applied

    // Terminals attach one column right of their exit stage; that sets the rightmost column.
    let lastColumn = usedStages.length; // spine occupies columns 1..usedStages.length
    for (const entry of termExit.values()) {
        lastColumn = Math.max(lastColumn, (stageColumn.get(entry.exit) ?? 0) + 1);
    }
    if (notStarted > 0) lastColumn = Math.max(lastColumn, appliedColumn);

    const nodes: FlowNode[] = [];
    const links: FlowLink[] = [];

    // Source: every charted application, splitting into Not started vs the Applied trunk.
    nodes.push({
        id: SOURCE_ID,
        name: SOURCE_NAME,
        status: null,
        color: SOURCE_COLOR,
        count: charted,
        column: 0,
        slot: 0,
        isSource: true,
        isTerminal: false,
    });

    // Not started branch — parked just beneath the Applied trunk in the first stage column.
    if (notStarted > 0) {
        nodes.push({
            id: NOT_STARTED_ID,
            name: STATUS_LABELS.NOT_STARTED,
            status: "NOT_STARTED",
            color: STATUS_HEX.NOT_STARTED,
            count: notStarted,
            column: appliedColumn,
            slot: 1,
            isSource: false,
            isTerminal: false,
        });
        links.push({
            id: `${SOURCE_ID}>${NOT_STARTED_ID}`,
            source: SOURCE_ID,
            target: NOT_STARTED_ID,
            value: notStarted,
            sourceName: SOURCE_NAME,
            targetName: STATUS_LABELS.NOT_STARTED,
            fromColor: SOURCE_COLOR,
            toColor: STATUS_HEX.NOT_STARTED,
        });
    }

    // Source → Applied trunk (all applications that have applied).
    if (startedCount > 0) {
        links.push({
            id: `${SOURCE_ID}>stage:APPLIED`,
            source: SOURCE_ID,
            target: "stage:APPLIED",
            value: startedCount,
            sourceName: SOURCE_NAME,
            targetName: STATUS_LABELS.APPLIED,
            fromColor: SOURCE_COLOR,
            toColor: STATUS_HEX.APPLIED,
        });
    }

    // Spine stage nodes (slot 0 in each column).
    for (const s of usedStages) {
        nodes.push({
            id: `stage:${s}`,
            name: STATUS_LABELS[s],
            status: s,
            color: STATUS_HEX[s],
            count: stageCount.get(s) ?? 0,
            column: stageColumn.get(s)!,
            slot: 0,
            isSource: false,
            isTerminal: false,
        });
    }

    // Spine links: stage → the next stage applications actually advanced to.
    for (const [key, value] of spineEdge) {
        if (value <= 0) continue;
        const [from, to] = key.split("|") as [JobStatus, JobStatus];
        links.push({
            id: `stage:${from}>stage:${to}`,
            source: `stage:${from}`,
            target: `stage:${to}`,
            value,
            sourceName: STATUS_LABELS[from],
            targetName: STATUS_LABELS[to],
            fromColor: STATUS_HEX[from],
            toColor: STATUS_HEX[to],
        });
    }

    // Terminal end-caps: one node per (exit stage, outcome), placed in the column right
    // of the exit stage and slotted beneath the spine in fixed TERMINAL_ORDER.
    for (const entry of termExit.values()) {
        const nodeId = `term:${SPINE_RANK.get(entry.exit)}:${entry.outcome}`;
        nodes.push({
            id: nodeId,
            name: outcomeLabel(entry.outcome),
            status: outcomeStatus(entry.outcome),
            color: outcomeColor(entry.outcome),
            count: entry.value,
            column: (stageColumn.get(entry.exit) ?? 0) + 1,
            slot: 1 + OUTCOME_ORDER.indexOf(entry.outcome), // slot 0 stays reserved for the spine stage
            isSource: false,
            isTerminal: true,
        });
        links.push({
            id: `stage:${entry.exit}>${nodeId}`,
            source: `stage:${entry.exit}`,
            target: nodeId,
            value: entry.value,
            sourceName: STATUS_LABELS[entry.exit],
            targetName: outcomeLabel(entry.outcome),
            fromColor: STATUS_HEX[entry.exit],
            toColor: outcomeColor(entry.outcome),
        });
    }

    return { nodes, links, columns: lastColumn + 1, total: charted };
}
