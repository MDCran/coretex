"use client";

import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Overview",     href: "/career" },
    { label: "Companies",    href: "/career/companies" },
    { label: "Applications", href: "/career/applications" },
    { label: "Contacts",     href: "/career/contacts" },
    { label: "Job Search",   href: "/career/search" },
    { label: "Networking",   href: "/career/networking" },
    { label: "Prep",         href: "/career/prep" },
    { label: "Documents",    href: "/career/documents" },
    { label: "Analytics",    href: "/career/analytics" },
    { label: "Salary",       href: "/career/salary" },
];

export function CareerSubNav() {
    return <ModuleSubNav tabs={TABS} rootHref="/career" />;
}
