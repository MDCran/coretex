// @ts-nocheck

import { toast } from "sonner";
import { Button } from "react-aria-components";
import { useState, useTransition } from "react";
import { LinkExternal01, RefreshCw01, MagicWand02 } from "@untitledui/icons";
import { Toggle } from "@/components/base/toggle/toggle";
import { Card } from "../_components/financial-ui";

/**
 * Per-account Alpaca link toggle + holdings tools for a BROKERAGE account.
 *  - "Link Alpaca" mirrors the user's live portfolio into this account (read-only).
 *  - "Refresh from Alpaca" re-pulls positions.
 *  - "Extract from statements" runs the AI holdings extractor over uploaded PDFs.
 *
 * The actual live equity/positions/chart render below via <AlpacaPortfolio/> when linked.
 */
export function BrokerageControls({
    finAccountId,
    alpacaLinked,
    alpacaConnected,
    aiConfigured,
    hasStatements,
}: {
    finAccountId: string;
    alpacaLinked: boolean;
    alpacaConnected: boolean;
    aiConfigured: boolean;
    hasStatements: boolean;
}) {
    const [linked, setLinked] = useState(alpacaLinked);
    const [savingLink, startLink] = useTransition();
    const [refreshing, startRefresh] = useTransition();
    const [extracting, startExtract] = useTransition();

    function onToggle(next: boolean) {
        setLinked(next); // optimistic
        startLink(async () => {
            const fd = new FormData();
            fd.set("id", finAccountId);
            fd.set("alpacaLinked", next ? "true" : "false");
            try {
                await setFinAccountAlpacaLinked(fd);
                toast.success(next ? "Linked to Alpaca" : "Unlinked from Alpaca");
            } catch (e) {
                setLinked(!next);
                toast.error(e instanceof Error ? e.message : "Failed to update link");
            }
        });
    }

    function onRefresh() {
        startRefresh(async () => {
            const fd = new FormData();
            fd.set("id", finAccountId);
            try {
                const res = await refreshAlpacaHoldings(fd);
                toast.success(res.synced != null ? `Synced ${res.synced} position${res.synced === 1 ? "" : "s"} from Alpaca` : "Nothing to sync");
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Refresh failed");
            }
        });
    }

    function onExtract() {
        startExtract(async () => {
            const fd = new FormData();
            fd.set("id", finAccountId);
            try {
                const res = await extractHoldings(fd);
                if (res.statementsScanned === 0) toast.message("No PDF statements to extract from yet.");
                else toast.success(`Extracted ${res.upserted} holding${res.upserted === 1 ? "" : "s"} from ${res.statementsScanned} statement${res.statementsScanned === 1 ? "" : "s"}.`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Extraction failed");
            }
        });
    }

    return (
        <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <h3 className="text-md font-semibold text-primary">Alpaca</h3>
                    <p className="text-sm text-tertiary">
                        {alpacaConnected
                            ? "Mirror your live Alpaca portfolio into this account for real-time equity, positions and a value chart. Read-only — no trading."
                            : "Connect Alpaca in Settings → Integrations to enable live equity and positions for this account."}
                    </p>
                </div>
                {alpacaConnected ? (
                    <Toggle
                        isSelected={linked}
                        isDisabled={savingLink}
                        onChange={onToggle}
                        slim
                        aria-label="Link this account to Alpaca"
                    />
                ) : (
                    <Button size="sm" color="secondary" href="/settings/integrations" iconTrailing={LinkExternal01}>
                        Connect Alpaca
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-secondary pt-4">
                {alpacaConnected && linked && (
                    <Button size="sm" color="secondary" iconLeading={RefreshCw01} isLoading={refreshing} onClick={onRefresh}>
                        Refresh from Alpaca
                    </Button>
                )}
                <Button
                    size="sm"
                    color="secondary"
                    iconLeading={MagicWand02}
                    isLoading={extracting}
                    isDisabled={!aiConfigured || !hasStatements}
                    onClick={onExtract}
                >
                    Extract holdings from statements
                </Button>
                {!aiConfigured && <span className="self-center text-xs text-tertiary">Add ANTHROPIC_API_KEY to enable statement extraction.</span>}
                {aiConfigured && !hasStatements && <span className="self-center text-xs text-tertiary">Upload a brokerage statement PDF first.</span>}
            </div>
        </Card>
    );
}
