// @ts-nocheck
import type { ComposerSpeechOptions } from "./ai-composer";

/** Build mic options from settings.speech for a given surface. */
export function speechOptsFor(
    speech:
        | {
              enabled?: boolean;
              language?: string;
              pushToTalk?: boolean;
              autoSpace?: boolean;
              showInAskAi?: boolean;
              showInCommandBar?: boolean;
              showInTerminalBuddy?: boolean;
              showInProjectChat?: boolean;
          }
        | undefined,
    surface: "askAi" | "commandBar" | "terminalBuddy" | "projectChat",
): ComposerSpeechOptions | undefined {
    if (!speech?.enabled) return undefined;
    const show =
        surface === "askAi"
            ? speech.showInAskAi !== false
            : surface === "commandBar"
              ? speech.showInCommandBar !== false
              : surface === "terminalBuddy"
                ? speech.showInTerminalBuddy !== false
                : speech.showInProjectChat !== false;
    if (!show) return undefined;
    return {
        enabled: true,
        language: speech.language ?? "",
        pushToTalk: speech.pushToTalk === true,
        autoSpace: speech.autoSpace !== false,
    };
}
