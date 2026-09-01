// @ts-nocheck


import { Button } from "react-aria-components";
import { useEffect, useState, useRef, useMemo } from "react";
import { Upload01, Plus, Trash02 } from "@untitledui/icons";
import { Field, NativeInput, NativeTextarea } from "./financial-ui";
import { InstitutionLogo } from "./institution-logo";

export interface PhoneRow {
    label: string;
    phone: string;
}
export interface EmailRow {
    label: string;
    email: string;
}
export interface PersonRow {
    name: string;
    role: string;
    phone: string;
    email: string;
    notes: string;
}

export interface InstitutionFormValues {
    name: string;
    website: string;
    notes: string;
    logoKey: string | null;
    phones: PhoneRow[];
    emails: EmailRow[];
    people: PersonRow[];
}

const emptyPhone = (): PhoneRow => ({ label: "", phone: "" });
const emptyEmail = (): EmailRow => ({ label: "", email: "" });
const emptyPerson = (): PersonRow => ({ name: "", role: "", phone: "", email: "", notes: "" });
const SAFE_LOGO_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_LOGO_ACCEPT = Array.from(SAFE_LOGO_TYPES).join(",");
const MAX_LOGO_SIZE = 25 * 1024 * 1024;

/**
 * The shared institution create/edit form body (fields only — caller wraps it in a
 * <form action>). Manages repeatable labeled phone/email rows and persons of contact.
 * Emits indexed names like `phones[0].label` that the server action reassembles.
 */
