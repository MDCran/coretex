"use client";

import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Profile", href: "/settings" },
    { label: "Account", href: "/settings/account" },
    { label: "Tracking", href: "/settings/tracking" },
    { label: "Goals", href: "/settings/goals" },
    { label: "Appearance", href: "/settings/appearance" },
    { label: "Integrations", href: "/settings/integrations" },
    { label: "AI", href: "/settings/ai" },
];

export function SettingsSubNav() {
    return <ModuleSubNav tabs={TABS} rootHref="/settings" />;
}
