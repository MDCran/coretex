import type { ReactNode } from "react";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";

export default function MusicLayout({ children }: { children: React.ReactNode }) {
    return (
        <ModulePageShell
            title="Music"
            description="Spotify playback, playlists, search, and AI mood mixes — control everything from one place."
            className="page-shell--immersive max-xl:flex max-xl:min-h-0 max-xl:flex-col"
            contentClassName="max-xl:mt-3 max-xl:min-h-0 max-xl:flex-1 max-xl:gap-0 max-xl:!pb-0"
        >
            {children}
        </ModulePageShell>
    );
}
