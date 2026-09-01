"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
    geniusConfigured,
    getLyricsForTrack,
    type GeniusLyricsResult,
} from "@/lib/genius";

export interface GeniusStatus {
    configured: boolean;
    connected: boolean;
    displayName: string | null;
}

export async function getGeniusStatus(): Promise<GeniusStatus> {
    const user = await requireUser();
    const configured = geniusConfigured();
    if (!configured) {
        return { configured: false, connected: false, displayName: null };
    }

    const conn = await db.geniusConnection.findUnique({ where: { userId: user.id } });
    return {
        configured: true,
        connected: Boolean(conn),
        displayName: conn?.displayName ?? null,
    };
}

export async function disconnectGenius(): Promise<void> {
    const user = await requireUser();
    await db.geniusConnection.deleteMany({ where: { userId: user.id } });
    revalidatePath("/settings/integrations");
}

/** Fetch lyrics for the currently playing track (artist + title from Spotify). */
export async function fetchLyricsForTrack(
    artist: string,
    title: string,
): Promise<GeniusLyricsResult | null> {
    await requireUser();
    if (!geniusConfigured()) return null;
    if (!artist.trim() || !title.trim()) return null;
    return getLyricsForTrack(artist, title);
}
