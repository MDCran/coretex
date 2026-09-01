"use client";

// Coretex settings — local identity and connected services that work in this build.
import { type ReactNode, useEffect, useState } from "react";
import type { APIKey, CoretexConfig } from "@repo/coretex/types";
import { Edit01, GitBranch01, Trash01, User01 } from "@untitledui/icons";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import type { NavTarget } from "../../nav";
import { HelpTooltip } from "../../ui/help-tooltip";
import type { CoretexActions, CoretexState } from "../../use-coretex";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";

interface AccountPageProps {
    settings: CoretexConfig;
    state: CoretexState;
    actions: CoretexActions;
    onNavigate?: (target: NavTarget) => void;
}

export const AccountPage = ({ settings, state, actions, onNavigate }: AccountPageProps) => {
    const [editingProfile, setEditingProfile] = useState(false);
    const [githubToken, setGithubToken] = useState("");
    const disconnectConfirmation = useConfirm();
    const githubKey = state.keyvault?.keys.find((key) => key.serviceId === "github" && !key.projectId);

    useEffect(() => {
        actions.keyvaultGet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const connectGithub = (): void => {
        const value = githubToken.trim();
        if (!value) return;

        const now = Date.now();
        const key: APIKey = {
            id: githubKey?.id ?? `key_github_${now.toString(36)}`,
            serviceId: "github",
            serviceName: "GitHub",
            serviceDomain: "github.com",
            nickname: "GitHub account",
            keyValue: value,
            keyPreview: `••••${value.slice(-4)}`,
            category: "development",
            environment: "production",
            status: "unverified",
            expiresAt: null,
            lastUsed: null,
            lastTested: null,
            testStatus: "untested",
            aiAgentAccess: true,
            aiAccessScope: "full",
            projectId: null,
            scopes: ["repo", "read:user", "workflow"],
            note: "GitHub credential added from Settings → Account.",
            tags: ["github", "account"],
            createdAt: githubKey?.createdAt ?? now,
            updatedAt: now,
        };

        actions.keyvaultUpsertKey(key);
        window.setTimeout(() => actions.keyvaultTestKey(key.id), 350);
        setGithubToken("");
    };

    const requestGithubDisconnect = (): void => {
        if (!githubKey) return;
        disconnectConfirmation.confirm({
            title: "Remove stored GitHub credential?",
            description: "This removes the personal access token used by agents and direct GitHub tools. It does not sign the GitHub CLI out.",
            confirmLabel: "Remove credential",
            onConfirm: () => {
                actions.keyvaultDeleteKey(githubKey.id);
            },
        });
    };

    const profileSection = (
        <SettingsSection title="Local profile" description="Identity stored on this device and used by the assistant and account menu.">
            <div className="flex flex-col gap-4">
                <ProfileSummary settings={settings} />
                {editingProfile ? (
                    <ProfileForm settings={settings} actions={actions} onClose={() => setEditingProfile(false)} />
                ) : (
                    <div className="flex justify-end">
                        <Button size="sm" color="secondary" iconLeading={Edit01} onClick={() => setEditingProfile(true)}>
                            Edit profile
                        </Button>
                    </div>
                )}
            </div>
        </SettingsSection>
    );

    const githubSection = (
        <SettingsSection title="GitHub integration" description="Configure repository access and agent GitHub tools on this device.">
            <div className="flex flex-col gap-3">
                {githubKey ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-medium text-primary">
                                <GitBranch01 className="size-4" /> GitHub credential stored
                            </p>
                            <p className="mt-0.5 text-xs text-tertiary">
                                {githubKey.keyPreview} ·{" "}
                                {githubKey.testStatus === "valid"
                                    ? "Verified"
                                    : githubKey.testStatus === "invalid"
                                      ? "Authentication failed"
                                      : "Verification pending"}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button size="sm" color="secondary" iconLeading={GitBranch01} onClick={() => onNavigate?.({ kind: "github" })}>
                                Open GitHub workspace
                            </Button>
                            <Button size="sm" color="secondary" onClick={() => actions.keyvaultTestKey(githubKey.id)}>
                                Verify
                            </Button>
                            <Button size="sm" color="primary-destructive" iconLeading={Trash01} onClick={requestGithubDisconnect}>
                                Remove credential
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="text-xs leading-5 text-tertiary">
                            Paste a GitHub personal access token with repository and workflow access. It is stored in the protected local credential store for
                            agents and direct GitHub tools. The repository workspace discovers your account through an authenticated GitHub CLI session on this device.
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <div className="min-w-0 flex-1">
                                <Input type="password" label="Personal access token" placeholder="github_pat_…" value={githubToken} onChange={setGithubToken} />
                            </div>
                            <Button size="sm" color="primary" iconLeading={GitBranch01} isDisabled={!githubToken.trim()} onClick={connectGithub}>
                                Store credential
                            </Button>
                        </div>
                        <a
                            className="w-fit text-xs font-medium text-brand-secondary hover:underline"
                            href="https://github.com/settings/tokens?type=beta"
                            target="_blank"
                            rel="noreferrer"
                        >
                            Create a fine-grained token on GitHub
                        </a>
                    </>
                )}
            </div>
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            {disconnectConfirmation.dialog}
            <SettingsPageHeader
                icon={User01}
                title="Account"
                subtitle="Manage the profile and connected services stored on this device."
                badges={<SettingsStatusBadge label="Device local" color="gray" />}
            />
            <SettingsTwoColumn
                left={profileSection}
                right={githubSection}
            />
        </div>
    );
};

const ProfileSummary = ({ settings }: { settings: CoretexConfig }) => {
    const profile = settings.profile;
    const initials = (profile.fullName || profile.nickname || "?")
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    return (
        <>
            <div className="flex flex-col items-start gap-4 sm:flex-row">
                {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
                ) : (
                    <div className="flex size-16 items-center justify-center rounded-full bg-brand-secondary">
                        <span className="text-md font-semibold text-brand-secondary">{initials || "?"}</span>
                    </div>
                )}
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                    <ReadField label="Full name" value={profile.fullName} />
                    <ReadField label="Nickname" value={profile.nickname} help="What the assistant calls you." />
                    <ReadField label="Email" value={profile.email} />
                    <ReadField label="Pronouns" value={profile.pronouns} />
                </div>
            </div>
            <ReadField label="About you" value={profile.about} help="Custom instructions the assistant uses." multiline />
        </>
    );
};

