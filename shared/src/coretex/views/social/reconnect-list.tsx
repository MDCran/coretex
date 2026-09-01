// @ts-nocheck

import { useState } from "react";
import { Link } from "./mock-link";
import { toast } from "sonner";
import { MessageCheckSquare, Heart } from "@untitledui/icons";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { EmptyHint } from "@/components/social/ui";
import type { BadgeColors } from "@/components/base/badges/badge-types";

export type ReconnectItem = {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    initials: string;
    /** Closeness 0–10, or null. */
    closeness: number | null;
    /** Days since last contact, or null if never contacted. */
    daysSince: number | null;
    /** "Last contact …" relative label. */
    lastLabel: string;
    /** Tier label + color for the staleness badge. */
    tier: string;
    tierColor: BadgeColors;
};

/**
 * Relationship-intelligence "Reconnect priority" list. Ranks active contacts by
 * staleness (longest since last interaction) blended with closeness so the people
 * who matter most and have gone quietest float to the top. Each row offers a
 * one-click "Log interaction" that records a reach-out and refreshes the list.
 */
export function ReconnectList({
    items,
    logAction,
}: {
    items: ReconnectItem[];
    logAction: (formData: FormData) => Promise<void>;
}) {
    const [pending, setPending] = useState<string | null>(null);

    async function log(id: string) {
        setPending(id);
        try {
            const fd = new FormData();
            fd.set("id", id);
            await logAction(fd);
            toast.success("Interaction logged");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to log");
        } finally {
            setPending(null);
        }
    }

    if (items.length === 0) {
        return <EmptyHint>No one to reconnect with right now — you're staying close.</EmptyHint>;
    }

    return (
        <ul className="flex flex-col divide-y divide-secondary">
            {items.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center justify-between gap-3 sm:justify-start">
                        <Link href={`/social/contacts/${c.id}`} className="flex min-w-0 items-center gap-3">
                            <Avatar size="sm" src={c.avatarUrl ?? undefined} initials={c.initials} alt={c.displayName} />
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-primary">{c.displayName}</div>
                                <div className="flex items-center gap-1.5 text-xs text-tertiary">
                                    <span className="truncate">Last contact {c.lastLabel}</span>
                                    {c.closeness != null && (
                                        <span className="inline-flex items-center gap-0.5">
                                            <Heart className="size-3 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                            {c.closeness}/10
                                        </span>
                                    )}
                                </div>
                            </div>
                        </Link>
                        <Badge size="sm" color={c.tierColor}>
                            {c.tier}
                        </Badge>
                    </div>
                    <Button
                        color="secondary"
                        size="sm"
                        iconLeading={<MessageCheckSquare data-icon className="size-4" />}
                        isLoading={pending === c.id}
                        showTextWhileLoading
                        onClick={() => log(c.id)}
                        className="shrink-0"
                    >
                        Log interaction
                    </Button>
                </li>
            ))}
        </ul>
    );
}
