// @ts-nocheck
import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { HealthSubNav } from "./_components/sub-nav";

export default function HealthLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Health" description="Metrics, nutrition, sleep, habits and more." nav={<HealthSubNav />}>
            {children}
        </ModulePageShell>
    );
}
