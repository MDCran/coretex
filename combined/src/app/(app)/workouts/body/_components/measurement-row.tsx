"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash01 } from "@untitledui/icons";
import { toast } from "sonner";
import { ButtonUtility } from "@/components/base/buttons/button-utility";
import { deleteBodyMeasurement } from "@/lib/actions/workouts-body";
import { useConfirm } from "@/components/application/confirm-dialog/confirm-dialog";
import { type UnitSystem, heightToDisplay, weightToDisplay } from "@/lib/units";

type M = {
    id: string;
    date: string;
    weightKg: number | null;
    bodyFatPct: number | null;
    chestCm: number | null;
    waistCm: number | null;
    armLCm: number | null;
    armRCm: number | null;
    legLCm: number | null;
    legRCm: number | null;
};

const fmt = (n: number | null) => (n == null ? "—" : String(n));

export const MeasurementRow = ({ m, unitSystem }: { m: M; unitSystem: UnitSystem }) => {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const { confirm, dialog } = useConfirm();
    // Stored metric (kg/cm) → display unit. Labels live in the table header.
    const w = (n: number | null) => (n == null ? "—" : String(weightToDisplay(n, unitSystem)));
    const l = (n: number | null) => (n == null ? "—" : String(heightToDisplay(n, unitSystem)));
    return (
        <tr className="border-b border-secondary text-secondary">
            <td className="py-2 pr-3 font-medium text-primary">{m.date}</td>
            <td className="py-2 pr-3">{w(m.weightKg)}</td>
            <td className="py-2 pr-3">{fmt(m.bodyFatPct)}</td>
            <td className="py-2 pr-3">{l(m.chestCm)}</td>
            <td className="py-2 pr-3">{l(m.waistCm)}</td>
            <td className="py-2 pr-3">
                {l(m.armLCm)} / {l(m.armRCm)}
            </td>
            <td className="py-2 pr-3">
                {l(m.legLCm)} / {l(m.legRCm)}
            </td>
            <td className="py-2 text-right">
                <ButtonUtility
                    size="xs"
                    color="tertiary"
                    icon={Trash01}
                    tooltip="Delete"
                    isDisabled={pending}
                    onClick={() =>
                        confirm({
                            title: "Delete this measurement?",
                            destructive: true,
                            confirmLabel: "Delete",
                            onConfirm: () =>
                                startTransition(async () => {
                                    await deleteBodyMeasurement(m.id);
                                    toast.success("Deleted");
                                    router.refresh();
                                }),
                        })
                    }
                />
                {dialog}
            </td>
        </tr>
    );
};
