"use client";

import { useCallback, useState } from "react";
import { SearchLg } from "@untitledui/icons";
import { Card, CardBody, CardHeader } from "@/components/jobs/card";
import { JobSearchRunControls } from "@/components/career/job-search-actions";
import { SuggestedRolesTable, type LeadRow } from "@/components/career/suggested-roles-table";

/**
 * Client shell that wires the live run loop to the suggested-roles table. The run controls
 * append each pass's new leads into shared state, which the table merges + flashes — so rows
 * appear without any page refresh. Server data contracts are untouched: the initial rows are
 * still rendered server-side and passed straight through.
 */
export function JobSearchPanel({ initialRows, configured }: { initialRows: LeadRow[]; configured: boolean }) {
    const [liveLeads, setLiveLeads] = useState<LeadRow[]>([]);
    const [count, setCount] = useState(initialRows.length);

    const handleLeads = useCallback((rows: LeadRow[]) => {
        if (rows.length === 0) return;
        setLiveLeads((prev) => [...prev, ...rows]);
    }, []);

    return (
        <Card>
            <CardHeader title={`AI suggested roles (${count})`} action={<SearchLg className="size-5 text-fg-quaternary" />} />
            <CardBody className="flex flex-col gap-4">
                <JobSearchRunControls disabled={!configured} onLeads={handleLeads} />
            </CardBody>
            <div className="border-t border-secondary">
                <SuggestedRolesTable rows={initialRows} liveLeads={liveLeads} onTotalChange={setCount} />
            </div>
        </Card>
    );
}
