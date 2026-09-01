// @ts-nocheck
import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Dashboard", href: "/social" },
    { label: "Contacts", href: "/social/contacts" },
    { label: "Calendar", href: "/social/calendar" },
    { label: "Drafts", href: "/social/drafts" },
    { label: "Events", href: "/social/events" },
];
// (Canvas lives in the desktop SocialView tabs — not this Next.js sub-nav.)

export const SocialSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/social" />;
