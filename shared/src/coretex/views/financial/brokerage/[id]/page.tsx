// @ts-nocheck
import { redirect } from "next/navigation";

/**
 * Legacy brokerage-account detail route. Brokerage accounts are now FinAccounts
 * of kind BROKERAGE (see /financial/accounts/[id]); legacy rows are reconciled
 * to new FinAccount ids on load, so old ids no longer resolve. Redirect to the list.
 */
export default function LegacyBrokerageDetailPage() {
    redirect("/financial/accounts");
}
