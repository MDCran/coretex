// @ts-nocheck
import { CreditCard } from "@/components/shared-assets/credit-card/credit-card";
import { cx } from "@/utils/cx";

export const CARD_STYLE_OPTIONS = [
    { value: "brand-dark", label: "Brand dark" },
    { value: "brand-light", label: "Brand light" },
    { value: "gray-dark", label: "Graphite" },
    { value: "gray-light", label: "Silver" },
    { value: "gradient-strip", label: "Gradient strip" },
    { value: "salmon-strip", label: "Salmon strip" },
    { value: "gray-strip", label: "Gray strip" },
    { value: "gradient-strip-vertical", label: "Vertical gradient" },
] as const;

export type CardStyleValue = (typeof CARD_STYLE_OPTIONS)[number]["value"];

const CARD_STYLE_VALUES = new Set<string>(CARD_STYLE_OPTIONS.map((s) => s.value));

export function safeCardStyle(value: string | null | undefined, archived = false): CardStyleValue {
    if (archived) return "gray-dark";
    return CARD_STYLE_VALUES.has(value ?? "") ? (value as CardStyleValue) : "brand-dark";
}

export function CardPreview({
    imageUrl,
    styleValue,
    archived = false,
    company,
    cardHolder,
    cardNumber,
    cardExpiration,
    width = 300,
    className,
}: {
    imageUrl?: string | null;
    styleValue?: string | null;
    archived?: boolean;
    company: string;
    cardHolder: string;
    cardNumber: string;
    cardExpiration: string;
    width?: number;
    className?: string;
}) {
    const height = Math.round((width / 316) * 190);

    if (imageUrl) {
        return (
            <div
                className={cx("relative shrink-0 overflow-hidden rounded-2xl bg-secondary ring-1 ring-secondary ring-inset", archived && "opacity-70 grayscale", className)}
                style={{ width, height }}
            >
                <img src={imageUrl} alt={`${company} card image`} className="size-full object-cover" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 to-transparent p-4 text-white">
                    <p className="truncate text-xs font-semibold uppercase tracking-[0.6px]">{cardHolder}</p>
                    <p className="mt-1 text-sm font-semibold tabular-nums tracking-[1px]">{cardNumber}</p>
                </div>
            </div>
        );
    }

    return (
        <CreditCard
            width={width}
            type={safeCardStyle(styleValue, archived)}
            className={className}
            company={company}
            cardHolder={cardHolder}
            cardNumber={cardNumber}
            cardExpiration={cardExpiration}
        />
    );
}
