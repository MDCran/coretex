"use client";

// Coretex settings — Microphone & speech-to-text. Request browser mic access,
// choose language / push-to-talk, and pick where the mic appears (Ask AI,
// command bar, Terminal Buddy, project chat).
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, Microphone01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { type MicPermission, micPermission, requestMicPermission, speechRecognitionSupported } from "../../ui/speech";
import { SettingSelect, SettingToggle, SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge, SettingsTwoColumn } from "../settings-shell";
import type { SettingsPageProps } from "../settings-window";

const LANG_OPTIONS = [
    { label: "Browser default", value: "" },
    { label: "English (US)", value: "en-US" },
    { label: "English (UK)", value: "en-GB" },
    { label: "Spanish", value: "es-ES" },
    { label: "French", value: "fr-FR" },
    { label: "German", value: "de-DE" },
    { label: "Portuguese (BR)", value: "pt-BR" },
    { label: "Japanese", value: "ja-JP" },
    { label: "Chinese (Simplified)", value: "zh-CN" },
    { label: "Korean", value: "ko-KR" },
];

function permLabel(p: MicPermission, stt: boolean): { label: string; color: "success" | "warning" | "error" | "gray" | "brand" } {
    if (!stt) return { label: "STT unsupported", color: "warning" };
    switch (p) {
        case "granted":
            return { label: "Mic allowed", color: "success" };
        case "denied":
            return { label: "Mic blocked", color: "error" };
        case "unsupported":
            return { label: "No microphone", color: "error" };
        default:
            return { label: "Permission needed", color: "warning" };
    }
}

export const SpeechPage = ({ settings, actions }: SettingsPageProps) => {
    const speech = settings.speech;
    const enabled = speech?.enabled === true;
    const disabledReason = enabled ? undefined : "Enable speech-to-text to change this.";
    const sttOk = speechRecognitionSupported();

    const [perm, setPerm] = useState<MicPermission>("prompt");
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    const refresh = useCallback(() => {
        void micPermission().then(setPerm);
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const requestAccess = async (): Promise<void> => {
        setBusy(true);
        setNote(null);
        const next = await requestMicPermission();
        setPerm(next);
        setBusy(false);
        if (next === "granted") setNote("Microphone access granted. Use the mic icon in Ask AI or Terminal Buddy.");
        else if (next === "denied") setNote("Permission denied. Allow the microphone in your OS / browser site settings, then try again.");
        else if (next === "unsupported") setNote("No microphone detected on this device.");
    };

    const badge = permLabel(perm, sttOk);
    const surfaceCount = [speech?.showInAskAi, speech?.showInCommandBar, speech?.showInTerminalBuddy, speech?.showInProjectChat].filter(Boolean).length;

    const accessSection = (
        <SettingsSection title="Microphone access" description="Coretex needs mic permission to dictate into Ask AI and terminals.">
            <div className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                        {perm === "granted" ? <CheckCircle className="size-4 text-success-primary" /> : <AlertCircle className="size-4 text-warning-primary" />}
                        Permission status
                    </p>
                    <p className="mt-0.5 text-xs text-tertiary">
                        {sttOk
                            ? "Speech recognition uses the browser Web Speech API (Chrome, Edge, Electron)."
                            : "This host doesn’t expose speech recognition — dictate buttons stay hidden."}
                    </p>
                    {note && <p className="mt-1.5 text-xs text-secondary">{note}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <SettingsStatusBadge label={badge.label} color={badge.color} />
                    <Button size="sm" color="secondary" isLoading={busy} isDisabled={perm === "granted" || !sttOk} onClick={() => void requestAccess()}>
                        {perm === "granted" ? "Access granted" : "Allow microphone"}
                    </Button>
                </div>
            </div>
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.enabled"
                label="Enable speech-to-text"
                description="Show microphone controls on Ask AI, the command bar, Terminal Buddy, and project chat."
            />
        </SettingsSection>
    );

    const behaviorSection = (
        <SettingsSection title="Dictation" description="How transcripts are captured and inserted.">
            <SettingSelect
                settings={settings}
                actions={actions}
                path="speech.language"
                label="Recognition language"
                description="Leave on browser default to follow your OS language."
                options={LANG_OPTIONS}
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.pushToTalk"
                label="Push to talk"
                description="Hold the mic button to listen. When off, click once to start and again to stop."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.autoSpace"
                label="Auto-space transcripts"
                description="Insert a space before new dictated text when the field already has content."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
        </SettingsSection>
    );

    const surfacesSection = (
        <SettingsSection title="Where to show the mic" description="Turn dictation on per surface. Master switch still required.">
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.showInAskAi"
                label="Ask AI chat"
                description="Microphone on the full Ask AI composer."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.showInCommandBar"
                label="Command-center Ask bar"
                description="Microphone on the bottom Ask AI / Ctrl+K composer."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.showInTerminalBuddy"
                label="Terminal Buddy"
                description="Dictate tasks into the buddy bar under each terminal."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
            <SettingToggle
                settings={settings}
                actions={actions}
                path="speech.showInProjectChat"
                label="Project chat"
                description="Microphone on the project workspace chat composer."
                disabled={!enabled}
                disabledReason={disabledReason}
            />
        </SettingsSection>
    );

    return (
        <div className="flex flex-col gap-6">
            <SettingsPageHeader
                icon={Microphone01}
                title="Microphone"
                subtitle="Speech-to-text for Ask AI and terminals. Permission is local to this device."
                badges={
                    <>
                        <SettingsStatusBadge label={badge.label} color={badge.color} />
                        {enabled && <SettingsStatusBadge label={`${surfaceCount} surfaces`} color="brand" />}
                    </>
                }
            />

            {accessSection}
            <SettingsTwoColumn left={behaviorSection} right={surfacesSection} />
        </div>
    );
};
