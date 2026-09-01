// @ts-nocheck

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { InputBase } from "@/components/base/input/input";
import { Card, CardBody, CardHeader } from "@/components/social/ui";
import { TextInput, SelectInput, TextareaInput, DateInput } from "@/components/jobs/fields";
import { SubmitButton } from "@/components/jobs/submit-button";
import { AvatarUpload } from "@/components/social/avatar-upload";
import { cx } from "@/utils/cx";
import {
    RELATIONSHIP_LABELS,
    COMMUNICATION_FREQUENCY_LABELS,
    CONTACT_METHOD_LABELS,
    toOptions,
} from "./enums";
import { toDateInput } from "./format";

type TagOption = { id: string; name: string; color: string | null };

export type ContactDefaults = Partial<{
    displayName: string | null;
    firstName: string | null;
    lastName: string | null;
    nickname: string | null;
    relationshipType: string | null;
    howWeMet: string | null;
    birthday: Date | string | null;
    occupation: string | null;
    companyOrSchool: string | null;
    hometown: string | null;
    timezone: string | null;
    pronouns: string | null;
    interests: string | null;
    notes: string | null;
    closenessScore: number | null;
    trustScore: number | null;
    communicationFrequency: string | null;
    energyTags: string[];
    innerCircle: boolean;
    stayInTouch: boolean;
    stayInTouchDays: number | null;
    preferredContactMethod: string | null;
    active: boolean;
    avatarUrl: string | null;
}>;

