import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { SkillsClient, type SkillRow } from "@/components/career/skills-client";

export const dynamic = "force-dynamic";

export default async function CareerSkillsPage() {
    const user = await requireUser();
    const skills = await db.careerSkill.findMany({
        where: { userId: user.id },
        orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const rows: SkillRow[] = skills.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        proficiency: s.proficiency,
        targetProficiency: s.targetProficiency,
        practicePlan: s.practicePlan,
        proofUrl: s.proofUrl,
        hoursLogged: s.hoursLogged,
    }));

    return <SkillsClient skills={rows} />;
}
