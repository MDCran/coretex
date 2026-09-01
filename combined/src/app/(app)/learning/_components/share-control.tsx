"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy01, LinkBroken02, Share07 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";

/**
 * Reusable view-only share control for a note or flashcard deck.
 * `token` is the current share token (null when not shared). `onShare` creates
 * (or returns the existing) share; `onRevoke` removes it. Copies the public
 * `/share/learning/<token>` URL to the clipboard.
 */
export function ShareControl({
    token,
    onShare,
    onRevoke,
    label = "Share",
    size = "sm",
}: {
    token: string | null;
    onShare: () => Promise<{ token: string }>;
    onRevoke: () => Promise<void>;
    label?: string;
    size?: "sm" | "md";
}) {
    const [pending, start] = useTransition();
    const router = useRouter();

    function copyUrl(t: string) {
        const url = `${window.location.origin}/share/learning/${t}`;
        navigator.clipboard?.writeText(url).then(
            () => toast.success("View-only link copied to clipboard"),
            () => toast.message(url),
        );
    }

    function share() {
        start(async () => {
            try {
                const { token: t } = await onShare();
                copyUrl(t);
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't create the link");
            }
        });
    }

    function revoke() {
        start(async () => {
            try {
                await onRevoke();
                toast.success("Public link revoked");
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Couldn't revoke the link");
            }
        });
    }

    if (!token) {
        return (
            <Button size={size} color="secondary" iconLeading={Share07} onClick={share} isLoading={pending}>
                {label}
            </Button>
        );
    }
    return (
        <div className="flex items-center gap-1">
            <Button size={size} color="secondary" iconLeading={Copy01} onClick={() => copyUrl(token)} isDisabled={pending}>
                Copy link
            </Button>
            <Button size={size} color="tertiary-destructive" iconLeading={LinkBroken02} aria-label="Revoke public link" onClick={revoke} isDisabled={pending} />
        </div>
    );
}
