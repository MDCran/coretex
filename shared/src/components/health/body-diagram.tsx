// @ts-nocheck
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "@/utils/cx";

/** A selectable body region shared across both anatomical views. */
export interface BodyRegion {
    /** Stable id used for selection + markers lookup. */
    id: string;
    /** Human-readable label (used for aria-label + UI). */
    label: string;
    /** Which view this region belongs to. */
    view: "front" | "back";
}

/**
 * Canonical list of selectable regions. The same ids are reused where a region
 * exists on both sides (e.g. `head`, `calves`) so callers can keep one marker map.
 */
export const BODY_REGIONS: BodyRegion[] = [
    // Front (anterior)
    { id: "head", label: "Head", view: "front" },
    { id: "neck", label: "Neck", view: "front" },
    { id: "shoulders", label: "Shoulders", view: "front" },
    { id: "chest", label: "Chest", view: "front" },
    { id: "arms", label: "Upper arms", view: "front" },
    { id: "forearms", label: "Forearms", view: "front" },
    { id: "core", label: "Core / abdomen", view: "front" },
    { id: "hips", label: "Hips", view: "front" },
    { id: "thighs", label: "Thighs", view: "front" },
    { id: "calves", label: "Calves", view: "front" },
    // Back (posterior)
    { id: "head", label: "Head", view: "back" },
    { id: "traps", label: "Traps", view: "back" },
    { id: "back", label: "Back / lats", view: "back" },
    { id: "arms-back", label: "Triceps", view: "back" },
    { id: "lower-back", label: "Lower back", view: "back" },
    { id: "glutes", label: "Glutes", view: "back" },
    { id: "hamstrings", label: "Hamstrings", view: "back" },
    { id: "calves", label: "Calves", view: "back" },
];

/** Convenience: regions for a single view, in render order. */
export function regionsForView(view: "front" | "back"): BodyRegion[] {
    return BODY_REGIONS.filter((r) => r.view === view);
}

export interface BodyDiagramProps {
    /** Which anatomical side to render. */
    view?: "front" | "back";
    /** Currently selected region id (controlled). */
    selected?: string | null;
    /** Fired on click / Enter / Space over a region. */
    onSelectRegion?: (region: string) => void;
    /** Map of region id -> value; rendered as a small pill near the region. */
    markers?: Record<string, string | number>;
    className?: string;
}

const VIEW_BOX = "0 0 240 560";

/** Approximate centroid for each region, used to anchor value pills. */
const PILL_ANCHORS: Record<string, { x: number; y: number }> = {
    head: { x: 120, y: 42 },
    neck: { x: 120, y: 92 },
    shoulders: { x: 120, y: 120 },
    chest: { x: 120, y: 158 },
    arms: { x: 64, y: 178 },
    forearms: { x: 52, y: 250 },
    core: { x: 120, y: 232 },
    hips: { x: 120, y: 300 },
    thighs: { x: 120, y: 372 },
    calves: { x: 120, y: 478 },
    // back-specific
    traps: { x: 120, y: 112 },
    back: { x: 120, y: 180 },
    "arms-back": { x: 64, y: 200 },
    "lower-back": { x: 120, y: 262 },
    glutes: { x: 120, y: 318 },
    hamstrings: { x: 120, y: 372 },
};

interface RegionShapeProps {
    id: string;
    label: string;
    selected: boolean;
    onSelect?: (id: string) => void;
    children: ReactNode;
}

/**
 * Wraps one logical region (which may be several mirrored paths) in an
 * accessible, keyboard-operable group. Visual state is driven purely by the
 * `currentColor` set on this group via Tailwind text tokens, so inner shapes
 * can use `fill-current`.
 */
function Region({ id, label, selected, onSelect, children }: RegionShapeProps) {
    const handleKeyDown = (e: KeyboardEvent<SVGGElement>) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect?.(id);
        }
    };

    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onSelect?.(id)}
            onKeyDown={handleKeyDown}
            className={cx(
                "cursor-pointer outline-none transition duration-100 ease-linear",
                // base fill via currentColor
                selected ? "text-fg-brand-primary" : "text-fg-quaternary hover:text-fg-tertiary",
                // crisp focus ring for keyboard users
                "focus-visible:[&>*]:stroke-fg-brand-primary",
            )}
        >
            {children}
        </g>
    );
}

/** Small rounded value chip anchored at a region centroid. */
function MarkerPill({ x, y, value }: { x: number; y: number; value: string | number }) {
    const text = String(value);
    const width = Math.max(22, text.length * 7 + 12);
    return (
        <g className="pointer-events-none" aria-hidden="true">
            <rect
                x={x - width / 2}
                y={y - 9}
                width={width}
                height={18}
                rx={9}
                className="fill-brand-solid"
            />
            <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle" className="fill-white text-[10px] font-semibold">
                {text}
            </text>
        </g>
    );
}

/**
 * BodyDiagram renders a clean, symmetric flat human silhouette with delineated,
 * individually selectable muscle/region groups for logging per-region metrics.
 *
 * Visual language: minimal medical/fitness illustration. Regions sit on a soft
 * silhouette outline; the selected region uses the brand accent, others read as
 * quaternary foreground and lighten on hover. All colors come from semantic
 * tokens — no raw hex.
 */
