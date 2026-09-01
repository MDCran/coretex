import { CheckCircle, Clock, Rocket01, Stars01 } from "@untitledui/icons";
import { ModulePageShell } from "@/components/app-shell/module-page-shell";
import { Badge } from "@/components/base/badges/badges";
import { SettingsCard, SettingsHeading } from "@/components/settings/settings-ui";
import { FeedbackForm } from "@/components/app-shell/feedback-form";
import { requireUser } from "@/lib/auth";
import { CHANGELOG, ROADMAP, type ChangeType, type RoadmapStatus } from "@/lib/changelog";
import { formatDate } from "@/lib/dates";
import { cx } from "@/utils/cx";

const CHANGE_BADGE: Record<ChangeType, { label: string; color: "success" | "brand" | "warning" }> = {
    added: { label: "New", color: "success" },
    improved: { label: "Improved", color: "brand" },
    fixed: { label: "Fixed", color: "warning" },
};

const ROADMAP_META: Record<RoadmapStatus, { label: string; icon: typeof CheckCircle; dot: string; text: string }> = {
    shipped: { label: "Shipped", icon: CheckCircle, dot: "bg-success-solid", text: "text-success-primary" },
    in_progress: { label: "In progress", icon: Clock, dot: "bg-warning-solid", text: "text-warning-primary" },
    planned: { label: "Planned", icon: Rocket01, dot: "bg-fg-quaternary", text: "text-tertiary" },
};

const ROADMAP_ORDER: RoadmapStatus[] = ["in_progress", "planned", "shipped"];

export default async function ChangelogPage() {
    await requireUser();

    return (
        <ModulePageShell title="What's new" description="Recent releases, what we're building next, and a place to tell us what you think.">
            <div className="flex max-w-3xl flex-col gap-6">
                {/* Roadmap */}
                <SettingsCard bloom="brand">
                    <SettingsHeading title="Roadmap" description="Where LifeOS is headed." />
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {ROADMAP_ORDER.flatMap((status) =>
                            ROADMAP.filter((r) => r.status === status).map((item) => {
                                const meta = ROADMAP_META[item.status];
                                const Icon = meta.icon;
                                return (
                                    <div key={item.title} className="flex gap-3 rounded-xl bg-secondary_subtle p-4 ring-1 ring-secondary ring-inset">
                                        <Icon className={cx("mt-0.5 size-5 shrink-0", meta.text)} aria-hidden="true" />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-semibold text-primary">{item.title}</p>
                                            </div>
                                            <p className="mt-0.5 text-sm text-tertiary">{item.description}</p>
                                            <span className={cx("mt-1.5 inline-flex items-center gap-1 text-xs font-medium", meta.text)}>
                                                <span className={cx("size-1.5 rounded-full", meta.dot)} aria-hidden="true" />
                                                {meta.label}
                                            </span>
                                        </div>
                                    </div>
                                );
                            }),
                        )}
                    </div>
                </SettingsCard>

                {/* Changelog timeline */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                        <Stars01 className="size-5 text-fg-brand-primary" aria-hidden="true" />
                        <h2 className="text-lg font-semibold text-primary">Release notes</h2>
                    </div>
                    {CHANGELOG.map((release) => (
                        <div key={release.version} className="rounded-2xl bg-primary p-5 ring-1 ring-secondary ring-inset sm:p-6">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge color="brand" size="md" type="pill-color">
                                    v{release.version}
                                </Badge>
                                <span className="text-xs text-tertiary">{formatDate(release.date)}</span>
                            </div>
                            <h3 className="mt-2 text-md font-semibold text-primary">{release.title}</h3>
                            <ul className="mt-3 flex flex-col gap-2.5">
                                {release.highlights.map((h, i) => {
                                    const badge = CHANGE_BADGE[h.type];
                                    return (
                                        <li key={i} className="flex items-start gap-2.5">
                                            <Badge color={badge.color} size="sm" type="pill-color" className="mt-0.5 shrink-0">
                                                {badge.label}
                                            </Badge>
                                            <span className="text-sm text-secondary">{h.text}</span>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ))}
                </div>

                {/* Feedback */}
                <SettingsCard bloom="emerald">
                    <SettingsHeading title="Send feedback" description="Spotted a bug or have an idea? We read everything." />
                    <div className="mt-4">
                        <FeedbackForm />
                    </div>
                </SettingsCard>
            </div>
        </ModulePageShell>
    );
}
