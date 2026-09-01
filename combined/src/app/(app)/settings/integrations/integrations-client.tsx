"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { File06, Lightning01, LinkExternal01, MusicNote01, XCircle } from "@untitledui/icons";
import { Dialog as AriaDialog, Heading as AriaHeading } from "react-aria-components";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { SettingsCard } from "@/components/settings/settings-ui";
import { Modal, ModalOverlay } from "@/components/application/modals/modal";
import { disconnectGenius } from "@/lib/actions/genius";
import { disconnectSpotify } from "@/lib/actions/spotify";
import type { AlpacaConnectionView } from "@/lib/actions/financial-alpaca";
import type { AlpacaEnvStatus } from "@/lib/financial/alpaca-config";
import type { PlaidItemView, PlaidLinkOption } from "@/lib/actions/financial-plaid";
import type { IntegrationStatus } from "@/lib/integrations/status";
import { IntegrationStatusBadges } from "@/components/settings/integration-status-badges";
import { SettingsEnvVarList, SettingsNotice } from "@/components/settings/settings-notice";
import { AlpacaIntegrationCard } from "./alpaca-integration-card";
import { IntegrationsOverview } from "./integrations-overview";
import { PlaidIntegrationCard } from "./plaid-integration-card";
import { SpotifyHostHint } from "./spotify-host-hint";

interface Connection {
    displayName: string | null;
    spotifyUserId: string;
    scopes: string[];
}

interface Props {
    statuses: IntegrationStatus[];
    plaidItems: PlaidItemView[];
    connection: Connection | null;
    alpaca: AlpacaConnectionView | null;
    alpacaEnv: AlpacaEnvStatus;
    alpacaAutoConnectError?: string | null;
    spotifyConnectUrl: string;
    spotifyRedirectOrigin: string;
    spotifyRedirectUri: string;
    geniusConnection: { displayName: string | null } | null;
    geniusConnectUrl: string;
    geniusRedirectOrigin: string;
    plaidLinkToken?: string | null;
    plaidLinkError?: string | null;
    plaidLinkOptions: PlaidLinkOption[];
}

const GENIUS_ERROR_MESSAGES: Record<string, string> = {
    invalid_state: "Session expired or wrong browser host — open LifeOS at the same host as GENIUS_REDIRECT_URI and try again.",
    missing_code: "Genius did not return an authorization code.",
    token_exchange: "Could not exchange the authorization code. Check redirect URI and client secret.",
    access_denied: "You declined Genius access.",
};

const SPOTIFY_ERROR_MESSAGES: Record<string, string> = {
    invalid_state: "Session expired or wrong browser host — open LifeOS at 127.0.0.1:3000 and try again.",
    missing_code: "Spotify did not return an authorization code.",
    token_exchange: "Could not exchange the authorization code. Check redirect URI and client secret.",
    access_denied: "You declined Spotify access.",
};

function statusOf(statuses: IntegrationStatus[], id: IntegrationStatus["id"]) {
    const hit = statuses.find((s) => s.id === id);
    if (!hit) throw new Error(`Missing integration status: ${id}`);
    return hit;
}

