import type { FC } from "react";
import {
    Activity,
    ActivityHeart,
    BankNote03,
    Calendar,
    MusicNote01,
    Scales01,
    Users01,
} from "@untitledui/icons";
import type { WidgetSize } from "@/components/app-shell/floating-widgets/use-floating-widget";

export type WidgetId = "music" | "workouts" | "health" | "calendar" | "nutrition" | "social" | "financial";

export interface WidgetDefinition {
    id: WidgetId;
    label: string;
    icon: FC<{ className?: string }>;
    /** Full-page routes where the popout is hidden (dedicated page already open). */
    hideOnRoutes: string[];
    defaultSize: WidgetSize;
    minWidth: number;
    minHeight: number;
    maxWidth: number;
    /** Stagger offset index for default placement. */
    placementIndex: number;
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
    {
        id: "music",
        label: "Spotify",
        icon: MusicNote01,
        hideOnRoutes: ["/music"],
        defaultSize: { width: 360, height: 520 },
        minWidth: 280,
        minHeight: 320,
        maxWidth: 720,
        placementIndex: 0,
    },
    {
        id: "workouts",
        label: "Workouts",
        icon: Activity,
        hideOnRoutes: [],
        defaultSize: { width: 380, height: 560 },
        minWidth: 300,
        minHeight: 360,
        maxWidth: 560,
        placementIndex: 1,
    },
    {
        id: "health",
        label: "Health",
        icon: ActivityHeart,
        hideOnRoutes: [],
        defaultSize: { width: 340, height: 540 },
        minWidth: 280,
        minHeight: 360,
        maxWidth: 480,
        placementIndex: 2,
    },
    {
        id: "calendar",
        label: "Calendar",
        icon: Calendar,
        hideOnRoutes: ["/calendar"],
        defaultSize: { width: 320, height: 440 },
        minWidth: 260,
        minHeight: 300,
        maxWidth: 480,
        placementIndex: 3,
    },
    {
        id: "nutrition",
        label: "Nutrition",
        icon: Scales01,
        hideOnRoutes: ["/nutrition"],
        defaultSize: { width: 300, height: 440 },
        minWidth: 260,
        minHeight: 320,
        maxWidth: 440,
        placementIndex: 4,
    },
    {
        id: "social",
        label: "Social",
        icon: Users01,
        hideOnRoutes: ["/social"],
        defaultSize: { width: 300, height: 420 },
        minWidth: 260,
        minHeight: 300,
        maxWidth: 440,
        placementIndex: 5,
    },
    {
        id: "financial",
        label: "Financial",
        icon: BankNote03,
        hideOnRoutes: ["/financial"],
        defaultSize: { width: 320, height: 460 },
        minWidth: 260,
        minHeight: 320,
        maxWidth: 480,
        placementIndex: 6,
    },
];

export function getWidgetDefinition(id: WidgetId): WidgetDefinition {
    const hit = WIDGET_DEFINITIONS.find((w) => w.id === id);
    if (!hit) throw new Error(`Unknown widget: ${id}`);
    return hit;
}
