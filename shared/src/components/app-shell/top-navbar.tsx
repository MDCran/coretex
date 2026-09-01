import { NavbarActions } from "@/components/app-shell/navbar/navbar-actions";
import { NavbarBreadcrumb } from "@/components/app-shell/navbar/navbar-breadcrumb";
import type { AccountUser } from "@/components/app-shell/navbar/account-menu";

/**
 * Desktop top navbar: a sticky bar across the main content. Left = page breadcrumb +
 * title; right = global search (command palette), notifications, theme toggle and account.
 */
export function TopNavbar({ user, unreadCount }: { user: AccountUser; unreadCount: number }) {
    return (
        <header className="sticky top-0 z-30 hidden h-16 shrink-0 items-center gap-4 border-b border-secondary bg-primary/95 px-4 backdrop-blur-sm lg:flex lg:px-6">
            <div className="flex min-w-0 flex-1 items-center">
                <NavbarBreadcrumb />
            </div>
            <div className="flex shrink-0 items-center justify-end">
                <NavbarActions user={user} unreadCount={unreadCount} />
            </div>
        </header>
    );
}
