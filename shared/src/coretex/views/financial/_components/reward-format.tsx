// @ts-nocheck
/** Client-safe formatting for card rewards (shared by detail + list views). */

export type RewardType = "PERCENT" | "POINTS" | "MILES" | "CASHBACK";

interface RewardLike {
    type: RewardType;
    rate: number;
}

/** Drop trailing ".0" but keep up to two meaningful decimals (3 → "3", 1.5 → "1.5"). */
function trimRate(rate: number): string {
    return Number(rate.toFixed(2)).toString();
}

/**
 * Render a reward's rate by type:
 *   PERCENT  → "3% back"
 *   POINTS   → "4× points"
 *   MILES    → "2× miles"
 *   CASHBACK → "$5 back"
 */
export function formatRewardRate(reward: RewardLike): string {
    const r = trimRate(reward.rate);
    switch (reward.type) {
        case "POINTS":
            return `${r}× points`;
        case "MILES":
            return `${r}× miles`;
        case "CASHBACK":
            return `$${r} back`;
        case "PERCENT":
        default:
            return `${r}% back`;
    }
}

/** Compact rate for list chips: "3% Dining", "4× Groceries", "$5 Travel". */
export function formatRewardChip(reward: RewardLike & { category: string }): string {
    const r = trimRate(reward.rate);
    const prefix = reward.type === "CASHBACK" ? `$${r}` : reward.type === "PERCENT" ? `${r}%` : `${r}×`;
    return `${prefix} ${reward.category}`;
}

/**
 * A comparable "value" for ranking rewards so the best one can be highlighted.
 * Percent/cashback compared at face value; points/miles roughly ~1¢ each so
 * a 4× multiplier ≈ 4% — good enough for ordering the marquee reward.
 */
export function rewardSortKey(reward: RewardLike): number {
    return reward.rate;
}
