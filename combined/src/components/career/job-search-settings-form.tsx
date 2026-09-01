"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Edit01, Lock01 } from "@untitledui/icons";
import type { JobLevel } from "@prisma/client";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { NativeSelect } from "@/components/base/select/select-native";
import { TextArea } from "@/components/base/textarea/textarea";
import { Toggle } from "@/components/base/toggle/toggle";
import { SubmitButton } from "@/components/jobs/submit-button";
import { JOB_LEVEL_LABELS } from "@/lib/jobs/enums";
import { updateSearchProfile } from "@/lib/actions/job-search";

const LEVEL_CHOICES: JobLevel[] = ["INTERNSHIP", "ENTRY", "JUNIOR", "MID", "SENIOR", "LEAD"];
const DISTANCES = [10, 25, 50, 100, 250];

export interface SearchProfileData {
    profileText: string | null;
    keywords: string[];
    excludeKeywords: string[];
    levels: JobLevel[];
    distanceMiles: number;
    allowRemote: boolean;
    includeNewCompanies: boolean;
    minSalary: number | null;
    autoGhost: boolean;
    ghostAfterDays: number;
    followUpAfterDays: number;
}

export function JobSearchSettingsForm({ profile, aiEnabled = true }: { profile: SearchProfileData; aiEnabled?: boolean }) {
    const [editing, setEditing] = useState(false);
    // Bumping the key remounts the form so unsaved edits are discarded on cancel.
    const [formKey, setFormKey] = useState(0);
    // Locked when not editing OR when AI features are turned off (locked down).
    const locked = !editing || !aiEnabled;

    async function onSubmit(fd: FormData) {
        await updateSearchProfile(fd);
        toast.success("Search settings saved");
        setEditing(false);
    }

    function cancel() {
        setEditing(false);
        setFormKey((k) => k + 1);
    }

    return (
        <form key={formKey} action={onSubmit} className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-tertiary">
                    {!aiEnabled ? (
                        <>
                            <Lock01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                            Locked — AI features are off. Enable them in Settings → AI to edit.
                        </>
                    ) : locked ? (
                        <>
                            <Lock01 className="size-3.5 text-fg-quaternary" aria-hidden="true" />
                            These settings drive every job search. Click edit to change them.
                        </>
                    ) : (
                        "Editing — save when you're done."
                    )}
                </p>
                {locked && aiEnabled && (
                    <Button type="button" size="sm" color="secondary" iconLeading={<Edit01 data-icon className="size-4" />} onClick={() => setEditing(true)}>
                        Edit
                    </Button>
                )}
            </div>

            <TextArea
                name="profileText"
                label="About you"
                rows={3}
                isDisabled={locked}
                defaultValue={profile.profileText ?? ""}
                placeholder="e.g. Computer science graduate (B.S.), strong in React/TypeScript and Python, seeking entry-level software roles."
                hint="Claude uses this to judge how well each role fits you and your qualification level."
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <TextArea
                    name="keywords"
                    label="Target roles / keywords"
                    rows={2}
                    isDisabled={locked}
                    defaultValue={profile.keywords.join(", ")}
                    placeholder="Software Engineer, Frontend, Full Stack, New Grad"
                    hint="Comma or newline separated."
                />
                <TextArea
                    name="excludeKeywords"
                    label="Exclude"
                    rows={2}
                    isDisabled={locked}
                    defaultValue={profile.excludeKeywords.join(", ")}
                    placeholder="Senior, Manager, Clearance required"
                    hint="Roles matching these are skipped."
                />
            </div>

            <fieldset className="flex flex-col gap-2.5">
                <legend className="mb-1 text-sm font-medium text-secondary">Experience levels</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-3">
                    {LEVEL_CHOICES.map((lvl) => (
                        <Checkbox key={lvl} name="levels" value={lvl} isDisabled={locked} defaultSelected={profile.levels.includes(lvl)} label={JOB_LEVEL_LABELS[lvl]} />
                    ))}
                </div>
                <p className="text-xs text-tertiary">Only roles at the levels you’re qualified for are returned. Leave all unchecked to allow any level.</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
                <NativeSelect
                    name="distanceMiles"
                    label="Search radius"
                    disabled={locked}
                    defaultValue={String(profile.distanceMiles)}
                    options={DISTANCES.map((d) => ({ value: String(d), label: `Within ${d} miles` }))}
                />
                <Input
                    name="minSalary"
                    type="number"
                    label="Minimum salary"
                    isDisabled={locked}
                    defaultValue={profile.minSalary != null ? String(profile.minSalary) : ""}
                    placeholder="e.g. 80000"
                />
            </div>

            <div className="flex flex-col gap-3 rounded-lg bg-secondary p-4">
                <Toggle
                    name="allowRemote"
                    isDisabled={locked}
                    defaultSelected={profile.allowRemote}
                    label="Include remote roles"
                    hint="Also search for fully-remote openings in addition to your locations."
                />
                <Toggle
                    name="includeNewCompanies"
                    isDisabled={locked}
                    defaultSelected={profile.includeNewCompanies}
                    label="Suggest new companies"
                    hint="Surface employers you don't track yet as suggested companies. Add one to your Companies — or just add a role from it, and the company is added for you automatically."
                />
                <Toggle
                    name="autoGhost"
                    isDisabled={locked}
                    defaultSelected={profile.autoGhost}
                    label="Auto-flag ghosted applications"
                    hint="Mark silent applications as ghosted automatically once they pass the ghost threshold below."
                />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <Input
                    name="ghostAfterDays"
                    type="number"
                    label="Ghost after (days of silence)"
                    isDisabled={locked}
                    defaultValue={String(profile.ghostAfterDays)}
                />
                <Input
                    name="followUpAfterDays"
                    type="number"
                    label="Follow-up nudge after (days)"
                    isDisabled={locked}
                    defaultValue={String(profile.followUpAfterDays)}
                />
            </div>

            {editing && (
                <div className="flex justify-end gap-3">
                    <Button type="button" color="secondary" onClick={cancel}>
                        Cancel
                    </Button>
                    <SubmitButton color="primary">Save settings</SubmitButton>
                </div>
            )}
        </form>
    );
}
