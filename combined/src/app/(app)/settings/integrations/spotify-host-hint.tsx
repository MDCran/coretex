"use client";

import { useEffect, useState } from "react";
import { InfoCircle } from "@untitledui/icons";
import { SettingsNotice } from "@/components/settings/settings-notice";

/** Reminder that localhost and 127.0.0.1 need separate Spotify redirect URIs. */
export function SpotifyHostHint() {
    const [host, setHost] = useState<string | null>(null);

    useEffect(() => {
        setHost(window.location.origin);
    }, []);

    if (!host) return null;

    const other =
        host === "http://localhost:3000" ? "http://127.0.0.1:3000/api/spotify/callback" : "http://localhost:3000/api/spotify/callback";

    return (
        <SettingsNotice tone="info" icon={InfoCircle} title="Use one host consistently">
            <p>
                You&apos;re on <span className="font-mono text-xs">{host}</span>. Spotify treats{" "}
                <span className="font-mono text-xs">localhost</span> and <span className="font-mono text-xs">127.0.0.1</span> as
                different sites — register both callback URIs in the Spotify dashboard if you switch between them.
            </p>
            <p className="mt-2 text-sm text-tertiary">
                Alternate callback: <span className="font-mono text-xs">{other}</span>
            </p>
        </SettingsNotice>
    );
}
