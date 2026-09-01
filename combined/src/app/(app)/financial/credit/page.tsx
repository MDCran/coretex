import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMonthYear } from "@/lib/dates";
import { SectionHeader } from "../_components/financial-ui";
import { CreditSection, type CreditScoreEntry } from "../_components/credit-section";

export default async function CreditPage() {
    const user = await requireUser();

    const scores = await db.creditScoreEntry.findMany({
        where: { userId: user.id },
        orderBy: { scoreDate: "asc" },
        take: 120,
    });

    const creditScores: CreditScoreEntry[] = scores.map((s) => ({
        id: s.id,
        label: formatMonthYear(s.scoreDate),
        value: s.score,
        scoreDate: s.scoreDate.toISOString().slice(0, 10),
        bureau: s.bureau ?? null,
        notes: s.notes ?? null,
    }));

    return (
        <div className="flex flex-col gap-6">
            <SectionHeader title="Credit scores" description="Track your score from each bureau over time." />
            <CreditSection scores={creditScores} />
        </div>
    );
}
