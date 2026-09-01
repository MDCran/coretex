"use client";

import { usePathname } from "next/navigation";
import {
    Activity,
    ActivityHeart,
    BankNote03,
    BookOpen01,
    Briefcase01,
    Calendar,
    CheckDone01,
    File02,
    Home01,
    LogOut01,
    MusicNote01,
    Scales01,
    Settings01,
    Target04,
    Users01,
} from "@untitledui/icons";
import { MobileNavigationHeader } from "@/components/application/app-navigation/base-components/mobile-header";
import { NavItemBase } from "@/components/application/app-navigation/base-components/nav-item";
import { NavList } from "@/components/application/app-navigation/base-components/nav-list";
import type { NavItemType } from "@/components/application/app-navigation/config";
import { Avatar } from "@/components/base/avatar/avatar";
import { NavbarActions } from "@/components/app-shell/navbar/navbar-actions";
import { LifeOSLogoMark } from "@/components/foundations/logo/lifeos-logo";
import { logout } from "@/lib/auth-actions";
import { isHrefEnabled, type AreaKey } from "@/lib/areas";
import { APP_VERSION, CHANNEL_LABELS, versionLabel } from "@/lib/version";
import { cx } from "@/utils/cx";

const NAV_ITEMS: NavItemType[] = [
    { label: "Dashboard", href: "/dashboard", icon: Home01 },
    { label: "Career", href: "/career", icon: Briefcase01 },
    { label: "Documents", href: "/documents", icon: File02 },
    { label: "Health", href: "/health", icon: ActivityHeart },
    { label: "Nutrition", href: "/nutrition", icon: Scales01 },
    { label: "Workouts", href: "/workouts", icon: Activity },
    { label: "Music", href: "/music", icon: MusicNote01 },
    { label: "Financial", href: "/financial", icon: BankNote03 },
    { label: "Social", href: "/social", icon: Users01 },
    { label: "Learning", href: "/learning", icon: BookOpen01 },
    { label: "Calendar", href: "/calendar", icon: Calendar },
    { label: "Focus", href: "/focus", icon: Target04 },
    { label: "Todos", href: "/todos", icon: CheckDone01 },
];

interface AppSidebarProps {
    user: { name: string | null; email: string; avatarUrl?: string | null };
    /** Unread notification count for the mobile navbar bell. */
    unreadCount?: number;
    /** Area keys the user has turned off in Settings → Tracking. */
    hiddenAreas?: AreaKey[];
}

export const AppSidebar = ({ user, unreadCount = 0, hiddenAreas = [] }: AppSidebarProps) => {
    const pathname = usePathname();
    const SIDEBAR_WIDTH = 280;

    // Hide areas the user has turned off (Dashboard / Notifications are always shown).
    const items = NAV_ITEMS.filter((item) => isHrefEnabled(item.href, hiddenAreas));

    // Highlight the module root for nested routes (e.g. /career/applications/123 → /career).
    const activeUrl = items.find((item) => item.href && pathname.startsWith(item.href))?.href ?? pathname;

    const content = (
        <aside
            style={{ "--width": `${SIDEBAR_WIDTH}px` } as React.CSSProperties}
            className={cx(
                "flex h-full min-h-0 w-full max-w-full flex-col justify-between overflow-y-auto overscroll-contain border-secondary bg-primary pt-4 md:border-r lg:w-(--width) lg:pt-5",
            )}
        >
            <div className="flex items-center gap-2.5 px-4 lg:px-5">
                <LifeOSLogoMark className="size-7" />
                <span className="text-lg font-semibold text-primary">LifeOS</span>
            </div>

            <NavList activeUrl={activeUrl} items={items} />

            <div className="mt-auto flex flex-col gap-3 px-4 py-4 lg:py-5">
                {/* Settings + account live in the top-navbar account menu on desktop; keep
                    them here only inside the mobile nav drawer. */}
                <div className="flex flex-col gap-3 lg:hidden">
                    <ul className="flex flex-col">
                        <li className="py-px">
                            <NavItemBase icon={Settings01} href="/settings" type="link" current={pathname.startsWith("/settings")}>
                                Settings
                            </NavItemBase>
                        </li>
                    </ul>

                    <div className="flex items-center justify-between gap-3 rounded-xl p-3 ring-1 ring-secondary ring-inset">
                        <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar size="md" src={user.avatarUrl ?? undefined} initials={(user.name ?? user.email).slice(0, 2).toUpperCase()} alt={user.name ?? user.email} />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-secondary">{user.name ?? "Account"}</p>
                                <p className="truncate text-sm text-tertiary">{user.email}</p>
                            </div>
                        </div>
                        <form action={logout}>
                            <button
                                type="submit"
                                aria-label="Sign out"
                                className="flex cursor-pointer items-center justify-center rounded-md p-1.5 text-fg-quaternary outline-focus-ring transition duration-100 ease-linear hover:bg-primary_hover hover:text-fg-quaternary_hover focus-visible:outline-2 focus-visible:outline-offset-2"
                            >
                                <LogOut01 className="size-5" />
                            </button>
                        </form>
                    </div>
                </div>

                <a
                    href="/api/version"
                    target="_blank"
                    rel="noreferrer"
                    title={`${CHANNEL_LABELS[APP_VERSION.channel]} build${APP_VERSION.commit ? ` · ${APP_VERSION.commit}` : ""}`}
                    className="px-1 text-center text-[11px] text-quaternary transition hover:text-tertiary"
                >
                    LifeOS {versionLabel} · {CHANNEL_LABELS[APP_VERSION.channel]}
                </a>
            </div>
        </aside>
    );

    return (
        <>
            {/* Mobile header navigation */}
            <MobileNavigationHeader actions={<NavbarActions user={user} unreadCount={unreadCount} includeAccount={false} />}>
                {content}
            </MobileNavigationHeader>

            {/* Desktop sidebar navigation */}
            <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex">{content}</div>

            {/* Placeholder to take up physical space because the real sidebar has `fixed` position. */}
            <div style={{ paddingLeft: SIDEBAR_WIDTH }} className="invisible hidden lg:sticky lg:top-0 lg:bottom-0 lg:left-0 lg:block" />
        </>
    );
};
