import type { ReactNode } from "react";
import { cx } from "@/utils/cx";
import { Breadcrumbs } from "@/components/app-shell/breadcrumbs";

/**
 * Consistent module layout for LifeOS sections. The section tabs sit as a clean bar
 * at the top of the content; the page title + breadcrumb live in the sticky top
 * navbar on desktop (and inline on mobile). The module-level description is no longer
 * shown above the tabs — pages own their own header copy where it's useful.
 */
export function ModulePageShell({
    title,
    nav,
    actions,
    children,
    className,
    contentClassName,
    hideHeader = false,
}: {
    title: string;
    /** Accepted for back-compat; intentionally not rendered above the tabs anymore. */
    description?: string;
    nav?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    className?: string;
    contentClassName?: string;
    /** Suppress the module title + nav (e.g. immersive pages that own their own header). */
    hideHeader?: boolean;
}) {
    return (
        <div className={cx("page-shell", className)}>
            {!hideHeader && (
                <div className="flex flex-col gap-3">
                    {/* Mobile-only title + breadcrumb (desktop shows them in the top navbar). */}
                    <div className="flex flex-col gap-1 lg:hidden">
                        <Breadcrumbs />
                        <h1 className="module-title">{title}</h1>
                    </div>

                    {(nav || actions) && (
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-secondary pb-3 lg:sticky lg:top-16 z-20 bg-primary/95 backdrop-blur-sm lg:pt-3 lg:-mx-8 lg:px-8 -mt-px">
                            {nav && <div className="min-w-0 flex-1">{nav}</div>}
                            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
                        </div>
                    )}
                </div>
            )}
            <div className={cx("flex min-w-0 flex-col gap-4 sm:gap-6", !hideHeader && "mt-4 sm:mt-6", contentClassName)}>{children}</div>
        </div>
    );
}
