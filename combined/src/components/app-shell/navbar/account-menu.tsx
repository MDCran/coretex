"use client";

import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import {
    ChevronDown,
    CreditCard02,
    LogOut01,
    Monitor04,
    Moon01,
    Settings01,
    Stars01,
    Stars02,
    Sun,
    Target04,
    Zap,
} from "@untitledui/icons";
import { useTheme } from "@teispace/next-themes";
import { Avatar } from "@/components/base/avatar/avatar";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { logout } from "@/lib/auth-actions";
import { cx } from "@/utils/cx";

export interface AccountUser {
    name: string | null;
    email: string;
    avatarUrl?: string | null;
}

const THEME_OPTIONS = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon01 },
    { id: "system", label: "System", icon: Monitor04 },
] as const;

function ThemeSegmented() {
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const active = mounted ? theme ?? "system" : null;

    return (
        <div className="px-3.5 py-3">
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-tertiary uppercase">Theme</p>
            <div className="flex rounded-lg bg-secondary_alt p-0.5 ring-1 ring-secondary ring-inset">
                {THEME_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const selected = active === opt.id;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => setTheme(opt.id)}
                            aria-pressed={selected}
                            className={cx(
                                "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition duration-100 ease-linear",
                                selected ? "bg-primary text-primary shadow-xs ring-1 ring-secondary ring-inset" : "text-tertiary hover:text-secondary",
                            )}
                        >
                            <Icon className="size-4" aria-hidden="true" />
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/** Avatar + name trigger that opens a full account dropdown (Untitled UI). */
export function AccountMenu({ user }: { user: AccountUser }) {
    const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

    return (
        <Dropdown.Root>
            <AriaButton
                aria-label="Open account menu"
                className={cx(
                    "flex cursor-pointer items-center gap-2 rounded-lg p-1 pr-2 text-left outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-offset-2",
                )}
            >
                <Avatar size="sm" src={user.avatarUrl ?? undefined} initials={initials} alt={user.name ?? user.email} />
                <span className="hidden max-w-32 truncate text-sm font-semibold text-secondary sm:block">{user.name ?? "Account"}</span>
                <ChevronDown className="hidden size-4 text-fg-quaternary sm:block" aria-hidden="true" />
            </AriaButton>

            <Dropdown.Popover className="w-72">
                {/* User header */}
                <div className="flex items-center gap-3 border-b border-secondary px-3.5 py-3">
                    <Avatar size="md" src={user.avatarUrl ?? undefined} initials={initials} alt={user.name ?? user.email} />
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-primary">{user.name ?? "Account"}</p>
                        <p className="truncate text-xs text-tertiary">{user.email}</p>
                    </div>
                </div>

                {/* Theme quick switch */}
                <ThemeSegmented />

                <div className="border-t border-secondary" />

                <Dropdown.Menu aria-label="Account">
                    {/* Quick links to specific settings areas */}
                    <Dropdown.Section>
                        <Dropdown.Item label="Appearance" icon={Stars02} href="/settings/appearance" selectionIndicator="none" />
                        <Dropdown.Item label="Tracking" icon={Target04} href="/settings/tracking" selectionIndicator="none" />
                        <Dropdown.Item label="Integrations" icon={Zap} href="/settings/integrations" selectionIndicator="none" />
                        <Dropdown.Item label="AI & usage" icon={CreditCard02} href="/settings/ai" selectionIndicator="none" />
                        <Dropdown.Item label="What's new" icon={Stars01} href="/changelog" selectionIndicator="none" />
                    </Dropdown.Section>

                    <Dropdown.Separator />

                    {/* Settings sits at the bottom, next to Sign out */}
                    <Dropdown.Section>
                        <Dropdown.Item label="Settings" icon={Settings01} href="/settings" selectionIndicator="none" />
                        <Dropdown.Item
                            label="Sign out"
                            icon={LogOut01}
                            selectionIndicator="none"
                            className="[&_span]:!text-error-primary [&_svg]:!text-error-primary"
                            onAction={() => {
                                void logout();
                            }}
                        />
                    </Dropdown.Section>
                </Dropdown.Menu>
            </Dropdown.Popover>
        </Dropdown.Root>
    );
}
