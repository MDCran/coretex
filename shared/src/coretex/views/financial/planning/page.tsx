// @ts-nocheck
import { redirect } from "next/navigation";

/** Planning was removed — legacy route redirects to financial overview. */
export default function PlanningRedirectPage() {
    redirect("/financial");
}
