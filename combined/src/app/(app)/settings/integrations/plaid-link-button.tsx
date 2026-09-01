"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { SettingsNotice } from "@/components/settings/settings-notice";
import { exchangePlaidPublicToken, getPlaidLinkToken } from "@/lib/actions/financial-plaid";

interface Props {
    /** Pre-generated on the server so Link can initialize immediately. */
    initialLinkToken?: string | null;
    initialLinkError?: string | null;
}

/** Inner component — `usePlaidLink` only runs with a real token (required for `ready`). */
function PlaidLinkOpener({
    linkToken,
    onTokenConsumed,
}: {
    linkToken: string;
    onTokenConsumed: () => void;
}) {
    const router = useRouter();
    const [exchanging, setExchanging] = useState(false);

    const onSuccess = useCallback(
        async (publicToken: string) => {
            setExchanging(true);
            try {
                const res = await exchangePlaidPublicToken(publicToken);
                const msg =
                    res.sync.added > 0
                        ? `Connected - imported ${res.sync.added} transaction${res.sync.added === 1 ? "" : "s"}`
                        : res.sync.linked > 0
                          ? `Connected - linked ${res.sync.linked} existing transaction${res.sync.linked === 1 ? "" : "s"}`
                          : "Bank connected - sync transactions from Integrations when ready";
                toast.success(msg);
                onTokenConsumed();
                router.refresh();
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Could not connect bank");
            } finally {
                setExchanging(false);
            }
        },
        [onTokenConsumed, router],
    );

    const { open, ready } = usePlaidLink({
        token: linkToken,
        onSuccess,
    });

    return (
        <Button
            onClick={() => {
                if (ready) open();
            }}
            isDisabled={!ready || exchanging}
            isLoading={exchanging}
            showTextWhileLoading
        >
            {ready ? "Connect bank or card" : "Preparing Plaid..."}
        </Button>
    );
}

export function PlaidLinkButton({ initialLinkToken = null, initialLinkError = null }: Props) {
    const [linkToken, setLinkToken] = useState<string | null>(initialLinkToken);
    const [error, setError] = useState<string | null>(initialLinkError);
    const [fetching, setFetching] = useState(!initialLinkToken && !initialLinkError);

    const loadToken = useCallback(async () => {
        setFetching(true);
        setError(null);
        try {
            const { linkToken: token } = await getPlaidLinkToken();
            setLinkToken(token);
        } catch (e) {
            const message = e instanceof Error ? e.message : "Could not initialize Plaid Link";
            setError(message);
            toast.error(message);
        } finally {
            setFetching(false);
        }
    }, []);

    useEffect(() => {
        if (!initialLinkToken && !initialLinkError) {
            void loadToken();
        }
    }, [initialLinkToken, initialLinkError, loadToken]);

    if (error) {
        return (
            <div className="flex flex-col gap-3">
                <SettingsNotice status="error" title="Could not start Plaid Link">
                    {error}
                </SettingsNotice>
                <Button color="secondary" onClick={() => void loadToken()} isLoading={fetching} showTextWhileLoading>
                    Retry Plaid setup
                </Button>
            </div>
        );
    }

    if (fetching || !linkToken) {
        return (
            <Button isDisabled isLoading showTextWhileLoading>
                Preparing Plaid...
            </Button>
        );
    }

    return (
        <PlaidLinkOpener
            linkToken={linkToken}
            onTokenConsumed={() => {
                setLinkToken(null);
                void loadToken();
            }}
        />
    );
}
