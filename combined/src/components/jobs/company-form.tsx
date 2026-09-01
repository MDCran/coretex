"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { FileUpload } from "@/components/application/file-upload/file-upload-base";
import { Card, CardBody } from "@/components/jobs/card";
import { TextInput, TextareaInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";

export type CompanyDefaults = Partial<{
    name: string | null;
    websiteDomain: string | null;
    linkedinUrl: string | null;
    hqLocation: string | null;
    officeLocations: string[];
    industry: string | null;
    size: string | null;
    hasLogo: boolean;
}>;

const SAFE_LOGO_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_LOGO_ACCEPT = Array.from(SAFE_LOGO_TYPES).join(",");
const MAX_LOGO_SIZE = 25 * 1024 * 1024;

/**
 * Strip protocol, path, www, and subdomains from a raw URL/domain input
 * so LogoKit gets the apex domain (e.g. careers.nothing.tech → nothing.tech).
 */
function cleanDomain(raw: string): string {
    const value = raw.trim();
    if (!value) return "";

    let host: string;
    try {
        const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
        host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
        return "";
    }

    if (host.length > 253 || !host.includes(".")) return "";
    if (!host.split(".").every((label) => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return "";

    const parts = host.split(".");
    if (parts.length <= 2) return host;

    // Preserve country-code + SLD combos like co.uk, com.au (tld is 2 chars, sld is ≤3 chars)
    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];
    if (tld.length === 2 && sld.length <= 3) return parts.slice(-3).join(".");
    return parts.slice(-2).join(".");
}

function LogoPreview({
    name,
    domain,
    file,
    onStatus,
}: {
    name: string;
    domain: string;
    file: File | null;
    onStatus?: (hasLogo: boolean) => void;
}) {
    const [logoKitFailed, setLogoKitFailed] = useState(false);
    const [debouncedDomain, setDebouncedDomain] = useState(domain);
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const onStatusRef = useRef(onStatus);
    useEffect(() => { onStatusRef.current = onStatus; });

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedDomain(domain), 400);
        return () => clearTimeout(handle);
    }, [domain]);

    useEffect(() => setLogoKitFailed(false), [debouncedDomain]);

    useEffect(() => {
        if (!file) { setObjectUrl(null); return; }
        if (!SAFE_LOGO_TYPES.has(file.type.toLowerCase())) { setObjectUrl(null); return; }
        const url = encodeURI(URL.createObjectURL(file));
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    const cleaned = cleanDomain(debouncedDomain);
    const logoKitSrc = cleaned ? `https://img.logokit.com/${encodeURIComponent(cleaned)}` : null;
    const previewSrc = objectUrl ?? (logoKitFailed ? null : logoKitSrc);

    const hasLogo = !!previewSrc;
    useEffect(() => { onStatusRef.current?.(hasLogo); }, [hasLogo]);

    const caption = objectUrl
        ? "Using uploaded logo"
        : previewSrc
          ? "Logo auto-fetched from domain"
          : cleaned
            ? "No logo found for this domain"
            : "Enter a website domain to auto-fetch a logo";

    return (
        <div className="flex items-center gap-3">
            <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary p-1.5 ring-1 ring-secondary">
                {previewSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={previewSrc}
                        alt={`${name || "Company"} logo`}
                        className="size-full object-contain"
                        onError={() => { if (!objectUrl) setLogoKitFailed(true); }}
                    />
                ) : (
                    <span aria-hidden="true" className="block size-full rounded-[inherit] bg-black" />
                )}
            </span>
            <p className="text-sm text-tertiary">{caption}</p>
        </div>
    );
}

