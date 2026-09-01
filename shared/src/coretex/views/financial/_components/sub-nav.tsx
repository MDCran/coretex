// @ts-nocheck
import { ModuleSubNav } from "@/components/app-shell/module-sub-nav";

const TABS = [
    { label: "Overview", href: "/financial" },
    { label: "Net worth", href: "/financial/net-worth" },
    { label: "Forecast", href: "/financial/forecast" },
    { label: "Calendar", href: "/financial/calendar" },
    { label: "Accounts", href: "/financial/accounts" },
    { label: "Cards", href: "/financial/cards" },
    { label: "Credit", href: "/financial/credit" },
    { label: "Debt", href: "/financial/debt" },
    { label: "Institutions", href: "/financial/institutions" },
    { label: "Transactions", href: "/financial/transactions" },
    { label: "Statements", href: "/financial/statements" },
    { label: "Subscriptions", href: "/financial/subscriptions" },
    { label: "Income", href: "/financial/income" },
    { label: "Budget", href: "/financial/budget" },
    { label: "Reports", href: "/financial/reports" },
    { label: "Deductions", href: "/financial/deductions" },
    { label: "Tax", href: "/financial/tax" },
];

export const FinancialSubNav = () => <ModuleSubNav tabs={TABS} rootHref="/financial" />;
