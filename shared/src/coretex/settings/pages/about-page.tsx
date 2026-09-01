"use client";

// The installed desktop process owns update discovery, preferences, downloads,
// and safe external navigation. This page presents that contract and keeps a
// small bundled changelog available when release history cannot be reached.

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { IconComponentType } from "@/components/base/badges/badge-types";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Toggle } from "@/components/base/toggle/toggle";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";
import {
  AlertCircle,
  Announcement02,
  Beaker01,
  BookOpen01,
  CheckCircle,
  Clock,
  Code01,
  Download01,
  File06,
  GitBranch01,
  InfoCircle,
  LifeBuoy01,
  LinkExternal01,
  RefreshCcw02,
  ShieldTick,
  Stars01,
  Zap,
} from "@untitledui/icons";
import { Alert } from "../../ui/alert";
import { requestTour } from "../../ui/tour";
import {
  CHANGELOG,
  CORETEX_VERSION,
  UPDATE_CHANNELS,
  UPDATE_REPO,
  channelLabel,
  checkForUpdates,
  compareSemver,
  downloadDesktopUpdate,
  getDesktopUpdateStatus,
  getReleaseHistory,
  getUpdatePreferences,
  installDesktopUpdate,
  loadUpdateChannel,
  openUpdateExternal,
  setUpdatePreferences,
  subscribeToDesktopUpdateStatus,
  type ReleaseHistoryItem,
  type UpdateChannel,
  type UpdateExternalTarget,
  type UpdatePreferences,
  type UpdateStatus,
} from "../../version";
import { SettingsSection } from "../controls";
import { SettingsPageHeader, SettingsStatusBadge } from "../settings-shell";
import type { SettingsPageProps } from "../settings-window";

const COPYRIGHT_YEAR = 2026;

const CHANNEL_META: Record<
  string,
  {
    icon: IconComponentType;
    color: "success" | "brand" | "warning";
    cadence: string;
    detail: string;
  }
> = {
  stable: {
    icon: ShieldTick,
    color: "success",
    cadence: "Production",
    detail: "Production releases only. Recommended for everyday use.",
  },
  beta: {
    icon: Beaker01,
    color: "brand",
    cadence: "Early access",
    detail:
      "Beta builds arrive early; newer stable promotions remain eligible for this stream.",
  },
  nightly: {
    icon: Zap,
    color: "warning",
    cadence: "Latest builds",
    detail:
      "A distinct nightly stream for the newest packaged changes. Expect frequent updates and rough edges.",
  },
};

const ACKNOWLEDGEMENTS: { name: string; license: string }[] = [
  { name: "Untitled UI React", license: "Untitled UI license" },
  { name: "@untitledui/icons", license: "Untitled UI license" },
  { name: "React", license: "MIT" },
  { name: "xterm.js", license: "MIT" },
  { name: "Recharts", license: "MIT" },
  { name: "dockerode", license: "Apache-2.0" },
  { name: "ssh2 / basic-ftp", license: "MIT" },
  { name: "Brand logos via LogoKit", license: "Per LogoKit terms" },
];

