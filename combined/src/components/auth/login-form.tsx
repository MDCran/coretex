"use client";

import { useActionState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Form } from "@/components/base/form/form";
import { Input } from "@/components/base/input/input";
import { LifeOSLogoMark } from "@/components/foundations/logo/lifeos-logo";
import { login } from "@/lib/auth-actions";

export const LoginForm = ({ next = "/dashboard" }: { next?: string }) => {
    const [state, formAction, isPending] = useActionState(login, undefined);

    return (
        <section className="min-h-screen bg-primary p-3 sm:p-6 lg:p-8">
            <div className="grid min-h-[calc(100vh-1.5rem)] overflow-hidden rounded-3xl bg-primary shadow-xl ring-1 ring-secondary ring-inset sm:min-h-[calc(100vh-3rem)] lg:grid-cols-[minmax(28rem,0.9fr)_minmax(0,1.1fr)]">
                <div className="flex items-center justify-center px-5 py-10 sm:px-10 lg:px-14">
                    <div className="flex w-full max-w-110 flex-col gap-7">
                        <div className="flex flex-col gap-7 text-left">
                            <LifeOSLogoMark className="size-9" />
                            <div className="flex flex-col gap-2 md:gap-3">
                                <h1 className="text-display-xs font-semibold text-primary md:text-display-sm">Welcome back</h1>
                                <p className="text-md text-tertiary">Sign in to your LifeOS account.</p>
                            </div>
                        </div>

                        <Form action={formAction} className="flex flex-col gap-6">
                            <input type="hidden" name="next" value={next} />
                            <div className="flex flex-col gap-5">
                                <Input isRequired type="text" name="email" label="Email" placeholder="Enter your email" size="lg" />
                                <Input
                                    isRequired
                                    type="password"
                                    name="password"
                                    label="Password"
                                    size="lg"
                                    placeholder="Password"
                                    inputClassName="placeholder:text-placeholder/70"
                                />
                            </div>

                            {state?.error && <p className="text-sm text-error-primary">{state.error}</p>}

                            <Button type="submit" size="lg" isLoading={isPending} showTextWhileLoading>
                                Sign in
                            </Button>
                        </Form>

                        <div className="flex justify-center gap-1 text-center">
                            <span className="text-sm text-tertiary">Don&apos;t have an account?</span>
                            <Button color="link-color" size="md" href="/signup">
                                Sign up
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="relative hidden min-h-0 overflow-hidden bg-[#08111f] lg:block">
                    <div
                        className="absolute inset-0"
                        style={{
                            background:
                                "radial-gradient(110% 80% at 18% 20%, rgba(26,188,156,0.34), transparent 56%), radial-gradient(95% 78% at 80% 16%, rgba(98,91,255,0.34), transparent 56%), linear-gradient(140deg, #08111f 0%, #10233f 48%, #19172f 100%)",
                        }}
                    />
                    <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.18)_1px,transparent_1px)] [background-size:42px_42px]" />
                    <div className="relative flex h-full flex-col justify-between p-10 text-white">
                        <div className="max-w-md">
                            <p className="text-sm font-semibold text-white/70">LifeOS Command Center</p>
                            <p className="mt-4 text-display-md font-semibold leading-tight text-white">Everything important, one calm place.</p>
                            <p className="mt-4 text-md leading-7 text-white/72">
                                Finance, health, calendar, music, focus, files, and the daily context that keeps the system warm.
                            </p>
                        </div>

                        <div className="grid max-w-xl grid-cols-2 gap-3">
                            {[
                                ["Today", "Calendar, focus, reminders"],
                                ["Money", "Accounts, cards, docs"],
                                ["Music", "Lyrics, devices, playlists"],
                                ["AI", "Cheap extraction and cleanup"],
                            ].map(([title, text]) => (
                                <div key={title} className="rounded-2xl bg-white/10 p-4 shadow-lg ring-1 ring-white/15 backdrop-blur">
                                    <p className="text-sm font-semibold text-white">{title}</p>
                                    <p className="mt-1 text-xs text-white/68">{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
