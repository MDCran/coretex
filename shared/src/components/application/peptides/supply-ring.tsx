// @ts-nocheck
import { cx } from "@/utils/cx";

interface Props {
    /** 0..1 fraction of the ring to fill. */
    value: number;
    color: string;
    over?: boolean;
    size?: number;
    label?: string;
    sublabel?: string;
}

/** Circular supply gauge. Fills `value` of the ring in `color`, red when over budget. */
export function SupplyRing({ value, color, over, size = 64, label, sublabel }: Props) {
    const stroke = 6;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const pct = Math.max(0, Math.min(1, value));
    const dash = c * pct;

    return (
        <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-bg-quaternary" />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${dash} ${c}`}
                    style={{ stroke: over ? "var(--color-fg-error-primary)" : color, transition: "stroke-dasharray 300ms ease" }}
                />
            </svg>
            {(label || sublabel) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    {label && <span className={cx("font-mono text-sm leading-none font-semibold tabular-nums", over ? "text-error-primary" : "text-primary")}>{label}</span>}
                    {sublabel && <span className="mt-0.5 text-[9px] tracking-wide text-tertiary uppercase">{sublabel}</span>}
                </div>
            )}
        </div>
    );
}
