import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { LearningSubNav } from "./_components/sub-nav";

export default function LearningLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Learning" description="Academic classes, online courses, learning goals, a video archive, and study tools — all in one hub." nav={<LearningSubNav />}>
            {children}
        </ModulePageShell>
    );
}
