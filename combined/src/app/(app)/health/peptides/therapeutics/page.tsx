import { redirect } from "next/navigation";

// Therapeutics moved to its own top-level Medications tab.
export default function TherapeuticsRedirect() {
    redirect("/health/medications");
}
