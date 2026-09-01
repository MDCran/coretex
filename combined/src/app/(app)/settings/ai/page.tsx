import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { aiConfigured, AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { AiClient, type AiCallRow, type DayCost } from "./ai-client";
import { LiveRefresh } from "@/components/app-shell/live-refresh";
import { formatDateShort } from "@/lib/dates";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
// Upper bound on rows shipped to the client for in-browser pagination. The table
// pages through these locally so paging never triggers a navigation/scroll jump.
const ROW_WINDOW = 500;

export default async function SettingsAiPage() {
    const user = await requireUser();

    const settings = await db.settings.findUnique({ where: { userId: user.id } });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayWindowStart = new Date(now);
    dayWindowStart.setDate(dayWindowStart.getDate() - 29);
    dayWindowStart.setHours(0, 0, 0, 0);

    const [monthAgg, allTimeAgg, latencyAgg, totalCount, rows, recentForChart, deletedRolesCount] = await Promise.all([
        db.aiCall.aggregate({ where: { userId: user.id, createdAt: { gte: monthStart } }, _sum: { costUsd: true } }),
        db.aiCall.aggregate({ where: { userId: user.id }, _sum: { costUsd: true }, _count: true }),
        db.aiCall.aggregate({ where: { userId: user.id, latencyMs: { not: null } }, _avg: { latencyMs: true } }),
        db.aiCall.count({ where: { userId: user.id } }),
        db.aiCall.findMany({
            where: { userId: user.id },
            orderBy: { createdAt: "desc" },
            take: ROW_WINDOW,
        }),
        db.aiCall.findMany({
            where: { userId: user.id, createdAt: { gte: dayWindowStart } },
            select: { createdAt: true, costUsd: true },
        }),
        db.deletedSuggestedRole.count({ where: { userId: user.id } }),
    ]);

    const settingsSpend = settings ? Number(settings.aiMonthSpend) : 0;
    const callMonthSpend = monthAgg._sum.costUsd ? Number(monthAgg._sum.costUsd) : 0;
    const monthSpend = Math.max(settingsSpend, callMonthSpend);
    const allTimeSpend = allTimeAgg._sum.costUsd ? Number(allTimeAgg._sum.costUsd) : 0;
    const totalRequests = allTimeAgg._count ?? 0;
    const avgLatency = latencyAgg._avg.latencyMs ?? null;

    // Build a continuous 30-day cost series.
    const byDay = new Map<string, number>();
    for (const c of recentForChart) {
        const key = c.createdAt.toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) ?? 0) + Number(c.costUsd));
    }
    const dailyCosts: DayCost[] = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date(dayWindowStart);
        d.setDate(d.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        dailyCosts.push({
            label: formatDateShort(d),
            cost: Number((byDay.get(key) ?? 0).toFixed(6)),
        });
    }

    const callRows: AiCallRow[] = rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        purpose: r.purpose,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: Number(r.costUsd),
        latencyMs: r.latencyMs,
        errored: r.errored,
        errorMessage: r.errorMessage,
    }));

    return (
        <>
            {/* Keep usage + spend fresh while AI calls happen, without a manual reload. */}
            <LiveRefresh intervalMs={20000} />
            <AiClient
            configured={aiConfigured()}
            models={AVAILABLE_MODELS}
            defaultModel={DEFAULT_MODEL}
            settings={{
                aiEnabled: settings?.aiEnabled ?? false,
                aiModel: settings?.aiModel ?? null,
                aiBudgetUsd: settings?.aiBudgetUsd ? Number(settings.aiBudgetUsd) : null,
                coachStyle: settings?.coachStyle ?? null,
                aiMonthlyLimitUsd: settings?.aiMonthlyLimitUsd != null ? Number(settings.aiMonthlyLimitUsd) : null,
                aiPerSearchLimitUsd: settings?.aiPerSearchLimitUsd != null ? Number(settings.aiPerSearchLimitUsd) : null,
            }}
            monthSpend={monthSpend}
            allTimeSpend={allTimeSpend}
            totalRequests={totalRequests}
            avgLatencyMs={avgLatency}
            dailyCosts={dailyCosts}
            calls={callRows}
            pageSize={PAGE_SIZE}
            totalCalls={totalCount}
            deletedRolesCount={deletedRolesCount}
            />
        </>
    );
}
