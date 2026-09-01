import { redirect } from "next/navigation";

/** Substances were folded into Sobriety — keep the old route working by redirecting. */
export default function SubstancesPage() {
    redirect("/health/sobriety");
}
