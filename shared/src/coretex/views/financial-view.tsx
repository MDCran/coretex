import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, CurrencyDollarCircle, Edit01, File02, FilterLines, Grid01, LinkExternal01, Plus, RefreshCcw01, Rows01, SearchLg, Stars01, Trash01, UploadCloud02, XClose } from "@untitledui/icons";
import { RichSelect } from "@/components/base/select/rich-select";
import {
    EmptyMessage,
    PersonalCard,
    PersonalModuleShell,
    PersonalTable,
    QueryBoundary,
    StatGrid,
    formatCurrency,
    formatDate,
    formatMonthYear,
    titleCase,
    type TableColumn,
} from "./personal/personal-ui";
import { useLifeOSQuery, type LifeOSClient } from "./personal/use-lifeos-query";
import { useLifeOSMutation } from "./personal/use-lifeos-mutation";
import { FormModal } from "./financial/_components/form-modal";
import { CategoryBadge } from "./financial/_components/category-badge";
import { DonutChart, TrendChart, type TrendPoint } from "./financial/_components/trend-chart";
import { BillCalendar, type BillCalendarEvent } from "./financial/calendar/bill-calendar";
import { BrandLogo } from "../ui/brand-logo";
import { cx } from "@/utils/cx";
import { categoryColor, categoryIcon } from "./financial/_components/category-icons";
import BudgetPage from "./financial/budget/page";
import DeductionsPage from "./financial/deductions/page";
import ReportsPage from "./financial/reports/page";
import TaxPage from "./financial/tax/page";
import TransactionsPage from "./financial/transactions/page";
import { RecentTransactionsPanel } from "./financial/_components/recent-transactions-panel";

type Scalar = string | number | boolean | null;
type CellFormat = "text" | "currency" | "percent" | "number" | "date" | "status" | "boolean" | "bytes";

interface FinancialRow {
    id?: string;
    [key: string]: unknown;
}

interface FinancialPayload {
    summary?: Record<string, Scalar>;
    recommendations?: string[];
    grade?: string;
    integrations?: unknown;
    [key: string]: unknown;
}

interface MetricConfig {
    key: string;
    label: string;
    format?: CellFormat;
    detail?: string;
}

interface ColumnConfig {
    key: string;
    label: string;
    format?: CellFormat;
    align?: "left" | "right";
}

interface TableConfig {
    key: string;
    title: string;
    empty: string;
    columns: ColumnConfig[];
}

interface FinancialTab {
    id: string;
    label: string;
    command: `financial:get${string}`;
    description: string;
    metrics: MetricConfig[];
    tables: TableConfig[];
    readOnlyConnections?: boolean;
}

const money = (key: string, label: string, detail?: string): MetricConfig => ({ key, label, detail, format: "currency" });
const count = (key: string, label: string, detail?: string): MetricConfig => ({ key, label, detail, format: "number" });
const percentage = (key: string, label: string, detail?: string): MetricConfig => ({ key, label, detail, format: "percent" });

