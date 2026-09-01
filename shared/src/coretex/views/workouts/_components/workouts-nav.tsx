// @ts-nocheck
import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Overview", href: "/workouts" },
    { label: "Log", href: "/workouts/log" },
    { label: "Schedule", href: "/workouts/schedule" },
    { label: "Exercises", href: "/workouts/exercises" },
    { label: "Templates", href: "/workouts/templates" },
    { label: "Body", href: "/workouts/body" },
    { label: "Progress", href: "/workouts/progress" },
];

export const WorkoutsNav = () => <ModuleSubNav tabs={TABS} rootHref="/workouts" />;
