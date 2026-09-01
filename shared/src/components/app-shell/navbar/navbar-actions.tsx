// @ts-nocheck
import { AccountMenu, type AccountUser } from "./account-menu";
import { NotificationsBell } from "./notifications-bell";
import { ThemeToggle } from "./theme-toggle";
import { CommandSearchButton } from "@/components/app-shell/command/command-search-button";

/**
 * Right-aligned navbar cluster: notifications bell, light/dark toggle, and (on the
 * full desktop bar) the account menu. `includeAccount={false}` is used in the mobile
 * header, where the account lives in the nav drawer.
 */
export function NavbarActions({
    user,
    unreadCount,
    includeAccount = true,
}: {
    user: AccountUser;
    unreadCount: number;
    includeAccount?: boolean;
}) {
    return (
        <div className="flex items-center gap-0.5 sm:gap-1">
            <CommandSearchButton className="mr-0.5 lg:mr-1" />
            <NotificationsBell count={unreadCount} />
            <ThemeToggle />
            {includeAccount && (
                <>
                    <div className="mx-1 h-6 w-px bg-border-secondary" aria-hidden="true" />
                    <AccountMenu user={user} />
                </>
            )}
        </div>
    );
}
