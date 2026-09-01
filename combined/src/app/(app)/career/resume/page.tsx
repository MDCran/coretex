import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ResumeClient, type ResumeData, type ResumeItemData } from "./resume-client";

export const dynamic = "force-dynamic";

export default async function CareerResumePage() {
    const user = await requireUser();
    const resumes = await db.resume.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        include: { items: { orderBy: [{ kind: "asc" }, { order: "asc" }] } },
    });

    const data: ResumeData[] = resumes.map((r) => ({
        id: r.id,
        name: r.name,
        headline: r.headline,
        summary: r.summary,
        items: r.items.map(
            (i): ResumeItemData => ({
                id: i.id,
                kind: i.kind,
                order: i.order,
                title: i.title,
                subtitle: i.subtitle,
                location: i.location,
                startDate: i.startDate?.toISOString() ?? null,
                endDate: i.endDate?.toISOString() ?? null,
                current: i.current,
                description: i.description,
                url: i.url,
            }),
        ),
    }));

    const profile = { name: user.name, email: user.email };

    return <ResumeClient resumes={data} profile={profile} />;
}
