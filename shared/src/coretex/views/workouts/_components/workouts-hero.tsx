// @ts-nocheck
import { Activity, Play } from "@untitledui/icons";
import { ModuleHero } from "@/components/app-shell/module-hero";
import { StartWorkoutButtons } from "./start-workout-buttons";

export function WorkoutsHero({ templates }: { templates: { id: string; name: string }[] }) {
    return (
        <ModuleHero
            theme="red"
            icon={Activity}
            eyebrow="Ready to train?"
            title="Start your next session"
            description="Log sets, track PRs, and watch your volume climb. Pick a template or jump into an empty workout."
            actions={[{ label: "Go to log", href: "/workouts/log", icon: Play }]}
        >
            <StartWorkoutButtons templates={templates} />
        </ModuleHero>
    );
}
