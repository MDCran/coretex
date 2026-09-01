"use client";

import { useMemo, useState } from "react";
import { SelectInput } from "@/components/jobs/fields";

export type PickerDoc = {
    id: string;
    name: string;
    versions: { id: string; versionNumber: number; label: string | null }[];
};

/**
 * Cascading picker: choose a document, then a version. Posts the chosen
 * JobDocumentVersion id under `name`. Defaults the version to the latest.
 */
export function VersionPicker({
    name,
    label,
    documents,
    defaultVersionId,
}: {
    name: string;
    label?: string;
    documents: PickerDoc[];
    defaultVersionId?: string | null;
}) {
    const initialDocId = documents.find((d) => d.versions.some((v) => v.id === defaultVersionId))?.id ?? "";
    const [docId, setDocId] = useState(initialDocId);
    const [versionId, setVersionId] = useState(defaultVersionId ?? "");

    const versions = useMemo(() => documents.find((d) => d.id === docId)?.versions ?? [], [documents, docId]);

    function onDocChange(value: string) {
        setDocId(value);
        if (!value) {
            setVersionId("");
        } else {
            const doc = documents.find((d) => d.id === value);
            setVersionId(doc?.versions[0]?.id ?? "");
        }
    }

    return (
        <div className="flex flex-col gap-1.5">
            {label && <span className="text-sm font-medium text-secondary">{label}</span>}
            <input type="hidden" name={name} value={versionId} />
            <div className="grid gap-2 sm:grid-cols-2">
                <SelectInput
                    placeholder="None"
                    value={docId}
                    onChange={(e) => onDocChange(e.target.value)}
                    options={documents.map((d) => ({ value: d.id, label: d.name }))}
                />
                <SelectInput
                    placeholder="Version"
                    value={versionId}
                    onChange={(e) => setVersionId(e.target.value)}
                    disabled={!docId || versions.length === 0}
                    options={versions.map((v) => ({ value: v.id, label: `v${v.versionNumber}${v.label ? ` · ${v.label}` : ""}` }))}
                />
            </div>
        </div>
    );
}
