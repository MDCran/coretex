// @ts-nocheck
import { useRouter } from "@react-aria/utils";
import { Stars01 } from "@untitledui/icons";
import { useState, useTransition } from "react";
import { DialogTrigger, Button, ModalOverlay, Modal, Dialog, TextArea } from "react-aria-components";
import { toast } from "sonner";


const EXAMPLES = [
    "45-min upper body push day, hypertrophy focus",
    "Quick full-body dumbbell workout for travel",
    "Heavy leg day with squats and accessories",
];

/**
 * "Generate with AI" CTA for the templates page. Opens a small prompt dialog,
 * calls generateAiTemplate (which only ever uses exercises from the user's DB),
 * toasts, and routes to the new template's edit page on success.
 */
export const GenerateTemplateButton = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [pending, startTransition] = useTransition();

    const submit = () => {
        const value = prompt.trim();
        if (!value) {
            toast.error("Describe the workout you want first.");
            return;
        }
        startTransition(async () => {
            try {
                const { id } = await generateAiTemplate({ prompt: value });
                toast.success("Workout template generated");
                setIsOpen(false);
                setPrompt("");
                router.push(`/workouts/templates/${id}/edit`);
            } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to generate template");
            }
        });
    };

    return (
        <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
            <Button size={size} color="secondary" iconLeading={<Stars01 data-icon className="size-4" />}>
                Generate with AI
            </Button>

            <ModalOverlay isDismissable={!pending}>
                <Modal className="max-w-lg">
                    <Dialog>
                        <div className="flex w-full flex-col gap-4 rounded-xl bg-primary p-5 shadow-xl ring-1 ring-secondary_alt">
                            <div className="flex flex-col gap-1">
                                <h2 className="text-md font-semibold text-primary">Generate a workout template</h2>
                                <p className="text-sm text-tertiary">
                                    Describe what you want and AI will build a template using only the exercises in your library.
                                </p>
                            </div>

                            <TextArea
                                aria-label="Workout description"
                                placeholder="e.g. 45-min upper body push day, hypertrophy focus"
                                rows={4}
                                value={prompt}
                                onChange={setPrompt}
                                isDisabled={pending}
                            />

                            <div className="flex flex-wrap gap-2">
                                {EXAMPLES.map((ex) => (
                                    <button
                                        key={ex}
                                        type="button"
                                        disabled={pending}
                                        onClick={() => setPrompt(ex)}
                                        className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary transition duration-100 ease-linear hover:bg-secondary_hover disabled:opacity-50"
                                    >
                                        {ex}
                                    </button>
                                ))}
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button size="md" color="secondary" isDisabled={pending} onClick={() => setIsOpen(false)}>
                                    Cancel
                                </Button>
                                <Button
                                    size="md"
                                    color="primary"
                                    iconLeading={<Stars01 data-icon className="size-4" />}
                                    isLoading={pending}
                                    showTextWhileLoading
                                    onClick={submit}
                                >
                                    Generate
                                </Button>
                            </div>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </DialogTrigger>
    );
};
