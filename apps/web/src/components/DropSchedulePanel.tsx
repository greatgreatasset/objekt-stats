import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  computeDropProgressPct,
  formatDropCountdown,
  formatDropWindow,
  formatShortUtcDate,
  isLongRunningSeasonalDrop,
  selectRecentPastDropsPreview,
  type DropScheduleEntry,
} from "@objekt-stats/stats";

export interface DropSchedulePanelData {
  serverNowIso: string;
  lastSyncedAt: string | null;
  featuredActive: DropScheduleEntry | null;
  active: DropScheduleEntry[];
  upcoming: DropScheduleEntry[];
  past: DropScheduleEntry[];
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  shop: "Shop",
  seasonal: "Seasonal",
  tour: "Tour",
  merch: "Merch / Pass+",
  offline: "Offline",
  promotional: "Promo",
  album: "Album",
};

function typeLabel(eventType: string): string {
  return EVENT_TYPE_LABEL[eventType.toLowerCase()] ?? eventType;
}

function formatBuyerLabel(buyers: number, isFloor?: boolean): string {
  return `${buyers.toLocaleString()}${isFloor ? "+" : ""} buyers`;
}

export function DropSchedulePanel({
  schedule,
  accentColor,
}: {
  schedule: DropSchedulePanelData;
  accentColor: string;
}) {
  const [tab, setTab] = useState<"overview" | "active" | "upcoming" | "past">(
    "overview",
  );
  const [showMath, setShowMath] = useState(false);

  // Hydration-safe ticking clock: initializes from serverNowIso so SSR & initial render match
  const [nowMs, setNowMs] = useState<number>(() => {
    const parsed = Date.parse(schedule.serverNowIso);
    return Number.isNaN(parsed) ? 0 : parsed;
  });

  useEffect(() => {
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => window.clearInterval(id);
  }, []);

  if (
    schedule.active.length === 0 &&
    schedule.upcoming.length === 0 &&
    schedule.past.length === 0
  ) {
    return null;
  }

  const featured = schedule.featuredActive;
  const featuredIsSeason = featured
    ? isLongRunningSeasonalDrop(featured)
    : false;
  const secondaryActive = schedule.active.slice(1, 3);
  const featuredCountdown = featured?.endAt
    ? formatDropCountdown(featured.endAt, nowMs, { includeSeconds: true })
    : null;
  const featuredProgress = featured
    ? computeDropProgressPct(featured.startAt, featured.endAt, nowMs)
    : null;
  const recentPastPreview = selectRecentPastDropsPreview(schedule.past, 3);
  const hasUpcoming = schedule.upcoming.length > 0;

  return (
    <section className="rounded-lg border border-zinc-800/90 bg-[#121215] overflow-hidden">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold text-white">Drop Schedule</h2>
          <button
            type="button"
            onClick={() => setShowMath((v) => !v)}
            className="font-mono text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            {showMath ? "Hide math" : "Math"}
          </button>
        </div>

        <div className="inline-flex rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs">
          <TabButton
            active={tab === "overview"}
            onClick={() => setTab("overview")}
            label="Overview"
          />
          <TabButton
            active={tab === "active"}
            onClick={() => setTab("active")}
            label={`Active (${schedule.active.length})`}
          />
          <TabButton
            active={tab === "upcoming"}
            onClick={() => setTab("upcoming")}
            label={`Upcoming (${schedule.upcoming.length})`}
          />
          <TabButton
            active={tab === "past"}
            onClick={() => setTab("past")}
            label={`Past (${schedule.past.length})`}
          />
        </div>
      </div>

      {showMath && (
        <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
          <div>
            <span className="text-zinc-200">Source:</span> Apollo{" "}
            <span className="text-zinc-300">/events</span> schedule cached in D1
            (30m TTL
            {schedule.lastSyncedAt
              ? ` · synced ${schedule.lastSyncedAt.slice(0, 16).replace("T", " ")} UTC`
              : ""}
            ).
          </div>
          <div>
            <span className="text-zinc-200">Window rules:</span> Active ={" "}
            <span className="text-zinc-300">start ≤ now &lt; end</span> (or
            open-ended); Upcoming ={" "}
            <span className="text-zinc-300">start &gt; now</span>; Past ={" "}
            <span className="text-zinc-300">end ≤ now</span>. Seasonal runs
            &gt;30 days display as{" "}
            <span className="text-zinc-300">Active Season</span>.
          </div>
          {featured?.linkedRoundSlug && (
            <div>
              <span className="text-zinc-200">Linked round:</span>{" "}
              <span className="text-zinc-300">{featured.linkedRoundSlug}</span>
              {featured.linkedRoundMints
                ? ` · ${featured.linkedRoundMints.toLocaleString()} primary mints`
                : ""}
              {featured.linkedRoundBuyers
                ? ` · ${formatBuyerLabel(featured.linkedRoundBuyers, featured.linkedRoundBuyersIsFloor)}`
                : ""}
              {featured.linkedRoundBuyersIsFloor
                ? " (+ = single-member lower bound from pre-ledger live sync)"
                : " (exact deduplicated wallets)"}
            </div>
          )}
        </div>
      )}

      {/* OVERVIEW TAB */}
      {tab === "overview" && (
        <div>
          {/* Featured Current Drop / Active Season */}
          {featured ? (
            <div className="relative px-4 py-4 sm:px-5">
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: accentColor }}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
                    <span className="uppercase tracking-wider text-zinc-200 font-semibold">
                      {featuredIsSeason ? "Active Season" : "Current Drop"}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-400">
                      {typeLabel(featured.eventType)}
                    </span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-400">
                      {formatDropWindow(featured.startAt, featured.endAt, nowMs)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {featured.linkedRoundSlug ? (
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: featured.linkedRoundSlug }}
                        className="text-base sm:text-lg font-semibold text-white hover:underline decoration-zinc-500 underline-offset-4"
                      >
                        {featured.name}{" "}
                        <span className="text-xs font-normal text-zinc-500">
                          →
                        </span>
                      </Link>
                    ) : (
                      <p className="text-base sm:text-lg font-semibold text-white">
                        {featured.name}
                      </p>
                    )}

                    {featured.linkedRoundMints !== null &&
                      featured.linkedRoundMints > 0 && (
                        <span
                          className="font-mono text-xs text-zinc-400 tabular-nums"
                          title={
                            featured.linkedRoundBuyersIsFloor
                              ? `${featured.linkedRoundMints.toLocaleString()} mints in ${featured.linkedRoundSlug}; buyer count is a single-member lower bound (≥${featured.linkedRoundBuyers?.toLocaleString()} wallets)`
                              : `${featured.linkedRoundMints.toLocaleString()} mints across ${featured.linkedRoundBuyers?.toLocaleString() ?? 0} distinct wallets in ${featured.linkedRoundSlug}`
                          }
                        >
                          {featured.linkedRoundMints.toLocaleString()} mints
                          {featured.linkedRoundBuyers
                            ? ` · ${formatBuyerLabel(featured.linkedRoundBuyers, featured.linkedRoundBuyersIsFloor)}`
                            : ""}
                        </span>
                      )}
                  </div>
                </div>

                <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end sm:gap-1 shrink-0">
                  {featuredCountdown ? (
                    <div className="text-left sm:text-right">
                      <div className="font-mono text-lg sm:text-xl font-semibold tracking-tight text-white tabular-nums">
                        {featuredCountdown}
                      </div>
                      <div className="font-mono text-[11px] text-zinc-500">
                        {featured.endAt
                          ? `ends ${formatShortUtcDate(featured.endAt)} UTC`
                          : "remaining"}
                      </div>
                    </div>
                  ) : (
                    <span className="font-mono text-xs text-zinc-400">
                      Ongoing
                    </span>
                  )}

                  {featured.twitterUrl && (
                    <a
                      href={featured.twitterUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      Announcement ↗
                    </a>
                  )}
                </div>
              </div>

              {featuredProgress !== null && (
                <div className="mt-3 h-1 w-full overflow-hidden rounded-[1px] bg-zinc-800/90">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${featuredProgress}%`,
                      backgroundColor: accentColor,
                    }}
                  />
                </div>
              )}

              {secondaryActive.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-800/60 pt-2.5 text-xs text-zinc-400">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    Also active:
                  </span>
                  {secondaryActive.map((item) => {
                    const left = item.endAt
                      ? formatDropCountdown(item.endAt, nowMs)
                      : null;
                    return (
                      <span
                        key={item.slug}
                        className="inline-flex items-baseline gap-1.5"
                      >
                        {item.linkedRoundSlug ? (
                          <Link
                            to="/rounds/$slug"
                            params={{ slug: item.linkedRoundSlug }}
                            className="text-zinc-200 hover:text-white hover:underline"
                          >
                            {item.name}
                          </Link>
                        ) : (
                          <span className="text-zinc-200">{item.name}</span>
                        )}
                        {left && (
                          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                            ({left} left)
                          </span>
                        )}
                      </span>
                    );
                  })}
                  {schedule.active.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setTab("active")}
                      className="text-zinc-400 hover:text-white transition-colors"
                    >
                      +{schedule.active.length - 3} more
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-4 text-xs text-zinc-400 sm:px-5">
              No active Objekt drop right now.
            </div>
          )}

          {/* Upcoming & Recent Past — collapses to full-width 3-col Recent Past when Upcoming is empty */}
          {hasUpcoming ? (
            <div className="grid border-t border-zinc-800/80 md:grid-cols-2 md:divide-x divide-zinc-800/80">
              {/* Upcoming Column */}
              <div>
                <div className="flex items-center justify-between border-b border-zinc-800/60 bg-[#0f0f12] px-4 py-1.5 sm:px-5">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    Upcoming Drops
                  </span>
                  {schedule.upcoming.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setTab("upcoming")}
                      className="text-[11px] text-zinc-400 hover:text-white"
                    >
                      All ({schedule.upcoming.length}) →
                    </button>
                  )}
                </div>

                <div className="divide-y divide-zinc-800/60">
                  {schedule.upcoming.slice(0, 3).map((item) => {
                    const until = item.startAt
                      ? formatDropCountdown(item.startAt, nowMs, {
                          includeSeconds: true,
                        })
                      : null;
                    return (
                      <div
                        key={item.slug}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-xs sm:px-5"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-100 truncate">
                            {item.name}
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                            {typeLabel(item.eventType)} · Starts{" "}
                            {formatShortUtcDate(item.startAt) ?? "TBA"}
                          </p>
                        </div>
                        {until && (
                          <span className="font-mono text-xs text-zinc-200 tabular-nums shrink-0">
                            in {until}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent Past Column */}
              <div className="border-t border-zinc-800/80 md:border-t-0">
                <div className="flex items-center justify-between border-b border-zinc-800/60 bg-[#0f0f12] px-4 py-1.5 sm:px-5">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    Recent Past Drops
                  </span>
                  {schedule.past.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setTab("past")}
                      className="text-[11px] text-zinc-400 hover:text-white"
                    >
                      All ({schedule.past.length}) →
                    </button>
                  )}
                </div>

                <div className="divide-y divide-zinc-800/60">
                  {recentPastPreview.map((item) => (
                    <PastDropRow key={item.slug} item={item} nowMs={nowMs} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            recentPastPreview.length > 0 && (
              <div className="border-t border-zinc-800/80">
                <div className="flex items-center justify-between border-b border-zinc-800/60 bg-[#0f0f12] px-4 py-1.5 sm:px-5">
                  <span className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    Recent Past Drops
                  </span>
                  {schedule.past.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setTab("past")}
                      className="text-[11px] text-zinc-400 hover:text-white"
                    >
                      All ({schedule.past.length}) →
                    </button>
                  )}
                </div>
                <div className="grid divide-y divide-zinc-800/60 md:grid-cols-3 md:divide-y-0 md:divide-x">
                  {recentPastPreview.map((item) => (
                    <PastDropRow key={item.slug} item={item} nowMs={nowMs} />
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {/* FULL LIST TABS (ACTIVE / UPCOMING / PAST) */}
      {tab !== "overview" && (
        <DropListTable
          entries={
            tab === "active"
              ? schedule.active
              : tab === "upcoming"
                ? schedule.upcoming
                : schedule.past
          }
          mode={tab}
          nowMs={nowMs}
        />
      )}
    </section>
  );
}

function PastDropRow({
  item,
  nowMs,
}: {
  item: DropScheduleEntry;
  nowMs: number;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-xs sm:px-5">
      <div className="min-w-0">
        {item.linkedRoundSlug ? (
          <Link
            to="/rounds/$slug"
            params={{ slug: item.linkedRoundSlug }}
            className="font-medium text-zinc-200 hover:text-white hover:underline truncate block"
          >
            {item.name}
          </Link>
        ) : (
          <p className="font-medium text-zinc-300 truncate">{item.name}</p>
        )}
        <p
          className="mt-0.5 font-mono text-[11px] text-zinc-500"
          title={
            item.linkedRoundSlug
              ? `${item.linkedRoundSlug}: ${item.linkedRoundMints?.toLocaleString() ?? 0} mints${item.linkedRoundBuyersIsFloor ? " (single-member lower bound)" : ""}`
              : "No on-chain round minted for this promo/offline event"
          }
        >
          {typeLabel(item.eventType)}
          {item.linkedRoundBuyers
            ? ` · ${formatBuyerLabel(item.linkedRoundBuyers, item.linkedRoundBuyersIsFloor)}`
            : ""}
        </p>
      </div>
      <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
        {formatDropWindow(item.startAt, item.endAt, nowMs)}
      </span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-400 hover:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

function DropListTable({
  entries,
  mode,
  nowMs,
}: {
  entries: DropScheduleEntry[];
  mode: "active" | "upcoming" | "past";
  nowMs: number;
}) {
  if (entries.length === 0) {
    return (
      <div className="px-4 py-5 text-xs text-zinc-500 sm:px-5">
        {mode === "upcoming"
          ? "No upcoming drops announced yet."
          : mode === "active"
            ? "No active drops right now."
            : "No past drops recorded yet."}
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/60">
      {entries.map((item) => {
        const countdown =
          mode === "active" && item.endAt
            ? formatDropCountdown(item.endAt, nowMs, { includeSeconds: true })
            : mode === "upcoming" && item.startAt
              ? formatDropCountdown(item.startAt, nowMs, {
                  includeSeconds: true,
                })
              : null;

        return (
          <div
            key={item.slug}
            className="flex flex-col gap-1.5 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5 hover:bg-zinc-900/50 transition-colors"
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {item.linkedRoundSlug ? (
                  <Link
                    to="/rounds/$slug"
                    params={{ slug: item.linkedRoundSlug }}
                    className="text-sm font-medium text-zinc-100 hover:text-white hover:underline"
                  >
                    {item.name}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-zinc-100">
                    {item.name}
                  </span>
                )}
                <span className="font-mono text-[11px] text-zinc-500">
                  {typeLabel(item.eventType)}
                </span>
                {item.linkedRoundBuyers ? (
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                    ·{" "}
                    {formatBuyerLabel(
                      item.linkedRoundBuyers,
                      item.linkedRoundBuyersIsFloor,
                    )}
                  </span>
                ) : null}
              </div>
              {item.description && (
                <p className="text-zinc-500 line-clamp-1">{item.description}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums shrink-0">
              <span className="text-zinc-400">
                {formatDropWindow(item.startAt, item.endAt, nowMs)}
              </span>

              {countdown && (
                <span className="text-zinc-100 font-semibold">
                  {mode === "upcoming" ? `in ${countdown}` : `${countdown} left`}
                </span>
              )}

              {item.linkedRoundSlug && (
                <Link
                  to="/rounds/$slug"
                  params={{ slug: item.linkedRoundSlug }}
                  className="font-sans text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-2"
                >
                  Stats →
                </Link>
              )}

              {item.twitterUrl && (
                <a
                  href={item.twitterUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-sans text-zinc-500 hover:text-zinc-200"
                >
                  Post ↗
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
