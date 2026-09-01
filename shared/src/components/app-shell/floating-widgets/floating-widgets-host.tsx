// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { FloatingWidgetShell } from "@/components/app-shell/floating-widgets/floating-widget-shell";
import { useFloatingWidgets } from "@/components/app-shell/floating-widgets/floating-widgets-context";
import {
    CalendarWidgetPanel,
    FinancialWidgetPanel,
    NutritionWidgetPanel,
    SocialWidgetPanel,
} from "@/components/app-shell/floating-widgets/panels/snapshot-widget-panels";
import { HealthWidgetPanel } from "@/components/app-shell/floating-widgets/panels/health-widget-panel";
import { WorkoutsWidgetPanel } from "@/components/app-shell/floating-widgets/panels/workouts-widget-panel";
import { WIDGET_DEFINITIONS, type WidgetId } from "@/components/app-shell/floating-widgets/widget-config";
import { WidgetDock } from "@/components/app-shell/floating-widgets/widget-dock";
import { AiActivityProvider } from "@/components/app-shell/floating-widgets/ai-activity-context";
import { AiActivityWidget } from "@/components/app-shell/floating-widgets/ai-activity-widget";
import { MusicWidgetPanel } from "@/components/app-shell/spotify-player-widget";

function shouldHideWidget(pathname: string, hideOnRoutes: string[]): boolean {
    return hideOnRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function WidgetBody({ id }: { id: WidgetId }) {
    switch (id) {
        case "music":
            return <MusicWidgetPanel />;
        case "workouts":
            return <WorkoutsWidgetPanel />;
        case "health":
            return <HealthWidgetPanel />;
        case "calendar":
            return <CalendarWidgetPanel />;
        case "nutrition":
            return <NutritionWidgetPanel />;
        case "social":
            return <SocialWidgetPanel />;
        case "financial":
            return <FinancialWidgetPanel />;
        default:
            return null;
    }
}

const BASE_Z = 50;

/** Renders open popout widgets + bottom launcher dock in a body portal (never affects page layout). */
export function FloatingWidgetsHost({ hiddenWidgets = [] }: { hiddenWidgets?: string[] }) {
    const pathname = usePathname();
    const { isOpen, toggle, focus, focusedId } = useFloatingWidgets();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    if (!mounted) return null;

    return createPortal(
        <AiActivityProvider>
            {WIDGET_DEFINITIONS.map((def, index) => {
                if (hiddenWidgets.includes(def.id)) return null;
                if (shouldHideWidget(pathname, def.hideOnRoutes)) return null;
                if (!isOpen(def.id)) return null;

                const zIndex = BASE_Z + (focusedId === def.id ? 10 : 0) + index;

                return (
                    <FloatingWidgetShell
                        key={def.id}
                        def={def}
                        onClose={() => toggle(def.id)}
                        onFocus={() => focus(def.id)}
                        zIndex={zIndex}
                    >
                        <WidgetBody id={def.id} />
                    </FloatingWidgetShell>
                );
            })}
            <AiActivityWidget />
            <WidgetDock hiddenWidgets={hiddenWidgets} />
        </AiActivityProvider>,
        document.body,
    );
}