function fmtDate(value: string | null): string {
  if (!value) return "Unpublished";
  // Date-only release values are calendar dates, not UTC instants. Appending a
  // local midnight keeps 2026-08-18 from rendering as Aug 17 west of UTC.
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value,
  );
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtTime(value?: number): string {
  if (!value) return "Not yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not yet";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function fmtInterval(milliseconds?: number): string {
  if (!milliseconds || milliseconds <= 0) return "periodically";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `every ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `every ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `every ${days} day${days === 1 ? "" : "s"}`;
}

function statusCheckedAt(status: UpdateStatus | null): number | undefined {
  if (!status) return undefined;
  if (status.lastCheckedAt) return status.lastCheckedAt;
  return "checkedAt" in status ? status.checkedAt : undefined;
}

function releaseNoteLines(notes: string[] | undefined): string[] {
  return (notes ?? []).map((note) => note.trim()).filter(Boolean);
}

function StatusPanel({
  status,
  channel,
  currentVersion,
  onCheck,
  onDownload,
  onInstall,
  onOpenReleases,
}: {
  status: UpdateStatus | null;
  channel: UpdateChannel;
  currentVersion: string;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onOpenReleases: () => void;
}) {
  const channelName = channelLabel(channel).toLowerCase();

  if (status?.state === "checking") {
    return (
      <Alert color="brand" title={`Checking the ${channelName} stream…`}>
        Coretex is asking the desktop updater for the newest compatible build.
      </Alert>
    );
  }

  if (status?.state === "current") {
    const feedComparison = compareSemver(status.latest, currentVersion);
    const olderPublishedBuild = feedComparison < 0;
    const newerIneligibleBuild = feedComparison > 0;
    return (
      <Alert
        color="success"
        title={
          olderPublishedBuild
            ? "No newer eligible update"
            : newerIneligibleBuild
              ? "Newer build is not currently eligible"
              : "You're up to date"
        }
      >
        {olderPublishedBuild ? (
          <>
            You have Coretex v{currentVersion}; the {channelName} feed reports v
            {status.latest}. Coretex never downgrades an installed build
            automatically.
          </>
        ) : newerIneligibleBuild ? (
          <>
            The {channelName} feed reports v{status.latest}, but it is not
            eligible for this installation yet. It may be staged or require a
            different system configuration.
          </>
        ) : (
          <>
            Coretex v{currentVersion} is current on the {channelName} stream.
          </>
        )}{" "}
        Last checked {fmtTime(status.checkedAt)}.
      </Alert>
    );
  }

  if (status?.state === "available") {
    return (
      <Alert
        color="warning"
        title={`Coretex v${status.version} is available`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {status.canDownload ? (
              <Button
                size="sm"
                color="primary"
                iconLeading={Download01}
                onClick={onDownload}
              >
                Download update
              </Button>
            ) : (
              <Button
                size="sm"
                color="primary"
                iconTrailing={LinkExternal01}
                onClick={onOpenReleases}
              >
                Open release
              </Button>
            )}
            <Button
              size="sm"
              color="secondary"
              iconLeading={RefreshCcw02}
              onClick={onCheck}
            >
              Check again
            </Button>
          </div>
        }
      >
        {status.name ? `${status.name}. ` : ""}You have v{currentVersion}.
        Downloading never restarts the app until you choose to install.
        {status.releaseNotes && (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs">
            {status.releaseNotes}
          </p>
        )}
      </Alert>
    );
  }

  if (status?.state === "downloading") {
    const percent = Math.max(0, Math.min(100, status.percent));
    return (
      <Alert color="brand" title={`Downloading Coretex v${status.version}`}>
        <div className="mt-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-tertiary">
            <span>{Math.round(percent)}% complete</span>
            <span className="tabular-nums">
              {fmtBytes(status.transferred)} / {fmtBytes(status.total)}
              {status.bytesPerSecond > 0
                ? ` · ${fmtBytes(status.bytesPerSecond)}/s`
                : ""}
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label={`Downloading Coretex ${status.version}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <div
              className="h-full rounded-full bg-brand-solid transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </Alert>
    );
  }

  if (status?.state === "ready") {
    return (
      <Alert
        color="success"
        title={`Coretex v${status.version} is ready`}
        action={
          <Button size="sm" color="primary" onClick={onInstall}>
            Restart and install
          </Button>
        }
      >
        The downloaded installer is ready. Save any terminal work before
        restarting Coretex.
        {status.releaseNotes && (
          <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs">
            {status.releaseNotes}
          </p>
        )}
      </Alert>
    );
  }

  if (status?.state === "development") {
    return (
      <Alert color="brand" title="Live development build">
        {status.reason} Installer downloads and restart-to-install are
        intentionally unavailable here.
      </Alert>
    );
  }

  if (status?.state === "error") {
    return (
      <Alert
        color="warning"
        title="The update service couldn't finish"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              color="secondary"
              iconLeading={RefreshCcw02}
              onClick={onCheck}
            >
              Try again
            </Button>
            <Button
              size="sm"
              color="link-color"
              iconTrailing={LinkExternal01}
              onClick={onOpenReleases}
            >
              Open releases
            </Button>
          </div>
        }
      >
        {status.reason}
      </Alert>
    );
  }

  return (
    <div className="rounded-xl border border-secondary bg-primary p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <FeaturedIcon
            icon={RefreshCcw02}
            color="gray"
            theme="light"
            size="md"
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Ready to check</p>
            <p className="mt-0.5 text-sm text-tertiary">
              Compare v{currentVersion} with the {channelName} stream.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          color="primary"
          iconLeading={RefreshCcw02}
          onClick={onCheck}
        >
          Check now
        </Button>
      </div>
    </div>
  );
}

function ChannelPicker({
  value,
  disabled,
  onChange,
}: {
  value: UpdateChannel;
  disabled: boolean;
  onChange: (channel: UpdateChannel) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
      role="radiogroup"
      aria-label="Release stream"
    >
      {UPDATE_CHANNELS.map((option) => {
        const selected = option.id === value;
        const meta = CHANNEL_META[option.id] ?? CHANNEL_META.beta;
        const Icon = meta.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            data-channel={option.id}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            onKeyDown={(event) => {
              const currentIndex = UPDATE_CHANNELS.findIndex(
                (channel) => channel.id === option.id,
              );
              let nextIndex = currentIndex;
              if (event.key === "ArrowRight" || event.key === "ArrowDown")
                nextIndex = (currentIndex + 1) % UPDATE_CHANNELS.length;
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                nextIndex =
                  (currentIndex - 1 + UPDATE_CHANNELS.length) %
                  UPDATE_CHANNELS.length;
              else if (event.key === "Home") nextIndex = 0;
              else if (event.key === "End")
                nextIndex = UPDATE_CHANNELS.length - 1;
              else return;

              event.preventDefault();
              const next = UPDATE_CHANNELS[nextIndex];
              onChange(next.id);
              const group = event.currentTarget.closest('[role="radiogroup"]');
              requestAnimationFrame(() => {
                group
                  ?.querySelector<HTMLElement>(`[data-channel="${next.id}"]`)
                  ?.focus();
              });
            }}
            className={cx(
              "group min-w-0 rounded-xl border p-3 text-left outline-focus-ring transition",
              selected
                ? "border-brand bg-brand-primary_alt"
                : "border-secondary bg-primary hover:border-primary hover:bg-primary_hover",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-secondary">
                <Icon className="size-4 text-secondary" />
              </span>
              <span
                className={cx(
                  "grid size-4 place-items-center rounded-full border",
                  selected
                    ? "border-brand-solid bg-brand-solid"
                    : "border-primary",
                )}
              >
                {selected && (
                  <span className="size-1.5 rounded-full bg-white" />
                )}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-primary">
              {option.label}
            </p>
            <p className="mt-0.5 text-xs font-medium text-quaternary">
              {meta.cadence}
            </p>
          </button>
        );
      })}
    </div>
  );
}

type BundledRelease = {
  version: string;
  name: string;
  publishedAt: string;
  channel: UpdateChannel;
  notes: string[];
  current: boolean;
  prerelease: boolean;
};

function ReleaseHistory({
  releases,
  channel,
  loading,
  error,
  onRefresh,
  onOpenReleases,
}: {
  releases: ReleaseHistoryItem[];
  channel: UpdateChannel;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenReleases: () => void;
}) {
  const [scope, setScope] = useState<"all" | "stream">("all");
  const liveRows =
    scope === "stream"
      ? releases.filter((release) => release.channel === channel)
      : releases;
  const bundledRows = useMemo<BundledRelease[]>(
    () =>
      CHANGELOG.filter(
        (entry) => scope === "all" || entry.channel === channel,
      ).map((entry) => ({
        version: entry.version,
        name: entry.title,
        publishedAt: entry.date,
        channel: entry.channel,
        notes: entry.notes,
        current: entry.version === CORETEX_VERSION,
        prerelease: entry.channel !== "stable",
      })),
    [scope, channel],
  );
  const rows: Array<ReleaseHistoryItem | BundledRelease> =
    liveRows.length > 0 ? liveRows : bundledRows;
  const isBundled = liveRows.length === 0;

  return (
    <SettingsSection
      title="Release history"
      description="Published releases when available, with a compact bundled changelog kept offline."
    >
      <div className="flex flex-col gap-4 py-3.5 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-lg bg-secondary p-0.5"
            aria-label="Release history filter"
          >
            {(["all", "stream"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => setScope(option)}
                className={cx(
                  "rounded-md px-3 py-1.5 text-xs font-semibold outline-focus-ring transition",
                  scope === option
                    ? "bg-primary text-primary shadow-xs"
                    : "text-tertiary hover:text-secondary",
                )}
              >
                {option === "all"
                  ? "All releases"
                  : `${channelLabel(channel)} labels`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              color="secondary"
              iconLeading={RefreshCcw02}
              isLoading={loading}
              onClick={onRefresh}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              color="link-color"
              iconTrailing={LinkExternal01}
              onClick={onOpenReleases}
            >
              GitHub Releases
            </Button>
          </div>
        </div>

        <p className="text-xs text-quaternary">
          The label filter describes published release history. Effective update
          candidates can differ: Beta also accepts a newer stable promotion.
        </p>

        {(error || isBundled) && (
          <div className="flex items-start gap-2.5 rounded-lg border border-secondary bg-secondary px-3 py-2.5">
            <InfoCircle className="mt-0.5 size-4 shrink-0 text-quaternary" />
            <p className="text-xs text-tertiary">
              {error
                ? `${error} Showing the notes bundled with this build instead.`
                : "No published history was returned. Showing the notes bundled with this build instead."}
            </p>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-secondary bg-primary px-6 text-center">
            <div>
              <Stars01 className="mx-auto size-6 text-quaternary" />
              <p className="mt-2 text-sm font-medium text-primary">
                No releases in this view
              </p>
              <p className="mt-1 text-xs text-tertiary">
                Choose all releases or open GitHub Releases.
              </p>
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-secondary overflow-hidden rounded-xl border border-secondary bg-primary">
            {rows.slice(0, 8).map((release) => {
              const meta = CHANNEL_META[release.channel] ?? CHANNEL_META.beta;
              return (
                <li
                  key={`${release.version}-${release.publishedAt}`}
                  className="p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-primary">
                          v{release.version}
                        </span>
                        {release.current && (
                          <Badge size="sm" color="success" type="pill-color">
                            <CheckCircle className="mr-1 inline size-3" />
                            Installed
                          </Badge>
                        )}
                        <Badge size="sm" color={meta.color} type="pill-color">
                          {channelLabel(release.channel)}
                        </Badge>
                        {isBundled && (
                          <Badge size="sm" color="gray">
                            Bundled notes
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium text-secondary">
                        {release.name || `Coretex ${release.version}`}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-quaternary">
                      {fmtDate(release.publishedAt)}
                    </time>
                  </div>
                  {releaseNoteLines(release.notes).length > 0 && (
                    <ul className="mt-3 grid gap-1.5 lg:grid-cols-2">
                      {releaseNoteLines(release.notes)
                        .slice(0, 6)
                        .map((note, index) => (
                          <li
                            key={`${release.version}-${index}`}
                            className="flex items-start gap-2 text-xs text-tertiary"
                          >
                            <Announcement02 className="mt-0.5 size-3.5 shrink-0 text-quaternary" />
                            <span>{note}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </SettingsSection>
  );
}

function ResourceCard({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: IconComponentType;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-secondary bg-primary p-4">
      <div className="flex items-start gap-3">
        <FeaturedIcon
          icon={Icon}
          color="gray"
          theme="light"
          size="md"
          className="shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-primary">{title}</p>
          <p className="mt-0.5 text-xs text-tertiary">{description}</p>
        </div>
      </div>
      <Button
        className="mt-4 self-start"
        size="sm"
        color="link-color"
        iconTrailing={LinkExternal01}
        onClick={onClick}
      >
        {action}
      </Button>
    </div>
  );
}

function ActionError({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 text-xs text-error-primary"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      {children}
    </p>
  );
}

export const AboutPage = (_props: SettingsPageProps) => {
  const [preferences, setPreferences] = useState<UpdatePreferences>(() => ({
    channel: loadUpdateChannel(),
    automaticChecks: true,
    autoDownload: false,
  }));
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [releases, setReleases] = useState<ReleaseHistoryItem[]>([]);
  const [checking, setChecking] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const channel = preferences.channel;
  const currentVersion = status?.currentVersion ?? CORETEX_VERSION;
  const busy =
    checking ||
    status?.state === "checking" ||
    status?.state === "downloading" ||
    status?.state === "ready";
  const isDevelopment =
    status?.state === "development" || status?.packaged === false;
  const installedDesktop = status?.packaged === true;
  const canScheduleUpdates = installedDesktop && !isDevelopment;
  const checkCadence = fmtInterval(status?.checkIntervalMs);

  const refreshHistory = async (): Promise<void> => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await getReleaseHistory({ refresh: true });
      if (result.ok) {
        setReleases(result.releases);
      } else {
        setReleases([]);
        setHistoryError(result.reason);
      }
    } catch (error) {
      setReleases([]);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Release history is unavailable.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    let statusEventSeen = false;

    const unsubscribe = subscribeToDesktopUpdateStatus((next) => {
      if (!mounted) return;
      statusEventSeen = true;
      setStatus(next);
      setPreferences((current) => ({
        channel: next.channel ?? current.channel,
        automaticChecks: next.automaticChecks ?? current.automaticChecks,
        autoDownload: next.autoDownload ?? current.autoDownload,
      }));
    });

    void getDesktopUpdateStatus().then((initial) => {
      if (mounted && initial && !statusEventSeen) setStatus(initial);
    });
    void getUpdatePreferences().then((initial) => {
      if (mounted && !statusEventSeen) setPreferences(initial);
    });
    void getReleaseHistory()
      .then((history) => {
        if (!mounted) return;
        if (history.ok) {
          setReleases(history.releases);
          setHistoryError(null);
        } else {
          setReleases([]);
          setHistoryError(history.reason);
        }
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Release history is unavailable.",
        );
      })
      .finally(() => {
        if (mounted) setHistoryLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const commitPreferences = async (
    patch: Partial<UpdatePreferences>,
  ): Promise<void> => {
    const previous = preferences;
    setPreferences({ ...previous, ...patch });
    setPreferenceError(null);
    try {
      setPreferences(await setUpdatePreferences(patch));
    } catch (error) {
      setPreferences(previous);
      setPreferenceError(
        error instanceof Error
          ? error.message
          : "The updater preference could not be saved.",
      );
    }
  };

  const runCheck = async (): Promise<void> => {
    setChecking(true);
    setActionError(null);
    try {
      setStatus(await checkForUpdates(channel));
      void refreshHistory();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The update check could not be started.",
      );
    } finally {
      setChecking(false);
    }
  };

  const runDownload = async (): Promise<void> => {
    setActionError(null);
    try {
      setStatus(await downloadDesktopUpdate());
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The update download could not be started.",
      );
    }
  };

  const runInstall = async (): Promise<void> => {
    setActionError(null);
    const result = await installDesktopUpdate();
    if (!result.ok)
      setActionError(
        result.reason ?? "The downloaded update could not be installed.",
      );
  };

  const launchResource = async (
    target: UpdateExternalTarget,
  ): Promise<void> => {
    setActionError(null);
    try {
      const result = await openUpdateExternal(target);
      if (!result.ok)
        setActionError(result.reason ?? "Coretex could not open that link.");
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Coretex could not open that link.",
      );
    }
  };

  const headerBadge = (() => {
    if (checking)
      return <SettingsStatusBadge label="Checking…" color="brand" />;
    switch (status?.state) {
      case "checking":
        return <SettingsStatusBadge label="Checking…" color="brand" />;
      case "current":
        return <SettingsStatusBadge label="Up to date" color="success" />;
      case "available":
        return (
          <SettingsStatusBadge
            label={`v${status.version} available`}
            color="warning"
          />
        );
      case "downloading":
        return (
          <SettingsStatusBadge
            label={`Downloading ${Math.round(status.percent)}%`}
            color="brand"
          />
        );
      case "ready":
        return <SettingsStatusBadge label="Ready to install" color="success" />;
      case "development":
        return <SettingsStatusBadge label="Development build" color="brand" />;
      case "error":
        return (
          <SettingsStatusBadge label="Updater needs attention" color="error" />
        );
      default:
        return (
          <SettingsStatusBadge label={`v${currentVersion}`} color="gray" />
        );
    }
  })();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsPageHeader
        icon={LifeBuoy01}
        title="About & updates"
        subtitle="Build information, release streams, update preferences, and release notes."
        badges={headerBadge}
        actions={
          <Button
            size="sm"
            color="secondary"
            iconLeading={RefreshCcw02}
            isLoading={checking || status?.state === "checking"}
            showTextWhileLoading
            isDisabled={busy}
            onClick={() => void runCheck()}
          >
            {checking || status?.state === "checking"
              ? "Checking…"
              : "Check now"}
          </Button>
        }
      />

      {actionError && <ActionError>{actionError}</ActionError>}

      <SettingsSection
        title="Application"
        description="The build and update source for this installation."
      >
        <div className="flex flex-col gap-5 py-3.5 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-secondary bg-secondary">
              <img src="./coretex-icon.svg" alt="" className="size-10" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-primary">Coretex</h2>
                <Badge size="sm" color="gray" type="pill-color">
                  v{currentVersion}
                </Badge>
                <Badge
                  size="sm"
                  color={(CHANNEL_META[channel] ?? CHANNEL_META.beta).color}
                  type="pill-color"
                >
                  {channelLabel(channel)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-tertiary">
                Local AI workspace for agents, terminals, projects, and personal
                operations.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-1 overflow-hidden rounded-xl border border-secondary bg-primary sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                term: "Build",
                value: isDevelopment
                  ? "Live development"
                  : installedDesktop
                    ? "Installed desktop"
                    : "Preview",
                icon: Code01,
              },
              {
                term: "Release stream",
                value: channelLabel(channel),
                icon: GitBranch01,
              },
              {
                term: "Last checked",
                value: fmtTime(statusCheckedAt(status)),
                icon: Clock,
              },
              {
                term: "Update source",
                value: "GitHub Releases",
                icon: Download01,
              },
            ].map(({ term, value, icon: Icon }) => (
              <div
                key={term}
                className="flex min-w-0 items-start gap-3 border-b border-secondary p-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-quaternary" />
                <div className="min-w-0">
                  <dt className="text-xs text-quaternary">{term}</dt>
                  <dd
                    className="mt-0.5 break-all text-sm font-medium text-primary"
                    title={value}
                  >
                    {value}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
          <p className="text-xs text-quaternary">
            © {COPYRIGHT_YEAR} Coretex. All rights reserved.
          </p>
        </div>
      </SettingsSection>

      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(22rem,0.92fr)]">
        <SettingsSection
          title="Update center"
          description="Check, download, and install without leaving Coretex."
        >
          <div className="flex flex-col gap-4 py-3.5 first:pt-0 last:pb-0">
            <StatusPanel
              status={status}
              channel={channel}
              currentVersion={currentVersion}
              onCheck={() => void runCheck()}
              onDownload={() => void runDownload()}
              onInstall={() => void runInstall()}
              onOpenReleases={() => void launchResource("releases")}
            />
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-secondary px-3 py-2.5">
                <dt className="text-xs text-quaternary">Automatic checks</dt>
                <dd className="mt-0.5 text-sm font-medium text-primary">
                  {!canScheduleUpdates
                    ? "Installed app only"
                    : preferences.automaticChecks
                      ? `On · ${checkCadence}`
                      : "Off"}
                </dd>
              </div>
              <div className="rounded-lg bg-secondary px-3 py-2.5">
                <dt className="text-xs text-quaternary">
                  Next scheduled check
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-primary">
                  {!canScheduleUpdates
                    ? "Unavailable"
                    : preferences.automaticChecks
                      ? fmtTime(status?.nextCheckAt)
                      : "Manual only"}
                </dd>
              </div>
            </dl>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Release stream"
          description="Choose how early you want new builds."
        >
          <div className="flex flex-col gap-4 py-3.5 first:pt-0 last:pb-0">
            <ChannelPicker
              value={channel}
              disabled={busy}
              onChange={(next) => void commitPreferences({ channel: next })}
            />
            <p className="text-xs text-tertiary">
              {(CHANNEL_META[channel] ?? CHANNEL_META.beta).detail}
            </p>
            <div className="divide-y divide-secondary rounded-xl border border-secondary bg-primary px-4">
              <div className="py-3.5">
                <Toggle
                  size="sm"
                  isSelected={canScheduleUpdates && preferences.automaticChecks}
                  isDisabled={!canScheduleUpdates}
                  onChange={(selected) =>
                    void commitPreferences(
                      selected
                        ? { automaticChecks: true }
                        : { automaticChecks: false, autoDownload: false },
                    )
                  }
                  label="Check automatically"
                  hint={
                    !canScheduleUpdates
                      ? "Background scheduling is only available in the installed desktop app."
                      : `Check this stream in the background ${checkCadence}.`
                  }
                />
              </div>
              <div className="py-3.5">
                <Toggle
                  size="sm"
                  isSelected={canScheduleUpdates && preferences.autoDownload}
                  isDisabled={
                    !canScheduleUpdates || !preferences.automaticChecks
                  }
                  onChange={(selected) =>
                    void commitPreferences({ autoDownload: selected })
                  }
                  label="Download automatically"
                  hint="Download verified updates in the background. Installing still requires your confirmation."
                />
              </div>
            </div>
            {preferenceError && <ActionError>{preferenceError}</ActionError>}
          </div>
        </SettingsSection>
      </div>

      <ReleaseHistory
        releases={releases}
        channel={channel}
        loading={historyLoading}
        error={historyError}
        onRefresh={() => void refreshHistory()}
        onOpenReleases={() => void launchResource("releases")}
      />

      <SettingsSection
        title="Source & legal"
        description="Repository, release notes, and notices connected to this build."
      >
        <div className="flex flex-col gap-4 py-3.5 first:pt-0 last:pb-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ResourceCard
              icon={Code01}
              title="Source code"
              description={UPDATE_REPO}
              action="Open repository"
              onClick={() => void launchResource("source")}
            />
            <ResourceCard
              icon={GitBranch01}
              title="Releases"
              description="Installer assets and update metadata."
              action="View releases"
              onClick={() => void launchResource("releases")}
            />
            <ResourceCard
              icon={BookOpen01}
              title="Changelog"
              description="Notes for published and bundled builds."
              action="Open changelog"
              onClick={() => void launchResource("changelog")}
            />
            <ResourceCard
              icon={File06}
              title="Licenses"
              description="Third-party notices shipped with Coretex."
              action="View notices"
              onClick={() => void launchResource("third-party-notices")}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ACKNOWLEDGEMENTS.map((item) => (
              <span key={item.name} title={item.license}>
                <Badge size="sm" color="gray" type="modern">
                  {item.name} · {item.license}
                </Badge>
              </span>
            ))}
          </div>
          <p className="text-xs text-quaternary">
            Product names and logos are trademarks of their respective owners
            and are used for identification only.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Getting started"
        description="Revisit the core surfaces whenever you need a refresher."
      >
        <div className="flex flex-wrap items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-3">
            <FeaturedIcon
              icon={LifeBuoy01}
              color="gray"
              theme="light"
              size="md"
              className="shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-primary">
                Coretex product tour
              </p>
              <p className="mt-0.5 text-xs text-tertiary">
                A short walkthrough of navigation, agents, projects, and
                terminals.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            color="secondary"
            iconLeading={Stars01}
            onClick={requestTour}
          >
            Take the tour
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
};
