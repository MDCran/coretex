// @ts-nocheck
"use client";

// Coretex Relay — "Customize board" slideout. Recolor the priority and role
// badges used across the task board (and everywhere priorityColor/roleColor are
// read) by writing settings.appearance.badges.* via setSetting. Right-edge
// Untitled UI SlideoutMenu.

import type { AgentRole, TaskPriority, BadgeColor } from "@repo/coretex/types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { SlideoutMenu } from "@/components/application/slideout-menus/slideout-menu";
import { roleLabel, titleCase } from "../labels";
import { DEFAULT_PRIORITY_COLOR, DEFAULT_ROLE_COLOR, priorityColor, roleColor, type CoretexActions, type CoretexState } from "../use-coretex";
import { ColorSelector } from "../settings/badge-colors";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const ROLES: AgentRole[] = ["orchestrator", "planner", "researcher", "developer", "reviewer", "writer", "analyst", "devops", "qa", "custom"];

interface Props {
    state: CoretexState;
    actions: CoretexActions;
    isOpen: boolean;
    onClose: () => void;
}

export const CustomizeBoardSlideout = ({ state, actions, isOpen, onClose }: Props) => {
    const settings = state.settings;

    const setPriority = (p: TaskPriority, c: BadgeColor) => actions.setSetting(`appearance.badges.priority.${p}`, c);
    const setRole = (r: AgentRole, c: BadgeColor) => actions.setSetting(`appearance.badges.role.${r}`, c);

    const reset = () => {
        PRIORITIES.forEach((p) => setPriority(p, DEFAULT_PRIORITY_COLOR[p]));
        ROLES.forEach((r) => setRole(r, DEFAULT_ROLE_COLOR[r]));
    };

    return (
        <SlideoutMenu isOpen={isOpen} onOpenChange={(v) => !v && onClose()} isDismissable dialogClassName="gap-0">
            <SlideoutMenu.Header onClose={onClose}>
                <h1 className="text-md font-semibold text-primary md:text-lg">Customize board</h1>
                <p className="mt-0.5 text-sm text-tertiary">Recolor the priority and role badges. Changes apply everywhere instantly.</p>
            </SlideoutMenu.Header>

            <SlideoutMenu.Content className="py-6">
                <div className="flex flex-col gap-7">
                    <section>
                        <p className="mb-1 text-sm font-semibold text-primary">Priority colors</p>
                        <div className="flex flex-col divide-y divide-[var(--c-border)]">
                            {PRIORITIES.map((p) => (
                                <ColorSelector
                                    key={p}
                                    label={titleCase(p)}
                                    current={priorityColor(p, settings)}
                                    preview={<Badge type="color" size="md" color={priorityColor(p, settings)}>{titleCase(p)}</Badge>}
                                    onChange={(c) => setPriority(p, c)}
                                />
                            ))}
                        </div>
                    </section>

                    <section>
                        <p className="mb-1 text-sm font-semibold text-primary">Role colors</p>
                        <div className="flex flex-col divide-y divide-[var(--c-border)]">
                            {ROLES.map((r) => (
                                <ColorSelector
                                    key={r}
                                    label={roleLabel(r)}
                                    current={roleColor(r, settings)}
                                    preview={<Badge type="color" size="md" color={roleColor(r, settings)}>{roleLabel(r)}</Badge>}
                                    onChange={(c) => setRole(r, c)}
                                />
                            ))}
                        </div>
                    </section>
                </div>
            </SlideoutMenu.Content>

            <SlideoutMenu.Footer className="flex w-full items-center justify-between gap-2">
                <Button size="sm" color="tertiary" onClick={reset}>Reset to defaults</Button>
                <Button size="sm" color="secondary" onClick={onClose}>Done</Button>
            </SlideoutMenu.Footer>
        </SlideoutMenu>
    );
};
