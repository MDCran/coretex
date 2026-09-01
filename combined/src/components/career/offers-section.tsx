import { Download01, Scales02 } from "@untitledui/icons";
import type { NegotiationKind, OfferStatus } from "@prisma/client";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { Badge } from "@/components/base/badges/badges";
import { EmptyState } from "@/components/career/career-ui";
import { DeleteButton } from "@/components/jobs/delete-button";
import { Markdown } from "@/components/jobs/markdown";
import { fileUrl } from "@/lib/files";
import { fmtDate, toDateInput } from "@/lib/jobs/format";
import { NEGOTIATION_KIND_LABELS, OFFER_STATUS_BADGE_COLOR, OFFER_STATUS_LABELS } from "@/lib/jobs/enums";
import { OfferDialog, NegotiationDialog } from "@/components/career/offer-dialog";
import { addNegotiationStep, createOffer, deleteNegotiationStep, deleteOffer, updateOffer } from "@/lib/actions/career-advanced";

interface NegStep {
    id: string;
    kind: NegotiationKind;
    date: Date | null;
    baseSalary: number | null;
    bonus: number | null;
    equityValue: number | null;
    rationale: string | null;
    outcome: string | null;
}

interface OfferRow {
    id: string;
    status: OfferStatus;
    baseSalary: number | null;
    bonus: number | null;
    equityValue: number | null;
    equityDescription: string | null;
    signOnBonus: number | null;
    ptoDays: number | null;
    currency: string;
    benefits: string | null;
    location: string | null;
    remote: boolean | null;
    startDate: Date | null;
    decisionDeadline: Date | null;
    receivedAt: Date | null;
    notesMarkdown: string | null;
    letterFileKey: string | null;
    letterFileName: string | null;
    negotiationSteps: NegStep[];
}

function money(n: number | null | undefined, currency: string) {
    if (n == null) return "—";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n);
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-xs text-tertiary">{label}</div>
            <div className="text-sm font-medium text-primary tabular-nums">{value}</div>
        </div>
    );
}

export function OffersSection({ applicationId, offers, defaultCurrency }: { applicationId: string; offers: OfferRow[]; defaultCurrency: string }) {
    return (
        <Card>
            <CardHeader title={`Offers (${offers.length})`} action={<OfferDialog action={createOffer.bind(null, applicationId)} defaultCurrency={defaultCurrency} />} />
            <CardBody className="flex flex-col gap-4">
                {offers.length === 0 ? (
                    <EmptyState
                        icon={Scales02}
                        title="Capture your offer the moment it lands"
                        action={<OfferDialog action={createOffer.bind(null, applicationId)} defaultCurrency={defaultCurrency} triggerLabel="Add an offer" />}
                    >
                        Log base, bonus, equity, and PTO to track every negotiation step — then compare it side-by-side with your other offers.
                    </EmptyState>
                ) : (
                    offers.map((o) => {
                        const total = (o.baseSalary ?? 0) + (o.bonus ?? 0) + (o.equityValue ?? 0);
                        return (
                            <div key={o.id} className="rounded-lg ring-1 ring-secondary ring-inset">
                                <div className="flex items-start justify-between gap-2 border-b border-secondary p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge color={OFFER_STATUS_BADGE_COLOR[o.status]} size="sm" type="pill-color">
                                            {OFFER_STATUS_LABELS[o.status]}
                                        </Badge>
                                        <span className="text-sm font-semibold text-primary tabular-nums">{money(total, o.currency)} total</span>
                                        {o.receivedAt && <span className="text-xs text-tertiary">received {fmtDate(o.receivedAt)}</span>}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {o.letterFileKey && (
                                            <a
                                                href={fileUrl(o.letterFileKey, { download: true, name: o.letterFileName ?? "offer-letter" })}
                                                className="inline-flex items-center gap-1 text-xs text-brand-secondary hover:underline"
                                            >
                                                <Download01 className="size-3.5" /> Letter
                                            </a>
                                        )}
                                        <OfferDialog
                                            mode="edit"
                                            action={updateOffer.bind(null, o.id)}
                                            defaultCurrency={o.currency}
                                            defaults={{
                                                status: o.status,
                                                baseSalary: o.baseSalary,
                                                bonus: o.bonus,
                                                equityValue: o.equityValue,
                                                equityDescription: o.equityDescription,
                                                signOnBonus: o.signOnBonus,
                                                ptoDays: o.ptoDays,
                                                currency: o.currency,
                                                benefits: o.benefits,
                                                location: o.location,
                                                remote: o.remote,
                                                startDate: toDateInput(o.startDate),
                                                decisionDeadline: toDateInput(o.decisionDeadline),
                                                receivedAt: toDateInput(o.receivedAt),
                                                notesMarkdown: o.notesMarkdown,
                                            }}
                                        />
                                        <DeleteButton action={deleteOffer} id={o.id} iconOnly title="Delete offer?" description="This removes the offer and its negotiation history." />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
                                    <Stat label="Base" value={money(o.baseSalary, o.currency)} />
                                    <Stat label="Bonus" value={money(o.bonus, o.currency)} />
                                    <Stat label="Equity / yr" value={money(o.equityValue, o.currency)} />
                                    <Stat label="Sign-on" value={money(o.signOnBonus, o.currency)} />
                                    <Stat label="PTO" value={o.ptoDays != null ? `${o.ptoDays} days` : "—"} />
                                    <Stat label="Decision by" value={o.decisionDeadline ? fmtDate(o.decisionDeadline) : "—"} />
                                </div>

                                {(o.benefits?.trim() || o.equityDescription || o.location) && (
                                    <div className="border-t border-secondary px-3 py-2 text-sm text-tertiary">
                                        {o.location && <div>📍 {o.location}{o.remote ? " · remote ok" : ""}</div>}
                                        {o.equityDescription && <div>Equity: {o.equityDescription}</div>}
                                        {o.benefits?.trim() && <Markdown>{o.benefits}</Markdown>}
                                    </div>
                                )}

                                <div className="border-t border-secondary p-3">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="text-xs font-semibold text-quaternary uppercase">Negotiation</span>
                                        <NegotiationDialog action={addNegotiationStep.bind(null, o.id)} />
                                    </div>
                                    {o.negotiationSteps.length === 0 ? (
                                        <p className="text-xs text-tertiary">No negotiation steps yet.</p>
                                    ) : (
                                        <ol className="flex flex-col gap-2">
                                            {o.negotiationSteps.map((s) => (
                                                <li key={s.id} className="flex items-start justify-between gap-2 rounded-md bg-secondary p-2">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
                                                            <Badge color="gray" size="sm" type="modern">
                                                                {NEGOTIATION_KIND_LABELS[s.kind]}
                                                            </Badge>
                                                            {s.baseSalary != null && <span className="tabular-nums">{money(s.baseSalary, o.currency)} base</span>}
                                                            {s.outcome && <span className="text-tertiary">· {s.outcome}</span>}
                                                            <span className="text-xs text-quaternary">{fmtDate(s.date)}</span>
                                                        </div>
                                                        {s.rationale && <p className="mt-0.5 text-xs text-tertiary">{s.rationale}</p>}
                                                    </div>
                                                    <DeleteButton action={deleteNegotiationStep} id={s.id} iconOnly title="Delete step?" description="Removes this negotiation step." />
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </CardBody>
        </Card>
    );
}
