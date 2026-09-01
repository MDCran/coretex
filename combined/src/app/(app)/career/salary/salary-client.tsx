"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Edit01, Trash02, Building07, Briefcase01, Coins01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { TextInput, DateInput } from "@/components/jobs/fields";
import { CompanyLogo } from "@/components/jobs/company-logo";
import { FormModal } from "@/app/(app)/health/_components/form-modal";
import { EmptyState } from "@/components/career/career-ui";
import { CompChart } from "@/components/career/charts";
import { fmtDate, toDateInput } from "@/lib/jobs/format";
import type { CompanyLogoSources } from "@/lib/jobs/logos";
import { createSalaryEntry, updateSalaryEntry, deleteSalaryEntry } from "@/lib/actions/career";

export interface ApplicationOption {
    id: string;
    role: string;
    /** Human-readable status label. */
    status: string;
}

export interface CompanyOption {
    id: string;
    name: string;
    logo: CompanyLogoSources;
    applications: ApplicationOption[];
}

export interface SalaryRow {
    id: string;
    date: string;
    /** Legacy free-text company (kept for old rows that predate the relation). */
    company: string | null;
    companyId: string | null;
    companyName: string | null;
    companyLogo: CompanyLogoSources | null;
    applicationId: string | null;
    applicationRole: string | null;
    applicationStatus: string | null;
    title: string | null;
    baseSalary: number;
    bonus: number;
    equity: number;
    totalComp: number;
    currency: string;
}

function money(n: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n);
}

