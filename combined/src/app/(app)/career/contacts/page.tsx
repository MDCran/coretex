import Link from "next/link";
import { Plus, Users01 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fmtRelative } from "@/lib/jobs/format";
import { CONTACT_METHOD_LABELS } from "@/lib/jobs/enums";
import { PageHeader } from "@/components/jobs/page-header";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Card, CardBody } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Avatar } from "@/components/base/avatar/avatar";
import { LiveClock } from "@/components/jobs/live-clock";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
    const user = await requireUser();
    const contacts = await db.jobContact.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        include: { company: { select: { name: true } } },
    });

    return (
        <div>
            <PageHeader title="Contacts" description={`${contacts.length} contact${contacts.length === 1 ? "" : "s"} in your network`}>
                <Button href="/career/contacts/new" color="primary" iconLeading={<Plus data-icon className="size-4" />}>
                    Add contact
                </Button>
            </PageHeader>

            {contacts.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <FeaturedIcon icon={Users01} color="brand" theme="light" size="lg" />
                        <p className="text-sm font-semibold text-primary">Grow your professional network</p>
                        <p className="max-w-sm text-sm text-tertiary">
                            Keep recruiters, referrers, and hiring managers in one place — with the right contact details and a reminder of when you last spoke.
                        </p>
                        <Button href="/career/contacts/new" color="primary" size="md" iconLeading={<Plus data-icon className="size-4" />} className="mt-1">
                            Add contact
                        </Button>
                    </div>
                </Card>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {contacts.map((p) => (
                        <Link key={p.id} href={`/career/contacts/${p.id}`}>
                            <Card className="h-full transition hover:bg-secondary_hover">
                                <CardBody className="flex flex-col gap-2">
                                    <div className="flex items-center gap-3">
                                        <Avatar size="md" initials={p.name.slice(0, 2).toUpperCase()} alt={p.name} />
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-primary">{p.name}</div>
                                            <div className="truncate text-sm text-tertiary">{[p.role, p.company?.name].filter(Boolean).join(" · ") || "—"}</div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 pt-1">
                                        {p.preferredContactMethod && (
                                            <Badge color="brand" size="sm">
                                                {CONTACT_METHOD_LABELS[p.preferredContactMethod]}
                                            </Badge>
                                        )}
                                        {p.timezone && <LiveClock timezone={p.timezone} />}
                                    </div>
                                    <div className="text-xs text-tertiary">Last contacted {fmtRelative(p.lastContactedAt)}</div>
                                </CardBody>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
