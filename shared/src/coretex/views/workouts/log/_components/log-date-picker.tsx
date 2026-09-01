// @ts-nocheck
import { ControlledDateInput } from "@/components/base/input/form-date-input";
import { ChevronLeft, ChevronRight } from "@untitledui/icons";
import { Button } from "react-aria-components";

const useRouter = () => ({ push: () => {}, replace: () => {} }); const useSearchParams = () => ({ get: () => null });


export const LogDatePicker = ({ dateKey }: { dateKey: string }) => {
    const router = useRouter();

    const go = (key: string) => router.push(`/workouts/log?date=${key}`);

    const shift = (days: number) => {
        const d = dateKeyToUtc(dateKey);
        d.setUTCDate(d.getUTCDate() + days);
        go(toDateKey(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    };

    return (
        <div className="flex items-center gap-2">
            <Button size="sm" color="secondary" iconLeading={ChevronLeft} onClick={() => shift(-1)} aria-label="Previous day" />
            <div className="w-44">
                <ControlledDateInput variant="date" value={dateKey} onChange={(v) => v && go(v)} />
            </div>
            <Button size="sm" color="secondary" iconLeading={ChevronRight} onClick={() => shift(1)} aria-label="Next day" />
            <Button size="sm" color="tertiary" onClick={() => go(toDateKey(new Date()))}>
                Today
            </Button>
        </div>
    );
};