const FINANCIAL_TABS: FinancialTab[] = [
    {
        id: "overview",
        label: "Overview",
        command: "financial:getOverview",
        description: "A current snapshot of cash flow, net worth, budgets, and recent activity.",
        metrics: [
            money("netWorth", "Net worth"),
            money("monthIncome", "Income this month"),
            money("monthSpending", "Spending this month"),
            money("monthNetCashFlow", "Net cash flow"),
            money("budgetRemaining", "Budget remaining"),
            count("activeSubscriptions", "Active subscriptions"),
            count("creditScore", "Latest credit score"),
        ],
        // Recent transactions render via RecentTransactionsPanel (same ledger as Transactions tab).
        tables: [],
        readOnlyConnections: true,
    },
    {
        id: "net-worth",
        label: "Net Worth",
        command: "financial:getNetWorth",
        description: "Assets and liabilities included in your recorded net worth.",
        metrics: [money("totalAssets", "Total assets"), money("totalLiabilities", "Total liabilities"), money("netWorth", "Net worth")],
        tables: [
            {
                key: "breakdown",
                title: "Net worth breakdown",
                empty: "Add an account, card, or debt to build your net worth view.",
                columns: [
                    { key: "name", label: "Account" },
                    { key: "type", label: "Type", format: "status" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "institution", label: "Institution" },
                    { key: "amount", label: "Value", format: "currency", align: "right" },
                ],
            },
        ],
    },

    {
        id: "health",
        label: "Health",
        command: "financial:getHealth",
        description: "A practical financial-health score based on reserves, savings, debt, credit, and budget adherence.",
        metrics: [
            count("healthScore", "Health score", "Out of 100"),
            count("emergencyMonths", "Emergency fund", "Months of spending"),
            percentage("savingsRatePercent", "Savings rate"),
            percentage("debtToAssetsPercent", "Debt to assets"),
            percentage("creditUtilizationPercent", "Credit utilization"),
        ],
        tables: [
            {
                key: "components",
                title: "Score components",
                empty: "Add financial activity to calculate your health score.",
                columns: [
                    { key: "label", label: "Component" },
                    { key: "score", label: "Score", format: "number", align: "right" },
                    { key: "detail", label: "Details" },
                ],
            },
        ],
    },
    {
        id: "alerts",
        label: "Alerts",
        command: "financial:getAlerts",
        description: "Overdue bills, high utilization, budget overruns, and connection issues that need review.",
        metrics: [count("alerts", "Open alerts"), count("critical", "Critical"), count("warnings", "Warnings"), count("information", "Informational")],
        tables: [
            {
                key: "alerts",
                title: "Financial alerts",
                empty: "Everything looks clear. No financial alerts were detected.",
                columns: [
                    { key: "severity", label: "Severity", format: "status" },
                    { key: "title", label: "Alert" },
                    { key: "detail", label: "Details" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                    { key: "dueDate", label: "Due", format: "date" },
                ],
            },
        ],
    },
    {
        id: "forecast",
        label: "Forecast",
        command: "financial:getForecast",
        description: "A six-month cash projection derived from recorded monthly flows and recurring obligations.",
        metrics: [money("startingCash", "Starting cash"), money("averageMonthlyNet", "Average monthly net"), money("recurringObligations", "Recurring obligations"), money("projectedSixMonthCash", "Projected cash in 6 months"), count("historyMonths", "History months")],
        tables: [
            {
                key: "projections",
                title: "Cash projection",
                empty: "No forecast could be generated yet.",
                columns: [
                    { key: "month", label: "Month" },
                    { key: "projectedNetFlow", label: "Projected net flow", format: "currency", align: "right" },
                    { key: "recurringObligations", label: "Recurring obligations", format: "currency", align: "right" },
                    { key: "projectedCash", label: "Projected cash", format: "currency", align: "right" },
                ],
            },
        ],
    },
    {
        id: "calendar",
        label: "Calendar",
        command: "financial:getCalendar",
        description: "Upcoming subscriptions and card payments over the next 90 days.",
        metrics: [count("scheduledEvents", "Scheduled events"), money("next30DaysTotal", "Due in 30 days"), count("overdueEvents", "Overdue"), count("upcomingEvents", "Upcoming")],
        tables: [
            {
                key: "events",
                title: "Bill calendar",
                empty: "No upcoming bills or card payments are scheduled.",
                columns: [
                    { key: "date", label: "Date", format: "date" },
                    { key: "label", label: "Bill" },
                    { key: "kind", label: "Type", format: "status" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                    { key: "overdue", label: "Overdue", format: "boolean" },
                ],
            },
        ],
    },
    {
        id: "accounts",
        label: "Accounts",
        command: "financial:getAccounts",
        description: "Bank, cash, brokerage, and other accounts, including locally mirrored read-only links.",
        metrics: [count("activeAccounts", "Active accounts"), money("assetBalance", "Asset balance"), money("liabilityBalance", "Liability balance"), money("netAccountBalance", "Net account balance"), count("connectedAccounts", "Linked accounts")],
        tables: [
            {
                key: "accounts",
                title: "Financial accounts",
                empty: "No financial accounts have been added.",
                columns: [
                    { key: "name", label: "Account" },
                    { key: "institution", label: "Institution" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "source", label: "Source", format: "status" },
                    { key: "balance", label: "Balance", format: "currency", align: "right" },
                    { key: "lastUpdated", label: "Updated", format: "date" },
                ],
            },
        ],
        readOnlyConnections: true,
    },
    {
        id: "cards",
        label: "Cards",
        command: "financial:getCards",
        description: "Balances, limits, due dates, rewards, and utilization for recorded cards.",
        metrics: [count("activeCards", "Active cards"), money("totalBalance", "Card balances"), money("totalCreditLimit", "Total limit"), percentage("utilizationPercent", "Utilization"), money("minimumPayments", "Minimum payments")],
        tables: [
            {
                key: "cards",
                title: "Cards",
                empty: "No cards have been added.",
                columns: [
                    { key: "name", label: "Card" },
                    { key: "institution", label: "Institution" },
                    { key: "balance", label: "Balance", format: "currency", align: "right" },
                    { key: "creditLimit", label: "Limit", format: "currency", align: "right" },
                    { key: "utilizationPercent", label: "Utilization", format: "percent", align: "right" },
                    { key: "paymentDueAt", label: "Payment due", format: "date" },
                    { key: "source", label: "Source", format: "status" },
                ],
            },
        ],
        readOnlyConnections: true,
    },
    {
        id: "credit",
        label: "Credit",
        command: "financial:getCredit",
        description: "Credit-score history and revolving-credit utilization.",
        metrics: [count("latestScore", "Latest score"), count("scoreEntries", "Score entries"), percentage("utilizationPercent", "Utilization"), money("revolvingBalance", "Revolving balance"), money("availableCredit", "Available credit")],
        tables: [
            {
                key: "scores",
                title: "Credit score history",
                empty: "No credit scores have been recorded.",
                columns: [
                    { key: "date", label: "Date", format: "date" },
                    { key: "bureau", label: "Bureau", format: "status" },
                    { key: "score", label: "Score", format: "number", align: "right" },
                    { key: "notes", label: "Notes" },
                ],
            },
        ],
    },
    {
        id: "debt",
        label: "Debt",
        command: "financial:getDebt",
        description: "Loans and revolving balances with APRs, minimum payments, payoff goals, and strategies.",
        metrics: [
            count("debtAccounts", "Debt accounts"),
            money("totalDebt", "Total debt"),
            money("minimumPayments", "Minimum payments"),
            percentage("weightedAprPercent", "Weighted APR"),
        ],
        tables: [
            {
                key: "debts",
                title: "Debt balances",
                empty: "No debts or card balances have been recorded.",
                columns: [
                    { key: "name", label: "Debt" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "balance", label: "Balance", format: "currency", align: "right" },
                    { key: "aprPercent", label: "APR", format: "percent", align: "right" },
                    { key: "minimumPayment", label: "Minimum", format: "currency", align: "right" },
                    { key: "payoffGoalDate", label: "Payoff goal", format: "date" },
                    { key: "source", label: "Source", format: "status" },
                ],
            },
        ],
    },
    {
        id: "institutions",
        label: "Institutions",
        command: "financial:getInstitutions",
        description: "Institution contacts and the health of read-only Plaid and Alpaca connections.",
        metrics: [count("institutions", "Institutions"), count("connectedInstitutions", "Connections"), count("linkedAccounts", "Linked accounts"), count("connectionIssues", "Connection issues")],
        tables: [
            {
                key: "institutions",
                title: "Institutions",
                empty: "No institutions have been added.",
                columns: [
                    { key: "name", label: "Institution" },
                    { key: "website", label: "Website" },
                    { key: "accountCount", label: "Accounts", format: "number", align: "right" },
                    { key: "cardCount", label: "Cards", format: "number", align: "right" },
                    { key: "contactCount", label: "Contacts", format: "number", align: "right" },
                ],
            },
            {
                key: "connections",
                title: "Read-only connections",
                empty: "No Plaid or Alpaca connections are configured.",
                columns: [
                    { key: "provider", label: "Provider" },
                    { key: "institution", label: "Institution" },
                    { key: "status", label: "Status", format: "status" },
                    { key: "accounts", label: "Accounts", format: "number", align: "right" },
                    { key: "lastSyncedAt", label: "Last synced", format: "date" },
                    { key: "mode", label: "Access", format: "status" },
                ],
            },
        ],
        readOnlyConnections: true,
    },
    {
        id: "transactions",
        label: "Transactions",
        command: "financial:getTransactions",
        description: "The most recent 500 transactions with account, category, source, and pending state.",
        metrics: [count("loadedTransactions", "Transactions loaded"), money("monthIncome", "Income this month"), money("monthSpending", "Spending this month"), money("monthNetCashFlow", "Net cash flow"), count("pendingTransactions", "Pending")],
        tables: [
            {
                key: "transactions",
                title: "Transaction ledger",
                empty: "No transactions have been recorded.",
                columns: [
                    { key: "date", label: "Date", format: "date" },
                    { key: "merchant", label: "Merchant" },
                    { key: "account", label: "Account" },
                    { key: "category", label: "Category" },
                    { key: "source", label: "Source", format: "status" },
                    { key: "pending", label: "Pending", format: "boolean" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                ],
            },
        ],
    },
    {
        id: "statements",
        label: "Statements",
        command: "financial:getStatements",
        description: "Statement files, extraction status, balances, and linked accounts.",
        metrics: [count("statements", "Statements"), count("processed", "Processed"), count("pending", "Pending"), count("failed", "Failed"), count("extractedTransactions", "Extracted transactions")],
        tables: [
            {
                key: "statements",
                title: "Statements",
                empty: "No statements have been imported.",
                columns: [
                    { key: "fileName", label: "Statement" },
                    { key: "owner", label: "Account" },
                    { key: "periodEnd", label: "Period end", format: "date" },
                    { key: "endingBalance", label: "Ending balance", format: "currency", align: "right" },
                    { key: "extractedTransactions", label: "Transactions", format: "number", align: "right" },
                    { key: "status", label: "Status", format: "status" },
                ],
            },
        ],
    },
    {
        id: "import-status",
        label: "Import",
        command: "financial:getImportStatus",
        description: "Processing health and transaction counts for imported financial data.",
        metrics: [count("imports", "Recent imports"), count("completed", "Completed"), count("inProgress", "In progress"), count("failed", "Failed"), percentage("completionPercent", "Completion"), count("importedTransactions", "Imported transactions")],
        tables: [
            {
                key: "recentStatements",
                title: "Recent statement imports",
                empty: "No statement imports have run.",
                columns: [
                    { key: "fileName", label: "File" },
                    { key: "uploadedAt", label: "Uploaded", format: "date" },
                    { key: "status", label: "Status", format: "status" },
                    { key: "transactions", label: "Transactions", format: "number", align: "right" },
                    { key: "fileSize", label: "Size", format: "bytes", align: "right" },
                    { key: "error", label: "Error" },
                ],
            },
            {
                key: "sourceCounts",
                title: "Transactions by source",
                empty: "No transaction sources have been imported.",
                columns: [
                    { key: "source", label: "Source", format: "status" },
                    { key: "transactions", label: "Transactions", format: "number", align: "right" },
                ],
            },
        ],
    },
    {
        id: "subscriptions",
        label: "Subscriptions",
        command: "financial:getSubscriptions",
        description: "Recurring services normalized to monthly and annual cost.",
        metrics: [count("activeSubscriptions", "Active subscriptions"), money("monthlyCost", "Monthly cost"), money("annualCost", "Annual cost"), count("upcomingCharges", "Upcoming charges")],
        tables: [
            {
                key: "subscriptions",
                title: "Subscriptions",
                empty: "No subscriptions have been tracked.",
                columns: [
                    { key: "name", label: "Subscription" },
                    { key: "merchant", label: "Merchant" },
                    { key: "status", label: "Status", format: "status" },
                    { key: "cadence", label: "Cadence", format: "status" },
                    { key: "amount", label: "Charge", format: "currency", align: "right" },
                    { key: "monthlyCost", label: "Monthly cost", format: "currency", align: "right" },
                    { key: "nextChargeOn", label: "Next charge", format: "date" },
                ],
            },
        ],
    },
    {
        id: "income",
        label: "Income",
        command: "financial:getIncome",
        description: "Income streams, recent payments, and a twelve-month trend.",
        metrics: [count("activeStreams", "Active streams"), money("yearToDateIncome", "Year-to-date income"), money("last30DaysIncome", "Last 30 days"), count("paymentsThisYear", "Payments this year")],
        tables: [
            {
                key: "streams",
                title: "Income streams",
                empty: "No income streams have been added.",
                columns: [
                    { key: "name", label: "Stream" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "account", label: "Destination" },
                    { key: "lastPayment", label: "Last payment", format: "currency", align: "right" },
                    { key: "lastReceivedAt", label: "Last received", format: "date" },
                    { key: "paymentCount", label: "Payments", format: "number", align: "right" },
                ],
            },
            {
                key: "monthly",
                title: "Twelve-month income",
                empty: "No income payments were found for the last twelve months.",
                columns: [
                    { key: "month", label: "Month" },
                    { key: "income", label: "Income", format: "currency", align: "right" },
                ],
            },
        ],
    },
    {
        id: "budget",
        label: "Budget",
        command: "financial:getBudget",
        description: "Monthly category targets compared with recorded spending.",
        metrics: [money("monthlyBudget", "Monthly budget"), money("monthSpending", "Month spending"), money("remainingBudget", "Remaining"), percentage("utilizationPercent", "Budget used"), money("uncategorizedSpending", "Uncategorized")],
        tables: [
            {
                key: "categories",
                title: "Budget categories",
                empty: "No budget categories have been configured.",
                columns: [
                    { key: "name", label: "Category" },
                    { key: "parent", label: "Parent" },
                    { key: "monthlyBudget", label: "Budget", format: "currency", align: "right" },
                    { key: "spent", label: "Spent", format: "currency", align: "right" },
                    { key: "remaining", label: "Remaining", format: "currency", align: "right" },
                    { key: "utilizationPercent", label: "Used", format: "percent", align: "right" },
                ],
            },
        ],
    },
    {
        id: "goals",
        label: "Goals",
        command: "financial:getGoals",
        description: "Progress toward savings and other financial targets.",
        metrics: [count("goals", "Goals"), money("totalTarget", "Total target"), money("totalSaved", "Saved"), percentage("overallProgressPercent", "Overall progress")],
        tables: [
            {
                key: "goals",
                title: "Financial goals",
                empty: "No financial goals have been created.",
                columns: [
                    { key: "title", label: "Goal" },
                    { key: "currentAmount", label: "Current", format: "currency", align: "right" },
                    { key: "targetAmount", label: "Target", format: "currency", align: "right" },
                    { key: "remainingAmount", label: "Remaining", format: "currency", align: "right" },
                    { key: "progressPercent", label: "Progress", format: "percent", align: "right" },
                    { key: "targetDate", label: "Target date", format: "date" },
                ],
            },
        ],
    },
    {
        id: "paycheck",
        label: "Paycheck",
        command: "financial:getPaycheck",
        description: "A historical paycheck analysis derived from recorded income entries.",
        metrics: [money("latestPayment", "Latest payment"), money("averagePayment", "Average payment"), money("trailingTwelveMonths", "Trailing 12 months"), money("inferredAnnualIncome", "Inferred annual income"), count("paymentsTracked", "Payments tracked"), { key: "inferredFrequency", label: "Inferred frequency" }],
        tables: [
            {
                key: "paychecks",
                title: "Recorded paychecks",
                empty: "No income entries are available for paycheck analysis.",
                columns: [
                    { key: "date", label: "Date", format: "date" },
                    { key: "stream", label: "Income stream" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "source", label: "Source", format: "status" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                ],
            },
        ],
    },
    {
        id: "reports",
        label: "Reports",
        command: "financial:getReports",
        description: "Twelve-month cash-flow and category-spending reports.",
        metrics: [money("totalIncome", "Total income"), money("totalSpending", "Total spending"), money("netCashFlow", "Net cash flow"), money("averageMonthlySpending", "Average monthly spending")],
        tables: [
            {
                key: "monthly",
                title: "Monthly cash flow",
                empty: "No transactions are available for the reporting period.",
                columns: [
                    { key: "month", label: "Month" },
                    { key: "income", label: "Income", format: "currency", align: "right" },
                    { key: "spending", label: "Spending", format: "currency", align: "right" },
                    { key: "netCashFlow", label: "Net", format: "currency", align: "right" },
                ],
            },
            {
                key: "categories",
                title: "Spending by category",
                empty: "No category spending is available.",
                columns: [
                    { key: "category", label: "Category" },
                    { key: "spending", label: "Spending", format: "currency", align: "right" },
                    { key: "sharePercent", label: "Share", format: "percent", align: "right" },
                ],
            },
        ],
    },
    {
        id: "deductions",
        label: "Deductions",
        command: "financial:getDeductions",
        description: "Current-year transactions explicitly tagged as tax deductible.",
        metrics: [count("taxYear", "Tax year"), count("deductibleTransactions", "Tagged deductions"), money("totalDeductions", "Total deductions"), count("reviewedTransactions", "Transactions reviewed")],
        tables: [
            {
                key: "deductions",
                title: "Deduction ledger",
                empty: "No current-year transactions are tagged as deductible.",
                columns: [
                    { key: "date", label: "Date", format: "date" },
                    { key: "merchant", label: "Merchant" },
                    { key: "category", label: "Transaction category" },
                    { key: "deductionCategory", label: "Deduction category" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                ],
            },
            {
                key: "categories",
                title: "Deductions by category",
                empty: "No deduction categories are available.",
                columns: [
                    { key: "category", label: "Category" },
                    { key: "amount", label: "Amount", format: "currency", align: "right" },
                ],
            },
        ],
    },
    {
        id: "currencies",
        label: "Currencies",
        command: "financial:getCurrencies",
        description: "Account balances converted with the latest locally stored USD exchange rates.",
        metrics: [count("currencies", "Currencies"), count("foreignAccounts", "Foreign-currency accounts"), money("foreignValueUsd", "Foreign value in USD"), count("missingRates", "Missing rates")],
        tables: [
            {
                key: "balances",
                title: "Currency balances",
                empty: "No account balances are available.",
                columns: [
                    { key: "account", label: "Account" },
                    { key: "currency", label: "Currency", format: "status" },
                    { key: "balance", label: "Native balance", format: "number", align: "right" },
                    { key: "rateToUsd", label: "USD rate", format: "number", align: "right" },
                    { key: "valueUsd", label: "Value in USD", format: "currency", align: "right" },
                ],
            },
            {
                key: "rates",
                title: "Exchange rates",
                empty: "No exchange rates are stored.",
                columns: [
                    { key: "code", label: "Currency", format: "status" },
                    { key: "rateToUsd", label: "USD per unit", format: "number", align: "right" },
                    { key: "asOf", label: "As of", format: "date" },
                ],
            },
        ],
    },
    {
        id: "tax",
        label: "Tax",
        command: "financial:getTax",
        description: "Tax-document inventory and four years of income, spending, and tagged deductions.",
        metrics: [count("taxDocuments", "Tax documents"), money("currentYearIncome", "Current-year income"), money("currentYearSpending", "Current-year spending"), money("currentYearDeductions", "Tagged deductions")],
        tables: [
            {
                key: "documents",
                title: "Tax documents",
                empty: "No tax documents have been added.",
                columns: [
                    { key: "taxYear", label: "Tax year", format: "number" },
                    { key: "kind", label: "Kind", format: "status" },
                    { key: "description", label: "Description" },
                    { key: "fileName", label: "File" },
                    { key: "addedAt", label: "Added", format: "date" },
                ],
            },
            {
                key: "years",
                title: "Year summary",
                empty: "No tax-year activity is available.",
                columns: [
                    { key: "year", label: "Year", format: "number" },
                    { key: "income", label: "Income", format: "currency", align: "right" },
                    { key: "spending", label: "Spending", format: "currency", align: "right" },
                    { key: "deductible", label: "Deductions", format: "currency", align: "right" },
                    { key: "documents", label: "Documents", format: "number", align: "right" },
                ],
            },
        ],
    },
];

// Tabs folded into other destinations or retired at the user's request:
//   alerts + import-status → removed; goals → removed; reports + currencies →
//   removed; calendar → the main Overview Calendar surfaces financial due-dates;
//   paycheck → folded into Income.
const REMOVED_FINANCIAL_TABS = new Set(["alerts", "import-status", "goals", "reports", "currencies", "paycheck"]);
const VISIBLE_FINANCIAL_TABS = FINANCIAL_TABS.filter((tab) => !REMOVED_FINANCIAL_TABS.has(tab.id));

export interface FinancialViewProps {
    client: LifeOSClient;
    onNavigate?: unknown;
}

function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function statusTone(value: string): string {
    const normalized = value.toLowerCase();
    if (["critical", "failed", "error", "overdue", "liability"].some((token) => normalized.includes(token))) return "bg-error-primary text-error-primary";
    if (["warning", "pending", "processing", "paused"].some((token) => normalized.includes(token))) return "bg-warning-primary text-warning-primary";
    if (["good", "done", "active", "connected", "asset", "manual"].some((token) => normalized.includes(token))) return "bg-success-primary text-success-primary";
    return "bg-secondary text-secondary";
}

function renderValue(value: unknown, format: CellFormat = "text"): ReactNode {
    if (value == null || value === "") return <span className="text-quaternary">—</span>;
    if (format === "currency") return formatCurrency(Number(value));
    if (format === "percent") return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    if (format === "number") return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (format === "date") return formatDate(String(value));
    if (format === "bytes") return formatBytes(Number(value));
    if (format === "boolean") return value ? "Yes" : "No";
    if (format === "status") {
        const text = titleCase(String(value));
        return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${statusTone(String(value))}`}>{text}</span>;
    }
    return String(value);
}

/** Ledger-style amount: red charges with no minus sign, green credits with a leading +. */
function renderAmount(value: number): ReactNode {
    const isCredit = value > 0;
    return (
        <span className={cx("font-medium tabular-nums", isCredit ? "text-success-primary" : "text-error-primary")}>
            {isCredit ? "+" : ""}
            {formatCurrency(Math.abs(value))}
        </span>
    );
}

function rowsAt(payload: FinancialPayload, key: string): FinancialRow[] {
    const value = payload[key];
    if (!Array.isArray(value)) return [];
    return value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object").map((row, index) => ({ ...row, id: typeof row.id === "string" ? row.id : `${key}:${index}` }));
}

const CATEGORY_FALLBACK_COLOR = "var(--color-brand-500)";

/** Normalize a stored/raw color string for inline styles (legacy chart helpers). */
function resolveCategoryHex(color: unknown): string {
    const text = typeof color === "string" ? color.trim() : "";
    return text && /^#|^rgb|^hsl|^var\(/i.test(text) ? text : CATEGORY_FALLBACK_COLOR;
}

function TransactionCategoryEditor({ client, row, categories }: { client: LifeOSClient; row: FinancialRow; categories: FinancialRow[] }) {
    const [categoryId, setCategoryId] = useState(String(row.categoryId ?? ""));
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const override = useLifeOSMutation(client, "financial:setTransactionCategory");
    const diagnose = useLifeOSMutation(client, "financial:aiCategorizeTransaction");
    const pending = override.pending || diagnose.pending;

    useEffect(() => {
        if (!open) return;
        const onOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", onOutside);
        return () => document.removeEventListener("mousedown", onOutside);
    }, [open]);

    const current = categories.find((category) => String(category.id) === categoryId);
    const currentName = current ? String(current.name) : "Uncategorized";
    const currentColor = typeof current?.color === "string" ? current.color : undefined;

    const apply = async (next: string) => {
        setCategoryId(next);
        setOpen(false);
        try { await override.mutate({ id: row.id, categoryId: next || null, notes: "Category overridden in Coretex" }); } catch { /* shown inline */ }
    };
    const runAi = async () => {
        try {
            const result = await diagnose.mutate<{ categoryId?: string }>({ id: row.id });
            if (result.categoryId) setCategoryId(result.categoryId);
        } catch { /* shown inline */ }
    };
    return (
        <div ref={containerRef} className="relative flex min-w-52 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            <button
                type="button"
                disabled={pending}
                onClick={() => setOpen((value) => !value)}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Category for ${String(row.merchant ?? "transaction")}`}
                className={`${INPUT_CLASS} flex min-w-36 items-center justify-between gap-2 py-1.5 text-xs disabled:opacity-50`}
            >
                <CategoryBadge name={currentName} color={currentColor} />
                <ChevronDown className="size-3.5 shrink-0 text-quaternary" />
            </button>
            {open && (
                <div role="listbox" className="absolute top-full left-0 z-20 mt-1 max-h-64 w-56 overflow-auto rounded-lg border border-secondary bg-primary py-1 shadow-lg">
                    <button type="button" role="option" aria-selected={!categoryId} onClick={() => void apply("")} className="flex w-full items-center px-2 py-1.5 text-left hover:bg-primary_hover">
                        <CategoryBadge name="Uncategorized" />
                    </button>
                    {categories.map((category) => (
                        <button key={String(category.id)} type="button" role="option" aria-selected={categoryId === String(category.id)} onClick={() => void apply(String(category.id))} className="flex w-full items-center px-2 py-1.5 text-left hover:bg-primary_hover">
                            <CategoryBadge name={String(category.name)} color={typeof category.color === "string" ? category.color : undefined} />
                        </button>
                    ))}
                </div>
            )}
            <button type="button" disabled={pending} onClick={() => void runAi()} title="Analyze category with Ollama" className="grid size-8 shrink-0 place-items-center rounded-lg border border-secondary text-brand-secondary transition hover:bg-brand-primary disabled:opacity-50"><Stars01 className={`size-4 ${diagnose.pending ? "animate-pulse" : ""}`} /></button>
            {(override.error || diagnose.error) && <span className="sr-only" role="alert">{override.error || diagnose.error}</span>}
        </div>
    );
}

interface FinancialFilePayload {
    fileName: string;
    mimeType: string;
    base64: string;
}

function DocumentPreviewModal({ file, open, onOpenChange, description, title }: { file: FinancialFilePayload | null; open: boolean; onOpenChange: (open: boolean) => void; description?: string; title?: string }) {
    const fileUrl = file ? `data:${file.mimeType || "application/octet-stream"};base64,${file.base64}` : "";
    const isPdf = Boolean(file && (/pdf/i.test(file.mimeType) || /\.pdf$/i.test(file.fileName)));
    const isImage = Boolean(file && (/^image\//i.test(file.mimeType) || /\.(png|jpe?g|gif|webp)$/i.test(file.fileName)));
    let textPreview = "";
    if (file && !isPdf && !isImage) {
        try {
            const bytes = Uint8Array.from(window.atob(file.base64), (character) => character.charCodeAt(0));
            textPreview = new TextDecoder().decode(bytes).slice(0, 100_000);
        } catch {
            textPreview = "This file cannot be rendered as text.";
        }
    }
    return (
        <FormModal isOpen={open} onOpenChange={onOpenChange} title={title ?? file?.fileName ?? "Document preview"} description={description} className="max-w-5xl">
            <div className="h-[min(72vh,760px)] overflow-hidden rounded-xl border border-secondary bg-secondary">
                {isPdf ? (
                    <iframe title={file?.fileName ?? "PDF preview"} src={fileUrl} className="size-full bg-white" />
                ) : isImage ? (
                    <div className="flex size-full items-center justify-center overflow-auto p-4"><img src={fileUrl} alt={file?.fileName ?? "Document"} className="max-h-full max-w-full rounded-lg object-contain" /></div>
                ) : (
                    <pre className="size-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-secondary">{textPreview || "No text preview is available."}</pre>
                )}
            </div>
        </FormModal>
    );
}

function FinancialDocumentActions({ client, row, kind }: { client: LifeOSClient; row: FinancialRow; kind: "statement" | "tax" }) {
    const [file, setFile] = useState<FinancialFilePayload | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const preview = useLifeOSMutation(client, "financial:getFinancialFile");
    const reanalyze = useLifeOSMutation(client, kind === "statement" ? "financial:reanalyzeStatement" : "financial:reanalyzeTaxDocument");
    const openPreview = async () => {
        try {
            const result = await preview.mutate<FinancialFilePayload>({ id: row.id });
            setFile(result);
            setPreviewOpen(true);
        } catch {
            // The validated bridge error is rendered next to the actions.
        }
    };
    const runAnalysis = async () => {
        try { await reanalyze.mutate({ id: row.id }); } catch { /* rendered below */ }
    };
    return (
        <>
            <div className="flex min-w-40 items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                <button type="button" disabled={preview.pending || !row.fileName || (kind === "tax" && !row.hasFile)} onClick={() => void openPreview()} className={`${SECONDARY_BUTTON} px-2.5 py-1.5 text-xs`}><File02 className="size-4" /> {kind === "statement" ? "View statement" : "Preview"}</button>
                <button type="button" disabled={reanalyze.pending || !row.fileName || (kind === "tax" && !row.hasFile)} onClick={() => void runAnalysis()} title="Re-run local AI extraction" className="grid size-8 place-items-center rounded-lg border border-secondary text-brand-secondary transition hover:bg-brand-primary disabled:opacity-50"><RefreshCcw01 className={`size-4 ${reanalyze.pending ? "animate-spin" : ""}`} /></button>
                {(preview.error || reanalyze.error) && <span className="max-w-44 text-xs text-error-primary" role="alert">{preview.error || reanalyze.error}</span>}
            </div>
            <DocumentPreviewModal file={file} open={previewOpen} onOpenChange={setPreviewOpen} title={kind === "statement" ? "Statement preview" : undefined} description={kind === "statement" ? "Original statement with AI-extracted metadata retained alongside the file." : "Original tax document stored in the local Coretex financial vault."} />
        </>
    );
}

function TransactionSourceCell({ client, row }: { client: LifeOSClient; row: FinancialRow }) {
    const [file, setFile] = useState<FinancialFilePayload | null>(null);
    const [open, setOpen] = useState(false);
    const preview = useLifeOSMutation(client, "financial:getFinancialFile");
    const statementId = row.statementId ? String(row.statementId) : "";
    const fileName = row.statement ? String(row.statement) : "";
    if (!statementId || !fileName) return renderValue(row.source, "status");
    const openPreview = async () => {
        try {
            const result = await preview.mutate<FinancialFilePayload>({ id: statementId });
            setFile(result);
            setOpen(true);
        } catch {
            // If the file can't be loaded the button simply won't open a preview.
        }
    };
    return (
        <>
            <button
                type="button"
                onClick={(event) => { event.stopPropagation(); void openPreview(); }}
                disabled={preview.pending}
                title="View linked statement"
                className="flex max-w-[11rem] items-center gap-1 truncate text-left text-xs font-medium text-brand-secondary hover:underline disabled:opacity-50"
            >
                <File02 className="size-3.5 shrink-0" /> <span className="truncate">View statement</span>
            </button>
            <DocumentPreviewModal file={file} open={open} onOpenChange={setOpen} title="Statement preview" description="Source statement linked to this transaction." />
        </>
    );
}

function isPendingRow(row: FinancialRow): boolean {
    const p = row.pending;
    return p === true || p === "true" || p === 1 || String(p).toLowerCase() === "pending";
}

function TransactionDetailSlideout({ client, row, onClose }: { client: LifeOSClient; row: FinancialRow; onClose: () => void }) {
    const amount = Number(row.amount ?? 0);
    const merchant = String(row.merchant ?? row.description ?? "Transaction");
    const domain = merchantLogoDomain(merchant);
    const categoryName = String(row.category ?? "Uncategorized");
    const categoryHex = categoryColor(categoryName, row.categoryColor != null ? String(row.categoryColor) : null);
    const statementId = row.statementId ? String(row.statementId) : "";
    const statementName = row.statement ? String(row.statement) : "";
    const [statementFile, setStatementFile] = useState<FinancialFilePayload | null>(null);
    const [statementOpen, setStatementOpen] = useState(false);
    const previewStatement = useLifeOSMutation(client, "financial:getFinancialFile");
    const openStatement = async () => {
        try {
            const result = await previewStatement.mutate<FinancialFilePayload>({ id: statementId });
            setStatementFile(result);
            setStatementOpen(true);
        } catch {
            // Error surface via previewStatement.error below.
        }
    };
    // z-[120]: above status-cluster (z-40), terminal dock, and floating widgets (z-100).
    // fixed + overflow-hidden locks the page; only the panel body scrolls.
    return (
        <div
            className="fixed inset-0 z-[120] flex justify-end overflow-hidden overscroll-none"
            style={{ background: "rgba(0,0,0,0.45)" }}
            onMouseDown={onClose}
            onWheel={(event) => event.preventDefault()}
        >
            <aside
                className="flex h-dvh max-h-dvh w-full max-w-md flex-col shadow-2xl"
                style={{ background: "var(--surface)", borderLeft: "1px solid var(--c-border)" }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <header className="flex shrink-0 items-start gap-3 border-b border-secondary px-5 py-4">
                    <BrandLogo domain={domain} name={merchant} size={36} />
                    <div className="min-w-0 flex-1">
                        <h2 className="truncate text-md font-semibold text-primary">{merchant}</h2>
                        <p className="text-xs text-tertiary">{formatDate(String(row.date ?? ""))} · {String(row.account ?? row.source ?? "—")}</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-quaternary hover:bg-secondary" aria-label="Close">
                        <ArrowLeft className="size-4 rotate-180" />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5" onWheel={(event) => event.stopPropagation()}>
                    <p className={cx("text-2xl font-semibold tabular-nums", amount < 0 ? "text-error-primary" : "text-success-primary")}>
                        {formatCurrency(amount)}
                    </p>
                    <dl className="mt-5 grid gap-3 text-sm">
                        <div className="flex items-center justify-between gap-3 border-b border-secondary py-2">
                            <dt className="text-tertiary">Category</dt>
                            <dd className="max-w-[70%] text-right">
                                <CategoryBadge name={categoryName} color={categoryHex} />
                            </dd>
                        </div>
                        {(
                            [
                                ["Account", String(row.account ?? row.accountName ?? "—")],
                                ["Source", titleCase(String(row.source ?? "manual"))],
                                ["Currency", String(row.currency ?? "USD")],
                                ["Status", isPendingRow(row) ? "Pending" : "Posted"],
                                ["Notes", String(row.notes ?? "—")],
                                ["ID", String(row.id ?? "—")],
                            ] as const
                        ).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3 border-b border-secondary py-2">
                                <dt className="text-tertiary">{k}</dt>
                                <dd className="max-w-[60%] truncate text-right font-medium text-primary">{v}</dd>
                            </div>
                        ))}
                    </dl>
                    {statementId && (
                        <button
                            type="button"
                            onClick={() => void openStatement()}
                            disabled={previewStatement.pending}
                            className={`${SECONDARY_BUTTON} mt-5 w-full`}
                        >
                            <File02 className="size-4" /> {previewStatement.pending ? "Loading…" : statementName ? `View statement` : "View statement"}
                        </button>
                    )}
                    {previewStatement.error && <p className="mt-2 text-xs text-error-primary" role="alert">{previewStatement.error}</p>}
                </div>
            </aside>
            <DocumentPreviewModal file={statementFile} open={statementOpen} onOpenChange={setStatementOpen} title="Statement preview" description="Source statement linked to this transaction." />
        </div>
    );
}

/** Best-effort domain for LogoKit / Clearbit-style merchant logos. */
function merchantLogoDomain(merchant: string): string {
    const cleaned = merchant.trim().toLowerCase().replace(/[^a-z0-9.\s-]/g, "").replace(/\s+/g, "");
    if (!cleaned) return "example.com";
    if (cleaned.includes(".")) return cleaned;
    return `${cleaned}.com`;
}

function AddTransactionButton({
    client,
    payload,
    defaultOpen = false,
    hideTrigger = false,
    onOpenChange,
}: {
    client: LifeOSClient;
    payload: FinancialPayload;
    defaultOpen?: boolean;
    hideTrigger?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const create = useLifeOSMutation(client, "financial:createTransaction");
    const ownerOptions = [
        ...optionRows(payload, "accounts").map((option) => ({ value: `account:${option.value}`, label: `Account · ${option.label}` })),
        ...optionRows(payload, "cards").map((option) => ({ value: `card:${option.value}`, label: `Card · ${option.label}` })),
    ];
    const changeOpen = (nextOpen: boolean) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };
    const fields: EditorField[] = [
        { key: "merchant", label: "Merchant or description", required: true, placeholder: "Groceries" },
        { key: "amount", label: "Amount", type: "number", required: true, step: 0.01, placeholder: "Negative for spending" },
        { key: "date", label: "Date", type: "date", required: true, defaultValue: localDateValue() },
        { key: "currency", label: "Currency", defaultValue: "USD" },
        { key: "ownerRef", label: "Account or card", type: "select", options: ownerOptions },
        { key: "categoryId", label: "Category", type: "select", options: optionRows(payload, "categories") },
        { key: "pending", label: "Pending", type: "checkbox" },
        { key: "notes", label: "Notes", type: "textarea", wide: true },
    ];
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = formPayload(form, fields);
        const ownerRef = String(data.ownerRef ?? "");
        delete data.ownerRef;
        data.finAccountId = ownerRef.startsWith("account:") ? ownerRef.slice("account:".length) : null;
        data.creditCardId = ownerRef.startsWith("card:") ? ownerRef.slice("card:".length) : null;
        try {
            await create.mutate(data);
            changeOpen(false);
            form.reset();
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };
    return (
        <>
            {!hideTrigger && <button type="button" onClick={() => changeOpen(true)} className={`${PRIMARY_BUTTON} shrink-0`}><Plus className="size-4" /> Add transaction</button>}
            <FormModal isOpen={open} onOpenChange={changeOpen} title="Add transaction" description="Create a manual transaction record." className="max-w-3xl">
                {create.error && <div role="alert" className="mb-3 rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{create.error}</div>}
                <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
                    {fields.map((field) => <EditorInput key={field.key} field={field} row={null} />)}
                    <div className="flex items-center justify-end gap-2 lg:col-span-2">
                        <button type="button" onClick={() => changeOpen(false)} className={SECONDARY_BUTTON}>Cancel</button>
                        <button type="submit" disabled={create.pending} className={PRIMARY_BUTTON}><Plus className="size-4" /> Add transaction</button>
                    </div>
                </form>
            </FormModal>
        </>
    );
}

function QuickTransactionModal({ client, onClose }: { client: LifeOSClient; onClose: () => void }) {
    const query = useLifeOSQuery<FinancialPayload>(client, "financial:getOverview");
    if (query.data) {
        return <AddTransactionButton client={client} payload={query.data} defaultOpen hideTrigger onOpenChange={(open) => { if (!open) onClose(); }} />;
    }
    return (
        <FormModal isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Add transaction" description="Loading account and category options…" className="max-w-3xl">
            <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
                <div className="h-36" />
            </QueryBoundary>
        </FormModal>
    );
}

function FinancialTable({ client, payload, config, onNavigateTab }: { client: LifeOSClient; payload: FinancialPayload; config: TableConfig; onNavigateTab?: (tabId: string) => void }) {
    const rawRows = rowsAt(payload, config.key);
    // Never show pending rows in transaction tables — only posted activity.
    const rows = useMemo(
        () => (config.key === "transactions" || config.key === "recentTransactions"
            ? rawRows.filter((row) => !isPendingRow(row))
            : rawRows),
        [rawRows, config.key],
    );
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [detail, setDetail] = useState<FinancialRow | null>(null);
    const isLedger = config.key === "transactions";

    // Ledger-only filtering: merchant filter (set by clicking a merchant) plus an
    // advanced-filters panel. Declared unconditionally to keep hooks stable; unused
    // (and un-rendered) for every other table.
    const [merchantFilter, setMerchantFilter] = useState("");
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [filterAccount, setFilterAccount] = useState("");
    const [filterCategory, setFilterCategory] = useState("");
    const [filterSource, setFilterSource] = useState("");
    const [filterDateFrom, setFilterDateFrom] = useState("");
    const [filterDateTo, setFilterDateTo] = useState("");
    const [filterAmountMin, setFilterAmountMin] = useState("");
    const [filterAmountMax, setFilterAmountMax] = useState("");

    const filterOptions = useMemo(() => {
        if (!isLedger) return { accounts: [] as string[], categories: [] as string[], sources: [] as string[] };
        const accounts = new Set<string>();
        const categories = new Set<string>();
        const sources = new Set<string>();
        for (const row of rows) {
            if (row.account) accounts.add(String(row.account));
            if (row.category) categories.add(String(row.category));
            if (row.source) sources.add(String(row.source));
        }
        return { accounts: Array.from(accounts).sort(), categories: Array.from(categories).sort(), sources: Array.from(sources).sort() };
    }, [rows, isLedger]);

    const activeFilterCount = [filterAccount, filterCategory, filterSource, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax].filter(Boolean).length;
    const clearFilters = () => {
        setFilterAccount(""); setFilterCategory(""); setFilterSource("");
        setFilterDateFrom(""); setFilterDateTo(""); setFilterAmountMin(""); setFilterAmountMax("");
    };

    const filteredRows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        let result = needle
            ? rows.filter((row) => Object.values(row).some((value) => {
                if (value == null) return false;
                if (typeof value === "object") return JSON.stringify(value).toLowerCase().includes(needle);
                return String(value).toLowerCase().includes(needle);
            }))
            : rows;
        if (isLedger) {
            if (merchantFilter) result = result.filter((row) => String(row.merchant ?? "") === merchantFilter);
            if (filterAccount) result = result.filter((row) => String(row.account ?? "") === filterAccount);
            if (filterCategory) result = result.filter((row) => String(row.category ?? "") === filterCategory);
            if (filterSource) result = result.filter((row) => String(row.source ?? "") === filterSource);
            if (filterDateFrom) result = result.filter((row) => String(row.date ?? "") >= filterDateFrom);
            if (filterDateTo) result = result.filter((row) => String(row.date ?? "") <= filterDateTo);
            if (filterAmountMin !== "") { const min = Number(filterAmountMin); result = result.filter((row) => numeric(row.amount) >= min); }
            if (filterAmountMax !== "") { const max = Number(filterAmountMax); result = result.filter((row) => numeric(row.amount) <= max); }
        }
        return result;
    }, [query, rows, isLedger, merchantFilter, filterAccount, filterCategory, filterSource, filterDateFrom, filterDateTo, filterAmountMin, filterAmountMax]);
    const pageSize = 100;
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
    const isTxn = config.key === "transactions" || config.key === "recentTransactions";
    const columns = useMemo<TableColumn<FinancialRow>[]>(() => {
        const base = config.columns
            .filter((column) => column.key !== "pending") // hide pending column entirely
            .map((column) => ({
                key: column.key,
                label: column.label,
                align: column.align,
                render: (row: FinancialRow) => {
                    if (column.key === "merchant" && isTxn) {
                        const name = String(row.merchant ?? "—");
                        return (
                            <button
                                type="button"
                                onClick={() => (isLedger ? setMerchantFilter(name) : setDetail(row))}
                                title={isLedger ? `Filter to ${name}` : undefined}
                                className="flex min-w-0 max-w-xs items-center gap-2 text-left transition hover:text-brand-secondary"
                            >
                                <BrandLogo domain={merchantLogoDomain(name)} name={name} size={22} />
                                <span className="truncate font-medium text-primary">{name}</span>
                            </button>
                        );
                    }
                    if (column.key === "account" && isLedger) {
                        const name = String(row.account ?? "—");
                        return <button type="button" onClick={() => onNavigateTab?.("accounts")} title="Go to Accounts" className="truncate text-left text-primary hover:text-brand-secondary hover:underline">{name}</button>;
                    }
                    if (column.key === "category" && (isLedger || isTxn)) {
                        const name = String(row.category ?? "Uncategorized");
                        const color = row.categoryColor != null ? String(row.categoryColor) : null;
                        return (
                            <button type="button" onClick={() => onNavigateTab?.("budget")} title="Go to Budget" className="max-w-full text-left">
                                <CategoryBadge name={name} color={color} />
                            </button>
                        );
                    }
                    if (column.key === "source" && isLedger) {
                        return <TransactionSourceCell client={client} row={row} />;
                    }
                    if (column.key === "fileName" && config.key === "statements") {
                        const period = row.periodEnd || row.periodStart;
                        return <span className="font-medium text-primary">Statement{period ? ` · ${formatMonthYear(String(period))}` : ""}</span>;
                    }
                    if (column.key === "amount" && isTxn) {
                        return renderAmount(numeric(row.amount));
                    }
                    return renderValue(row[column.key], column.format);
                },
            }));
        if (config.key === "transactions") {
            base.push({ key: "categoryActions", label: "Categorize", align: undefined, render: (row: FinancialRow) => <TransactionCategoryEditor client={client} row={row} categories={rowsAt(payload, "categories")} /> });
            base.push({ key: "open", label: "", align: "right", render: (row: FinancialRow) => (
                <button type="button" className={`${SECONDARY_BUTTON} px-2 py-1 text-xs`} onClick={() => setDetail(row)}>Details</button>
            ) });
        }
        if (config.key === "statements") {
            base.push({ key: "documentActions", label: "Document", align: undefined, render: (row: FinancialRow) => <FinancialDocumentActions client={client} row={row} kind="statement" /> });
        }
        if (config.key === "documents") {
            base.push({ key: "documentActions", label: "Document", align: undefined, render: (row: FinancialRow) => <FinancialDocumentActions client={client} row={row} kind="tax" /> });
        }
        return base;
    }, [client, config, payload, isTxn, isLedger, onNavigateTab]);
    return (
        <>
        <PersonalCard
            title={config.title}
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block w-full max-w-72">
                        <span className="sr-only">Search {config.title}</span>
                        <SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-quaternary" />
                        <input
                            value={query}
                            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                            placeholder={`Search all ${rows.length.toLocaleString()} records`}
                            className={`${INPUT_CLASS} pl-9`}
                        />
                    </label>
                    {isLedger && (
                        <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-pressed={filtersOpen} className={`${SECONDARY_BUTTON} shrink-0`}>
                            <FilterLines className="size-4" /> Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                        </button>
                    )}
                    {isLedger && <AddTransactionButton client={client} payload={payload} />}
                </div>
            }
        >
            {isLedger && filtersOpen && (
                <div className="mb-4 grid gap-3 rounded-xl border border-secondary bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Account
                        <RichSelect value={filterAccount} onChange={(event) => setFilterAccount(event.target.value)} placeholder="All accounts" options={filterOptions.accounts.map((option) => ({ value: option, label: option }))} />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Category
                        <RichSelect value={filterCategory} onChange={(event) => setFilterCategory(event.target.value)} placeholder="All categories" options={filterOptions.categories.map((option) => ({ value: option, label: option }))} />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Source
                        <RichSelect value={filterSource} onChange={(event) => setFilterSource(event.target.value)} placeholder="All sources" options={filterOptions.sources.map((option) => ({ value: option, label: titleCase(option) }))} />
                    </label>
                    <div className="flex flex-col gap-1.5 text-xs font-medium text-secondary">
                        Date range
                        <div className="flex items-center gap-1.5">
                            <input type="date" value={filterDateFrom} onChange={(event) => setFilterDateFrom(event.target.value)} className={INPUT_CLASS} />
                            <input type="date" value={filterDateTo} onChange={(event) => setFilterDateTo(event.target.value)} className={INPUT_CLASS} />
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5 text-xs font-medium text-secondary sm:col-span-2 lg:col-span-2">
                        Amount range
                        <div className="flex items-center gap-1.5">
                            <input type="number" step="0.01" placeholder="Min" value={filterAmountMin} onChange={(event) => setFilterAmountMin(event.target.value)} className={INPUT_CLASS} />
                            <input type="number" step="0.01" placeholder="Max" value={filterAmountMax} onChange={(event) => setFilterAmountMax(event.target.value)} className={INPUT_CLASS} />
                        </div>
                    </div>
                    <div className="flex items-end sm:col-span-2 lg:col-span-2">
                        <button type="button" onClick={clearFilters} disabled={activeFilterCount === 0} className={`${SECONDARY_BUTTON} w-full disabled:opacity-50`}>Clear filters</button>
                    </div>
                </div>
            )}
            {isLedger && merchantFilter && (
                <div className="mb-4 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-3 py-1 text-xs font-medium text-brand-secondary">
                        Merchant: {merchantFilter}
                        <button type="button" onClick={() => setMerchantFilter("")} aria-label="Clear merchant filter" className="rounded-full hover:opacity-70"><XClose className="size-3.5" /></button>
                    </span>
                </div>
            )}
            <PersonalTable rows={pageRows} columns={columns} empty={query ? "No records match this search." : config.empty} />
            {filteredRows.length > pageSize && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-4">
                    <p className="text-xs text-tertiary">
                        Showing {((safePage - 1) * pageSize + 1).toLocaleString()}–{Math.min(safePage * pageSize, filteredRows.length).toLocaleString()} of {filteredRows.length.toLocaleString()}
                    </p>
                    <div className="flex items-center gap-1" aria-label="Table pages">
                        <button type="button" className={SECONDARY_BUTTON} disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))}><ChevronLeft className="size-4" /> Previous</button>
                        <div className="w-28"><RichSelect value={String(safePage)} onChange={(event) => setPage(Number(event.target.value))} aria-label="Select page" options={Array.from({ length: totalPages }, (_, index) => ({ value: String(index + 1), label: `Page ${index + 1}` }))} /></div>
                        <button type="button" className={SECONDARY_BUTTON} disabled={safePage >= totalPages} onClick={() => setPage(Math.min(totalPages, safePage + 1))}>Next <ChevronRight className="size-4" /></button>
                    </div>
                </div>
            )}
        </PersonalCard>
        {detail && <TransactionDetailSlideout client={client} row={detail} onClose={() => setDetail(null)} />}
        </>
    );
}

