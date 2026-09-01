// @ts-nocheck
import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { StateError } from "@/components/foundations/states";

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: (reset: () => void, error: Error) => ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/** Minimal error boundary — class component (the only way to catch render errors in React). */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Hook for an error-reporting service (Sentry, etc.).
        this.props.onError?.(error, info);
    }

    reset = () => this.setState({ error: null });

    render() {
        if (this.state.error) {
            if (this.props.fallback) return this.props.fallback(this.reset, this.state.error);
            return (
                <StateError
                    action={
                        <Button size="sm" color="secondary" onClick={this.reset}>
                            Try again
                        </Button>
                    }
                />
            );
        }
        return this.props.children;
    }
}

/**
 * Wrap an async surface (typically a server component fetching data) so it streams in
 * with a skeleton fallback and degrades to a recoverable error state — the building
 * block for per-card RSC streaming and a consistent loading/error triad everywhere.
 */
export function AsyncBoundary({
    children,
    pending,
    errorFallback,
    onError,
}: {
    children: ReactNode;
    pending: ReactNode;
    errorFallback?: (reset: () => void, error: Error) => ReactNode;
    onError?: (error: Error, info: ErrorInfo) => void;
}) {
    return (
        <ErrorBoundary fallback={errorFallback} onError={onError}>
            <Suspense fallback={pending}>{children}</Suspense>
        </ErrorBoundary>
    );
}
