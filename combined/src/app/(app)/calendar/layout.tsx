import type { ReactNode } from "react";
import { Bell01, Tag01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";

export default function CalendarLayout({ children }: { children: ReactNode }) {
    return (
        <ModulePageShell
            title="Calendar"
            description="One timeline for your events, appointments and everything happening across LifeOS."
            actions={
                <>
                    <Button href="/calendar/reminders" color="link-color" size="md" iconLeading={<Bell01 data-icon className="size-4" />}>
                        Reminders
                    </Button>
                    <Button href="/calendar/categories" color="link-color" size="md" iconLeading={<Tag01 data-icon className="size-4" />}>
                        Categories
                    </Button>
                </>
            }
        >
            {children}
        </ModulePageShell>
    );
}