function Recommendations({ payload }: { payload: FinancialPayload }) {
    if (!payload.recommendations) return null;
    return (
        <PersonalCard title={payload.grade ? `Recommendations · ${payload.grade}` : "Recommendations"}>
            {payload.recommendations.length > 0 ? (
                <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-secondary">
                    {payload.recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
                </ul>
            ) : (
                <EmptyMessage>No immediate financial-health recommendations were triggered.</EmptyMessage>
            )}
        </PersonalCard>
    );
}

const numeric = (value: unknown): number => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

function chartDataFor(tabId: string, payload: FinancialPayload): { title: string; data: TrendPoint[]; series: Array<{ key: string; name: string; color?: string }>; type?: "line" | "area" | "bar"; money?: boolean; unit?: string } | null {
    if (tabId === "overview" || tabId === "reports") return {
        title: tabId === "overview" ? "Twelve-month cash flow" : "Cash-flow report",
        data: rowsAt(payload, "monthly").map((row) => ({ label: String(row.month ?? ""), income: numeric(row.income), spending: numeric(row.spending), net: numeric(row.netCashFlow) })),
        series: [
            { key: "income", name: "Income", color: "var(--c-success, #12b76a)" },
            { key: "spending", name: "Spending", color: "var(--c-error, #f04438)" },
            { key: "net", name: "Net", color: "var(--brand, #7f56d9)" },
        ],
    };
    if (tabId === "net-worth") return {
        title: "Net worth history",
        data: rowsAt(payload, "history").map((row) => ({ label: String(row.date ?? ""), assets: numeric(row.assets), liabilities: numeric(row.liabilities), netWorth: numeric(row.netWorth) })),
        series: [
            { key: "assets", name: "Assets", color: "var(--color-success-solid)" },
            { key: "liabilities", name: "Liabilities", color: "var(--color-error-solid)" },
            { key: "netWorth", name: "Net worth", color: "var(--color-brand-500)" },
        ],
    };
    if (tabId === "forecast") return {
        title: "Projected cash position",
        data: rowsAt(payload, "projections").map((row) => ({ label: String(row.month ?? ""), cash: numeric(row.projectedCash), net: numeric(row.projectedNetFlow), obligations: numeric(row.recurringObligations) })),
        series: [
            { key: "cash", name: "Projected cash", color: "var(--color-brand-500)" },
            { key: "net", name: "Monthly net", color: "var(--color-success-solid)" },
            { key: "obligations", name: "Recurring obligations", color: "var(--color-warning-solid)" },
        ],
        type: "area",
    };
    // Accounts & cards: no top balance line charts — the product grid below is the surface.
    if (tabId === "accounts" || tabId === "cards") return null;
    if (tabId === "credit") return {
        title: "Credit score history",
        data: rowsAt(payload, "scores").map((row) => ({ label: String(row.date ?? ""), score: numeric(row.score) })),
        series: [{ key: "score", name: "Credit score", color: "var(--color-brand-500)" }],
        money: false,
        unit: "pts",
    };
    if (tabId === "income") return {
        title: "Income trend",
        data: rowsAt(payload, "monthly").map((row) => ({ label: String(row.month ?? ""), income: numeric(row.income) })),
        series: [{ key: "income", name: "Income", color: "var(--color-success-solid)" }],
        type: "area",
    };
    if (tabId === "budget") return {
        title: "Budget by category",
        data: rowsAt(payload, "categories").map((row) => ({ label: String(row.name ?? "Category"), budget: numeric(row.monthlyBudget), spent: numeric(row.spent) })),
        series: [
            { key: "budget", name: "Budget", color: "var(--color-brand-500)" },
            { key: "spent", name: "Spent", color: "var(--color-warning-solid)" },
        ],
    };
    if (tabId === "deductions") return {
        title: "Deductions by category",
        data: rowsAt(payload, "categories").map((row) => ({ label: String(row.category ?? "Other"), amount: numeric(row.amount) })),
        series: [{ key: "amount", name: "Deductible", color: "var(--color-success-solid)" }],
        type: "area",
    };
    return null;
}

function CashFlowChart({ title, allData, series }: { title: string; allData: TrendPoint[]; series: Array<{ key: string; name: string; color?: string }> }) {
    // Window through the series so users can scrub past/future 12-month blocks.
    const windowSize = 12;
    const maxOffset = Math.max(0, allData.length - windowSize);
    const [offset, setOffset] = useState(maxOffset); // default: most recent 12 months
    const slice = allData.slice(Math.max(0, offset), Math.max(0, offset) + windowSize);
    const labelStart = slice[0]?.label ?? "—";
    const labelEnd = slice[slice.length - 1]?.label ?? "—";
    return (
        <PersonalCard
            title={title}
            action={
                <div className="flex items-center gap-1.5">
                    <button type="button" className={SECONDARY_BUTTON} disabled={offset <= 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} aria-label="Earlier months">
                        <ChevronLeft className="size-4" />
                    </button>
                    <span className="min-w-[9rem] text-center text-xs font-medium text-tertiary tabular-nums">{labelStart} – {labelEnd}</span>
                    <button type="button" className={SECONDARY_BUTTON} disabled={offset >= maxOffset} onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))} aria-label="Later months">
                        <ChevronRight className="size-4" />
                    </button>
                </div>
            }
        >
            <TrendChart data={slice} series={series} type="bar" money fitDomain={false} height={300} emptyLabel="No cash-flow history yet" />
            <p className="mt-2 text-[11px] text-quaternary">Hover any bar for income, spending, and net. Use the arrows to walk earlier/later months.</p>
        </PersonalCard>
    );
}

