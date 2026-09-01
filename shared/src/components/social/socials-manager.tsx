// @ts-nocheck
import { useState } from "react";
import { toast } from "sonner";
import { Plus, X, Edit01, Trash01, LinkExternal01, Share07 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { TextInput, SelectInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/social/ui";
import { PlatformIcon } from "@/components/social/platform-icon";
import { PLATFORM_PRESETS, platformUrl } from "@/lib/social/platforms";

export type Social = { id: string; platform: string; handle: string };

type Action = (formData: FormData) => Promise<void>;

const platformOptions = PLATFORM_PRESETS.map((p) => ({ value: p, label: p }));

function SocialDialog({
    open,
    onOpenChange,
    social,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    social?: Social;
    onSubmit: (fd: FormData) => Promise<void>;
}) {
    const [platform, setPlatform] = useState(social?.platform ?? "Instagram");
    const isPreset = PLATFORM_PRESETS.includes(platform as never);
    const [custom, setCustom] = useState(!!social && !isPreset);

    async function handle(fd: FormData) {
        // When "Other" or a custom platform is chosen, the customPlatform field wins.
        if (custom || platform === "Other") {
            const c = String(fd.get("customPlatform") ?? "").trim();
            if (c) fd.set("platform", c);
        }
        try {
            await onSubmit(fd);
            toast.success(social ? "Social updated" : "Social added");
            onOpenChange(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        }
    }

    const title = social ? "Edit social" : "Add social";

    return (
        <ModalOverlay isDismissable isOpen={open} onOpenChange={onOpenChange}>
            <Modal className="max-w-md">
                <Dialog aria-label={title}>
                    <div className="w-full rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-5 py-4">
                            <h2 className="text-md font-semibold text-primary">{title}</h2>
                            <Button color="tertiary" size="sm" iconLeading={X} onClick={() => onOpenChange(false)} aria-label="Close" />
                        </div>
                        <form action={handle} className="flex flex-col gap-4 p-5">
                            {social && <input type="hidden" name="id" value={social.id} />}
                            <SelectInput
                                name="platform"
                                label="Platform"
                                options={platformOptions}
                                value={isPreset ? platform : "Other"}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setPlatform(v);
                                    setCustom(v === "Other");
                                }}
                            />
                            {(custom || platform === "Other") && (
                                <TextInput name="customPlatform" label="Custom platform" defaultValue={isPreset ? "" : (social?.platform ?? "")} placeholder="e.g. BeReal" />
                            )}
                            <TextInput name="handle" label="Handle or URL" isRequired defaultValue={social?.handle ?? ""} placeholder="@username or https://…" />
                            <div className="flex justify-end gap-2 pt-1">
                                <Button color="secondary" onClick={() => onOpenChange(false)}>
                                    Cancel
                                </Button>
                                <SubmitButton color="primary">{social ? "Save" : "Add"}</SubmitButton>
                            </div>
                        </form>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

export function SocialsManager({
    socials,
    addAction,
    updateAction,
    deleteAction,
}: {
    socials: Social[];
    addAction: Action;
    updateAction: Action;
    deleteAction: Action;
}) {
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<Social | null>(null);
    const { confirm, dialog } = useConfirm();

    async function remove(s: Social) {
        const fd = new FormData();
        fd.set("id", s.id);
        try {
            await deleteAction(fd);
            toast.success("Social removed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to remove");
        }
    }

    return (
        <Card>
            <CardHeader
                title="Socials"
                action={
                    <Button color="primary" size="sm" iconLeading={Plus} onClick={() => setAdding(true)}>
                        Add social
                    </Button>
                }
            />
            <CardBody>
                {socials.length === 0 ? (
                    <EmptyState
                        icon={Share07}
                        title="No social profiles yet"
                        description="Link Instagram, Discord, GitHub and more so you can reach them on their terms in one tap."
                        action={{ label: "Add a profile", onClick: () => setAdding(true) }}
                    />
                ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                        {socials.map((s) => {
                            const url = platformUrl(s.platform, s.handle);
                            return (
                                <li key={s.id} className="group flex items-center gap-3 rounded-lg p-2 ring-1 ring-secondary ring-inset transition hover:bg-secondary_hover">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-fg-secondary">
                                        <PlatformIcon platform={s.platform} className="size-5" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs text-tertiary">{s.platform}</div>
                                        {url ? (
                                            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 truncate text-sm font-medium text-primary hover:text-brand-secondary">
                                                <span className="truncate">{s.handle}</span>
                                                <LinkExternal01 className="size-3 shrink-0 text-fg-quaternary" aria-hidden="true" />
                                            </a>
                                        ) : (
                                            <span className="truncate text-sm font-medium text-primary">{s.handle}</span>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                                        <Button color="tertiary" size="sm" iconLeading={Edit01} onClick={() => setEditing(s)} aria-label="Edit" />
                                        <Button
                                            color="tertiary-destructive"
                                            size="sm"
                                            iconLeading={Trash01}
                                            aria-label="Remove"
                                            onClick={() => confirm({ title: "Remove social?", confirmLabel: "Remove", onConfirm: () => remove(s) })}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardBody>

            <SocialDialog open={adding} onOpenChange={setAdding} onSubmit={addAction} />
            <SocialDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} social={editing ?? undefined} onSubmit={updateAction} />
            {dialog}
        </Card>
    );
}
