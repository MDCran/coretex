// @ts-nocheck
import { TrendChart, type TrendPoint } from "./_components/trend-chart";
import { Card } from "./_components/health-ui";

export function OverviewCharts({ weight, sleep }: { weight: TrendPoint[]; sleep: TrendPoint[] }) {
    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <Card>
                <h3 className="mb-4 text-md font-semibold text-primary">Weight</h3>
                <TrendChart data={weight} series={[{ key: "value", name: "Weight" }]} type="area" fitDomain emptyLabel="No weight logged" />
            </Card>
            <Card>
                <h3 className="mb-4 text-md font-semibold text-primary">Sleep duration (hours)</h3>
                <TrendChart data={sleep} series={[{ key: "hours", name: "Hours" }]} type="area" fitDomain emptyLabel="No sleep logged" />
            </Card>
        </div>
    );
}