function FinancialVisualization({ tabId, payload }: { tabId: string; payload: FinancialPayload }) {
    if (tabId === "calendar") {
        const events: BillCalendarEvent[] = rowsAt(payload, "events").filter((row) => typeof row.date === "string").map((row) => ({
            id: String(row.id),
            date: String(row.date),
            label: String(row.label ?? "Scheduled item"),
            amount: numeric(row.amount),
            kind: String(row.kind).includes("CARD") ? "card" : String(row.kind).includes("INCOME") ? "income" : "subscription",
            overdue: Boolean(row.overdue),
        }));
        return <BillCalendar events={events} todayIso={localDateValue()} />;
    }
    const chart = chartDataFor(tabId, payload);
    if (!chart) return null;
    const budgetSlices = tabId === "budget"
        ? rowsAt(payload, "categories").filter((row) => numeric(row.spent) > 0).map((row, index) => ({ name: String(row.name ?? "Category"), value: numeric(row.spent), color: ["#7f56d9", "#2e90fa", "#12b76a", "#f79009", "#f04438", "#ee46bc"][index % 6] }))
        : [];
    if (tabId === "overview" || tabId === "reports") {
        return <CashFlowChart title={chart.title} allData={chart.data} series={chart.series} />;
    }
    return (
        <div className={budgetSlices.length ? "grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]" : ""}>
            <PersonalCard title={chart.title}>
                <TrendChart data={chart.data} series={chart.series} type={chart.type ?? "line"} money={chart.money !== false} unit={chart.unit} fitDomain height={300} emptyLabel={`No ${chart.title.toLowerCase()} yet`} />
            </PersonalCard>
            {budgetSlices.length > 0 && (
                <PersonalCard title="Spending mix">
                    <DonutChart data={budgetSlices} height={300} emptyLabel="No categorized spending yet" />
                </PersonalCard>
            )}
        </div>
    );
}

