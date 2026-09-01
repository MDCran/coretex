// @ts-nocheck
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { WorkoutsMobileShell } from "@/components/workouts/workouts-mobile-shell";
import { WorkoutsNav } from "./workouts-nav";

/**
 * Workouts module chrome. The in-session page (/workouts/session/[id]) owns its
 * own full header (workout title, clock, finish), so we hide the module title +
 * nav there to avoid a duplicate "Workouts" heading stacked above it.
 */
export function WorkoutsShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const immersive = pathname?.startsWith("/workouts/session/") ?? false;

    return (
        <ModulePageShell
            title="Workouts"
            description="Training log, exercises, templates and body metrics."
            nav={<WorkoutsNav />}
            hideHeader={immersive}
            className="page-shell--immersive max-xl:flex max-xl:min-h-0 max-xl:flex-col"
            contentClassName="max-xl:min-h-0 max-xl:flex-1 max-xl:gap-4 max-xl:!pb-0"
        >
            <WorkoutsMobileShell>{children}</WorkoutsMobileShell>
        </ModulePageShell>
    );
}