export function CompanyForm({
    action,
    defaults = {},
    submitLabel,
    cancelHref,
}: {
    action: (formData: FormData) => void | Promise<void>;
    defaults?: CompanyDefaults;
    submitLabel: string;
    cancelHref?: string;
}) {
    const [name, setName] = useState(defaults.name ?? "");
    const [domain, setDomain] = useState(defaults.websiteDomain ?? "");
    const [file, setFile] = useState<File | null>(null);
    const [removeLogo, setRemoveLogo] = useState(false);
    const [logoFound, setLogoFound] = useState(defaults.hasLogo ?? false);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const setSelectedFile = (next: File | null) => {
        const safeNext = next && next.size <= MAX_LOGO_SIZE && SAFE_LOGO_TYPES.has(next.type.toLowerCase()) ? next : null;
        setFile(safeNext);
        if (fileInputRef.current) {
            const dt = new DataTransfer();
            if (safeNext) dt.items.add(safeNext);
            fileInputRef.current.files = dt.files;
        }
    };

    // Derived: does the user have any logo right now (uploaded file or auto-fetched)?
    const hasAnyLogo = !!file || logoFound;
    // Show the upload zone prominently when there's no logo yet but a domain was entered.
    const noLogoWithDomain = !hasAnyLogo && cleanDomain(domain).length > 0;

    return (
        <form action={action} className="flex flex-col gap-6">
            <Card>
                <CardBody className="grid gap-5 sm:grid-cols-2">
                    <TextInput
                        name="name"
                        label="Company name"
                        isRequired
                        defaultValue={defaults.name ?? ""}
                        onChange={(e) => setName(e.target.value)}
                        fieldClassName="sm:col-span-2"
                    />
                    <TextInput
                        name="websiteDomain"
                        label="Website"
                        defaultValue={defaults.websiteDomain ?? ""}
                        onChange={(e) => setDomain(e.target.value)}
                        placeholder="https://acme.com"
                        hint="Used to auto-fetch a logo"
                    />
                    <TextInput name="linkedinUrl" label="LinkedIn URL" type="url" defaultValue={defaults.linkedinUrl ?? ""} placeholder="https://linkedin.com/company/…" />
                    <TextInput name="industry" label="Industry" defaultValue={defaults.industry ?? ""} placeholder="Software" />
                    <TextInput name="size" label="Company size" defaultValue={defaults.size ?? ""} placeholder="500–1,000" />
                    <TextInput name="hqLocation" label="Headquarters" defaultValue={defaults.hqLocation ?? ""} placeholder="New York, NY" />
                    <TextareaInput
                        name="officeLocations"
                        label="Office locations"
                        rows={2}
                        defaultValue={defaults.officeLocations?.join(", ") ?? ""}
                        placeholder="Comma or newline separated"
                    />

                    <div className="flex flex-col gap-3 sm:col-span-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-secondary">
                                Logo{defaults.hasLogo && !removeLogo ? " (replace)" : ""}
                            </span>
                            {noLogoWithDomain && (
                                <span className="text-xs font-medium text-warning-primary">
                                    No logo found — upload one below
                                </span>
                            )}
                        </div>

                        <LogoPreview name={name} domain={domain} file={file} onStatus={setLogoFound} />

                        <input type="hidden" name="removeLogo" value={removeLogo ? "on" : ""} />
                        {defaults.hasLogo && !file && (
                            <div className="flex items-center gap-3">
                                {removeLogo ? (
                                    <>
                                        <span className="text-sm text-tertiary">Uploaded logo will be removed.</span>
                                        <Button size="sm" color="link-color" type="button" onClick={() => setRemoveLogo(false)}>
                                            Undo
                                        </Button>
                                    </>
                                ) : (
                                    <Button size="sm" color="secondary" type="button" onClick={() => setRemoveLogo(true)}>
                                        Remove uploaded logo, use domain instead
                                    </Button>
                                )}
                            </div>
                        )}

                        <FileUpload.Root>
                            <FileUpload.DropZone
                                accept={SAFE_LOGO_ACCEPT}
                                allowsMultiple={false}
                                maxSize={MAX_LOGO_SIZE}
                                hint={
                                    hasAnyLogo && !file
                                        ? "PNG, JPG, GIF, WebP or AVIF — overrides the auto-fetched logo"
                                        : "PNG, JPG, GIF, WebP or AVIF"
                                }
                                onDropFiles={(files) => setSelectedFile(files[0] ?? null)}
                            />
                            {file && (
                                <FileUpload.List>
                                    <FileUpload.ListItemProgressBar
                                        name={file.name}
                                        size={file.size}
                                        progress={100}
                                        type="img"
                                        onDelete={() => setSelectedFile(null)}
                                    />
                                </FileUpload.List>
                            )}
                        </FileUpload.Root>

                        <input ref={fileInputRef} type="file" name="logo" accept={SAFE_LOGO_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" />
                    </div>
                </CardBody>
            </Card>

            <div className="flex justify-end gap-3">
                {cancelHref && (
                    <Button href={cancelHref} color="secondary">
                        Cancel
                    </Button>
                )}
                <SubmitButton color="primary">{submitLabel}</SubmitButton>
            </div>
        </form>
    );
}
