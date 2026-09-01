"use client";

import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Overview", href: "/financial" },
    { label: "Net worth", href: "/financial/net-worth" },
    { label: "Health", href: "/financial/health" },
    { label: "Alerts", href: "/financial/alerts" },
    { label: "Forecast", href: "/financial/forecast" },
    { label: "Calendar", href: "/financial/calendar" },
    { label: "Accounts", href: "/financial/accounts" },
    { label: "Cards", href: "/financial/cards" },
    { label: "Credit", href: "/financial/credit" },
    { label: "Debt", href: "/financial/debt" },
    { label: "Institutions", href: "/financial/institutions" },
    { label: "Transactions", href: "/financial/transactions" },
    { label: "Statements", href: "/financial/statements" },
    { label: "Import", href: "/financial/import-status" },
    { label: "Subscriptions", href: "/financial/subscriptions" },
    { label: "Income", href: "/financial/income" },
    { label: "Budget", href: "/financial/budget" },
    { label: "Goals", href: "/financial/goals" },
    { label: "Paycheck", href: "/financial/paycheck" },
    { label: "Reports", href: "/financial/reports" },
    { label: "Deductions", href: "/financial/deductions" },
    { label: "Currencies", href: "/financial/currencies" },
    { label: "Tax", href: "/financial/tax" },
];

export const FinancialSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/financial" />;