const ReadField = ({ label, value, help, multiline }: { label: string; value: string; help?: string; multiline?: boolean }) => (
    <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
            {label}
            {help && <HelpTooltip text={help} />}
        </span>
        <p
            className={`break-words text-sm text-primary ${multiline ? "whitespace-pre-wrap" : ""}`}
            style={{ color: value ? "var(--c-text-primary)" : "var(--c-text-muted)" }}
        >
            {value || "—"}
        </p>
    </div>
);

/** Device-local profile editor. No account or remote session is created. */
const ProfileForm = ({ settings, actions, onClose }: { settings: CoretexConfig; actions: CoretexActions; onClose: () => void }) => {
    const profile = settings.profile;
    const [fullName, setFullName] = useState(profile.fullName);
    const [nickname, setNickname] = useState(profile.nickname);
    const [email, setEmail] = useState(profile.email);
    const [pronouns, setPronouns] = useState(profile.pronouns);
    const [about, setAbout] = useState(profile.about);
    const [error, setError] = useState<string | null>(null);

    const submit = (): void => {
        setError(null);
        if (!fullName.trim() && !nickname.trim()) {
            setError("Add a full name or nickname.");
            return;
        }
        if (email.trim() && !email.includes("@")) {
            setError("Enter a valid email or leave it blank.");
            return;
        }

        actions.updateSettings({
            profile: {
                ...settings.profile,
                fullName: fullName.trim(),
                nickname: nickname.trim(),
                email: email.trim(),
                pronouns: pronouns.trim(),
                about: about.trim(),
            },
        });
        onClose();
    };

    return (
        <div className="flex flex-col gap-3 rounded-xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--c-border)" }}>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-primary">Edit local profile</h3>
                <Button size="sm" color="tertiary" onClick={onClose}>
                    Cancel
                </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Full name">
                    <Input aria-label="Full name" value={fullName} placeholder="Ada Lovelace" onChange={setFullName} />
                </Field>
                <Field label="Nickname" help="What the assistant calls you.">
                    <Input aria-label="Nickname" value={nickname} placeholder="Ada" onChange={setNickname} />
                </Field>
                <Field label="Email">
                    <Input aria-label="Email" value={email} type="email" placeholder="you@example.com" onChange={setEmail} />
                </Field>
                <Field label="Pronouns">
                    <Input aria-label="Pronouns" value={pronouns} placeholder="she/her" onChange={setPronouns} />
                </Field>
                <div className="sm:col-span-2">
                    <Field label="About you" help="Custom instructions for the assistant.">
                        <TextArea
                            aria-label="About you"
                            value={about}
                            placeholder="I'm a developer building with TypeScript. Prefer concise answers with code."
                            rows={3}
                            onChange={setAbout}
                        />
                    </Field>
                </div>
            </div>
            {error && <p className="text-xs text-error-primary">{error}</p>}
            <div className="flex justify-end">
                <Button size="sm" color="primary" onClick={submit}>
                    Save profile
                </Button>
            </div>
        </div>
    );
};

const Field = ({ label, help, children }: { label: string; help?: string; children: ReactNode }) => (
    <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-secondary">
            {label}
            {help && <HelpTooltip text={help} />}
        </span>
        {children}
    </div>
);
