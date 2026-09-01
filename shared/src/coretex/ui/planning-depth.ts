export const PLANNING_DEPTH_LEVELS = [
    {
        value: 0,
        label: "Off",
        description: "No upfront planning — start work immediately.",
    },
    {
        value: 25,
        label: "Quick",
        description: "Create a short outline, then execute.",
    },
    {
        value: 50,
        label: "Balanced",
        description: "Outline the approach, main steps, and checks before execution.",
    },
    {
        value: 75,
        label: "Thorough",
        description: "Plan subtasks, edge cases, risks, and verification before execution.",
    },
    {
        value: 100,
        label: "Deep",
        description: "Build an exhaustive decomposition and review the plan before execution.",
    },
] as const;

export type PlanningDepth = (typeof PLANNING_DEPTH_LEVELS)[number];

/** Clamp arbitrary persisted/input values to one of the five supported depths. */
export const snapPlanningDepth = (value: number): number => {
    const finite = Number.isFinite(value) ? value : 0;
    return Math.max(0, Math.min(100, Math.round(finite / 25) * 25));
};

export const planningDepthMeta = (value: number): PlanningDepth => {
    const snapped = snapPlanningDepth(value);
    return (
        PLANNING_DEPTH_LEVELS.find((level) => level.value === snapped) ??
        PLANNING_DEPTH_LEVELS[0]
    );
};
