// @ts-nocheck
import { useEffect, useState } from "react";
import { CoretexApp, AppErrorBoundary } from "@/coretex";

export const HomeScreen = () => {
    const [connection, setConnection] = useState<{ url: string; token: string } | null>();

    useEffect(() => {
        let active = true;
        const refresh = () => window.electronAPI?.getBridgeConnection?.()
            .then((value) => {
                if (!active) return;
                setConnection((current) => current?.token === value?.token && current?.url === value?.url ? current : value);
            })
            .catch(() => { if (active) setConnection(null); });
        void refresh();
        const timer = window.setInterval(refresh, 1500);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);

    if (connection === undefined) {
        return <div className="flex h-dvh items-center justify-center bg-primary text-sm text-tertiary">Starting secure local workspace…</div>;
    }

    if (connection === null) {
        return <div className="flex h-dvh items-center justify-center bg-primary px-6 text-center text-sm text-tertiary">The authenticated local workspace is unavailable. Restart Coretex to reconnect securely.</div>;
    }

    // The host supplies the per-launch token over renderer-validated IPC. The URL
    // may still be overridden for isolated QA, but credentials never enter Vite.
    const brainUrl = import.meta.env.VITE_CORETEX_BRAIN_URL ?? connection.url;

    return (
        <AppErrorBoundary>
            <CoretexApp key={connection.token} url={brainUrl} authToken={connection.token} />
        </AppErrorBoundary>
    );
};
