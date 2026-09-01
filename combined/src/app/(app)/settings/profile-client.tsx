"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ruler, Scales01 } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { Avatar } from "@/components/base/avatar/avatar";
import { FileUploadDropZone } from "@/components/application/file-upload/file-upload-base";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import { TextInput, SelectInput, DateInput } from "@/components/jobs/fields";
import { toDateInput } from "@/lib/jobs/format";
import { updateProfile, updateUnitSystem } from "@/lib/actions/settings";
import { heightToDisplay, heightUnit, parseHeightInput } from "@/lib/units";
import { cx } from "@/utils/cx";

const UNIT_OPTIONS = [
    { id: "IMPERIAL", label: "Imperial", hint: "lb · ft/in · fl oz", icon: Ruler },
    { id: "METRIC", label: "Metric", hint: "kg · cm · ml", icon: Scales01 },
] as const;

function UnitSystemControl({ initial }: { initial: "METRIC" | "IMPERIAL" }) {
    const router = useRouter();
    const [value, setValue] = useState<"METRIC" | "IMPERIAL">(initial);
    const [pending, startTransition] = useTransition();

    function choose(next: "METRIC" | "IMPERIAL") {
        if (next === value) return;
        const prev = value;
        setValue(next);
        startTransition(async () => {
            try {
                await updateUnitSystem(next);
                toast.success(`Switched to ${next === "METRIC" ? "metric" : "imperial"} units`);
                router.refresh();
            } catch (e) {
                setValue(prev);
                toast.error(e instanceof Error ? e.message : "Couldn't update units");
            }
        });
    }

    return (
        <SettingsCard bloom="blue">
            <SettingsHeading
                title="Units & measurements"
                description="Applies everywhere — weight, height, distance, water and volume across every area of LifeOS."
            />
            <div className="mt-5 flex flex-col gap-3">
                <div role="radiogroup" aria-label="Unit system" className="grid max-w-md grid-cols-2 gap-2">
                    {UNIT_OPTIONS.map(({ id, label, hint, icon: Icon }) => {
                        const active = value === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                disabled={pending}
                                onClick={() => choose(id)}
                                className={cx(
                                    "flex items-center gap-3 rounded-xl p-3 text-left ring-1 ring-inset transition duration-100 ease-linear disabled:opacity-60",
                                    active ? "bg-brand-primary ring-brand" : "bg-primary ring-secondary hover:bg-secondary_hover",
                                )}
                            >
                                <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset", active ? "bg-brand-solid text-white ring-transparent" : "bg-secondary_subtle text-fg-quaternary ring-secondary")}>
                                    <Icon className="size-5" aria-hidden="true" />
                                </span>
                                <span className="min-w-0">
                                    <span className={cx("block text-sm font-semibold", active ? "text-brand-secondary" : "text-primary")}>{label}</span>
                                    <span className="block text-xs text-tertiary">{hint}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </SettingsCard>
    );
}

interface Props {
    user: { name: string | null; email: string; username: string | null; avatarUrl: string | null };
    profile: { gender: string | null; birthdate: string | null; heightCm: number | null; phone: string | null };
    unitSystem: "METRIC" | "IMPERIAL";
}

const GENDER_OPTIONS = [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
    { value: "other", label: "Other" },
    { value: "prefer_not", label: "Prefer not to say" },
];

const SAFE_AVATAR_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const SAFE_AVATAR_ACCEPT = Array.from(SAFE_AVATAR_TYPES).join(",");
const MAX_AVATAR_SIZE = 25 * 1024 * 1024;

export function ProfileClient({ user, profile, unitSystem }: Props) {
    const [pending, setPending] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const pickerRef = useRef<HTMLInputElement>(null);
    const [preview, setPreview] = useState<string | null>(user.avatarUrl);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => () => {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    }, []);

    // Height is stored in cm; shown/entered in the chosen unit via shared helpers.
    const heightDisplay = profile.heightCm == null ? "" : String(heightToDisplay(profile.heightCm, unitSystem));

    async function onSubmit(fd: FormData) {
        // Convert the display-unit height back to cm for storage.
        const raw = fd.get("heightDisplay");
        const v = typeof raw === "string" ? raw.trim() : "";
        if (v !== "") {
            const cm = parseHeightInput(v, unitSystem);
            if (cm != null) fd.set("heightCm", String(cm));
        }
        fd.delete("heightDisplay");

        setPending(true);
        try {
            await updateProfile(fd);
            toast.success("Profile saved");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setPending(false);
        }
    }

    function onPickFile(file: File | undefined) {
        if (!file) return;
        if (file.size === 0 || file.size > MAX_AVATAR_SIZE) {
            toast.error(file.size === 0 ? "Choose a non-empty image." : "Profile photo must be 25 MB or smaller.");
            return;
        }
        if (!SAFE_AVATAR_TYPES.has(file.type.toLowerCase())) {
            toast.error("Choose an AVIF, GIF, JPEG, PNG, or WebP image.");
            return;
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        if (fileRef.current) fileRef.current.files = dataTransfer.files;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const previewUrl = encodeURI(URL.createObjectURL(file));
        objectUrlRef.current = previewUrl;
        setPreview(previewUrl);
    }

    return (
        <div className="flex flex-col gap-6">
            <UnitSystemControl initial={unitSystem} />
            <form action={onSubmit} className="flex flex-col gap-6">
            <SettingsCard bloom="blue">
                <SettingsHeading title="Profile photo" description="Used across LifeOS wherever your account appears." />
                <div className="mt-5 flex items-center gap-5">
                    <button
                        type="button"
                        aria-label="Upload profile photo"
                        onClick={() => pickerRef.current?.click()}
                        className="group shrink-0 cursor-pointer rounded-full ring-secondary transition duration-100 ease-linear hover:ring-2 hover:ring-brand"
                    >
                        <Avatar size="2xl" src={preview ?? undefined} initials={(user.name ?? user.email).slice(0, 2).toUpperCase()} alt={user.name ?? user.email} />
                    </button>
                    <FileUploadDropZone
                        className="flex-1"
                        accept={SAFE_AVATAR_ACCEPT}
                        allowsMultiple={false}
                        maxSize={MAX_AVATAR_SIZE}
                        hint="PNG or JPG, up to 25 MB."
                        onDropFiles={(files) => onPickFile(files[0])}
                        onSizeLimitExceed={() => toast.error("Profile photo must be 25 MB or smaller.")}
                    />
                    {/* The clickable avatar mirrors its selection into the form carrier input below. */}
                    <input
                        ref={pickerRef}
                        type="file"
                        accept={SAFE_AVATAR_ACCEPT}
                        className="sr-only"
                        tabIndex={-1}
                        aria-hidden="true"
                        onChange={(e) => {
                            onPickFile(e.target.files?.[0]);
                            e.currentTarget.value = "";
                        }}
                    />
                    <input ref={fileRef} type="file" name="avatar" accept={SAFE_AVATAR_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" />
                </div>
            </SettingsCard>

            <SettingsCard bloom="blue">
                <SettingsHeading title="Personal details" description="Your basic account and body metrics." />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <TextInput label="Name" name="name" id="name" defaultValue={user.name ?? ""} />
                    <TextInput label="Email" name="email" id="email" type="email" isRequired defaultValue={user.email} />
                    <TextInput label="Username" name="username" id="username" defaultValue={user.username ?? ""} placeholder="optional" />
                    <TextInput label="Phone" name="phone" id="phone" type="tel" defaultValue={profile.phone ?? ""} />
                    <SelectInput label="Gender" name="gender" id="gender" placeholder="Select" options={GENDER_OPTIONS} defaultValue={profile.gender ?? ""} />
                    <DateInput label="Birthdate" name="birthdate" id="birthdate" defaultValue={toDateInput(profile.birthdate)} />
                    <TextInput
                        label={`Height (${heightUnit(unitSystem)})`}
                        name="heightDisplay"
                        id="heightDisplay"
                        type="number"
                        step="any"
                        min={0}
                        defaultValue={heightDisplay}
                    />
                </div>
            </SettingsCard>

            <div className="flex justify-end">
                <Button type="submit" isLoading={pending} showTextWhileLoading>
                    Save changes
                </Button>
            </div>
            </form>
        </div>
    );
}
