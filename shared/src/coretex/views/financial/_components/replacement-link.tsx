// @ts-nocheck
import { useState } from "react";
import { LinkBroken01, Repeat01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Card, Field, NativeSelect, SectionHeader } from "./financial-ui";
import { FormModal } from "./form-modal";

export interface ReplacementOption {
    id: string;
    label: string;
}

interface Props {
    /** The current entity id. */
    id: string;
    kind: "account" | "card";
    /** Currently linked "replaced by" target, if any. */
    replacedBy: ReplacementOption | null;
    /** Entities that this one "replaces" (incoming links). */
    replaces: ReplacementOption[];
    /** Other entities of the same kind that can be selected as the replacement. */
    options: ReplacementOption[];
    /** Server action setting the replacedById link (account or card variant). */
    setReplacedBy: (fd: FormData) => Promise<void>;
}

/**
 * Replacement-chain control + badges for an account/card detail page. Lets the
 * user mark this entity as "replaced by" another, shows chain badges
 * ("Replaced by X" / "Replaces Y"), and optionally archives the replaced one.
 */
export function ReplacementLink({ id, kind, replacedBy, replaces, options, setReplacedBy }: Props) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const noun = kind === "account" ? "account" : "card";

    async function onSubmit(fd: FormData) {
        fd.set("id", id);
        setSaving(true);
        try {
            await setReplacedBy(fd);
            toast.success("Replacement updated");
            setOpen(false);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setSaving(false);
        }
    }
    async function onClear() {
        const fd = new FormData();
        fd.set("id", id);
        fd.set("replacedById", "");
        try {
            await setReplacedBy(fd);
            toast.success("Link removed");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed");
        }
    }

    return (
        <Card className="flex flex-col gap-3">
            <SectionHeader
                title="Replacement chain"
                description={`Mark this ${noun} as replaced by a re-issued ${noun} to keep its history linked.`}
                action={
                    <Button size="sm" color="secondary" iconLeading={Repeat01} onClick={() => setOpen(true)} isDisabled={options.length === 0}>
                        {replacedBy ? "Change" : "Set replacement"}
                    </Button>
                }
            />
            <div className="flex flex-wrap items-center gap-2">
                {replacedBy ? (
                    <span className="inline-flex items-center gap-2">
                        <Badge size="sm" color="brand">
                            Replaced by {replacedBy.label}
                        </Badge>
                        <Button size="sm" color="link-gray" iconLeading={LinkBroken01} onClick={onClear}>
                            Unlink
                        </Button>
                    </span>
                ) : (
                    <span className="text-sm text-tertiary">Not linked.</span>
                )}
                {replaces.map((r) => (
                    <Badge key={r.id} size="sm" color="gray">
                        Replaces {r.label}
                    </Badge>
                ))}
            </div>

            <FormModal isOpen={open} onOpenChange={setOpen} title={`Replace this ${noun}`}>
                <form action={onSubmit} className="flex flex-col gap-4">
                    <Field label={`Replaced by ${noun}`} htmlFor="replacedById">
                        <NativeSelect id="replacedById" name="replacedById" defaultValue={replacedBy?.id ?? ""}>
                            <option value="">— none —</option>
                            {options.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.label}
                                </option>
                            ))}
                        </NativeSelect>
                    </Field>
                    <Checkbox name="archiveReplaced" label={`Archive this ${noun} once linked`} />
                    <div className="flex justify-end gap-2 pt-2">
                        <Button color="secondary" type="button" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" isLoading={saving}>
                            Save
                        </Button>
                    </div>
                </form>
            </FormModal>
        </Card>
    );
}