export function ContactForm({
    action,
    defaults = {},
    submitLabel,
    cancelHref,
    tags,
    selectedTagIds = [],
    createTagAction,
}: {
    action: (formData: FormData) => void | Promise<void>;
    defaults?: ContactDefaults;
    submitLabel: string;
    cancelHref?: string;
    tags?: TagOption[];
    selectedTagIds?: string[];
    /** Optional: create a new tag inline and return the created row. */
    createTagAction?: (formData: FormData) => Promise<{ id: string; name: string; color: string | null }>;
}) {
    const [innerCircle, setInnerCircle] = useState(defaults.innerCircle ?? false);
    const [stayInTouch, setStayInTouch] = useState(defaults.stayInTouch ?? false);
    const [archived, setArchived] = useState(defaults.active === false);
    const [selected, setSelected] = useState<Set<string>>(new Set(selectedTagIds));
    const [tagList, setTagList] = useState<TagOption[]>(tags ?? []);
    const [newTag, setNewTag] = useState("");
    const [creating, setCreating] = useState(false);

    function toggleTag(id: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    async function createTag() {
        const name = newTag.trim();
        if (!name || !createTagAction) return;
        setCreating(true);
        try {
            const fd = new FormData();
            fd.set("name", name);
            fd.set("color", "brand");
            const created = await createTagAction(fd);
            setTagList((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
            setSelected((prev) => new Set(prev).add(created.id));
            setNewTag("");
            toast.success("Tag created");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create tag");
        } finally {
            setCreating(false);
        }
    }

    return (
        <form action={action} className="flex flex-col gap-6">
            <Card>
                <CardHeader title="Basics" />
                <CardBody className="flex flex-col gap-5">
                    <AvatarUpload currentUrl={defaults.avatarUrl} alt={defaults.displayName ?? ""} />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <TextInput name="displayName" label="Display name" isRequired defaultValue={defaults.displayName ?? ""} />
                        <TextInput name="nickname" label="Nickname" defaultValue={defaults.nickname ?? ""} />
                        <TextInput name="firstName" label="First name" defaultValue={defaults.firstName ?? ""} />
                        <TextInput name="lastName" label="Last name" defaultValue={defaults.lastName ?? ""} />
                        <SelectInput
                            name="relationshipType"
                            label="Relationship"
                            placeholder="—"
                            defaultValue={defaults.relationshipType ?? ""}
                            options={toOptions(RELATIONSHIP_LABELS)}
                        />
                        <TextInput name="pronouns" label="Pronouns" defaultValue={defaults.pronouns ?? ""} placeholder="they/them" />
                        <DateInput name="birthday" label="Birthday" defaultValue={toDateInput(defaults.birthday)} />
                        <TextInput name="howWeMet" label="How we met" defaultValue={defaults.howWeMet ?? ""} />
                    </div>
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Background" />
                <CardBody className="grid gap-5 sm:grid-cols-2">
                    <TextInput name="occupation" label="Occupation" defaultValue={defaults.occupation ?? ""} />
                    <TextInput name="companyOrSchool" label="Company / school" defaultValue={defaults.companyOrSchool ?? ""} />
                    <TextInput name="hometown" label="Hometown" defaultValue={defaults.hometown ?? ""} />
                    <TextInput name="timezone" label="Timezone" defaultValue={defaults.timezone ?? ""} placeholder="America/New_York" />
                    <TextInput name="interests" label="Interests" fieldClassName="sm:col-span-2" defaultValue={defaults.interests ?? ""} placeholder="Hiking, jazz, board games" />
                </CardBody>
            </Card>

            <Card>
                <CardHeader title="Relationship details" />
                <CardBody className="flex flex-col gap-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                        <TextInput name="closenessScore" label="Closeness (1–10)" type="number" min={1} max={10} defaultValue={defaults.closenessScore ?? ""} />
                        <TextInput name="trustScore" label="Trust (1–10)" type="number" min={1} max={10} defaultValue={defaults.trustScore ?? ""} />
                        <SelectInput
                            name="communicationFrequency"
                            label="Communication frequency"
                            placeholder="—"
                            defaultValue={defaults.communicationFrequency ?? ""}
                            options={toOptions(COMMUNICATION_FREQUENCY_LABELS)}
                        />
                        <SelectInput
                            name="preferredContactMethod"
                            label="Preferred contact method"
                            placeholder="—"
                            defaultValue={defaults.preferredContactMethod ?? ""}
                            options={toOptions(CONTACT_METHOD_LABELS)}
                        />
                        <TextInput
                            name="energyTags"
                            label="Energy tags"
                            fieldClassName="sm:col-span-2"
                            defaultValue={(defaults.energyTags ?? []).join(", ")}
                            placeholder="energizing, supportive (comma separated)"
                        />
                    </div>

                    <div className="flex flex-col gap-4 border-t border-secondary pt-5">
                        <label className="flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-secondary">Inner circle</span>
                            <Toggle isSelected={innerCircle} onChange={setInnerCircle} />
                        </label>
                        <input type="hidden" name="innerCircle" value={innerCircle ? "on" : ""} />

                        <label className="flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-secondary">Stay in touch</span>
                            <Toggle isSelected={stayInTouch} onChange={setStayInTouch} />
                        </label>
                        <input type="hidden" name="stayInTouch" value={stayInTouch ? "on" : ""} />
                        {stayInTouch && (
                            <TextInput
                                name="stayInTouchDays"
                                label="Reach out every (days)"
                                type="number"
                                min={1}
                                defaultValue={defaults.stayInTouchDays ?? 30}
                                fieldClassName="max-w-xs"
                            />
                        )}

                        <label className="flex items-center justify-between gap-4">
                            <span className="text-sm font-medium text-secondary">Archived (inactive)</span>
                            <Toggle isSelected={archived} onChange={setArchived} />
                        </label>
                        <input type="hidden" name="archived" value={archived ? "on" : ""} />
                    </div>
                </CardBody>
            </Card>

            {tags && (
                <Card>
                    <CardHeader title="Tags" />
                    <CardBody className="flex flex-col gap-4">
                        {tagList.length === 0 ? (
                            <p className="text-sm text-tertiary">No tags yet. Create one below.</p>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {tagList.map((t) => {
                                    const on = selected.has(t.id);
                                    return (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => toggleTag(t.id)}
                                            className={cx(
                                                "rounded-full px-3 py-1 text-sm font-medium ring-1 transition duration-100 ease-linear ring-inset",
                                                on ? "bg-brand-primary text-brand-secondary ring-brand" : "bg-primary text-secondary ring-secondary hover:bg-secondary_hover",
                                            )}
                                        >
                                            {t.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {createTagAction && (
                            <div className="flex items-end gap-2">
                                <div className="w-56">
                                    <InputBase
                                        size="sm"
                                        value={newTag}
                                        onChange={(e) => setNewTag(e.target.value)}
                                        placeholder="New tag name"
                                        aria-label="New tag name"
                                        wrapperClassName="w-full"
                                    />
                                </div>
                                <Button type="button" color="secondary" size="sm" iconLeading={Plus} onClick={createTag} isLoading={creating} isDisabled={!newTag.trim()}>
                                    Add tag
                                </Button>
                            </div>
                        )}
                        {[...selected].map((id) => (
                            <input key={id} type="hidden" name="tagIds" value={id} />
                        ))}
                    </CardBody>
                </Card>
            )}

            <Card>
                <CardHeader title="Notes" />
                <CardBody>
                    <TextareaInput name="notes" rows={4} defaultValue={defaults.notes ?? ""} placeholder="Anything worth remembering…" />
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
