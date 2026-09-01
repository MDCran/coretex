"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    eachDayOfInterval,
    eachHourOfInterval,
    eachMonthOfInterval,
    format,
    startOfDay,
    startOfHour,
    startOfMonth,
    subDays,
    subHours,
} from "date-fns";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "@/utils/cx";
import type { FlowLink, FlowNode, SankeyFlowData } from "@/lib/jobs/sankey";

/** Respect reduced-motion; SSR-safe (defaults to animating on the server). */
const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const ANIMATE = !prefersReducedMotion;
const ANIM_DURATION = 800;

const tooltipStyle = {
    backgroundColor: "var(--color-bg-primary)",
    border: "1px solid var(--color-border-secondary)",
    borderRadius: 8,
    fontSize: 12,
    color: "var(--color-text-primary)",
};

/** Horizontal bar chart of application counts per status. */
export function StatusBarChart({ data }: { data: { key: string; status: string; count: number; fill: string }[] }) {
    return (
        <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="var(--color-border-tertiary)" />
                <XAxis type="number" dataKey="count" allowDecimals={false} hide />
                <YAxis type="category" dataKey="status" tickLine={false} axisLine={false} width={104} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                <Tooltip cursor={{ fill: "var(--color-bg-secondary)" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" radius={5} isAnimationActive={ANIMATE} animationDuration={ANIM_DURATION} animationEasing="ease-out">
                    {data.map((d) => (
                        <Cell key={d.key} fill={d.fill} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

const RANGES = [
    { key: "1d", label: "1D" },
    { key: "7d", label: "7D" },
    { key: "30d", label: "30D" },
    { key: "90d", label: "90D" },
    { key: "all", label: "All" },
] as const;
type Range = (typeof RANGES)[number]["key"];

function buildSeries(points: number[], range: Range) {
    const now = new Date();
    let slots: Date[];
    let unit: "hour" | "day" | "month";
    let fmt: string;

    if (range === "1d") {
        slots = eachHourOfInterval({ start: subHours(startOfHour(now), 23), end: now });
        unit = "hour";
        fmt = "ha";
    } else if (range === "all") {
        if (points.length === 0) {
            slots = [startOfMonth(now)];
        } else {
            slots = eachMonthOfInterval({ start: startOfMonth(new Date(Math.min(...points))), end: now });
        }
        unit = "month";
        fmt = "MMM ''yy";
    } else {
        const days = range === "7d" ? 6 : range === "30d" ? 29 : 89;
        slots = eachDayOfInterval({ start: subDays(startOfDay(now), days), end: now });
        unit = "day";
        fmt = "MMM d";
    }

    const slotMs = (d: Date) =>
        (unit === "hour" ? startOfHour(d) : unit === "day" ? startOfDay(d) : startOfMonth(d)).getTime();

    const counts = new Map<number, number>(slots.map((s) => [s.getTime(), 0]));
    for (const p of points) {
        const k = slotMs(new Date(p));
        if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return slots.map((s) => ({ label: format(s, fmt), count: counts.get(s.getTime()) ?? 0 }));
}

/** Applications-over-time with a 1D / 7D / 30D / 90D / All toggle. `points` are epoch ms. */
export function TrendChart({ points }: { points: number[] }) {
    const [range, setRange] = useState<Range>("30d");
    const data = useMemo(() => buildSeries(points, range), [points, range]);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex justify-end">
                <div className="inline-flex gap-0.5 rounded-lg bg-secondary p-0.5">
                    {RANGES.map((r) => (
                        <button
                            key={r.key}
                            type="button"
                            onClick={() => setRange(r.key)}
                            className={cx(
                                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                                range === r.key ? "bg-primary text-primary shadow-xs" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <defs>
                        <linearGradient id="jobsFillCount" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.6} />
                            <stop offset="95%" stopColor="var(--color-fg-brand-primary)" stopOpacity={0.04} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--color-border-tertiary)" />
                    <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        fontSize={12}
                        interval="preserveStartEnd"
                        minTickGap={24}
                        tick={{ fill: "var(--color-text-tertiary)" }}
                    />
                    <YAxis tickLine={false} axisLine={false} width={24} allowDecimals={false} domain={[0, "auto"]} fontSize={12} tick={{ fill: "var(--color-text-tertiary)" }} />
                    <Tooltip cursor={{ stroke: "var(--color-border-secondary)" }} contentStyle={tooltipStyle} />
                    <Area
                        dataKey="count"
                        type="monotone"
                        baseValue={0}
                        fill="url(#jobsFillCount)"
                        stroke="var(--color-fg-brand-primary)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        isAnimationActive={ANIMATE}
                        animationDuration={ANIM_DURATION}
                        animationEasing="ease-out"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// =====================================================================================
// Status step-flow — a custom left→right stepped visualization (replaces the recharts
// Sankey). Plain SVG: rounded node rects with counts + labels, smooth horizontal bezier
// bands colored source→target, hover highlights a band + tooltip. Bands never cross
// because `buildStatusFlow` emits fixed stage ordering with the spine in slot 0 and
// terminal end-caps in sorted slots below; we honor that order top→bottom per column.
// =====================================================================================

type Tip = { x: number; y: number; label: string; value: number; color: string };

const NODE_W = 13;
const MIN_NODE_H = 10;
const COL_GAP_MIN = 110;
const PAD_TOP = 16;
const PAD_BOTTOM = 16;
const NODE_GAP = 18; // vertical gap between stacked nodes in a column
const CHART_H = 320;
/** How far (as a fraction of the horizontal gap) the bezier control points reach. */
const CURVATURE = 0.55;

/** Measure the container width so the SVG scales responsively. */
function useMeasuredWidth() {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const update = () => setWidth(el.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return { ref, width };
}

type Placed = FlowNode & { x: number; y: number; h: number };

/**
 * Compute pixel geometry for every node. Node height is proportional to its count so
 * the spine reads as a funnel. Within a column, nodes stack in `slot` order (spine
 * stage first, terminal end-caps below) and the stack is vertically centered.
 */
function layout(data: SankeyFlowData, width: number, height: number) {
    const innerH = height - PAD_TOP - PAD_BOTTOM;
    const maxCount = Math.max(1, ...data.nodes.map((n) => n.count));
    const leftPad = 4;
    const rightPad = 100; // room for terminal labels on the right
    const usableW = Math.max(width - leftPad - rightPad, COL_GAP_MIN);
    const colX = (col: number) => leftPad + (data.columns <= 1 ? 0 : (usableW * col) / (data.columns - 1));
    const scale = (count: number) => Math.max(MIN_NODE_H, (count / maxCount) * (innerH * 0.6));

    const byColumn = new Map<number, FlowNode[]>();
    for (const n of data.nodes) {
        const arr = byColumn.get(n.column) ?? [];
        arr.push(n);
        byColumn.set(n.column, arr);
    }

    const placed = new Map<string, Placed>();
    for (const [col, group] of byColumn) {
        const ordered = [...group].sort((a, b) => a.slot - b.slot);
        const stackH = ordered.reduce((sum, n) => sum + scale(n.count), 0) + NODE_GAP * (ordered.length - 1);
        let y = PAD_TOP + Math.max(0, (innerH - stackH) / 2);
        const x = colX(col) - NODE_W / 2;
        for (const n of ordered) {
            const h = scale(n.count);
            placed.set(n.id, { ...n, x, y, h });
            y += h + NODE_GAP;
        }
    }
    return placed;
}

type Band = { x0: number; y0: number; h0: number; x1: number; y1: number; h1: number };

/**
 * Partition every node's height among its links so each band's thickness equals that
 * transition's share of the node's count — a true proportional Sankey, not full-height
 * overlapping ribbons. Outgoing links leave the source stacked top→bottom in target
 * order; incoming links land on the target stacked in source order, so the spine stays
 * straight and terminal exits fan out beneath it without crossing. Any unflowed
 * remainder (applications still sitting at a stage) simply leaves a gap — the node rect
 * still reflects the full count, so bands match the true numbers with no bottleneck.
 */
function computeBands(data: SankeyFlowData, placed: Map<string, Placed>): Map<string, Band> {
    const out = new Map<string, FlowLink[]>();
    const inc = new Map<string, FlowLink[]>();
    for (const l of data.links) {
        let o = out.get(l.source);
        if (!o) out.set(l.source, (o = []));
        o.push(l);
        let n = inc.get(l.target);
        if (!n) inc.set(l.target, (n = []));
        n.push(l);
    }

    const yOf = (id: string) => placed.get(id)?.y ?? 0;
    // Band thickness at a node edge = the link's share of that node's count, scaled to
    // the node's pixel height. Because node heights share one count→pixel scale, a
    // link's two edges come out near-identical, giving a clean uniform-width ribbon.
    const thickness = (node: Placed, value: number) => (node.count > 0 ? (value / node.count) * node.h : node.h);

    const bands = new Map<string, Band>();

    for (const [nid, links] of out) {
        const src = placed.get(nid);
        if (!src) continue;
        links.sort((a, b) => yOf(a.target) - yOf(b.target));
        let y = src.y;
        for (const l of links) {
            const h0 = thickness(src, l.value);
            bands.set(l.id, { x0: src.x + NODE_W, y0: y, h0, x1: 0, y1: 0, h1: 0 });
            y += h0;
        }
    }
    for (const [nid, links] of inc) {
        const tgt = placed.get(nid);
        if (!tgt) continue;
        links.sort((a, b) => yOf(a.source) - yOf(b.source));
        let y = tgt.y;
        for (const l of links) {
            const band = bands.get(l.id);
            if (!band) continue;
            band.x1 = tgt.x;
            band.y1 = y;
            band.h1 = thickness(tgt, l.value);
            y += band.h1;
        }
    }
    return bands;
}

/**
 * Smooth horizontal bezier ribbon between two node edges (closed, fillable).
 * Symmetric control points at CURVATURE of the gap give a relaxed S-curve that
 * leaves and lands perfectly horizontal, so bands meet node rects flush.
 */
function bandPath(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number) {
    const dx = x1 - x0;
    const c0 = x0 + dx * CURVATURE;
    const c1 = x1 - dx * CURVATURE;
    return [
        `M${x0},${y0}`,
        `C${c0},${y0} ${c1},${y1} ${x1},${y1}`,
        `L${x1},${y1 + h1}`,
        `C${c1},${y1 + h1} ${c0},${y0 + h0} ${x0},${y0 + h0}`,
        "Z",
    ].join(" ");
}

/**
 * Status pipeline as a branching stepped flow: each column is a stage the pipeline
 * actually reached (Not started → Applied → … → Offered → Offer accepted), bands carry
 * applications to whatever stage they advanced to next (skips allowed), and terminal
 * outcomes (Rejected / Ghosted / Withdrawn / Offer declined) branch off as end caps at
 * the stage they exited. Band thickness is proportional to each transition's count
 * (see `computeBands`). Data is precomputed server-side from JobApplicationEvent
 * transitions (see `buildStatusFlow`). Rendered by both the career dashboard and
 * company detail.
 */
export function StatusFlowSankey({ data }: { data: SankeyFlowData }) {
    const { ref, width } = useMeasuredWidth();
    const [hover, setHover] = useState<string | null>(null);
    const [tip, setTip] = useState<Tip | null>(null);
    const rawId = useId();
    const uid = rawId.replace(/[^a-zA-Z0-9]/g, "");

    if (data.links.length === 0) {
        return (
            <div className="flex flex-col items-center gap-1 py-12 text-center">
                <p className="text-sm font-medium text-secondary">No status changes to chart yet</p>
                <p className="text-xs text-tertiary">Move an application through the pipeline and its journey will show up here.</p>
            </div>
        );
    }

    const charted = data.nodes.find((n) => n.isSource)?.count ?? data.total;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-tertiary">
                    <span className="font-semibold tabular-nums text-primary">{charted}</span> application{charted === 1 ? "" : "s"} charted
                </p>
                <p className="text-xs text-quaternary max-sm:hidden">Hover a band for transition counts</p>
            </div>
            <div ref={ref} className="relative w-full">
                {width > 0 && <FlowSvg data={data} width={width} uid={uid} hover={hover} setHover={setHover} setTip={setTip} />}
                {tip && (
                    <div
                        className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-secondary bg-primary px-2.5 py-1.5 text-xs whitespace-nowrap text-primary shadow-md"
                        style={{ left: tip.x, top: tip.y - 6 }}
                    >
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block size-2 rounded-full" style={{ background: tip.color }} />
                            <span className="font-medium">{tip.label}</span>
                            <span className="ml-1 tabular-nums text-tertiary">{tip.value}</span>
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

function FlowSvg({
    data,
    width,
    uid,
    hover,
    setHover,
    setTip,
}: {
    data: SankeyFlowData;
    width: number;
    uid: string;
    hover: string | null;
    setHover: (id: string | null) => void;
    setTip: (t: Tip | null) => void;
}) {
    const placed = useMemo(() => layout(data, width, CHART_H), [data, width]);
    const bands = useMemo(() => computeBands(data, placed), [data, placed]);

    return (
        <svg width={width} height={CHART_H} className="overflow-visible">
            {/* CSS-only entry animation: bands sweep in with a slight stagger, nodes fade. */}
            <style>{`
                @keyframes flowband${uid} { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
                @keyframes flownode${uid} { from { opacity: 0; } to { opacity: 1; } }
                @media (prefers-reduced-motion: reduce) {
                    .flowanim${uid} { animation: none !important; }
                }
            `}</style>
            <defs>
                {data.links.map((l) => (
                    <linearGradient key={l.id} id={`${uid}-${l.id}`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor={l.fromColor} />
                        <stop offset="100%" stopColor={l.toColor} />
                    </linearGradient>
                ))}
            </defs>

            {/* Bands first so node rects sit on top. */}
            <g>
                {data.links.map((l, i) => {
                    const b = bands.get(l.id);
                    if (!b) return null;
                    const active = hover === l.id;
                    return (
                        <path
                            key={l.id}
                            d={bandPath(b.x0, b.y0, b.h0, b.x1, b.y1, b.h1)}
                            fill={`url(#${uid}-${l.id})`}
                            fillOpacity={hover && !active ? 0.14 : active ? 0.78 : 0.42}
                            stroke={active ? l.toColor : "none"}
                            strokeOpacity={0.35}
                            strokeWidth={active ? 1 : 0}
                            className={`flowanim${uid} cursor-pointer transition-[fill-opacity] duration-100 ease-linear`}
                            style={{ animation: `flowband${uid} 0.5s ease-out ${80 + i * 60}ms both` }}
                            onMouseEnter={() => {
                                setHover(l.id);
                                setTip({
                                    x: (b.x0 + b.x1) / 2,
                                    y: Math.min(b.y0 + b.h0 / 2, b.y1 + b.h1 / 2),
                                    label: `${l.sourceName} → ${l.targetName}`,
                                    value: l.value,
                                    color: l.toColor,
                                });
                            }}
                            onMouseLeave={() => {
                                setHover(null);
                                setTip(null);
                            }}
                        />
                    );
                })}
            </g>

            {/* Nodes + labels on top. When a band is hovered, unrelated nodes recede. */}
            <g className={`flowanim${uid}`} style={{ animation: `flownode${uid} 0.4s ease-out both` }}>
                {[...placed.values()].map((n) => {
                    const hovered = hover ? data.links.find((l) => l.id === hover) : null;
                    const dimmed = hovered != null && hovered.source !== n.id && hovered.target !== n.id;
                    return <FlowNodeRect key={n.id} node={n} dimmed={dimmed} />;
                })}
            </g>
        </svg>
    );
}

function FlowNodeRect({ node, dimmed }: { node: Placed; dimmed?: boolean }) {
    // Terminal end caps label to the LEFT of their rect (they hug the right edge);
    // everything else labels to the right.
    const labelOnLeft = node.isTerminal;
    const labelX = labelOnLeft ? node.x - 6 : node.x + NODE_W + 6;
    const labelAnchor = labelOnLeft ? "end" : "start";
    return (
        <g className="transition-opacity duration-100 ease-linear" opacity={dimmed ? 0.35 : 1}>
            <rect x={node.x} y={node.y} width={NODE_W} height={node.h} rx={3} ry={3} fill={node.color} fillOpacity={node.isSource ? 1 : 0.92} />
            {node.h >= 6 && (
                <text x={labelX} y={node.y + node.h / 2} textAnchor={labelAnchor} dominantBaseline="middle" fontSize={node.isSource ? 12 : 11}>
                    <tspan className={node.isSource ? "font-semibold" : "font-medium"} style={{ fill: "var(--color-text-primary)" }}>
                        {node.name}
                    </tspan>
                    <tspan dx={5} className="tabular-nums" style={{ fill: "var(--color-text-tertiary)" }}>
                        {node.count}
                    </tspan>
                </text>
            )}
        </g>
    );
}
