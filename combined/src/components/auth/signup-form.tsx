"use client";

import { useActionState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Form } from "@/components/base/form/form";
import { Input } from "@/components/base/input/input";
import { LifeOSLogoMark } from "@/components/foundations/logo/lifeos-logo";
import { signup } from "@/lib/auth-actions";

export const SignupForm = () => {
    const [state, formAction, isPending] = useActionState(signup, undefined);

    return (
        <section className="min-h-screen bg-primary px-4 py-12 sm:bg-secondary md:px-8 md:pt-24">
            <div className="flex w-full flex-col gap-6 bg-primary sm:mx-auto sm:max-w-110 sm:rounded-2xl sm:px-10 sm:py-8 sm:shadow-sm">
                <div className="flex flex-col items-center gap-6 text-center">
                    <LifeOSLogoMark className="size-8" />
                    <div className="flex flex-col gap-2 md:gap-3">
                        <h1 className="text-xl font-semibold text-primary md:text-display-xs">Create your account</h1>
                        <p className="text-md text-tertiary">Your whole life, one operating system.</p>
                    </div>
                </div>

                <Form action={formAction} className="flex flex-col gap-6">
                    <div className="flex flex-col gap-5">
                        <Input isRequired type="text" name="name" label="Name" placeholder="Enter your name" size="lg" />
                        <Input isRequired type="email" name="email" label="Email" placeholder="Enter your email" size="lg" />
                        <Input
                            isRequired
                            type="password"
                            name="password"
                            label="Password"
                            size="lg"
                            placeholder="At least 8 characters"
                            inputClassName="placeholder:text-placeholder/50"
                        />
                        <Input
                            isRequired
                            type="password"
                            name="confirmPassword"
                            label="Confirm password"
                            size="lg"
                            placeholder="Repeat your password"
                            inputClassName="placeholder:text-placeholder/50"
                        />
                    </div>

                    {state?.error && <p className="text-sm text-error-primary">{state.error}</p>}

                    <Button type="submit" size="lg" isLoading={isPending} showTextWhileLoading>
                        Create account
                    </Button>
                </Form>

                <div className="flex justify-center gap-1 text-center">
                    <span className="text-sm text-tertiary">Already have an account?</span>
                    <Button color="link-color" size="md" href="/login">
                        Sign in
                    </Button>
                </div>
            </div>
        </section>
    );
};
