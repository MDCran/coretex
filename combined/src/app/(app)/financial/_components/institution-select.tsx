"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Building07, Plus } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Select } from "@/components/base/select/select";
import { quickCreateInstitution } from "@/lib/actions/financial-institutions";
import { institutionLogoSrc } from "@/lib/financial/institution-logos";
import { Field, NativeInput } from "./financial-ui";
import { InstitutionLogo } from "./institution-logo";

export interface InstitutionOption {
    id: string;
    name: string;
    website?: string | null;
    logoKey?: string | null;
}

const NONE_ID = "";

/**
 * Searchable institution picker with logos (LogoKit/favicon/upload), — none —,
 * and inline quick-create (name + optional website).
 */
export function InstitutionSelect({
    institutions,
    defaultValue = "",
}: {
    institutions: InstitutionOption[];
    defaultValue?: string;
}) {
    const [options, setOptions] = useState<InstitutionOption[]>(institutions);
    const [value, setValue] = useState(defaultValue);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [newWebsite, setNewWebsite] = useState("");
    const [busy, setBusy] = useState(false);

    type InstItem = { id: string; label: string; logo: ReturnType<typeof institutionLogoSrc> | null };

    const items: InstItem[] = useMemo(
        () => [
            { id: NONE_ID, label: "— none —", logo: null },
            ...options.map((o) => ({
                id: o.id,
                label: o.name,
                logo: institutionLogoSrc(o),
            })),
        ],
        [options],
    );

    const selected = items.find((i) => i.id === value);
    const logoById = useMemo(() => new Map(items.map((i) => [i.id, i.logo])), [items]);
    const labelById = useMemo(() => new Map(items.map((i) => [i.id, i.label])), [items]);

    async function onCreate() {
        const name = newName.trim();
        if (!name) {
            toast.error("Enter an institution name");
            return;
        }
        setBusy(true);
        try {
            const res = await quickCreateInstitution(name, newWebsite.trim() || undefined);
            const row: InstitutionOption = { id: res.id, name: res.name, website: newWebsite.trim() || null };
            setOptions((o) => (o.some((x) => x.id === res.id) ? o : [...o, row].sort((a, b) => a.name.localeCompare(b.name))));
            setValue(res.id);
            setNewName("");
            setNewWebsite("");
            setCreating(false);
            toast.success("Institution added");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Field label="Institution">
            <input type="hidden" name="institutionId" value={value} />
            <div className="flex flex-col gap-2">
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <Select.ComboBox
                            icon={Building07}
                            placeholder="Search institutions…"
                            shortcut={false}
                            selectedKey={value || null}
                            onSelectionChange={(k) => setValue(k ? String(k) : NONE_ID)}
                            items={items}
                        >
                            {(item) => {
                                const logo = logoById.get(String(item.id));
                                const label = labelById.get(String(item.id)) ?? String(item.id);
                                return (
                                    <Select.Item
                                        id={item.id}
                                        icon={
                                            logo ? (
                                                <span data-icon className="flex items-center justify-center">
                                                    <InstitutionLogo src={logo} name={label} size="sm" />
                                                </span>
                                            ) : undefined
                                        }
                                    >
                                        {label}
                                    </Select.Item>
                                );
                            }}
                        </Select.ComboBox>
                    </div>
                    <Button size="md" color="secondary" iconLeading={Plus} type="button" onClick={() => setCreating((c) => !c)}>
                        New
                    </Button>
                </div>
                {selected && selected.id && selected.logo && (
                    <div className="flex items-center gap-2 rounded-lg bg-secondary_subtle px-3 py-2">
                        <InstitutionLogo src={selected.logo} name={selected.label} size="md" />
                        <span className="text-sm font-medium text-primary">{selected.label}</span>
                    </div>
                )}
                {creating && (
                    <div className="flex flex-col gap-2 rounded-lg bg-secondary p-3 ring-1 ring-secondary ring-inset">
                        <NativeInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Institution name" aria-label="New institution name" />
                        <NativeInput value={newWebsite} onChange={(e) => setNewWebsite(e.target.value)} placeholder="Website (optional, for LogoKit)" aria-label="Institution website" />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" type="button" onClick={onCreate} isLoading={busy}>
                                Add institution
                            </Button>
                            <Link href="/financial/institutions" className="text-xs font-medium text-brand-secondary hover:underline">
                                Full institution form →
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </Field>
    );
}
