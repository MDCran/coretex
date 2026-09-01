import { AppSidebar } from "@/components/app-shell/sidebar";
import { TopNavbar } from "@/components/app-shell/top-navbar";
import { CommandPaletteProvider } from "@/components/app-shell/command/command-context";
import { ThemeConfigProvider } from "@/components/app-shell/theme/theme-config";
import { ModuleAccentApplier } from "@/components/app-shell/theme/module-accent-applier";
import { WhatsNewDialog } from "@/components/app-shell/whats-new-dialog";
import { FloatingWidgetsHost } from "@/components/app-shell/floating-widgets/floating-widgets-host";
import { FloatingWidgetsProvider } from "@/components/app-shell/floating-widgets/floating-widgets-context";
import { DateFormatProvider } from "@/components/foundations/date-format-context";
import { UnitSystemProvider } from "@/components/foundations/unit-system-context";
import { CurrencyProvider } from "@/components/foundations/currency-context";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fileUrl } from "@/lib/files";
import { parseHiddenAreas } from "@/lib/areas";
import { readServerDateTimePrefs } from "@/lib/datetime-prefs-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser();
    const [settings, unreadCount, dateTimePrefs] = await Promise.all([
        db.settings.findUnique({ where: { userId: user.id }, select: { sidebarConfig: true, unitSystem: true, currency: true } }),
        db.notification.count({ where: { userId: user.id, readAt: null } }),
        readServerDateTimePrefs(),
    ]);
    const hiddenAreas = parseHiddenAreas(settings?.sidebarConfig);
    const account = { name: user.name, email: user.email, avatarUrl: user.avatarKey ? fileUrl(user.avatarKey) : null };

    return (
        <FloatingWidgetsProvider>
            <ThemeConfigProvider>
            <DateFormatProvider value={dateTimePrefs}>
            <UnitSystemProvider value={settings?.unitSystem ?? "IMPERIAL"}>
            <CurrencyProvider value={settings?.currency ?? "USD"}>
            <CommandPaletteProvider hiddenAreas={hiddenAreas}>
                <div className="flex flex-col lg:flex-row">
                    <AppSidebar user={account} unreadCount={unreadCount} hiddenAreas={hiddenAreas} />
                    <main className="flex min-w-0 flex-1 flex-col overflow-x-clip bg-primary pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0">
                        <TopNavbar user={account} unreadCount={unreadCount} />
                        <div className="min-w-0 flex-1">{children}</div>
                    </main>
                </div>
                <FloatingWidgetsHost hiddenWidgets={hiddenAreas} />
                <WhatsNewDialog />
                <ModuleAccentApplier />
            </CommandPaletteProvider>
            </CurrencyProvider>
            </UnitSystemProvider>
            </DateFormatProvider>
            </ThemeConfigProvider>
        </FloatingWidgetsProvider>
    );
}
