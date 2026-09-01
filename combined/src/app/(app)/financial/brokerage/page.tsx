import { redirect } from "next/navigation";

/**
 * Brokerage was merged into Accounts — a brokerage is now a FinAccount of kind
 * BROKERAGE. This route is retired and permanently redirects to the accounts list.
 */
export default function BrokeragePage() {
    redirect("/financial/accounts");
}
