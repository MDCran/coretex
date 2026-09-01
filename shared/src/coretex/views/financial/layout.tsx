// @ts-nocheck
import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { FinancialSubNav } from "./_components/sub-nav";

export default function FinancialLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Financial" description="Net worth, accounts, spending, budgets and goals." nav={<FinancialSubNav />}>
            <div className="financial-area">{children}</div>
        </ModulePageShell>
    );
}
