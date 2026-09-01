// @ts-nocheck
import React from 'react';
import { Home01 } from '@untitledui/icons';
import type { CoretexState, CoretexActions } from '../use-coretex';

export interface ViewProps {
    state?: CoretexState;
    actions?: CoretexActions;
    onNavigate?: any;
    client?: any;
}

export const LearningView = (props: ViewProps) => {
    return (
        <div className="flex h-full flex-col gap-6 overflow-y-auto overflow-x-hidden p-6">
            <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--surface-2)]">
                    <Home01 className="size-5 text-[var(--brand)]" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-[var(--c-text-primary)]">Learning Dashboard</h1>
                    <p className="text-sm text-[var(--c-text-tertiary)]">Manage your learning.</p>
                </div>
            </div>
        </div>
    );
};
