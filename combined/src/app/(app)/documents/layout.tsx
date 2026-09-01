import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";

export default function DocumentsLayout({ children }: { children: ReactNode }) {
    return <ModulePageShell title="Documents">{children}</ModulePageShell>;
}
