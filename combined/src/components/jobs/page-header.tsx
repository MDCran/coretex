import type { ReactNode } from "react";

/** Page heading with optional description and trailing actions. */
export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
    return (
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
                <h1 className="text-display-xs font-semibold text-primary">{title}</h1>
                {description && <p className="text-md text-tertiary">{description}</p>}
            </div>
            {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
        </div>
    );
}
