// @ts-nocheck
import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Overview", href: "/health" },
    { label: "Metrics", href: "/health/metrics" },
    { label: "Goals", href: "/health/goals" },
    { label: "Vitals", href: "/health/vitals" },
    { label: "Sleep", href: "/health/sleep" },
    { label: "Habits", href: "/health/habits" },
    { label: "Journal", href: "/health/journal" },
    { label: "Medical", href: "/health/medical" },
    { label: "Photos", href: "/health/photos" },
    { label: "Sobriety", href: "/health/sobriety" },
    { label: "Peptides", href: "/health/peptides" },
    { label: "Meds", href: "/health/medications" },
];

export const HealthSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/health" />;
