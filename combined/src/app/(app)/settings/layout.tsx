import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { SettingsSubNav } from "@/components/settings/sub-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell title="Settings" description="Profile, goals, appearance, integrations and AI." nav={<SettingsSubNav />} contentClassName="w-full max-w-6xl">
            {children}
        </ModulePageShell>
    );
}