export function IntegrationsClient({
    statuses,
    plaidItems,
    connection,
    alpaca,
    alpacaEnv,
    alpacaAutoConnectError,
    spotifyConnectUrl,
    spotifyRedirectOrigin,
    spotifyRedirectUri,
    geniusConnection,
    geniusConnectUrl,
    geniusRedirectOrigin,
    plaidLinkToken,
    plaidLinkError,
    plaidLinkOptions,
}: Props) {
    const spotify = statusOf(statuses, "spotify");
    const genius = statusOf(statuses, "genius");
    const claude = statusOf(statuses, "claude");
    const plaid = statusOf(statuses, "plaid");
    const alpacaStatus = statusOf(statuses, "alpaca");
    const router = useRouter();
    const searchParams = useSearchParams();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [geniusConfirmOpen, setGeniusConfirmOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [geniusPending, setGeniusPending] = useState(false);
    // Persisted callback failures, surfaced inline so they don't vanish with the toast.
    const [spotifyError, setSpotifyError] = useState<string | null>(null);
    const [geniusError, setGeniusError] = useState<string | null>(null);

    // Surface callback results as a toast + persistent inline notice (and clean the query string).
    useEffect(() => {
        const spotifyStatus = searchParams.get("spotify");
        const geniusStatus = searchParams.get("genius");
        if (!spotifyStatus && !geniusStatus) return;

        if (spotifyStatus === "connected") {
            toast.success("Spotify connected");
            setSpotifyError(null);
        } else if (spotifyStatus === "error") {
            const reason = searchParams.get("reason");
            const message = SPOTIFY_ERROR_MESSAGES[reason ?? ""] ?? "Spotify connection failed. Please try again.";
            toast.error(message);
            setSpotifyError(message);
        } else if (spotifyStatus === "unconfigured") {
            const message = "Spotify is not configured on the server.";
            toast.error(message);
            setSpotifyError(message);
        }

        if (geniusStatus === "connected") {
            toast.success("Genius account linked");
            setGeniusError(null);
        } else if (geniusStatus === "error") {
            const reason = searchParams.get("reason");
            const message = GENIUS_ERROR_MESSAGES[reason ?? ""] ?? "Genius connection failed. Please try again.";
            toast.error(message);
            setGeniusError(message);
        } else if (geniusStatus === "unconfigured") {
            const message = "Genius is not configured on the server.";
            toast.error(message);
            setGeniusError(message);
        }

        router.replace("/settings/integrations");
    }, [searchParams, router]);

    async function onDisconnect() {
        setPending(true);
        try {
            await disconnectSpotify();
            toast.success("Spotify disconnected");
            setConfirmOpen(false);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setPending(false);
        }
    }

    async function onDisconnectGenius() {
        setGeniusPending(true);
        try {
            await disconnectGenius();
            toast.success("Genius account unlinked");
            setGeniusConfirmOpen(false);
            router.refresh();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setGeniusPending(false);
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <IntegrationsOverview statuses={statuses} />

            <SettingsCard bloom="emerald">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                        <MusicNote01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        Spotify
                    </h2>
                    <IntegrationStatusBadges env={spotify.env} connection={spotify.connection} />
                </div>
                <div className="mt-5 flex flex-col gap-5">
                    {spotifyError && (
                        <SettingsNotice status="error" title="Spotify connection failed">
                            {spotifyError}
                        </SettingsNotice>
                    )}
                    {spotify.env === "not_configured" ? (
                        <SettingsNotice status="info" title="Spotify is not configured on the server">
                            <p>Add these environment variables to enable music playback and the AI mood playlist in Workouts:</p>
                            <div className="mt-2">
                                <SettingsEnvVarList vars={spotify.envVars} tone="info" />
                            </div>
                        </SettingsNotice>
                    ) : spotify.connection === "connected" && connection ? (
                        <>
                            <SettingsNotice status="success" title={`Connected as ${connection.displayName ?? connection.spotifyUserId}`}>
                                Control playback and build AI playlists from the Workouts player.
                            </SettingsNotice>

                            <div className="flex flex-col gap-2">
                                <p className="text-sm font-medium text-secondary">Granted permissions</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {connection.scopes.length === 0 ? (
                                        <span className="text-sm text-tertiary">None</span>
                                    ) : (
                                        connection.scopes.map((s) => (
                                            <Badge key={s} color="gray" type="pill-color" size="sm">
                                                {s}
                                            </Badge>
                                        ))
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Button color="secondary-destructive" iconLeading={XCircle} onClick={() => setConfirmOpen(true)}>
                                    Disconnect
                                </Button>
                                <Button color="link-color" href="/workouts" iconTrailing={LinkExternal01}>
                                    Open Workouts player
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <SettingsNotice status="warning" title="Spotify is not connected">
                                Connect your account to control playback and generate AI mood playlists in the Workouts player.
                            </SettingsNotice>
                            <SpotifyHostHint />
                            <p className="text-sm text-tertiary">
                                Add both redirect URIs in the{" "}
                                <a
                                    href="https://developer.spotify.com/dashboard"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-brand-secondary hover:underline"
                                >
                                    Spotify dashboard
                                </a>{" "}
                                (localhost and 127.0.0.1 are different):
                            </p>
                            <ul className="list-inside list-disc text-sm text-tertiary">
                                <li>
                                    <span className="font-mono text-xs">{spotifyRedirectUri}</span>
                                </li>
                                <li>
                                    <span className="font-mono text-xs">
                                        {spotifyRedirectOrigin === "http://localhost:3000"
                                            ? "http://127.0.0.1:3000/api/spotify/callback"
                                            : "http://localhost:3000/api/spotify/callback"}
                                    </span>
                                </li>
                            </ul>
                            <div>
                                <Button href={spotifyConnectUrl} iconLeading={MusicNote01}>
                                    Connect Spotify
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </SettingsCard>

            <SettingsCard bloom="emerald">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                        <File06 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        Genius (lyrics)
                    </h2>
                    <IntegrationStatusBadges env={genius.env} showConnection={false} />
                </div>
                <div className="mt-5 flex flex-col gap-5">
                    {geniusError && (
                        <SettingsNotice status="error" title="Genius connection failed">
                            {geniusError}
                        </SettingsNotice>
                    )}
                    {genius.env === "not_configured" ? (
                        <SettingsNotice status="info" title="Genius is not configured on the server">
                            <p>Add these environment variables to show lyrics on the Music page:</p>
                            <div className="mt-2">
                                <SettingsEnvVarList vars={genius.envVars} tone="info" />
                            </div>
                            <p className="mt-2 text-sm text-tertiary">
                                Register redirect URI:{" "}
                                <span className="font-mono text-xs">{geniusRedirectOrigin}/api/genius/callback</span>
                            </p>
                        </SettingsNotice>
                    ) : (
                        <>
                            <SettingsNotice status="success" title="Lyrics are enabled">
                                The Music page loads lyrics for the current Spotify track via Genius. Linking your Genius account is
                                optional.
                            </SettingsNotice>
                            {geniusConnection ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm text-secondary">
                                        Linked as <span className="font-medium">{geniusConnection.displayName ?? "Genius user"}</span>
                                    </p>
                                    <Button
                                        color="secondary-destructive"
                                        size="sm"
                                        iconLeading={XCircle}
                                        onClick={() => setGeniusConfirmOpen(true)}
                                    >
                                        Unlink account
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button href={geniusConnectUrl} iconLeading={File06} size="sm">
                                        Link Genius account
                                    </Button>
                                    <Button href="/music" color="link-color" size="sm" iconTrailing={LinkExternal01}>
                                        Open Music
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </SettingsCard>

            <SettingsCard bloom="emerald">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
                        <Lightning01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        Anthropic Claude (AI)
                    </h2>
                    <IntegrationStatusBadges env={claude.env} showConnection={false} />
                </div>
                <div className="mt-5 flex flex-col gap-4">
                    <SettingsNotice
                        status={claude.env === "configured" ? "success" : "warning"}
                        title={claude.env === "configured" ? "Claude API key is set on the server" : "Claude API key is missing"}
                    >
                        {claude.env === "configured"
                            ? "AI features (nutrition, financial extraction, quizzes, categorization) are available. No account linking required — this is a server-wide API key."
                            : "Add the environment variable below to enable AI."}
                        {claude.env === "not_configured" && (
                            <div className="mt-2">
                                <SettingsEnvVarList vars={claude.envVars} tone="warning" />
                            </div>
                        )}
                    </SettingsNotice>
                    <div className="flex flex-wrap gap-2">
                        <Button href="/settings/ai" color="secondary" iconTrailing={LinkExternal01}>
                            AI settings & usage
                        </Button>
                    </div>
                    <p className="text-xs text-tertiary">
                        Manage default model, monthly budget, and view per-request charges on the{" "}
                        <Link href="/settings/ai" className="font-medium text-brand-secondary hover:underline">
                            AI tab
                        </Link>
                        .
                    </p>
                </div>
            </SettingsCard>

            <PlaidIntegrationCard
                status={plaid}
                items={plaidItems}
                plaidLinkToken={plaidLinkToken}
                plaidLinkError={plaidLinkError}
                plaidLinkOptions={plaidLinkOptions}
            />

            <AlpacaIntegrationCard status={alpacaStatus} connection={alpaca} envStatus={alpacaEnv} autoConnectError={alpacaAutoConnectError} />

            <ModalOverlay isOpen={geniusConfirmOpen} onOpenChange={setGeniusConfirmOpen}>
                <Modal className="max-w-md">
                    <AriaDialog className="rounded-xl bg-primary p-6 outline-hidden ring-1 ring-secondary">
                        <AriaHeading slot="title" className="text-lg font-semibold text-primary">
                            Unlink Genius account?
                        </AriaHeading>
                        <p className="mt-2 text-sm text-tertiary">
                            Lyrics will still work via app credentials. You can link your account again any time.
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button color="secondary" onClick={() => setGeniusConfirmOpen(false)} isDisabled={geniusPending}>
                                Cancel
                            </Button>
                            <Button
                                color="primary-destructive"
                                onClick={onDisconnectGenius}
                                isLoading={geniusPending}
                                showTextWhileLoading
                            >
                                Unlink
                            </Button>
                        </div>
                    </AriaDialog>
                </Modal>
            </ModalOverlay>

            <ModalOverlay isOpen={confirmOpen} onOpenChange={setConfirmOpen}>
                <Modal className="max-w-md">
                    <AriaDialog className="rounded-xl bg-primary p-6 outline-hidden ring-1 ring-secondary">
                        <AriaHeading slot="title" className="text-lg font-semibold text-primary">
                            Disconnect Spotify?
                        </AriaHeading>
                        <p className="mt-2 text-sm text-tertiary">
                            This removes the stored connection. You can reconnect any time from this page. Your playlists on Spotify are not
                            affected.
                        </p>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button color="secondary" onClick={() => setConfirmOpen(false)} isDisabled={pending}>
                                Cancel
                            </Button>
                            <Button color="primary-destructive" onClick={onDisconnect} isLoading={pending} showTextWhileLoading>
                                Disconnect
                            </Button>
                        </div>
                    </AriaDialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
}
