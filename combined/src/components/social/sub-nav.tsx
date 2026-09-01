"use client";

import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Dashboard", href: "/social" },
    { label: "Contacts", href: "/social/contacts" },
    { label: "Calendar", href: "/social/calendar" },
    { label: "Drafts", href: "/social/drafts" },
    { label: "Events", href: "/social/events" },
];

export const SocialSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/social" />;
