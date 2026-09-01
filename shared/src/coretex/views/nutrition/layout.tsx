// @ts-nocheck
import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";

export default function NutritionLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Nutrition" description="Meals, macros, water and food products.">
            {children}
        </ModulePageShell>
    );
}
