import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CategoriesClient } from "./categories-client";

export default async function CategoriesPage() {
    const user = await requireUser();
    const categories = await db.eventCategory.findMany({
        where: { userId: user.id },
        include: { _count: { select: { events: true } } },
        orderBy: { name: "asc" },
    });

    return (
        <CategoriesClient
            categories={categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, eventCount: c._count.events }))}
        />
    );
}
