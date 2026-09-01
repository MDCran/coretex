// @ts-nocheck
// Coretex Relay — public surface for the shared dashboard.
export { CoretexApp } from "./app-shell";
export type { CoretexAppProps } from "./app-shell";
export { CoretexDashboard } from "./coretex-dashboard";
export type { CoretexDashboardProps } from "./coretex-dashboard";
export { ThemeProvider, ThemeToggle, useTheme } from "./theme";
export { AppErrorBoundary } from "./ui/error-boundary";
export {
    useCoretex,
    AGENT_STATUS_COLOR,
    TASK_PRIORITY_COLOR,
    TASK_STATUS_LABEL,
    TASK_BOARD_COLUMNS,
    formatUSD,
    formatTokens,
} from "./use-coretex";
export type { CoretexState, CoretexActions, CoretexLogLine, AgentActivity, UseCoretexResult } from "./use-coretex";
