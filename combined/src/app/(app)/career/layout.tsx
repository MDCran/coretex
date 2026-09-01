import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { CareerSubNav } from "@/components/career/sub-nav";

export default function CareerLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Career" description="Applications, contacts, documents and your career development." nav={<CareerSubNav />}>
            {children}
        </ModulePageShell>
    );
}