export function SalaryClient({ entries, companies }: { entries: SalaryRow[]; companies: CompanyOption[] }) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<SalaryRow | null>(null);

    // Chosen company in the form controls which applications are selectable.
    const [companyId, setCompanyId] = useState<string>("");
    const [applicationId, setApplicationId] = useState<string>("");

    const selectedCompany = companies.find((c) => c.id === companyId);
    const applicationOptions = selectedCompany?.applications ?? [];

    const currency = entries[0]?.currency ?? "USD";
    const latest = entries[0];

    const chartData = useMemo(
        () =>
            entries
                .slice()
                .sort((a, b) => +new Date(a.date) - +new Date(b.date))
                .map((e) => ({
                    label: new Date(e.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
                    base: e.baseSalary,
                    bonus: e.bonus,
                    equity: e.equity,
                })),
        [entries],
    );

    function openCreate() {
        setEditing(null);
        setCompanyId("");
        setApplicationId("");
        setOpen(true);
    }
    function openEdit(row: SalaryRow) {
        setEditing(row);
        setCompanyId(row.companyId ?? "");
        setApplicationId(row.applicationId ?? "");
        setOpen(true);
    }

    async function onSubmit(fd: FormData) {
        try {
            if (editing) await updateSalaryEntry(fd);
            else await createSalaryEntry(fd);
            toast.success(editing ? "Entry updated" : "Entry added");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    async function onDelete(id: string) {
        const fd = new FormData();
        fd.set("id", id);
        try {
            await deleteSalaryEntry(fd);
            toast.success("Entry deleted");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to delete");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-primary">Compensation</h2>
                    <p className="text-sm text-tertiary">Log total compensation over time. Total auto-calculates from base + bonus + equity.</p>
                </div>
                <Button iconLeading={Plus} onClick={openCreate}>
                    Add entry
                </Button>
            </div>

            {latest && (
                <div className="grid gap-4 sm:grid-cols-3">
                    <Card>
                        <CardBody>
                            <p className="text-sm text-tertiary">Latest total comp</p>
                            <p className="text-display-xs font-semibold text-primary">{money(latest.totalComp, currency)}</p>
                            <p className="text-xs text-tertiary">{fmtDate(latest.date)}</p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <p className="text-sm text-tertiary">Base</p>
                            <p className="text-display-xs font-semibold text-primary">{money(latest.baseSalary, currency)}</p>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardBody>
                            <p className="text-sm text-tertiary">Bonus + equity</p>
                            <p className="text-display-xs font-semibold text-primary">{money(latest.bonus + latest.equity, currency)}</p>
                        </CardBody>
                    </Card>
                </div>
            )}

            <Card>
                <CardHeader title="Compensation over time" />
                <CardBody>
                    <CompChart data={chartData} />
                </CardBody>
            </Card>

            {/* Mobile: stacked cards. Each entry collapses to a card so no horizontal scroll is needed. */}
            <div className="flex flex-col gap-3 sm:hidden">
                {entries.length === 0 ? (
                    <Card>
                        <EmptyState
                            icon={Coins01}
                            title="Track your compensation"
                            action={
                                <Button iconLeading={Plus} onClick={openCreate}>
                                    Add your first entry
                                </Button>
                            }
                        >
                            Log base, bonus, and equity over time to see your total comp grow and benchmark every new offer.
                        </EmptyState>
                    </Card>
                ) : (
                    entries.map((e) => (
                        <Card key={e.id}>
                            <CardBody className="flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 items-center gap-2">
                                        {e.companyName && (
                                            <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded bg-primary p-0.5 ring-1 ring-secondary">
                                                <CompanyLogo src={e.companyLogo} alt={e.companyName} name={e.companyName} className="size-full object-contain" iconClassName="text-[0.5rem]" />
                                            </span>
                                        )}
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-primary">{e.companyName ?? e.company ?? "—"}</p>
                                            <p className="truncate text-xs text-tertiary">
                                                {e.title ?? "—"} · {fmtDate(e.date)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(e)} aria-label="Edit" />
                                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(e.id)} aria-label="Delete" />
                                    </div>
                                </div>

                                {e.applicationId && e.applicationRole && (
                                    <Link
                                        href={`/career/applications/${e.applicationId}`}
                                        className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover"
                                    >
                                        <Briefcase01 aria-hidden="true" className="size-3 shrink-0 text-fg-quaternary" />
                                        <span className="truncate">{e.applicationRole}</span>
                                        {e.applicationStatus && <span className="shrink-0 text-tertiary">· {e.applicationStatus}</span>}
                                    </Link>
                                )}

                                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-secondary pt-3 text-sm">
                                    <div className="flex items-center justify-between">
                                        <dt className="text-tertiary">Base</dt>
                                        <dd className="text-secondary">{money(e.baseSalary, e.currency)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <dt className="text-tertiary">Bonus</dt>
                                        <dd className="text-secondary">{money(e.bonus, e.currency)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <dt className="text-tertiary">Equity</dt>
                                        <dd className="text-secondary">{money(e.equity, e.currency)}</dd>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <dt className="text-tertiary">Total</dt>
                                        <dd className="font-medium text-primary">{money(e.totalComp, e.currency)}</dd>
                                    </div>
                                </dl>
                            </CardBody>
                        </Card>
                    ))
                )}
            </div>

            {/* sm and up: full table, no min-width / horizontal scroll. */}
            <Card className="hidden p-0 sm:block">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-tertiary">
                                <th className="px-5 py-3 font-medium">Date</th>
                                <th className="px-5 py-3 font-medium">Company</th>
                                <th className="hidden px-5 py-3 font-medium lg:table-cell">Application</th>
                                <th className="hidden px-5 py-3 font-medium md:table-cell">Title</th>
                                <th className="px-5 py-3 font-medium">Base</th>
                                <th className="hidden px-5 py-3 font-medium lg:table-cell">Bonus</th>
                                <th className="hidden px-5 py-3 font-medium lg:table-cell">Equity</th>
                                <th className="px-5 py-3 font-medium">Total</th>
                                <th className="px-5 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {entries.length === 0 && (
                                <tr>
                                    <td colSpan={9}>
                                        <EmptyState
                                            icon={Coins01}
                                            title="Track your compensation"
                                            action={
                                                <Button iconLeading={Plus} onClick={openCreate}>
                                                    Add your first entry
                                                </Button>
                                            }
                                        >
                                            Log base, bonus, and equity over time to see your total comp grow and benchmark every new offer.
                                        </EmptyState>
                                    </td>
                                </tr>
                            )}
                            {entries.map((e) => (
                                <tr key={e.id} className="border-b border-secondary last:border-0">
                                    <td className="px-5 py-3 text-tertiary">{fmtDate(e.date)}</td>
                                    <td className="px-5 py-3 text-secondary">
                                        {e.companyName ? (
                                            <span className="flex items-center gap-2">
                                                <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded bg-primary p-0.5 ring-1 ring-secondary">
                                                    <CompanyLogo src={e.companyLogo} alt={e.companyName} name={e.companyName} className="size-full object-contain" iconClassName="text-[0.5rem]" />
                                                </span>
                                                <span className="truncate">{e.companyName}</span>
                                            </span>
                                        ) : (
                                            // Legacy free-text company value (rows that predate the relation).
                                            (e.company ?? "—")
                                        )}
                                    </td>
                                    <td className="hidden px-5 py-3 lg:table-cell">
                                        {e.applicationId && e.applicationRole ? (
                                            <Link
                                                href={`/career/applications/${e.applicationId}`}
                                                className="inline-flex max-w-[200px] items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover"
                                            >
                                                <Briefcase01 aria-hidden="true" className="size-3 shrink-0 text-fg-quaternary" />
                                                <span className="truncate">{e.applicationRole}</span>
                                                {e.applicationStatus && <span className="shrink-0 text-tertiary">· {e.applicationStatus}</span>}
                                            </Link>
                                        ) : (
                                            <span className="text-tertiary">—</span>
                                        )}
                                    </td>
                                    <td className="hidden px-5 py-3 text-secondary md:table-cell">{e.title ?? "—"}</td>
                                    <td className="px-5 py-3 text-tertiary">{money(e.baseSalary, e.currency)}</td>
                                    <td className="hidden px-5 py-3 text-tertiary lg:table-cell">{money(e.bonus, e.currency)}</td>
                                    <td className="hidden px-5 py-3 text-tertiary lg:table-cell">{money(e.equity, e.currency)}</td>
                                    <td className="px-5 py-3 font-medium text-primary">{money(e.totalComp, e.currency)}</td>
                                    <td className="px-5 py-3">
                                        <div className="flex justify-end gap-1">
                                            <Button size="sm" color="tertiary" iconLeading={Edit01} onClick={() => openEdit(e)} aria-label="Edit" />
                                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} onClick={() => onDelete(e.id)} aria-label="Delete" />
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <FormModal isOpen={open} onOpenChange={setOpen} title={editing ? "Edit entry" : "Add compensation entry"}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    {editing && <input type="hidden" name="id" value={editing.id} />}
                    {/* Hidden inputs carry the selected ids to the server action. */}
                    <input type="hidden" name="companyId" value={companyId} />
                    <input type="hidden" name="applicationId" value={applicationId} />
                    {/* Preserve the legacy free-text company value on edit so it isn't lost. */}
                    {editing?.company && !editing.companyId && <input type="hidden" name="company" value={editing.company} />}
                    <div className="grid grid-cols-2 gap-4">
                        <DateInput label="Date" name="date" id="date" isRequired defaultValue={toDateInput(editing?.date ?? new Date().toISOString())} />
                        <TextInput label="Currency" name="currency" id="currency" defaultValue={editing?.currency ?? "USD"} />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Select
                            label="Company"
                            icon={Building07}
                            placeholder={companies.length ? "Select a company" : "No companies yet"}
                            selectedKey={companyId || null}
                            onSelectionChange={(key) => {
                                setCompanyId(key ? String(key) : "");
                                setApplicationId(""); // reset application when company changes
                            }}
                            items={companies.map((c) => ({ id: c.id, label: c.name }))}
                        >
                            {(item) => <Select.Item id={item.id}>{item.label}</Select.Item>}
                        </Select>
                        {editing?.company && !editing.companyId && (
                            <p className="text-xs text-tertiary">Previously recorded as “{editing.company}”. Selecting a company links this entry.</p>
                        )}
                    </div>

                    <Select
                        label="Application (optional)"
                        icon={Briefcase01}
                        placeholder={!companyId ? "Select a company first" : applicationOptions.length ? "Link an application" : "No applications for this company"}
                        isDisabled={!companyId || applicationOptions.length === 0}
                        selectedKey={applicationId || null}
                        onSelectionChange={(key) => setApplicationId(key ? String(key) : "")}
                        items={applicationOptions.map((a) => ({ id: a.id, label: a.role, supportingText: a.status }))}
                    >
                        {(item) => (
                            <Select.Item id={item.id} supportingText={item.supportingText}>
                                {item.label}
                            </Select.Item>
                        )}
                    </Select>

                    <TextInput label="Title" name="title" id="title" defaultValue={editing?.title ?? ""} />
                    <div className="grid grid-cols-3 gap-4">
                        <TextInput label="Base" name="baseSalary" id="baseSalary" type="number" step="any" min={0} defaultValue={editing?.baseSalary ?? 0} />
                        <TextInput label="Bonus" name="bonus" id="bonus" type="number" step="any" min={0} defaultValue={editing?.bonus ?? 0} />
                        <TextInput label="Equity" name="equity" id="equity" type="number" step="any" min={0} defaultValue={editing?.equity ?? 0} />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit">{editing ? "Save" : "Add"}</Button>
                    </div>
                </form>
            </FormModal>
        </div>
    );
}
