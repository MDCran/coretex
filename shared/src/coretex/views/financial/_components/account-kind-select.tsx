// @ts-nocheck
import { useState } from "react";
import { Bank, Briefcase01, CurrencyDollarCircle, DotsHorizontal, FileCheck02, PiggyBank01 } from "@untitledui/icons";
import { Select } from "@/components/base/select/select";
import { Field } from "./financial-ui";

const KINDS = [
    { id: "CHECKING", label: "Checking", icon: Bank },
    { id: "SAVINGS", label: "Savings", icon: PiggyBank01 },
    { id: "MONEY_MARKET", label: "Money market", icon: CurrencyDollarCircle },
    { id: "CD", label: "Certificate of deposit (CD)", icon: FileCheck02 },
    { id: "BROKERAGE", label: "Brokerage", icon: Briefcase01 },
    { id: "OTHER", label: "Other", icon: DotsHorizontal },
] as const;

export function AccountKindSelect({ defaultValue = "CHECKING", includeLoan = false }: { defaultValue?: string; includeLoan?: boolean }) {
    const [value, setValue] = useState(defaultValue === "LOAN" && !includeLoan ? "CHECKING" : defaultValue);

    const items = [
        ...KINDS.map((k) => ({
            id: k.id,
            label: k.label,
            icon: <k.icon data-icon className="size-4 text-fg-quaternary" />,
        })),
        ...(includeLoan ? [{ id: "LOAN", label: "Loan (legacy)", icon: <Bank data-icon className="size-4 text-fg-quaternary" /> }] : []),
    ];

    return (
        <Field label="Account type">
            <input type="hidden" name="kind" value={value} />
            <Select
                selectedKey={value}
                onSelectionChange={(k) => k && setValue(String(k))}
                items={items}
                placeholder="Select account type"
            >
                {(item) => (
                    <Select.Item id={item.id} icon={item.icon}>
                        {item.label}
                    </Select.Item>
                )}
            </Select>
        </Field>
    );
}
