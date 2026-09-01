import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("flex flex-col rounded-xl bg-primary shadow-xs ring-1 ring-secondary ring-inset", className)}>{children}</div>;
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("flex items-center justify-between gap-2 border-b border-secondary px-5 py-4", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
    return <h3 className={cx("text-xs font-semibold tracking-wider text-tertiary uppercase", className)}>{children}</h3>;
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cx("p-5", className)}>{children}</div>;
}