const fileToBase64 = async (file: File): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 32_768;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
    }
    return window.btoa(binary);
};

function FinancialImportZone({ client }: { client: LifeOSClient }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const importer = useLifeOSMutation(client, "financial:importFile");

    const importFiles = async (files: File[]) => {
        if (files.length === 0) return;
        setMessage(null);
        let imported = 0;
        for (const file of files) {
            if (file.size > 20 * 1024 * 1024) {
                setMessage(`${file.name} is larger than the 20 MB local import limit.`);
                continue;
            }
            try {
                const result = await importer.mutate<{ classification?: string; transactionCount?: number; owner?: string }>({
                    fileName: file.name,
                    mimeType: file.type || "application/octet-stream",
                    size: file.size,
                    base64: await fileToBase64(file),
                });
                imported += 1;
                setMessage(`${file.name}: ${result.classification ?? "financial document"} assigned to ${result.owner ?? "Unassigned"}; ${result.transactionCount ?? 0} transactions synchronized.`);
            } catch {
                // The mutation helper exposes the backend error next to the zone.
            }
        }
        if (imported > 1) setMessage(`${imported} files imported, classified, and synchronized.`);
        if (inputRef.current) inputRef.current.value = "";
    };

    return (
        <PersonalCard>
            <div
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
                onDrop={(event) => { event.preventDefault(); setDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }}
                className={`relative overflow-hidden rounded-xl border border-dashed p-6 transition ${dragging ? "border-brand bg-brand-primary" : "border-secondary bg-secondary"}`}
            >
                <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-brand-solid/10 blur-3xl" />
                <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-brand-secondary shadow-xs ring-1 ring-secondary ring-inset"><UploadCloud02 className="size-6" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                            <h2 className="text-md font-semibold text-primary">Drop financial files here</h2>
                            <span className="inline-flex items-center gap-1 rounded-md bg-brand-primary px-2 py-0.5 text-xs font-medium text-brand-secondary"><Stars01 className="size-3" /> AI classification</span>
                        </div>
                        <p className="mt-1 text-sm text-tertiary">PDF statements and CSV exports are detected, matched to an account or card, deduplicated, categorized, and synchronized into the ledger.</p>
                        {(message || importer.error) && <p role={importer.error ? "alert" : "status"} className={`mt-2 text-xs ${importer.error ? "text-error-primary" : "text-success-primary"}`}>{importer.error ?? message}</p>}
                    </div>
                    <button type="button" disabled={importer.pending} onClick={() => inputRef.current?.click()} className={PRIMARY_BUTTON}>
                        <File02 className="size-4" /> {importer.pending ? "Analyzing…" : "Choose files"}
                    </button>
                    <input ref={inputRef} type="file" multiple accept=".pdf,.csv,.tsv,.ofx,.qfx,.txt,application/pdf,text/csv" className="sr-only" onChange={(event) => void importFiles(Array.from(event.target.files ?? []))} />
                </div>
            </div>
        </PersonalCard>
    );
}

function SubscriptionDiagnostics({ client }: { client: LifeOSClient }) {
    const scan = useLifeOSMutation(client, "financial:detectSubscriptions");
    const [result, setResult] = useState<string | null>(null);
    const run = async () => {
        setResult(null);
        try {
            const value = await scan.mutate<{ detected: number; created: number; updated: number; duplicatesMerged: number; aiUsed: boolean; model?: string | null }>();
            setResult(`${value.detected} recurring services detected · ${value.created} added · ${value.updated} refreshed · ${value.duplicatesMerged} duplicates merged${value.aiUsed ? ` with ${value.model ?? "Ollama"}` : " using local fallback diagnostics"}.`);
        } catch { /* mutation error is shown below */ }
    };
    return (
        <PersonalCard>
            <div className="relative flex flex-col gap-4 overflow-hidden rounded-xl border border-secondary bg-secondary p-5 sm:flex-row sm:items-center" style={{ borderLeftColor: "var(--c-border)" }}>
                <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-brand-solid/10 blur-3xl" />
                <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-brand-secondary ring-1 ring-secondary ring-inset"><Stars01 className="size-5" /></span>
                <div className="relative min-w-0 flex-1"><h2 className="text-sm font-semibold text-primary">Subscription diagnostics</h2><p className="mt-1 text-sm text-tertiary">Ollama groups merchant aliases, identifies recurring cadence, merges duplicates, and links the source transactions automatically.</p>{(result || scan.error) && <p className={`mt-2 text-xs ${scan.error ? "text-error-primary" : "text-success-primary"}`}>{scan.error ?? result}</p>}</div>
                <button type="button" onClick={() => void run()} disabled={scan.pending} className={`${PRIMARY_BUTTON} relative`}><RefreshCcw01 className={`size-4 ${scan.pending ? "animate-spin" : ""}`} />{scan.pending ? "Analyzing…" : "Analyze transactions"}</button>
            </div>
        </PersonalCard>
    );
}

function DeductionRowEditor({ client, row }: { client: LifeOSClient; row: FinancialRow }) {
    const [deductible, setDeductible] = useState(Boolean(row.deductible));
    const [category, setCategory] = useState(String(row.deductionCategory ?? "Other"));
    const [saved, setSaved] = useState(false);
    const mutation = useLifeOSMutation(client, "financial:setDeductible");
    const save = async () => {
        setSaved(false);
        try {
            await mutation.mutate({ id: row.id, deductible, category: deductible ? category : null, notes: row.notes ?? null });
            setSaved(true);
        } catch {
            // The bridge error is displayed inline.
        }
    };
    return (
        <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-secondary">
                <input type="checkbox" checked={deductible} onChange={(event) => { setDeductible(event.target.checked); setSaved(false); }} className="size-4 rounded border-secondary text-brand-solid" />
                Deductible
            </label>
            <input value={category} disabled={!deductible} onChange={(event) => { setCategory(event.target.value); setSaved(false); }} placeholder="Category" className={`${INPUT_CLASS} w-40 py-1.5 text-xs`} />
            <button type="button" disabled={mutation.pending || (deductible && !category.trim())} onClick={() => void save()} className={`${SECONDARY_BUTTON} px-2.5 py-1.5 text-xs`}>{mutation.pending ? "Saving…" : saved ? "Saved" : "Save"}</button>
            {mutation.error && <span className="text-xs text-error-primary" role="alert">{mutation.error}</span>}
        </div>
    );
}

function DeductionLedgerManager({ client, payload }: { client: LifeOSClient; payload: FinancialPayload }) {
    const ledger = rowsAt(payload, "ledger");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle ? ledger.filter((row) => JSON.stringify(row).toLowerCase().includes(needle)) : ledger;
    }, [ledger, query]);
    const pages = Math.max(1, Math.ceil(filtered.length / 100));
    const safePage = Math.min(page, pages);
    const rows = filtered.slice((safePage - 1) * 100, safePage * 100);
    const columns: TableColumn<FinancialRow>[] = [
        { key: "date", label: "Date", render: (row) => formatDate(String(row.date ?? "")) },
        { key: "merchant", label: "Merchant", render: (row) => String(row.merchant ?? "Transaction") },
        { key: "category", label: "Budget category", render: (row) => String(row.category ?? "Uncategorized") },
        { key: "amount", label: "Amount", align: "right", render: (row) => formatCurrency(numeric(row.amount)) },
        { key: "deduction", label: "Tax treatment", render: (row) => <DeductionRowEditor client={client} row={row} /> },
    ];
    return (
        <PersonalCard
            title="Review every expense"
            action={<label className="relative block w-full max-w-72"><span className="sr-only">Search expense ledger</span><SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-quaternary" /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={`Search ${ledger.length.toLocaleString()} expenses`} className={`${INPUT_CLASS} pl-9`} /></label>}
        >
            <p className="mb-4 text-sm text-tertiary">Mark, unmark, and recategorize eligible expenses without editing hidden transaction notes. Totals and tax-year reports update immediately.</p>
            <PersonalTable rows={rows} columns={columns} empty={query ? "No expenses match this search." : "No expenses are available for this tax year."} />
            {filtered.length > 100 && (
                <div className="mt-4 flex items-center justify-end gap-2 border-t border-secondary pt-4">
                    <button type="button" className={SECONDARY_BUTTON} disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><ChevronLeft className="size-4" /> Previous</button>
                    <div className="w-28"><RichSelect value={String(safePage)} onChange={(event) => setPage(Number(event.target.value))} aria-label="Expense page" options={Array.from({ length: pages }, (_, index) => ({ value: String(index + 1), label: `Page ${index + 1}` }))} /></div>
                    <button type="button" className={SECONDARY_BUTTON} disabled={safePage >= pages} onClick={() => setPage(safePage + 1)}>Next <ChevronRight className="size-4" /></button>
                </div>
            )}
        </PersonalCard>
    );
}

const logoDomain = (row: FinancialRow): string => {
    const website = String(row.website ?? row.institutionWebsite ?? "").trim();
    if (website) {
        try { return new URL(website.includes("://") ? website : `https://${website}`).hostname.replace(/^www\./, ""); } catch { /* use institution fallback */ }
    }
    return String(row.institution ?? row.name ?? "bank").toLowerCase().replace(/[^a-z0-9.]+/g, "").replace(/^(the)/, "") || "bank";
};

