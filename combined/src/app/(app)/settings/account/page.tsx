import { requireUser } from "@/lib/auth";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

export default async function SettingsAccountPage() {
    const user = await requireUser();
    return <AccountClient email={user.email} />;
}
