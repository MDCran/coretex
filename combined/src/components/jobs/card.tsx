import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cx("rounded-xl bg-primary ring-1 ring-secondary ring-inset", className)}>{children}</div>;
}

export function CardHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
    return (
        <div className={cx("flex items-center justify-between gap-3 border-b border-secondary px-5 py-4", className)}>
            <h2 className="text-md font-semibold text-primary">{title}</h2>
            {action}
        </div>
    );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
    return <div className={cx("p-5", className)}>{children}</div>;
}
