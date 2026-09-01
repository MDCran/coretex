"use client";

import { useState } from "react";
import { AlertTriangle } from "@untitledui/icons";
import { toast } from "sonner";
import { Button } from "@/components/base/buttons/button";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import { TextInput } from "@/components/jobs/fields";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { changePassword, deleteAccount } from "@/lib/actions/settings";

export function AccountClient({ email }: { email: string }) {
    const [pwPending, setPwPending] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [confirmEmail, setConfirmEmail] = useState("");
    const [deleting, setDeleting] = useState(false);

    async function onChangePassword(fd: FormData) {
        setPwPending(true);
        try {
            await changePassword(fd);
            toast.success("Password changed");
            (document.getElementById("password-form") as HTMLFormElement | null)?.reset();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Something went wrong");
        } finally {
            setPwPending(false);
        }
    }

    async function onDelete(fd: FormData) {
        setDeleting(true);
        try {
            // Redirects to /login on success; only reaches catch on error.
            await deleteAccount(fd);
        } catch (e) {
            setDeleting(false);
            toast.error(e instanceof Error ? e.message : "Failed to delete account");
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <SettingsCard bloom="brand">
                <SettingsHeading title="Change password" description="Update the password you use to sign in to LifeOS." />
                <form id="password-form" action={onChangePassword} className="mt-5 flex flex-col gap-4">
                    <TextInput label="Current password" name="currentPassword" id="currentPassword" type="password" isRequired autoComplete="current-password" />
                    <TextInput label="New password" name="newPassword" id="newPassword" type="password" isRequired hint="At least 8 characters" autoComplete="new-password" />
                    <TextInput label="Confirm new password" name="confirmPassword" id="confirmPassword" type="password" isRequired autoComplete="new-password" />
                    <div className="flex justify-end">
                        <Button type="submit" isLoading={pwPending} showTextWhileLoading>
                            Update password
                        </Button>
                    </div>
                </form>
            </SettingsCard>

            <SettingsCard bloom="brand" className="ring-error_subtle">
                <SettingsHeading title="Danger zone" description="Permanently delete your account and all associated data. This cannot be undone." />
                <div className="mt-5">
                    <Button color="primary-destructive" iconLeading={AlertTriangle} onClick={() => setDeleteOpen(true)}>
                        Delete account
                    </Button>
                </div>
            </SettingsCard>

            <ModalOverlay isDismissable isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
                <Modal className="max-w-md">
                    <Dialog aria-label="Delete account">
                        <div className="w-full rounded-2xl bg-primary p-6 shadow-xl ring-1 ring-secondary">
                            <FeaturedIcon icon={AlertTriangle} color="error" theme="light" size="lg" />
                            <h2 className="mt-4 text-lg font-semibold text-primary">Delete account</h2>
                            <p className="mt-1 text-sm text-tertiary">
                                Type <span className="font-medium text-secondary">{email}</span> to confirm. All your data will be permanently removed.
                            </p>
                            <form action={onDelete} className="mt-4 flex flex-col gap-4">
                                <TextInput
                                    label="Confirm email"
                                    name="confirmEmail"
                                    id="confirmEmail"
                                    value={confirmEmail}
                                    onChange={(e) => setConfirmEmail(e.target.value)}
                                    placeholder={email}
                                />
                                <div className="flex justify-end gap-3">
                                    <Button type="button" color="secondary" onClick={() => setDeleteOpen(false)}>
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        color="primary-destructive"
                                        isLoading={deleting}
                                        showTextWhileLoading
                                        isDisabled={confirmEmail.trim().toLowerCase() !== email.toLowerCase()}
                                    >
                                        Delete account
                                    </Button>
                                </div>
                            </form>
                        </div>
                    </Dialog>
                </Modal>
            </ModalOverlay>
        </div>
    );
}