function FinancialProductsExplorer({ client, payload, kind }: { client: LifeOSClient; payload: FinancialPayload; kind: "accounts" | "cards" }) {
    const rows = rowsAt(payload, kind);
    const config = baseCrudConfig(kind, payload)!;
    const [view, setView] = useState<"grid" | "table">("grid");
    const [query, setQuery] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editing, setEditing] = useState<FinancialRow | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const create = useLifeOSMutation(client, config.createCommand ?? config.updateCommand);
    const update = useLifeOSMutation(client, config.updateCommand);
    const remove = useLifeOSMutation(client, config.deleteCommand);
    const pending = create.pending || update.pending || remove.pending;
    const formError = create.error || update.error || remove.error;
    const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.trim().toLowerCase()));
    const selected = rows.find((row) => row.id === selectedId) ?? null;

    const openCreate = () => { setEditing(null); setFormOpen(true); };
    const openEdit = (row: FinancialRow) => { setEditing(row); setFormOpen(true); };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = formPayload(form, config.fields);
        try {
            if (editing?.id) await update.mutate({ ...data, id: editing.id });
            else await create.mutate(data);
            setEditing(null);
            setFormOpen(false);
            form.reset();
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };
    const deleteRow = async (row: FinancialRow) => {
        if (!row.id || !window.confirm(`Delete ${config.display(row)}?`)) return;
        try {
            await remove.mutate({ id: row.id });
            if (selectedId === row.id) setSelectedId(null);
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };
    const editorModal = (
        <FormModal
            isOpen={formOpen}
            onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
            title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
            description={editing ? `Update ${config.display(editing)}.` : `Create a new ${config.singular} record.`}
            className="max-w-3xl"
        >
            {formError && <div role="alert" className="mb-3 rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{formError}</div>}
            <form key={String(editing?.id ?? "new")} onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
                {config.fields.map((field) => <EditorInput key={field.key} field={field} row={editing} />)}
                <div className="flex items-center justify-end gap-2 lg:col-span-2">
                    <button type="button" onClick={() => setFormOpen(false)} className={SECONDARY_BUTTON}>Cancel</button>
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                        {editing ? <Edit01 className="size-4" /> : <Plus className="size-4" />}
                        {editing ? "Save" : `Add ${config.singular}`}
                    </button>
                </div>
            </form>
        </FormModal>
    );

    if (selected) {
        const transactions = (Array.isArray(selected.transactions) ? selected.transactions as FinancialRow[] : []).filter((row) => !isPendingRow(row));
        const statements = Array.isArray(selected.statements) ? selected.statements as FinancialRow[] : [];
        const plaidLinked = Boolean(selected.plaidLinked || selected.plaidAccountId || String(selected.source ?? "").toLowerCase().includes("plaid"));
        const detailColumns: TableColumn<FinancialRow>[] = [
            { key: "date", label: "Date", render: (row) => formatDate(String(row.date ?? "")) },
            {
                key: "merchant",
                label: "Merchant / description",
                render: (row) => {
                    const name = String(row.merchant ?? row.description ?? "Transaction");
                    return (
                        <span className="flex min-w-0 items-center gap-2">
                            <BrandLogo domain={merchantLogoDomain(name)} name={name} size={20} />
                            <span className="truncate">{name}</span>
                        </span>
                    );
                },
            },
            { key: "category", label: "Category", render: (row) => titleCase(String(row.category ?? "Uncategorized")) },
            { key: "amount", label: "Amount", align: "right", render: (row) => formatCurrency(numeric(row.amount)) },
        ];
        const statementColumns: TableColumn<FinancialRow>[] = [
            { key: "fileName", label: "Statement", render: (row) => String(row.fileName ?? "Statement") },
            { key: "period", label: "Period", render: (row) => `${formatDate(String(row.periodStart ?? ""))} – ${formatDate(String(row.periodEnd ?? ""))}` },
            { key: "endingBalance", label: "Ending balance", align: "right", render: (row) => formatCurrency(numeric(row.endingBalance)) },
            { key: "status", label: "Status", render: (row) => renderValue(row.status, "status") },
        ];
        return (
            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" onClick={() => setSelectedId(null)} className={`${SECONDARY_BUTTON} w-fit`}><ArrowLeft className="size-4" /> Back to {kind}</button>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => openEdit(selected)} className={SECONDARY_BUTTON}><Edit01 className="size-4" /> Edit</button>
                        <button type="button" onClick={() => void deleteRow(selected)} className={`${SECONDARY_BUTTON} text-error-primary`}><Trash01 className="size-4" /> Delete</button>
                    </div>
                </div>
                <PersonalCard>
                    <div className="flex flex-wrap items-start gap-4">
                        <BrandLogo domain={logoDomain(selected)} name={String(selected.institution ?? selected.name)} size={52} />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-semibold text-primary">{String(selected.name ?? titleCase(kind))}</h2>
                                {renderValue(selected.source, "status")}
                                {plaidLinked && <span className="rounded-full bg-success-primary px-2 py-0.5 text-[11px] font-semibold text-success-primary">Plaid linked</span>}
                            </div>
                            <p className="mt-1 text-sm text-tertiary">{String(selected.institution ?? "Independent")} {selected.last4 ? `••${selected.last4}` : ""}</p>
                            <p className="mt-2 text-xs text-quaternary">
                                {plaidLinked
                                    ? "Balances and transactions sync automatically from Plaid."
                                    : "Manual account — connect Plaid on this record when you want automated sync (Settings → Integrations → Plaid, then link to this account)."}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-xs text-tertiary">Current balance</p>
                            <p className="text-2xl font-semibold text-primary">{formatCurrency(numeric(selected.balance))}</p>
                            {kind === "cards" && numeric(selected.creditLimit) > 0 && (
                                <p className="mt-1 text-xs text-quaternary">Limit {formatCurrency(numeric(selected.creditLimit))}</p>
                            )}
                        </div>
                    </div>
                </PersonalCard>
                <PersonalCard title="Cash flow (statement periods)">
                    <TrendChart
                        data={(statements.length ? statements : [{ fileName: "Current", endingBalance: selected.balance }]).map((row) => ({ label: String(row.periodEnd ?? row.fileName ?? "Current"), balance: numeric(row.endingBalance ?? selected.balance) }))}
                        series={[{ key: "balance", name: "Ending balance", color: "var(--color-brand-500)" }]}
                        height={280}
                        fitDomain
                    />
                </PersonalCard>
                <PersonalCard title="Transactions (posted only)">
                    <PersonalTable rows={transactions} columns={detailColumns} empty={`No posted transactions for this ${kind === "cards" ? "card" : "account"}.`} />
                </PersonalCard>
                <PersonalCard title="Statement history">
                    <PersonalTable rows={statements} columns={statementColumns} empty="No statements are associated with this record yet." />
                </PersonalCard>
            </div>
        );
    }

    return (
        <>
        <PersonalCard
            title={kind === "accounts" ? "Accounts" : "Cards"}
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block w-full sm:w-64"><span className="sr-only">Search {kind}</span><SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-quaternary" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search all ${kind}`} className={`${INPUT_CLASS} pl-9`} /></label>
                    <div className="inline-flex overflow-hidden rounded-lg border border-secondary">
                        <button type="button" onClick={() => setView("grid")} aria-pressed={view === "grid"} className={`p-2 ${view === "grid" ? "bg-secondary text-primary" : "text-tertiary"}`} title="Grid view"><Grid01 className="size-4" /></button>
                        <button type="button" onClick={() => setView("table")} aria-pressed={view === "table"} className={`p-2 ${view === "table" ? "bg-secondary text-primary" : "text-tertiary"}`} title="Table view"><Rows01 className="size-4" /></button>
                    </div>
                    <button type="button" onClick={openCreate} className={PRIMARY_BUTTON}><Plus className="size-4" /> Add {config.singular}</button>
                </div>
            }
        >
            {filtered.length === 0 ? <EmptyMessage>No {kind} match this search.</EmptyMessage> : view === "grid" ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((row) => (
                        <div key={String(row.id)} className="group relative rounded-xl border border-secondary bg-primary p-4 transition hover:border-brand hover:shadow-md">
                            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                <button type="button" onClick={(event) => { event.stopPropagation(); openEdit(row); }} aria-label={`Edit ${config.display(row)}`} className="rounded-lg bg-primary p-1.5 text-quaternary shadow-xs transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-4" /></button>
                                <button type="button" onClick={(event) => { event.stopPropagation(); void deleteRow(row); }} aria-label={`Delete ${config.display(row)}`} className="rounded-lg bg-primary p-1.5 text-quaternary shadow-xs transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button>
                            </div>
                            <button type="button" onClick={() => setSelectedId(String(row.id))} className="w-full text-left">
                                <div className="flex items-start gap-3 pr-14"><BrandLogo domain={logoDomain(row)} name={String(row.institution ?? row.name)} size={40} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-primary">{String(row.name ?? titleCase(kind))}</p><p className="truncate text-xs text-tertiary">{String(row.institution ?? "Independent")}</p></div>{renderValue(row.source, "status")}</div>
                                <p className="mt-5 text-xl font-semibold text-primary">{formatCurrency(numeric(row.balance))}</p>
                                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-quaternary"><span>{titleCase(String(row.kind ?? row.cardType ?? ""))}</span><span>{numeric(row.transactionCount).toLocaleString()} transactions · {numeric(row.statementCount).toLocaleString()} statements</span></div>
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr className="border-b border-secondary text-left text-xs font-semibold uppercase tracking-wide text-quaternary"><th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Institution</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5 text-right">Balance</th><th className="px-3 py-2.5" /></tr></thead><tbody className="divide-y divide-secondary">{filtered.map((row) => <tr key={String(row.id)} onClick={() => setSelectedId(String(row.id))} className="cursor-pointer hover:bg-primary_hover"><td className="px-3 py-3"><span className="flex items-center gap-2"><BrandLogo domain={logoDomain(row)} name={String(row.institution ?? row.name)} size={28} />{String(row.name ?? titleCase(kind))}</span></td><td className="px-3 py-3 text-secondary">{String(row.institution ?? "Independent")}</td><td className="px-3 py-3">{titleCase(String(row.kind ?? row.cardType ?? ""))}</td><td className="px-3 py-3">{renderValue(row.source, "status")}</td><td className="px-3 py-3 text-right font-medium text-primary">{formatCurrency(numeric(row.balance))}</td><td className="px-3 py-3"><div className="flex items-center justify-end gap-1"><button type="button" onClick={(event) => { event.stopPropagation(); openEdit(row); }} aria-label={`Edit ${config.display(row)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-4" /></button><button type="button" onClick={(event) => { event.stopPropagation(); void deleteRow(row); }} aria-label={`Delete ${config.display(row)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button></div></td></tr>)}</tbody></table></div>
            )}
        </PersonalCard>
        {editorModal}
        </>
    );
}

