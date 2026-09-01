// @ts-nocheck
import type { ReactNode } from "react";
import type { FC } from "react";
import { Button } from "@/components/base/buttons/button";
import { Card } from "./health-ui";

/** Overview card with consistent footer action placement. */
export function OverviewActionCard({
    icon,
    title,
    actionLabel,
    actionHref,
    actionIcon,
    children,
}: {
    icon: FC<{ className?: string }>;
    title: string;
    actionLabel: string;
    actionHref: string;
    actionIcon?: FC<{ className?: string }>;
    children: ReactNode;
}) {
    const Icon = icon;
    const ActionIcon = actionIcon;
    return (
        <Card className="flex min-h-[11.5rem] flex-col">
            <div className="mb-3 flex items-center gap-2">
                <Icon className="size-5 text-fg-quaternary" aria-hidden="true" />
                <h3 className="text-md font-semibold text-primary">{title}</h3>
            </div>
            <div className="flex flex-1 flex-col">{children}</div>
            <div className="mt-4 border-t border-secondary pt-4">
                <Button
                    href={actionHref}
                    size="sm"
                    color="secondary"
                    iconLeading={ActionIcon ? <ActionIcon data-icon className="size-4" /> : undefined}
                    className="w-full sm:w-auto"
                >
                    {actionLabel}
                </Button>
            </div>
        </Card>
    );
}
