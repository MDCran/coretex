"use client";

import { Droplets01, Send01, Sun, Sunrise, Moon01, Star06 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { LifeOSLogoMark } from "@/components/foundations/logo/lifeos-logo";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Field, NativeTextarea } from "@/app/(app)/health/_components/health-ui";
import { cx } from "@/utils/cx";
import type { UnitSystem } from "@/lib/units";
import { volumeUnit } from "@/lib/units";

const MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
type MealType = (typeof MEAL_TYPES)[number];
export type ChatLogTarget = MealType | "AUTO" | "WATER";

const MEAL_LABEL: Record<string, string> = { BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", SNACK: "Snack" };
const MEAL_ICON: Record<string, typeof Sunrise> = { BREAKFAST: Sunrise, LUNCH: Sun, DINNER: Moon01, SNACK: Star06 };

export function QuickLogAi({
    chatTarget,
    onChatTargetChange,
    chatText,
    onChatTextChange,
    chatBusy,
    aiConfigured,
    aiTooltip,
    unitSystem,
    onSubmit,
}: {
    chatTarget: ChatLogTarget;
    onChatTargetChange: (target: ChatLogTarget) => void;
    chatText: string;
    onChatTextChange: (text: string) => void;
    chatBusy: boolean;
    aiConfigured: boolean;
    aiTooltip: string;
    unitSystem: UnitSystem;
    onSubmit: () => void;
}) {
    const placeholder = !aiConfigured
        ? "AI is not configured on the server."
        : chatTarget === "WATER"
          ? `How much water? e.g. 16 ${volumeUnit(unitSystem)} or 500 ml`
          : chatTarget === "AUTO"
            ? "e.g. oatmeal for breakfast and 500ml water"
            : `What did you have for ${MEAL_LABEL[chatTarget].toLowerCase()}?`;

    const targets: { id: ChatLogTarget; label: string; icon?: typeof Sunrise }[] = [
        { id: "AUTO", label: "Auto" },
        ...MEAL_TYPES.map((mt) => ({ id: mt, label: MEAL_LABEL[mt], icon: MEAL_ICON[mt] })),
        { id: "WATER", label: "Water", icon: Droplets01 },
    ];

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
                <LifeOSLogoMark className="size-10 shrink-0" />
                <div className="min-w-0 flex-1">
                    <h3 className="text-md font-semibold text-primary">Quick log with AI</h3>
                    <p className="mt-0.5 text-sm text-tertiary">
                        Choose what you&apos;re logging, describe it in plain language, then review before saving.
                    </p>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-secondary">Log as</span>
                <div
                    role="radiogroup"
                    aria-label="Log as"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
                >
                    {targets.map(({ id, label, icon: Icon }) => {
                        const selected = chatTarget === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onChatTargetChange(id)}
                                className={cx(
                                    "flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium transition duration-100 ease-linear outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                                    selected
                                        ? "bg-brand-solid text-white shadow-xs ring-1 ring-brand-solid ring-inset"
                                        : "bg-secondary text-secondary ring-1 ring-secondary ring-inset hover:bg-secondary_hover hover:text-primary",
                                )}
                            >
                                {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <Field
                label={chatTarget === "WATER" ? "Water amount" : "What did you have?"}
                hint={
                    aiConfigured
                        ? chatTarget === "AUTO"
                            ? "AI detects meals and water from your message. Press Ctrl+Enter to log."
                            : "Press Ctrl+Enter to log."
                        : undefined
                }
            >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                        <NativeTextarea
                            aria-label="Describe what you ate or drank"
                            rows={3}
                            value={chatText}
                            onChange={(e) => onChatTextChange(e.target.value)}
                            placeholder={placeholder}
                            disabled={!aiConfigured || chatBusy}
                            className="min-h-[5.5rem] resize-y"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    onSubmit();
                                }
                            }}
                        />
                    </div>
                    <div className="shrink-0 sm:pb-0">
                        {aiConfigured ? (
                            <Button
                                size="md"
                                color="primary"
                                iconLeading={Send01}
                                onClick={onSubmit}
                                isLoading={chatBusy}
                                showTextWhileLoading
                                isDisabled={!chatText.trim()}
                                className="w-full sm:w-auto"
                            >
                                Analyze & log
                            </Button>
                        ) : (
                            <Tooltip title="AI logging" description={aiTooltip}>
                                <TooltipTrigger>
                                    <Button size="md" color="primary" iconLeading={Send01} isDisabled className="w-full sm:w-auto">
                                        Analyze & log
                                    </Button>
                                </TooltipTrigger>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </Field>
        </div>
    );
}