function websiteHref(website: string): string {
    const trimmed = website.trim();
    if (!trimmed) return "";
    return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function websiteLabel(website: string): string {
    const trimmed = website.trim();
    if (!trimmed) return "";
    try { return new URL(websiteHref(trimmed)).hostname.replace(/^www\./, ""); } catch { return trimmed; }
}

function InstitutionWebsiteLink({ row }: { row: FinancialRow }) {
    const website = String(row.website ?? "").trim();
    if (!website) return <span className="text-quaternary">—</span>;
    return (
        <a href={websiteHref(website)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex max-w-full items-center gap-1 text-brand-secondary hover:underline">
            <LinkExternal01 className="size-3.5 shrink-0" /> <span className="truncate">{websiteLabel(website)}</span>
        </a>
    );
}

function InstitutionEditorModal({ client, open, onOpenChange, editing }: { client: LifeOSClient; open: boolean; onOpenChange: (open: boolean) => void; editing: FinancialRow | null }) {
    const create = useLifeOSMutation(client, "financial:createInstitution");
    const update = useLifeOSMutation(client, "financial:updateInstitution");
    const pending = create.pending || update.pending;
    const error = create.error || update.error;
    const fields: EditorField[] = [
        { key: "name", label: "Institution name", required: true, placeholder: "Bank or brokerage" },
        { key: "website", label: "Website", placeholder: "https://example.com" },
        { key: "notes", label: "Notes", type: "textarea", wide: true },
    ];
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = formPayload(form, fields);
        try {
            if (editing?.id) await update.mutate({ ...data, id: editing.id });
            else await create.mutate(data);
            onOpenChange(false);
            form.reset();
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };
    return (
        <FormModal isOpen={open} onOpenChange={onOpenChange} title={editing ? "Edit institution" : "Add institution"} description={editing ? `Update ${String(editing.name ?? "institution")}.` : "Create a new institution record."} className="max-w-2xl">
            {error && <div role="alert" className="mb-3 rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{error}</div>}
            <form key={String(editing?.id ?? "new")} onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
                {fields.map((field) => <EditorInput key={field.key} field={field} row={editing} />)}
                <div className="flex items-center justify-end gap-2 lg:col-span-2">
                    <button type="button" onClick={() => onOpenChange(false)} className={SECONDARY_BUTTON}>Cancel</button>
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>{editing ? <Edit01 className="size-4" /> : <Plus className="size-4" />}{editing ? "Save institution" : "Add institution"}</button>
                </div>
            </form>
        </FormModal>
    );
}

function InstitutionsExplorer({ client, payload }: { client: LifeOSClient; payload: FinancialPayload }) {
    const rows = rowsAt(payload, "institutions");
    const [view, setView] = useState<"grid" | "table">("grid");
    const [query, setQuery] = useState("");
    const [editing, setEditing] = useState<FinancialRow | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const remove = useLifeOSMutation(client, "financial:deleteInstitution");
    const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.trim().toLowerCase()));

    const openCreate = () => { setEditing(null); setFormOpen(true); };
    const openEdit = (row: FinancialRow) => { setEditing(row); setFormOpen(true); };
    const deleteRow = async (row: FinancialRow) => {
        if (!row.id || !window.confirm(`Delete ${String(row.name ?? "this institution")}?`)) return;
        try { await remove.mutate({ id: row.id }); } catch {
            // The mutation error surfaces via remove.error below.
        }
    };

    return (
        <>
        <PersonalCard
            title="Institutions"
            action={
                <div className="flex flex-wrap items-center gap-2">
                    <label className="relative block w-full sm:w-64">
                        <span className="sr-only">Search institutions</span>
                        <SearchLg className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-quaternary" />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search all institutions" className={`${INPUT_CLASS} pl-9`} />
                    </label>
                    <div className="inline-flex overflow-hidden rounded-lg border border-secondary">
                        <button type="button" onClick={() => setView("grid")} aria-pressed={view === "grid"} className={`p-2 ${view === "grid" ? "bg-secondary text-primary" : "text-tertiary"}`} title="Grid view"><Grid01 className="size-4" /></button>
                        <button type="button" onClick={() => setView("table")} aria-pressed={view === "table"} className={`p-2 ${view === "table" ? "bg-secondary text-primary" : "text-tertiary"}`} title="Table view"><Rows01 className="size-4" /></button>
                    </div>
                    <button type="button" onClick={openCreate} className={PRIMARY_BUTTON}><Plus className="size-4" /> Add institution</button>
                </div>
            }
        >
            {remove.error && <p className="mb-3 text-xs text-error-primary" role="alert">{remove.error}</p>}
            {filtered.length === 0 ? <EmptyMessage>No institutions match this search.</EmptyMessage> : view === "grid" ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {filtered.map((row) => (
                        <div key={String(row.id)} className="group relative rounded-xl border border-secondary bg-primary p-4 transition hover:border-brand hover:shadow-md">
                            <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                <button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${String(row.name)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-4" /></button>
                                <button type="button" onClick={() => void deleteRow(row)} aria-label={`Delete ${String(row.name)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button>
                            </div>
                            <div className="flex items-start gap-3 pr-14">
                                <BrandLogo domain={String(row.logoDomain ?? logoDomain(row))} name={String(row.name)} size={40} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-primary">{String(row.name ?? "Institution")}</p>
                                    <div className="mt-0.5 truncate text-xs"><InstitutionWebsiteLink row={row} /></div>
                                </div>
                            </div>
                            <div className="mt-4 flex items-center gap-3 text-xs text-quaternary">
                                <span>{numeric(row.accountCount)} accounts</span>
                                <span>{numeric(row.cardCount)} cards</span>
                                <span>{numeric(row.contactCount)} contacts</span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                        <thead>
                            <tr className="border-b border-secondary text-left text-xs font-semibold tracking-wide text-quaternary uppercase">
                                <th className="px-3 py-2.5">Institution</th>
                                <th className="px-3 py-2.5">Website</th>
                                <th className="px-3 py-2.5 text-right">Accounts</th>
                                <th className="px-3 py-2.5 text-right">Cards</th>
                                <th className="px-3 py-2.5 text-right">Contacts</th>
                                <th className="px-3 py-2.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-secondary">
                            {filtered.map((row) => (
                                <tr key={String(row.id)}>
                                    <td className="px-3 py-3"><span className="flex items-center gap-2"><BrandLogo domain={String(row.logoDomain ?? logoDomain(row))} name={String(row.name)} size={28} />{String(row.name ?? "Institution")}</span></td>
                                    <td className="px-3 py-3">{<InstitutionWebsiteLink row={row} />}</td>
                                    <td className="px-3 py-3 text-right text-secondary">{numeric(row.accountCount)}</td>
                                    <td className="px-3 py-3 text-right text-secondary">{numeric(row.cardCount)}</td>
                                    <td className="px-3 py-3 text-right text-secondary">{numeric(row.contactCount)}</td>
                                    <td className="px-3 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <button type="button" onClick={() => openEdit(row)} aria-label={`Edit ${String(row.name)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-4" /></button>
                                            <button type="button" onClick={() => void deleteRow(row)} aria-label={`Delete ${String(row.name)}`} className="rounded-lg p-1.5 text-quaternary transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </PersonalCard>
        <InstitutionEditorModal client={client} open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }} editing={editing} />
        </>
    );
}

const INPUT_CLASS = "w-full min-w-0 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-primary outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
const PRIMARY_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-solid px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON = "inline-flex items-center justify-center gap-2 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm font-semibold text-secondary transition hover:bg-primary_hover disabled:cursor-not-allowed disabled:opacity-50";

type EditorFieldType = "text" | "number" | "date" | "select" | "textarea" | "checkbox";

interface EditorOption {
    value: string;
    label: string;
}

interface EditorField {
    key: string;
    valueKey?: string;
    label: string;
    type?: EditorFieldType;
    required?: boolean;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    defaultValue?: string | number;
    defaultChecked?: boolean;
    options?: EditorOption[];
    wide?: boolean;
}

interface CrudConfig {
    title: string;
    singular: string;
    rowsKey: string;
    createCommand?: string;
    updateCommand: string;
    deleteCommand: string;
    fields: EditorField[];
    display: (row: FinancialRow) => string;
    detail?: (row: FinancialRow) => string;
    canManage?: (row: FinancialRow) => boolean;
    readOnlyReason?: string;
}

function localDateValue(): string {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function optionRows(payload: FinancialPayload, key: string, labelKey = "name"): EditorOption[] {
    return rowsAt(payload, key).map((row) => ({
        value: String(row.id ?? ""),
        label: String(row[labelKey] ?? row.label ?? row.nickname ?? row.title ?? row.displayName ?? row.merchant ?? row.id ?? "Record"),
    })).filter((option) => option.value);
}

function rowFieldValue(row: FinancialRow | null, field: EditorField): unknown {
    return row?.[field.valueKey ?? field.key] ?? field.defaultValue ?? "";
}

function formPayload(form: HTMLFormElement, fields: EditorField[]): Record<string, unknown> {
    const values = new FormData(form);
    return Object.fromEntries(fields.map((field) => {
        if (field.type === "checkbox") return [field.key, values.has(field.key)];
        const raw = String(values.get(field.key) ?? "");
        if (field.type === "number") return [field.key, raw === "" ? null : Number(raw)];
        return [field.key, raw];
    }));
}

function EditorInput({ field, row }: { field: EditorField; row: FinancialRow | null }) {
    const value = rowFieldValue(row, field);
    if (field.type === "checkbox") {
        const checked = row ? Boolean(value) : field.defaultChecked ?? Boolean(value);
        return (
            <label className={`flex items-center gap-2 self-end rounded-lg border border-secondary bg-primary px-3 py-2 text-sm text-secondary ${field.wide ? "lg:col-span-2" : ""}`}>
                <input name={field.key} type="checkbox" defaultChecked={checked} className="size-4 rounded border-secondary text-brand-solid" />
                {field.label}
            </label>
        );
    }
    return (
        <label className={`flex flex-col gap-1.5 text-xs font-medium text-secondary ${field.wide ? "lg:col-span-2" : ""}`}>
            {field.label}
            {field.type === "select" ? (
                <RichSelect name={field.key} defaultValue={String(value ?? "")} placeholder={field.required ? "Select" : "None"} options={(field.options ?? []).map((option) => ({ value: option.value, label: option.label }))} />
            ) : field.type === "textarea" ? (
                <textarea name={field.key} defaultValue={String(value ?? "")} placeholder={field.placeholder} rows={2} className={INPUT_CLASS} />
            ) : (
                <input
                    name={field.key}
                    type={field.type ?? "text"}
                    defaultValue={String(value ?? "")}
                    required={field.required}
                    placeholder={field.placeholder}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    className={INPUT_CLASS}
                />
            )}
        </label>
    );
}

function CrudPanel({ client, payload, config, rowsOverride }: { client: LifeOSClient; payload: FinancialPayload; config: CrudConfig; rowsOverride?: FinancialRow[] }) {
    const rows = rowsOverride ?? rowsAt(payload, config.rowsKey);
    const [editing, setEditing] = useState<FinancialRow | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const create = useLifeOSMutation(client, config.createCommand ?? config.updateCommand);
    const update = useLifeOSMutation(client, config.updateCommand);
    const remove = useLifeOSMutation(client, config.deleteCommand);
    const pending = create.pending || update.pending || remove.pending;
    const error = create.error || update.error || remove.error;

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = formPayload(form, config.fields);
        try {
            if (editing?.id) await update.mutate({ ...data, id: editing.id });
            else if (config.createCommand) await create.mutate(data);
            else throw new Error(`Select a ${config.singular} to edit.`);
            setEditing(null);
            setFormOpen(false);
            form.reset();
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };

    const deleteRow = async (row: FinancialRow) => {
        if (!row.id || !window.confirm(`Delete ${config.display(row)}?`)) return;
        try {
            await remove.mutate({ id: row.id });
            if (editing?.id === row.id) setEditing(null);
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };

    const createNew = () => {
        setEditing(null);
        setFormOpen(true);
    };

    const editRow = (row: FinancialRow) => {
        setEditing(row);
        setFormOpen(true);
    };

    return (
        <>
        <PersonalCard
            title={config.title}
            action={config.createCommand ? <button type="button" onClick={createNew} className={PRIMARY_BUTTON}><Plus className="size-4" /> Add {config.singular}</button> : undefined}
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-tertiary">Create and edit records in a focused dialog, while this page stays dedicated to searching and reviewing the ledger.</p>
                {error && <div role="alert" className="rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{error}</div>}
                {rows.length > 0 && (
                    <div className="divide-y divide-secondary overflow-hidden rounded-lg border border-secondary">
                        {rows.slice(0, 40).map((row, index) => {
                            const manageable = config.canManage?.(row) ?? true;
                            return (
                                <div key={String(row.id ?? index)} className="flex items-center justify-between gap-3 bg-primary px-3 py-2.5">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-primary">{config.display(row)}</p>
                                        {config.detail && <p className="truncate text-xs text-tertiary">{config.detail(row)}</p>}
                                    </div>
                                    {manageable ? (
                                        <div className="flex shrink-0 items-center gap-1">
                                            <button type="button" disabled={pending} onClick={() => editRow(row)} aria-label={`Edit ${config.display(row)}`} className="rounded-lg p-2 text-quaternary transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-4" /></button>
                                            <button type="button" disabled={pending} onClick={() => deleteRow(row)} aria-label={`Delete ${config.display(row)}`} className="rounded-lg p-2 text-quaternary transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-4" /></button>
                                        </div>
                                    ) : (
                                        <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-tertiary">{config.readOnlyReason ?? "Read only"}</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </PersonalCard>
        <FormModal
            isOpen={formOpen}
            onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
            title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
            description={editing ? `Update ${config.display(editing)}.` : `Create a new ${config.singular} record.`}
            className="max-w-3xl"
        >
            {error && <div role="alert" className="mb-3 rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{error}</div>}
            <form key={`${config.createCommand ?? config.updateCommand}:${String(editing?.id ?? "new")}`} onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
                {config.fields.map((field) => <EditorInput key={field.key} field={field} row={editing} />)}
                <div className="flex items-center justify-end gap-2 lg:col-span-2">
                    <button type="button" onClick={() => setFormOpen(false)} className={SECONDARY_BUTTON}>Cancel</button>
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
                        {editing ? <Edit01 className="size-4" /> : <Plus className="size-4" />}
                        {editing ? `Save ${config.singular}` : `Add ${config.singular}`}
                    </button>
                </div>
            </form>
        </FormModal>
        </>
    );
}

function baseCrudConfig(tabId: string, payload: FinancialPayload): CrudConfig | null {
    const accountOptions = optionRows(payload, "accounts");
    const categoryOptions = optionRows(payload, "categories");
    if (tabId === "accounts") return {
        title: "Accounts",
        singular: "account",
        rowsKey: "accounts",
        createCommand: "financial:createAccount",
        updateCommand: "financial:updateAccount",
        deleteCommand: "financial:deleteAccount",
        display: (row) => String(row.name ?? "Account"),
        detail: (row) => `${titleCase(String(row.kind ?? ""))} · ${formatCurrency(Number(row.balance ?? 0))}${row.plaidLinked ? " · Plaid" : ""}`,
        fields: [
            { key: "nickname", valueKey: "name", label: "Account name", required: true, placeholder: "Everyday checking" },
            { key: "kind", label: "Kind", type: "select", required: true, defaultValue: "CHECKING", options: ["CHECKING", "SAVINGS", "MONEY_MARKET", "CD", "BROKERAGE", "OTHER"].map((value) => ({ value, label: titleCase(value) })) },
            { key: "institution", label: "Institution", placeholder: "Optional" },
            { key: "currentBalance", valueKey: "balance", label: "Current balance", type: "number", step: 0.01, defaultValue: 0 },
            { key: "currency", label: "Currency", defaultValue: "USD", placeholder: "USD" },
            { key: "last4", label: "Last four digits", placeholder: "1234" },
            { key: "isAsset", label: "Treat as an asset", type: "checkbox", defaultChecked: true },
            { key: "includeInNetWorth", label: "Include in net worth", type: "checkbox", defaultChecked: true },
            { key: "archived", label: "Archived", type: "checkbox" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    if (tabId === "cards") return {
        title: "Cards",
        singular: "card",
        rowsKey: "cards",
        createCommand: "financial:createCard",
        updateCommand: "financial:updateCard",
        deleteCommand: "financial:deleteCard",
        display: (row) => String(row.name ?? "Card"),
        detail: (row) => `${String(row.institution ?? "No institution")} · ${formatCurrency(Number(row.balance ?? 0))}${row.plaidLinked ? " · Plaid" : ""}`,
        fields: [
            { key: "nickname", valueKey: "name", label: "Card name", required: true, placeholder: "Everyday rewards" },
            { key: "productName", label: "Product name", placeholder: "Cash Rewards" },
            { key: "issuer", valueKey: "institution", label: "Issuer", placeholder: "Bank or issuer" },
            { key: "cardType", label: "Card type", type: "select", required: true, defaultValue: "CREDIT", options: ["CREDIT", "CHARGE", "DEBIT", "PREPAID", "OTHER"].map((value) => ({ value, label: titleCase(value) })) },
            { key: "last4", label: "Last four digits", placeholder: "1234" },
            { key: "apr", valueKey: "aprPercent", label: "APR (%)", type: "number", min: 0, step: 0.001 },
            { key: "creditLimit", label: "Credit limit", type: "number", min: 0, step: 0.01 },
            { key: "currentBalance", valueKey: "balance", label: "Current balance", type: "number", step: 0.01, defaultValue: 0 },
            { key: "minimumPayment", label: "Minimum payment", type: "number", min: 0, step: 0.01 },
            { key: "paymentDueAt", label: "Payment due", type: "date" },
            { key: "paymentOverdue", label: "Payment overdue", type: "checkbox" },
            { key: "archived", label: "Archived", type: "checkbox" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    if (tabId === "credit") return {
        title: "Manage credit-score history",
        singular: "credit score",
        rowsKey: "scores",
        createCommand: "financial:createCreditScore",
        updateCommand: "financial:updateCreditScore",
        deleteCommand: "financial:deleteCreditScore",
        display: (row) => `${String(row.bureau ?? "Credit score")} · ${Number(row.score ?? 0)}`,
        detail: (row) => formatDate(String(row.date ?? "")),
        fields: [
            { key: "score", label: "Score", type: "number", required: true, min: 300, max: 850, step: 1 },
            { key: "date", label: "Score date", type: "date", required: true, defaultValue: localDateValue() },
            { key: "bureau", label: "Bureau", type: "select", options: ["EXPERIAN", "EQUIFAX", "TRANSUNION", "OTHER"].map((value) => ({ value, label: titleCase(value) })) },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    if (tabId === "debt") return {
        title: "Manage debts",
        singular: "debt",
        rowsKey: "debts",
        createCommand: "financial:createDebt",
        updateCommand: "financial:updateDebt",
        deleteCommand: "financial:deleteDebt",
        display: (row) => String(row.name ?? "Debt"),
        detail: (row) => `${formatCurrency(Number(row.balance ?? 0))} remaining · ${Number(row.aprPercent ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}% APR`,
        canManage: (row) => row.source === "DEBT",
        fields: [
            { key: "name", label: "Debt name", required: true, placeholder: "Student loan" },
            { key: "kind", label: "Kind", placeholder: "Loan, mortgage, medical…" },
            { key: "principalOriginal", valueKey: "originalBalance", label: "Original balance", type: "number", min: 0, step: 0.01 },
            { key: "principalRemaining", valueKey: "balance", label: "Remaining balance", type: "number", min: 0, step: 0.01 },
            { key: "apr", valueKey: "aprPercent", label: "APR (%)", type: "number", min: 0, max: 1_000, step: 0.001 },
            { key: "minimumPayment", label: "Minimum payment", type: "number", min: 0, step: 0.01 },
            { key: "payoffGoalDate", label: "Payoff goal", type: "date" },
            { key: "strategy", label: "Payoff strategy", type: "textarea", wide: true },
        ],
    };
    if (tabId === "statements") {
        const ownerOptions = [
            ...accountOptions.map((option) => ({ value: `account:${option.value}`, label: `Account · ${option.label}` })),
            ...optionRows(payload, "cards").map((option) => ({ value: `card:${option.value}`, label: `Card · ${option.label}` })),
        ];
        return {
            title: "Manage statement metadata",
            singular: "statement",
            rowsKey: "statements",
            updateCommand: "financial:updateStatement",
            deleteCommand: "financial:deleteStatement",
            display: (row) => String(row.fileName ?? "Statement"),
            detail: (row) => `${String(row.owner ?? "Unassigned")} · ${formatDate(String(row.periodEnd ?? ""))}`,
            fields: [
                { key: "fileName", label: "File name", required: true },
                { key: "owner", valueKey: "ownerRef", label: "Account or card", type: "select", options: ownerOptions },
                { key: "periodStart", label: "Period start", type: "date" },
                { key: "periodEnd", label: "Period end", type: "date" },
                { key: "endingBalance", label: "Ending balance", type: "number", step: 0.01 },
            ],
        };
    }
    if (tabId === "tax") return {
        title: "Manage tax-document metadata",
        singular: "tax document",
        rowsKey: "documents",
        updateCommand: "financial:updateTaxDocument",
        deleteCommand: "financial:deleteTaxDocument",
        display: (row) => String(row.fileName ?? row.description ?? "Tax document"),
        detail: (row) => `${String(row.taxYear ?? "")} · ${String(row.kind ?? "Document")}`,
        fields: [
            { key: "taxYear", label: "Tax year", type: "number", required: true, min: 1900, max: 2200, step: 1 },
            { key: "kind", label: "Document type", placeholder: "W-2, 1099, receipt…" },
            { key: "description", label: "Description", type: "textarea", wide: true },
            { key: "fileName", label: "File name" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    if (tabId === "budget") return {
        title: "Manage budget categories",
        singular: "category",
        rowsKey: "categories",
        createCommand: "financial:createBudgetCategory",
        updateCommand: "financial:updateBudgetCategory",
        deleteCommand: "financial:deleteBudgetCategory",
        display: (row) => String(row.name ?? "Category"),
        detail: (row) => `${formatCurrency(Number(row.monthlyBudget ?? 0))} monthly`,
        fields: [
            { key: "name", label: "Category name", required: true, placeholder: "Groceries" },
            { key: "monthlyBudget", label: "Monthly budget", type: "number", min: 0, step: 0.01 },
            { key: "parentId", label: "Parent category", type: "select", options: categoryOptions },
            { key: "color", label: "Color label", placeholder: "Optional" },
        ],
    };
    if (tabId === "subscriptions") return {
        title: "Manage subscriptions",
        singular: "subscription",
        rowsKey: "subscriptions",
        createCommand: "financial:createSubscription",
        updateCommand: "financial:updateSubscription",
        deleteCommand: "financial:deleteSubscription",
        display: (row) => String(row.name ?? row.merchant ?? "Subscription"),
        detail: (row) => `${titleCase(String(row.status ?? ""))} · ${formatCurrency(Number(row.amount ?? 0))} ${String(row.cadence ?? "")}`,
        fields: [
            { key: "name", label: "Name", placeholder: "Optional display name" },
            { key: "merchant", label: "Merchant", required: true, placeholder: "Service provider" },
            { key: "amount", label: "Charge", type: "number", required: true, min: 0, step: 0.01 },
            { key: "currency", label: "Currency", defaultValue: "USD" },
            { key: "cadence", label: "Cadence", type: "select", required: true, defaultValue: "MONTHLY", options: ["MONTHLY", "YEARLY", "WEEKLY", "OTHER"].map((value) => ({ value, label: titleCase(value) })) },
            { key: "status", label: "Status", type: "select", required: true, defaultValue: "ACTIVE", options: ["ACTIVE", "PAUSED", "CANCELLED"].map((value) => ({ value, label: titleCase(value) })) },
            { key: "startedOn", label: "Started", type: "date" },
            { key: "nextChargeOn", label: "Next charge", type: "date" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    if (tabId === "goals") return {
        title: "Manage financial goals",
        singular: "goal",
        rowsKey: "goals",
        createCommand: "financial:createGoal",
        updateCommand: "financial:updateGoal",
        deleteCommand: "financial:deleteGoal",
        display: (row) => String(row.title ?? "Goal"),
        detail: (row) => `${formatCurrency(Number(row.currentAmount ?? 0))} of ${formatCurrency(Number(row.targetAmount ?? 0))}`,
        fields: [
            { key: "title", label: "Goal title", required: true, placeholder: "Emergency fund" },
            { key: "targetAmount", label: "Target amount", type: "number", min: 0.01, step: 0.01 },
            { key: "currentAmount", label: "Current amount", type: "number", min: 0, step: 0.01, defaultValue: 0 },
            { key: "targetDate", label: "Target date", type: "date" },
        ],
    };
    return null;
}

function IncomePanels({ client, payload }: { client: LifeOSClient; payload: FinancialPayload }) {
    const streams = rowsAt(payload, "streams");
    const accounts = optionRows(payload, "accounts");
    const streamOptions = streams.filter((stream) => !stream.archived).map((stream) => ({ value: String(stream.id), label: String(stream.name ?? "Income") }));
    const entries = streams.flatMap((stream) => Array.isArray(stream.entries)
        ? stream.entries.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object").map((entry) => ({ ...entry, id: String(entry.id ?? ""), streamId: stream.id, streamName: stream.name }))
        : []);
    const streamConfig: CrudConfig = {
        title: "Manage income streams",
        singular: "stream",
        rowsKey: "streams",
        createCommand: "financial:createIncomeStream",
        updateCommand: "financial:updateIncomeStream",
        deleteCommand: "financial:deleteIncomeStream",
        display: (row) => String(row.name ?? "Income stream"),
        detail: (row) => `${titleCase(String(row.kind ?? "Income"))} · ${Number(row.paymentCount ?? 0)} payments`,
        fields: [
            { key: "name", label: "Stream name", required: true, placeholder: "Primary job" },
            { key: "kind", label: "Kind", placeholder: "Salary, freelance…" },
            { key: "finAccountId", label: "Destination account", type: "select", options: accounts },
            { key: "archived", label: "Archived", type: "checkbox" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    const entryConfig: CrudConfig = {
        title: "Log income payments",
        singular: "payment",
        rowsKey: "entries",
        createCommand: "financial:createIncomeEntry",
        updateCommand: "financial:updateIncomeEntry",
        deleteCommand: "financial:deleteIncomeEntry",
        display: (row) => `${String(row.streamName ?? "Income")} · ${formatCurrency(Number(row.amount ?? 0))}`,
        detail: (row) => formatDate(String(row.receivedAt ?? "")),
        fields: [
            { key: "streamId", label: "Income stream", type: "select", required: true, options: streamOptions },
            { key: "amount", label: "Payment amount", type: "number", required: true, min: 0.01, step: 0.01 },
            { key: "receivedAt", label: "Received date", type: "date", required: true, defaultValue: localDateValue() },
            { key: "currency", label: "Currency", defaultValue: "USD" },
            { key: "notes", label: "Notes", type: "textarea", wide: true },
        ],
    };
    return (
        <>
            <CrudPanel client={client} payload={payload} config={streamConfig} />
            {streamOptions.length > 0 ? (
                <CrudPanel client={client} payload={payload} config={entryConfig} rowsOverride={entries} />
            ) : (
                <PersonalCard title="Log income payments"><EmptyMessage>Create an income stream before logging a payment.</EmptyMessage></PersonalCard>
            )}
        </>
    );
}

const CREDIT_BUREAU_COLUMNS = [
    { id: "EQUIFAX", label: "Equifax" },
    { id: "EXPERIAN", label: "Experian" },
    { id: "TRANSUNION", label: "TransUnion" },
] as const;

/** Per-bureau credit-score history, one column per bureau, each with its own add/edit/delete log. */
function CreditHistoryColumns({ client, payload }: { client: LifeOSClient; payload: FinancialPayload }) {
    const config = baseCrudConfig("credit", payload)!;
    const rows = rowsAt(payload, "scores");
    const [editing, setEditing] = useState<FinancialRow | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const create = useLifeOSMutation(client, config.createCommand ?? config.updateCommand);
    const update = useLifeOSMutation(client, config.updateCommand);
    const remove = useLifeOSMutation(client, config.deleteCommand);
    const pending = create.pending || update.pending || remove.pending;
    const formError = create.error || update.error || remove.error;

    const openAdd = (bureau?: string) => { setEditing(bureau ? { bureau } : null); setFormOpen(true); };
    const openEdit = (row: FinancialRow) => { setEditing(row); setFormOpen(true); };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = formPayload(form, config.fields);
        try {
            if (editing?.id) await update.mutate({ ...data, id: editing.id });
            else await create.mutate(data);
            setEditing(null);
            setFormOpen(false);
            form.reset();
        } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };
    const deleteRow = async (row: FinancialRow) => {
        if (!row.id || !window.confirm(`Delete this ${String(row.bureau ?? "credit")} score entry?`)) return;
        try { await remove.mutate({ id: row.id }); } catch {
            // The mutation helper exposes the validated backend error below.
        }
    };

    const byBureau = (bureau: string) =>
        rows
            .filter((row) => String(row.bureau ?? "").toUpperCase() === bureau)
            .slice()
            .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    const knownBureaus = new Set<string>(CREDIT_BUREAU_COLUMNS.map((c) => c.id));
    const otherRows = rows.filter((row) => !knownBureaus.has(String(row.bureau ?? "").toUpperCase()));
    const columns = [...CREDIT_BUREAU_COLUMNS, ...(otherRows.length > 0 ? [{ id: "OTHER", label: "Other" } as const] : [])];

    return (
        <>
        <PersonalCard title="Credit score history" action={<button type="button" onClick={() => openAdd()} className={PRIMARY_BUTTON}><Plus className="size-4" /> Add score</button>}>
            {formError && <div role="alert" className="mb-3 rounded-lg border border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{formError}</div>}
            <div className={`grid gap-4 ${columns.length >= 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3"}`}>
                {columns.map((bureau) => {
                    const entries = bureau.id === "OTHER" ? otherRows.slice().sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))) : byBureau(bureau.id);
                    const latest = entries[0];
                    return (
                        <div key={bureau.id} className="flex flex-col rounded-xl border border-secondary">
                            <div className="flex items-center justify-between gap-2 border-b border-secondary px-3 py-2.5">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-primary">{bureau.label}</p>
                                    <p className="text-xs text-tertiary">{latest ? `${Number(latest.score ?? 0)} · ${formatDate(String(latest.date ?? ""))}` : "No scores logged"}</p>
                                </div>
                                <button type="button" onClick={() => openAdd(bureau.id === "OTHER" ? undefined : bureau.id)} aria-label={`Add ${bureau.label} score`} className="shrink-0 rounded-lg p-1.5 text-quaternary transition hover:bg-primary_hover hover:text-secondary">
                                    <Plus className="size-4" />
                                </button>
                            </div>
                            <div className="flex max-h-80 flex-col divide-y divide-secondary overflow-y-auto">
                                {entries.length === 0 ? (
                                    <p className="px-3 py-4 text-center text-xs text-tertiary">No entries yet.</p>
                                ) : (
                                    entries.map((row) => (
                                        <div key={String(row.id)} className="group flex items-center justify-between gap-2 px-3 py-2">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium tabular-nums text-primary">{Number(row.score ?? 0)}</p>
                                                <p className="truncate text-xs text-tertiary">{formatDate(String(row.date ?? ""))}{row.notes ? ` · ${String(row.notes)}` : ""}</p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                                                <button type="button" disabled={pending} onClick={() => openEdit(row)} aria-label="Edit score" className="rounded-md p-1 text-quaternary transition hover:bg-primary_hover hover:text-secondary"><Edit01 className="size-3.5" /></button>
                                                <button type="button" disabled={pending} onClick={() => void deleteRow(row)} aria-label="Delete score" className="rounded-md p-1 text-quaternary transition hover:bg-error-primary hover:text-error-primary"><Trash01 className="size-3.5" /></button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </PersonalCard>
        <FormModal
            isOpen={formOpen}
            onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}
            title={editing?.id ? "Edit credit score" : "Add credit score"}
            description={editing?.id ? `Update this ${String(editing.bureau ?? "")} entry.` : "Log a new credit-score reading."}
            className="max-w-lg"
        >
            <form key={String(editing?.id ?? editing?.bureau ?? "new")} onSubmit={submit} className="grid gap-3">
                {config.fields.map((field) => <EditorInput key={field.key} field={field} row={editing} />)}
                <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={() => setFormOpen(false)} className={SECONDARY_BUTTON}>Cancel</button>
                    <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>{editing?.id ? <Edit01 className="size-4" /> : <Plus className="size-4" />}{editing?.id ? "Save" : "Add score"}</button>
                </div>
            </form>
        </FormModal>
        </>
    );
}

function FinancialMutationPanels({ client, tabId, payload }: { client: LifeOSClient; tabId: string; payload: FinancialPayload }) {
    if (tabId === "income") return <IncomePanels client={client} payload={payload} />;
    // Subscriptions are derived from transaction diagnostics; there is no manual
    // subscription editor to drift out of sync with statements and card activity.
    if (tabId === "subscriptions") return null;
    // Accounts and cards manage add/edit/delete inline in their own grid/table
    // browser (FinancialProductsExplorer) instead of a separate list-plus-form
    // section above it. Credit scores manage inline in the per-bureau columns
    // (CreditHistoryColumns) instead of a separate list-plus-form section.
    // Statements are an import-and-review surface; keep the grouped statement table
    // and document actions visible without exposing a separate metadata manager.
    if (tabId === "accounts" || tabId === "cards" || tabId === "credit" || tabId === "statements") return null;
    const config = baseCrudConfig(tabId, payload);
    return config ? <CrudPanel key={tabId} client={client} payload={payload} config={config} /> : null;
}

function GenericFinancialSection({ client, tab, onNavigateTab }: { client: LifeOSClient; tab: FinancialTab; onNavigateTab: (tabId: string) => void }) {
    const query = useLifeOSQuery<FinancialPayload>(client, tab.command);
    const stats = tab.metrics.map((metric) => ({
        label: metric.label,
        value: renderValue(query.data?.summary?.[metric.key] ?? null, metric.format),
        detail: metric.detail,
    }));

    return (
        <QueryBoundary loading={query.loading} error={query.error} onRetry={query.refresh}>
            {query.data && (
                <div className="flex flex-col gap-5">
                    {["overview", "statements", "tax"].includes(tab.id) && <FinancialImportZone client={client} />}
                    {tab.id === "subscriptions" && <SubscriptionDiagnostics client={client} />}
                    <StatGrid stats={stats} />
                    <FinancialVisualization tabId={tab.id} payload={query.data} />
                    <Recommendations payload={query.data} />
                    {tab.id === "deductions" && <DeductionLedgerManager client={client} payload={query.data} />}
                    <FinancialMutationPanels client={client} tabId={tab.id} payload={query.data} />
                    {tab.id === "overview" ? (
                        <RecentTransactionsPanel
                            client={client}
                            transactions={rowsAt(query.data, "recentTransactions") as never}
                            categories={(Array.isArray(query.data.categories) ? query.data.categories : []).map((c: Record<string, unknown>) => ({
                                id: String(c.id),
                                label: String(c.label ?? c.name ?? "Category"),
                                color: (c.color as string | null | undefined) ?? null,
                            }))}
                            accounts={(Array.isArray(query.data.accounts) ? query.data.accounts : []).map((a: Record<string, unknown>) => ({
                                id: String(a.id),
                                kind: "account" as const,
                                nickname: String(a.nickname ?? "Account"),
                            }))}
                            cards={(Array.isArray(query.data.cards) ? query.data.cards : []).map((c: Record<string, unknown>) => ({
                                id: String(c.id),
                                kind: "card" as const,
                                nickname: String(c.nickname ?? "Card"),
                            }))}
                            onViewAll={() => onNavigateTab("transactions")}
                        />
                    ) : tab.id === "accounts" || tab.id === "cards" ? (
                        <FinancialProductsExplorer client={client} payload={query.data} kind={tab.id} />
                    ) : tab.id === "credit" ? (
                        <CreditHistoryColumns client={client} payload={query.data} />
                    ) : tab.id === "calendar" ? null : tab.id === "institutions" ? (
                        <>
                            <InstitutionsExplorer client={client} payload={query.data} />
                            {tab.tables.filter((table) => table.key !== "institutions").map((table) => <FinancialTable key={table.key} client={client} payload={query.data!} config={table} onNavigateTab={onNavigateTab} />)}
                        </>
                    ) : (
                        tab.tables.map((table) => <FinancialTable key={table.key} client={client} payload={query.data!} config={table} onNavigateTab={onNavigateTab} />)
                    )}
                </div>
            )}
        </QueryBoundary>
    );
}

function FinancialSection({ client, tab, onNavigateTab }: { client: LifeOSClient; tab: FinancialTab; onNavigateTab: (tabId: string) => void }) {
    if (tab.id === "budget") return <BudgetPage client={client} onNavigateTab={onNavigateTab} />;
    if (tab.id === "reports") return <ReportsPage client={client} />;
    if (tab.id === "deductions") return <DeductionsPage client={client} />;
    if (tab.id === "tax") return <TaxPage client={client} />;
    if (tab.id === "transactions") return <TransactionsPage client={client} />;
    return <GenericFinancialSection client={client} tab={tab} onNavigateTab={onNavigateTab} />;
}

export function FinancialView({ client }: FinancialViewProps) {
    const [activeTab, setActiveTab] = useState("overview");
    const [quickTransactionOpen, setQuickTransactionOpen] = useState(false);
    const tab = VISIBLE_FINANCIAL_TABS.find((candidate) => candidate.id === activeTab) ?? VISIBLE_FINANCIAL_TABS[0];

    return (
        <PersonalModuleShell
            title="Financial"
            description={tab.description}
            icon={CurrencyDollarCircle}
            tabs={VISIBLE_FINANCIAL_TABS}
            activeTab={tab.id}
            onTabChange={setActiveTab}
            wrapTabs
            hero={{
                gradient: "linear-gradient(120deg, #059669 0%, #0d9488 48%, #0ea5e9 100%)",
                eyebrow: "Personal finance",
                actions: [
                    { label: "Add transaction", icon: Plus, variant: "primary", onClick: () => setQuickTransactionOpen(true) },
                    { label: "Import statements", icon: UploadCloud02, onClick: () => setActiveTab("statements") },
                ],
            }}
        >
            {quickTransactionOpen && <QuickTransactionModal client={client} onClose={() => setQuickTransactionOpen(false)} />}
            <FinancialSection key={tab.id} client={client} tab={tab} onNavigateTab={setActiveTab} />
        </PersonalModuleShell>
    );
}
