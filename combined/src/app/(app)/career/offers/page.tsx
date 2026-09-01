import Link from "next/link";
import { Briefcase01, Scales02 } from "@untitledui/icons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/jobs/page-header";
import { Card } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { fmtDate } from "@/lib/jobs/format";
import { OFFER_STATUS_BADGE_COLOR, OFFER_STATUS_LABELS } from "@/lib/jobs/enums";
import { cx } from "@/utils/cx";

export const dynamic = "force-dynamic";

function money(n: number | null | undefined, currency: string) {
    if (n == null) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n);
}

export default async function OffersPage() {
    const user = await requireUser();
    const offers = await db.offer.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { application: { select: { id: true, role: true, company: { select: { name: true } } } } },
    });

    const totals = offers.map((o) => (o.baseSalary ?? 0) + (o.bonus ?? 0) + (o.equityValue ?? 0) + (o.signOnBonus ?? 0));
    const bestTotal = Math.max(0, ...totals);
    const bestBase = Math.max(0, ...offers.map((o) => o.baseSalary ?? 0));

    const rows: { label: string; render: (o: (typeof offers)[number], total: number) => React.ReactNode; best?: (o: (typeof offers)[number], total: number) => boolean }[] = [
        { label: "Status", render: (o) => <Badge color={OFFER_STATUS_BADGE_COLOR[o.status]} size="sm" type="pill-color">{OFFER_STATUS_LABELS[o.status]}</Badge> },
        { label: "Base salary", render: (o) => money(o.baseSalary, o.currency), best: (o) => (o.baseSalary ?? 0) === bestBase && bestBase > 0 },
        { label: "Bonus", render: (o) => money(o.bonus, o.currency) },
        { label: "Equity / yr", render: (o) => money(o.equityValue, o.currency) },
        { label: "Sign-on", render: (o) => money(o.signOnBonus, o.currency) },
        { label: "Total comp", render: (o, t) => <span className="font-semibold">{money(t, o.currency)}</span>, best: (_o, t) => t === bestTotal && bestTotal > 0 },
        { label: "PTO", render: (o) => (o.ptoDays != null ? `${o.ptoDays} days` : "—") },
        { label: "Location", render: (o) => o.location ?? "—" },
        { label: "Remote", render: (o) => (o.remote == null ? "—" : o.remote ? "Yes" : "No") },
        { label: "Start date", render: (o) => fmtDate(o.startDate) },
        { label: "Decide by", render: (o) => fmtDate(o.decisionDeadline) },
        { label: "Benefits", render: (o) => <span className="text-xs">{o.benefits?.trim() || "—"}</span> },
    ];

    return (
        <div className="w-full">
            <PageHeader title="Offer comparison" description="Side-by-side comparison of every offer you're weighing.">
                <Scales02 className="size-5 text-fg-quaternary" />
            </PageHeader>

            {offers.length === 0 ? (
                <Card>
                    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                        <FeaturedIcon icon={Scales02} color="brand" theme="light" size="lg" />
                        <p className="text-sm font-semibold text-primary">Weigh your offers with confidence</p>
                        <p className="max-w-sm text-sm text-tertiary">
                            Add an offer from any application and it lands here in a clear side-by-side view — total comp, equity, PTO, and more, with the best in each row highlighted.
                        </p>
                        <Button href="/career/applications" color="primary" size="md" iconLeading={<Briefcase01 data-icon className="size-4" />} className="mt-1">
                            Go to applications
                        </Button>
                    </div>
                </Card>
            ) : (
                <Card className="overflow-x-auto">
                    <table className="w-full min-w-[640px]">
                        <thead>
                            <tr className="border-b border-secondary bg-secondary text-left">
                                <th className="sticky left-0 z-10 bg-secondary px-4 py-3 text-xs font-semibold text-quaternary">Attribute</th>
                                {offers.map((o) => (
                                    <th key={o.id} className="px-4 py-3 text-sm font-semibold text-primary">
                                        <Link href={`/career/applications/${o.application.id}`} className="hover:underline">
                                            {o.application.company.name}
                                        </Link>
                                        <div className="text-xs font-normal text-tertiary">{o.application.role}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.label} className="border-b border-secondary last:border-0">
                                    <td className="sticky left-0 z-10 bg-primary px-4 py-2.5 text-xs font-medium text-tertiary">{row.label}</td>
                                    {offers.map((o, i) => {
                                        const isBest = row.best?.(o, totals[i]) ?? false;
                                        return (
                                            <td key={o.id} className={cx("px-4 py-2.5 text-sm text-secondary tabular-nums", isBest && "bg-success-primary font-semibold text-success-primary")}>
                                                {row.render(o, totals[i])}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}
        </div>
    );
}