export function BodyDiagram({ view = "front", selected = null, onSelectRegion, markers = {}, className }: BodyDiagramProps) {
    const isSelected = (id: string) => selected === id;
    const regions = regionsForView(view);

    return (
        <div className={cx("relative w-full", className)}>
            <svg
                viewBox={VIEW_BOX}
                className="h-auto w-full select-none"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                role="group"
                aria-label={`Human body diagram, ${view} view`}
            >
                {/* Soft silhouette base — sits behind regions to unify the figure. */}
                <g className="text-fg-quaternary" aria-hidden="true">
                    <path
                        d={SILHOUETTE[view]}
                        className="fill-secondary stroke-border-secondary"
                        strokeWidth={1.5}
                        strokeLinejoin="round"
                    />
                </g>

                {/* Region shapes. Inner paths use fill-current + a thin shared stroke. */}
                <g strokeLinejoin="round" strokeLinecap="round">
                    {view === "front" ? (
                        <FrontRegions isSelected={isSelected} onSelect={onSelectRegion} />
                    ) : (
                        <BackRegions isSelected={isSelected} onSelect={onSelectRegion} />
                    )}
                </g>

                {/* Value pills layered above everything. */}
                {regions.map((r) => {
                    const value = markers[r.id];
                    const anchor = PILL_ANCHORS[r.id];
                    if (value === undefined || value === null || value === "" || !anchor) return null;
                    return <MarkerPill key={`${view}-${r.id}`} x={anchor.x} y={anchor.y} value={value} />;
                })}
            </svg>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Region geometry                                                           */
/* -------------------------------------------------------------------------- */

/** Shared inner-shape class: fill follows the group's currentColor. */
const SHAPE = "fill-current stroke-border-secondary transition duration-100 ease-linear";

interface RegionsProps {
    isSelected: (id: string) => boolean;
    onSelect?: (id: string) => void;
}

function FrontRegions({ isSelected, onSelect }: RegionsProps) {
    return (
        <>
            {/* Head */}
            <Region id="head" label="Head" selected={isSelected("head")} onSelect={onSelect}>
                <ellipse cx={120} cy={42} rx={22} ry={27} className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Neck */}
            <Region id="neck" label="Neck" selected={isSelected("neck")} onSelect={onSelect}>
                <path d="M108 66 L132 66 L133 92 L107 92 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Shoulders */}
            <Region id="shoulders" label="Shoulders" selected={isSelected("shoulders")} onSelect={onSelect}>
                <path d="M96 96 Q70 100 58 124 Q72 116 96 116 Z" className={SHAPE} strokeWidth={1} />
                <path d="M144 96 Q170 100 182 124 Q168 116 144 116 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Chest */}
            <Region id="chest" label="Chest" selected={isSelected("chest")} onSelect={onSelect}>
                <path d="M96 118 Q120 130 144 118 L150 150 Q120 166 90 150 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Upper arms */}
            <Region id="arms" label="Upper arms" selected={isSelected("arms")} onSelect={onSelect}>
                <path d="M58 124 Q52 128 50 150 L46 210 L66 210 L70 150 Q72 130 70 122 Z" className={SHAPE} strokeWidth={1} />
                <path d="M182 124 Q188 128 190 150 L194 210 L174 210 L170 150 Q168 130 170 122 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Forearms */}
            <Region id="forearms" label="Forearms" selected={isSelected("forearms")} onSelect={onSelect}>
                <path d="M46 212 L66 212 L60 286 L48 286 Z" className={SHAPE} strokeWidth={1} />
                <path d="M194 212 L174 212 L180 286 L192 286 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Core / abdomen */}
            <Region id="core" label="Core / abdomen" selected={isSelected("core")} onSelect={onSelect}>
                <path d="M92 154 Q120 168 148 154 L146 276 Q120 286 94 276 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Hips */}
            <Region id="hips" label="Hips" selected={isSelected("hips")} onSelect={onSelect}>
                <path d="M94 278 Q120 290 146 278 L150 322 Q120 336 90 322 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Thighs */}
            <Region id="thighs" label="Thighs" selected={isSelected("thighs")} onSelect={onSelect}>
                <path d="M92 326 Q104 332 116 328 L114 426 L94 426 Q86 380 88 340 Z" className={SHAPE} strokeWidth={1} />
                <path d="M148 326 Q136 332 124 328 L126 426 L146 426 Q154 380 152 340 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Calves */}
            <Region id="calves" label="Calves" selected={isSelected("calves")} onSelect={onSelect}>
                <path d="M94 430 L114 430 L110 532 L98 532 Q90 480 94 430 Z" className={SHAPE} strokeWidth={1} />
                <path d="M146 430 L126 430 L130 532 L142 532 Q150 480 146 430 Z" className={SHAPE} strokeWidth={1} />
            </Region>
        </>
    );
}

function BackRegions({ isSelected, onSelect }: RegionsProps) {
    return (
        <>
            {/* Head */}
            <Region id="head" label="Head" selected={isSelected("head")} onSelect={onSelect}>
                <ellipse cx={120} cy={42} rx={22} ry={27} className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Traps */}
            <Region id="traps" label="Traps" selected={isSelected("traps")} onSelect={onSelect}>
                <path d="M96 96 Q120 84 144 96 Q168 102 182 124 Q150 112 120 112 Q90 112 58 124 Q72 102 96 96 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Back / lats */}
            <Region id="back" label="Back / lats" selected={isSelected("back")} onSelect={onSelect}>
                <path d="M92 124 Q120 134 148 124 L150 232 Q120 244 90 232 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Triceps (upper arms, back) */}
            <Region id="arms-back" label="Triceps" selected={isSelected("arms-back")} onSelect={onSelect}>
                <path d="M58 124 Q52 128 50 150 L46 210 L66 210 L70 150 Q72 130 70 122 Z" className={SHAPE} strokeWidth={1} />
                <path d="M182 124 Q188 128 190 150 L194 210 L174 210 L170 150 Q168 130 170 122 Z" className={SHAPE} strokeWidth={1} />
                {/* forearms (non-selectable filler shown as part of triceps group for completeness) */}
                <path d="M46 212 L66 212 L60 286 L48 286 Z" className={SHAPE} strokeWidth={1} />
                <path d="M194 212 L174 212 L180 286 L192 286 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Lower back */}
            <Region id="lower-back" label="Lower back" selected={isSelected("lower-back")} onSelect={onSelect}>
                <path d="M94 234 Q120 244 146 234 L148 290 Q120 300 92 290 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Glutes */}
            <Region id="glutes" label="Glutes" selected={isSelected("glutes")} onSelect={onSelect}>
                <path d="M92 292 Q104 300 118 298 Q116 332 96 336 Q86 318 92 292 Z" className={SHAPE} strokeWidth={1} />
                <path d="M148 292 Q136 300 122 298 Q124 332 144 336 Q154 318 148 292 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Hamstrings */}
            <Region id="hamstrings" label="Hamstrings" selected={isSelected("hamstrings")} onSelect={onSelect}>
                <path d="M92 340 Q104 344 116 342 L114 426 L94 426 Q86 384 90 348 Z" className={SHAPE} strokeWidth={1} />
                <path d="M148 340 Q136 344 124 342 L126 426 L146 426 Q154 384 150 348 Z" className={SHAPE} strokeWidth={1} />
            </Region>

            {/* Calves */}
            <Region id="calves" label="Calves" selected={isSelected("calves")} onSelect={onSelect}>
                <path d="M94 430 L114 430 L110 532 L98 532 Q90 480 94 430 Z" className={SHAPE} strokeWidth={1} />
                <path d="M146 430 L126 430 L130 532 L142 532 Q150 480 146 430 Z" className={SHAPE} strokeWidth={1} />
            </Region>
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Unifying silhouette outline                                               */
/* -------------------------------------------------------------------------- */

/**
 * A single smooth outline of the whole figure (head -> shoulders -> arms ->
 * torso -> legs -> feet, mirrored). Rendered behind the regions to read as one
 * cohesive, proportioned body rather than disconnected parts.
 */
const SILHOUETTE: Record<"front" | "back", string> = {
    front:
        "M120 14 " +
        "C133 14 144 26 144 42 C144 56 137 67 128 70 " +
        "L132 90 " +
        "C150 92 168 100 180 122 " +
        "C188 138 192 170 196 212 " +
        "L200 286 L182 290 L176 214 " +
        "C172 178 168 150 160 134 " +
        "L152 286 " +
        "C156 320 156 340 150 372 " +
        "C146 430 140 486 138 536 " +
        "L122 538 L120 430 L118 538 L102 536 " +
        "C100 486 94 430 90 372 " +
        "C84 340 84 320 88 286 " +
        "L80 134 " +
        "C72 150 68 178 64 214 L58 290 L40 286 L44 212 " +
        "C48 170 52 138 60 122 " +
        "C72 100 90 92 108 90 " +
        "L112 70 " +
        "C103 67 96 56 96 42 C96 26 107 14 120 14 Z",
    back:
        "M120 14 " +
        "C133 14 144 26 144 42 C144 56 137 67 128 70 " +
        "L132 90 " +
        "C150 92 168 100 180 122 " +
        "C188 138 192 170 196 212 " +
        "L200 286 L182 290 L176 214 " +
        "C172 178 168 150 160 134 " +
        "L152 290 " +
        "C156 322 156 342 150 374 " +
        "C146 430 140 486 138 536 " +
        "L122 538 L120 430 L118 538 L102 536 " +
        "C100 486 94 430 90 374 " +
        "C84 342 84 322 88 290 " +
        "L80 134 " +
        "C72 150 68 178 64 214 L58 290 L40 286 L44 212 " +
        "C48 170 52 138 60 122 " +
        "C72 100 90 92 108 90 " +
        "L112 70 " +
        "C103 67 96 56 96 42 C96 26 107 14 120 14 Z",
};

export default BodyDiagram;