export function InstitutionFormFields({ initial }: { initial?: Partial<InstitutionFormValues> }) {
    const [phones, setPhones] = useState<PhoneRow[]>(initial?.phones?.length ? initial.phones : []);
    const [emails, setEmails] = useState<EmailRow[]>(initial?.emails?.length ? initial.emails : []);
    const [people, setPeople] = useState<PersonRow[]>(initial?.people?.length ? initial.people : []);
    const [logoPreview, setLogoPreview] = useState<string | null>(initial?.logoKey ? fileUrl(initial.logoKey) : null);
    const [website, setWebsite] = useState(initial?.website ?? "");
    const logoInputRef = useRef<HTMLInputElement>(null);
    const logoObjectUrlRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
    }, []);

    const remoteLogo = useMemo(
        () => (!logoPreview && website.trim() ? institutionLogoSrc({ logoKey: null, website, name: initial?.name ?? "Bank" }) : null),
        [logoPreview, website, initial?.name],
    );

    function onLogoPick(file: File | undefined) {
        if (!file || file.size > MAX_LOGO_SIZE || !SAFE_LOGO_TYPES.has(file.type.toLowerCase())) return;
        if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
        const previewUrl = encodeURI(URL.createObjectURL(file));
        logoObjectUrlRef.current = previewUrl;
        setLogoPreview(previewUrl);
        const dt = new DataTransfer();
        dt.items.add(file);
        if (logoInputRef.current) logoInputRef.current.files = dt.files;
    }

    return (
        <div className="flex flex-col gap-4">
            <Field label="Logo" htmlFor="logo-picker">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        id="logo-picker"
                        aria-label="Upload institution logo"
                        onClick={() => {
                            const inp = document.createElement("input");
                            inp.type = "file";
                            inp.accept = SAFE_LOGO_ACCEPT;
                            inp.onchange = (e) => {
                                const f = (e.target as HTMLInputElement).files?.[0];
                                onLogoPick(f);
                            };
                            inp.click();
                        }}
                        className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary ring-1 ring-secondary transition duration-100 ease-linear ring-inset hover:ring-brand"
                    >
                        {logoPreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoPreview} alt="Logo preview" className="size-full object-cover" />
                        ) : remoteLogo ? (
                            <InstitutionLogo src={remoteLogo} name={initial?.name ?? "Institution"} size="md" className="size-12 ring-0" />
                        ) : (
                            <Upload01 className="size-5 text-fg-quaternary" aria-hidden="true" />
                        )}
                    </button>
                    <p className="text-xs text-tertiary">Upload a raster logo up to 25 MB, or enter a website below to pull from LogoKit / favicon.</p>
                    <input ref={logoInputRef} type="file" name="logo" accept={SAFE_LOGO_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" />
                </div>
            </Field>
            <Field label="Name" htmlFor="name">
                <NativeInput id="name" name="name" required defaultValue={initial?.name ?? ""} placeholder="e.g. Chase Bank" />
            </Field>
            <Field label="Website" htmlFor="website">
                <NativeInput id="website" name="website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://wellsfargo.com" />
            </Field>

            {/* Phones */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-secondary">Phone numbers</span>
                    <Button size="sm" color="link-color" iconLeading={Plus} type="button" onClick={() => setPhones((p) => [...p, emptyPhone()])}>
                        Add phone
                    </Button>
                </div>
                {phones.length === 0 && <p className="text-xs text-tertiary">No phone numbers. Add labeled lines like “Fraud dept”, “Local branch”.</p>}
                {phones.map((row, i) => (
                    <div key={i} className="flex items-end gap-2">
                        <div className="w-1/3">
                            <NativeInput name={`phones[${i}].label`} defaultValue={row.label} placeholder="Label" aria-label="Phone label" />
                        </div>
                        <div className="flex-1">
                            <NativeInput name={`phones[${i}].phone`} defaultValue={row.phone} placeholder="(555) 123-4567" aria-label="Phone number" />
                        </div>
                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="button" aria-label="Remove phone" onClick={() => setPhones((p) => p.filter((_, x) => x !== i))} />
                    </div>
                ))}
            </div>

            {/* Emails */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-secondary">Emails</span>
                    <Button size="sm" color="link-color" iconLeading={Plus} type="button" onClick={() => setEmails((e) => [...e, emptyEmail()])}>
                        Add email
                    </Button>
                </div>
                {emails.length === 0 && <p className="text-xs text-tertiary">No emails yet.</p>}
                {emails.map((row, i) => (
                    <div key={i} className="flex items-end gap-2">
                        <div className="w-1/3">
                            <NativeInput name={`emails[${i}].label`} defaultValue={row.label} placeholder="Label" aria-label="Email label" />
                        </div>
                        <div className="flex-1">
                            <NativeInput name={`emails[${i}].email`} type="email" defaultValue={row.email} placeholder="support@bank.com" aria-label="Email address" />
                        </div>
                        <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="button" aria-label="Remove email" onClick={() => setEmails((e) => e.filter((_, x) => x !== i))} />
                    </div>
                ))}
            </div>

            {/* People */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-secondary">Persons of contact</span>
                    <Button size="sm" color="link-color" iconLeading={Plus} type="button" onClick={() => setPeople((p) => [...p, emptyPerson()])}>
                        Add person
                    </Button>
                </div>
                {people.length === 0 && <p className="text-xs text-tertiary">No contacts. Add a branch rep, corporate contact, etc.</p>}
                {people.map((row, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-lg bg-secondary p-3">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium tracking-wide text-quaternary uppercase">Contact {i + 1}</span>
                            <Button size="sm" color="tertiary-destructive" iconLeading={Trash02} type="button" aria-label="Remove person" onClick={() => setPeople((p) => p.filter((_, x) => x !== i))} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <NativeInput name={`people[${i}].name`} defaultValue={row.name} placeholder="Name" aria-label="Contact name" />
                            <NativeInput name={`people[${i}].role`} defaultValue={row.role} placeholder="Role (e.g. Local branch rep)" aria-label="Contact role" />
                            <NativeInput name={`people[${i}].phone`} defaultValue={row.phone} placeholder="Phone" aria-label="Contact phone" />
                            <NativeInput name={`people[${i}].email`} type="email" defaultValue={row.email} placeholder="Email" aria-label="Contact email" />
                        </div>
                        <NativeTextarea name={`people[${i}].notes`} defaultValue={row.notes} placeholder="Notes" aria-label="Contact notes" className="min-h-12" />
                    </div>
                ))}
            </div>

            <Field label="Notes" htmlFor="notes">
                <NativeTextarea id="notes" name="notes" defaultValue={initial?.notes ?? ""} placeholder="General notes about this institution" />
            </Field>
        </div>
    );
}
