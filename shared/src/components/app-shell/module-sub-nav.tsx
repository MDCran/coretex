// @ts-nocheck
// @ts-nocheck
// @ts-nocheck
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Tabs } from "@/components/application/tabs/tabs";

export type ModuleSubNavTab = { label: string; href: string };

function isTabActive(pathname: string, tab: ModuleSubNavTab, rootHref: string) {
    if (tab.href === rootHref) return pathname === tab.href;
    return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/**
 * Module section tabs built on Untitled UI's underline Tabs. Each tab is a link, so
 * selection follows the current route (controlled `selectedKey`); navigation is
 * client-side via the app's React Aria RouterProvider. Horizontally scrollable on
 * mobile, with the active tab scrolled into view.
 */
export function ModuleSubNav({ tabs, rootHref }: { tabs: ModuleSubNavTab[]; rootHref?: string }) {
    const pathname = usePathname();
    const wrapRef = useRef<HTMLDivElement>(null);
    const root = rootHref ?? tabs[0]?.href ?? "/";
    const activeHref = tabs.find((tab) => isTabActive(pathname, tab, root))?.href ?? null;

    useEffect(() => {
        const active = wrapRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
        active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }, [activeHref]);

    return (
        <div ref={wrapRef} className="-mx-3 sm:mx-0">
            <Tabs selectedKey={activeHref ?? undefined}>
                <Tabs.List
                    type="button-brand"
                    size="md"
                    aria-label="Section navigation"
                    className="scrollbar-hide overflow-x-auto px-3 sm:px-0"
                >
                    {tabs.map((tab) => (
                        <Tabs.Item key={tab.href} id={tab.href} href={tab.href}>
                            {tab.label}
                        </Tabs.Item>
                    ))}
                </Tabs.List>
            </Tabs>
        </div>
    );
}
