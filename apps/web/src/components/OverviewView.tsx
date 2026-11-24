import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  DropSchedulePanel,
  type DropSchedulePanelData,
} from "./DropSchedulePanel";

export interface OverviewData {
  artist: {
    id: string;
    name: string;
    accentColor: string;
    debutDate: string;
  } | null;
  members: Array<{
    id: string;
    code: string;
    memberOrder: number;
    name: string;
    fullName: string;
    hexColor: string;
    revealDate: string;
    stats: {
      totalMints: number;
      totalUniqueBuyers: number;
      roundsCount: number;
      avgRank: number | null;
      avgBuyersRank: number | null;
      avgRelativeIndex: number | null;
      avgBuyersRelativeIndex: number | null;
      avgMintsPerBuyer: number | null;
      bestRank: number | null;
    } | null;
  }>;
  rounds: Array<{
    slug: string;
    title: string;
    season: string;
    objektClass: string;
    saleMechanic: string;
    startAt: string;
    totalMints: number;
    uniqueBuyers: number;
    participatingMembers: number;
    includeInPopularity: boolean;
    topSeller: {
      memberId: string;
      mintCount: number;
      sharePct: number;
    } | null;
    topSellerByBuyers: {
      memberId: string;
      uniqueBuyers: number;
      sharePct: number;
    } | null;
  }>;
  anomalies: Array<{
    roundSlug: string;
    roundTitle: string;
    startAt: string;
    memberId: string;
    memberName: string;
    memberCode: string;
    hexColor: string;
    rank: number;
    rankDeltaPrev: number | null;
    relativeIndex: number;
    mintCount: number;
    uniqueBuyers: number;
    anomalyDirection: string | null;
    anomalyReason: string | null;
    nearestEvent: {
      id: string;
      title: string;
      eventDate: string;
      dayOffset: number;
      scope: "member" | "group";
    } | null;
  }>;
  movers: {
    roundSlug: string | null;
    roundTitle: string | null;
    risers: Array<{
      roundSlug: string;
      memberId: string;
      memberName: string;
      memberCode: string;
      hexColor: string;
      rank: number;
      rankDeltaPrev: number | null;
      relativeIndex: number;
    }>;
    fallers: Array<{
      roundSlug: string;
      memberId: string;
      memberName: string;
      memberCode: string;
      hexColor: string;
      rank: number;
      rankDeltaPrev: number | null;
      relativeIndex: number;
    }>;
  };
  events: Array<{
    id: string;
    eventDate: string;
    endDate: string | null;
    category: string;
    title: string;
    summary: string;
    memberIds: string[];
  }>;
  dropSchedule?: DropSchedulePanelData | null;
  syncState: Array<{
    chain: string;
    lastIndexedBlock: number;
    lastIndexedTimestamp: string | null;
    totalTokensIndexed: number;
  }>;
  abstractLagMinutes?: number | null;
  totals: {
    roundCount: number;
    popularityRoundCount: number;
    collectionCount: number;
    totalMints: number;
    totalSpins?: number;
    estGrossUsd: number;
  };
}

export function OverviewView({
  data,
  artistSlug,
}: {
  data: OverviewData;
  artistSlug: "triples" | "artms";
}) {
  const [boardMetric, setBoardMetric] = useState<"buyers" | "mints">("buyers");
  const isArtms = artistSlug === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const searchParam = isArtms ? { artist: "artms" as const } : {};

  const rankedMembers = [...data.members]
    .filter((m) => m.stats && m.stats.totalMints > 0)
    .sort((a, b) =>
      boardMetric === "buyers"
        ? (b.stats?.avgBuyersRelativeIndex ?? 0) -
          (a.stats?.avgBuyersRelativeIndex ?? 0)
        : (b.stats?.avgRelativeIndex ?? 0) - (a.stats?.avgRelativeIndex ?? 0),
    );
  const maxRelIdx = Math.max(
    1.4,
    ...rankedMembers.map((m) =>
      boardMetric === "buyers"
        ? (m.stats?.avgBuyersRelativeIndex ?? 1)
        : (m.stats?.avgRelativeIndex ?? 1),
    ),
  );

  const featuredRounds = data.rounds
    .filter((r) => r.includeInPopularity)
    .slice(0, 8);
  const displayRounds =
    featuredRounds.length > 0 ? featuredRounds : data.rounds.slice(0, 8);

  const totalSpins = data.totals.totalSpins ?? 0;
  const spinRatePct =
    data.totals.totalMints > 0
      ? (totalSpins / data.totals.totalMints) * 100
      : 0;
  const abstractChain = data.syncState.find((s) => s.chain === "abstract");
  const isCatchingUp =
    data.abstractLagMinutes !== null &&
    data.abstractLagMinutes !== undefined &&
    data.abstractLagMinutes >= 30;

  return (
    <div className="space-y-8">
      {/* Compact Editorial Header + Inline Stats */}
      <header className="border-b border-zinc-800/90 pb-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName}{" "}
              <span className="font-normal text-zinc-400">Objekt Stats</span>
            </h1>
            <p className="text-sm text-zinc-400">
              On-chain COSMO primary mints, unique buyer counts, and member
              demand rankings across Polygon and Abstract.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
            {isCatchingUp ? (
              <span
                className="text-amber-400/90"
                title="Live cron sync is catching up on a drop backlog"
              >
                Syncing (
                {data.abstractLagMinutes! >= 60
                  ? `${(data.abstractLagMinutes! / 60).toFixed(1)}h`
                  : `${data.abstractLagMinutes}m`}{" "}
                behind)
              </span>
            ) : (
              <span className="text-zinc-400">Live sync</span>
            )}
            {abstractChain && (
              <>
                <span className="text-zinc-700">/</span>
                <span>
                  Abstract #{abstractChain.lastIndexedBlock.toLocaleString()}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <div className="text-xs text-zinc-500">Paid Sale Rounds</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold text-white tabular-nums">
                  {data.totals.popularityRoundCount.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  of {data.totals.roundCount.toLocaleString()} total
                </span>
              </div>
            </div>

            <div className="hidden sm:block h-8 w-px bg-zinc-800/90 self-center" />

            <div>
              <div className="text-xs text-zinc-500">On-Chain Mints</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold text-white tabular-nums">
                  {data.totals.totalMints.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {data.totals.collectionCount.toLocaleString()} collections
                </span>
              </div>
            </div>

            {totalSpins > 0 && (
              <>
                <div className="hidden sm:block h-8 w-px bg-zinc-800/90 self-center" />
                <Link
                  to="/spins"
                  search={searchParam}
                  className="group block"
                >
                  <div className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                    Sent to Spin
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="font-mono text-xl font-semibold text-white tabular-nums group-hover:text-zinc-200">
                      {totalSpins.toLocaleString()}
                    </span>
                    <span className="text-xs text-zinc-500 tabular-nums">
                      {spinRatePct.toFixed(1)}% burned
                    </span>
                  </div>
                </Link>
              </>
            )}
          </div>

          <div className="flex items-center gap-5 text-xs font-medium">
            <Link
              to="/members"
              search={searchParam}
              className="text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-4 hover:decoration-zinc-400 transition-colors"
            >
              Rank history
            </Link>
            <Link
              to="/earnings"
              search={searchParam}
              className="text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-4 hover:decoration-zinc-400 transition-colors"
            >
              Revenue estimator
            </Link>
            <Link
              to="/rounds"
              search={searchParam}
              className="text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-4 hover:decoration-zinc-400 transition-colors"
            >
              All rounds →
            </Link>
          </div>
        </div>
      </header>

      {/* Live Drop Schedule (Current Drop + Countdown, Upcoming, Recent Past) */}
      {data.dropSchedule && (
        <DropSchedulePanel
          schedule={data.dropSchedule}
          accentColor={
            data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF")
          }
        />
      )}

      {/* Main Split: Demand Index Leaderboard (wide) + Paid Sale Rounds (narrow rail) */}
      {rankedMembers.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
          {/* Demand Index Leaderboard */}
          <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
              <div className="space-y-0.5">
                <h2 className="text-base font-semibold text-white">
                  Demand Index
                </h2>
                <p className="text-xs text-zinc-400">
                  {boardMetric === "buyers"
                    ? `Average unique buyers relative to round mean across paid drops (≥${isArtms ? 50 : 150} buyers · 1.00× = average).`
                    : `Average paid-round mints relative to round mean across paid drops (≥${isArtms ? 50 : 150} buyers · 1.00× = average).`}
                </p>
              </div>
              <div className="inline-flex rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setBoardMetric("buyers")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                    boardMetric === "buyers"
                      ? "bg-zinc-200 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  Unique Buyers
                </button>
                <button
                  type="button"
                  onClick={() => setBoardMetric("mints")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                    boardMetric === "mints"
                      ? "bg-zinc-200 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  Total Mints
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-800/70 bg-[#0f0f12] px-4 py-2 text-[11px] font-mono uppercase tracking-wide text-zinc-500 sm:px-5">
              <span>Member</span>
              <div className="flex items-center gap-4 sm:gap-6">
                <span className="w-24 text-right">
                  {boardMetric === "buyers" ? "Round Buyers" : "Paid Mints"}
                </span>
                <span
                  className="hidden sm:inline-block w-24 text-right"
                  title="Average number of Objekts minted per unique buyer in a paid round"
                >
                  Avg / Buyer
                </span>
                <span
                  className="w-14 text-right"
                  title="Relative demand vs. the round average (1.00× = exact average)"
                >
                  Index
                </span>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/60">
              {rankedMembers.slice(0, 10).map((m, i) => {
                const rel =
                  boardMetric === "buyers"
                    ? (m.stats?.avgBuyersRelativeIndex ?? 1)
                    : (m.stats?.avgRelativeIndex ?? 1);
                const widthPct = Math.max(
                  6,
                  Math.min(100, (rel / maxRelIdx) * 100),
                );
                const avgTickPct = Math.min(100, (1 / maxRelIdx) * 100);
                return (
                  <Link
                    key={m.id}
                    to="/members/$memberId"
                    params={{ memberId: m.id }}
                    className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70 sm:px-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-6 font-mono text-xs tabular-nums shrink-0 ${
                            i === 0
                              ? "font-semibold text-white"
                              : "text-zinc-500"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span
                          className="h-2.5 w-2.5 rounded-[2px] shrink-0"
                          style={{ backgroundColor: m.hexColor }}
                        />
                        <span className="text-sm font-medium text-zinc-100 group-hover:text-white truncate">
                          {m.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                          {m.code}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 sm:gap-6 font-mono tabular-nums shrink-0">
                        <span className="w-24 text-right text-xs sm:text-sm text-zinc-300">
                          {boardMetric === "buyers"
                            ? (m.stats?.totalUniqueBuyers ?? 0).toLocaleString()
                            : (m.stats?.totalMints ?? 0).toLocaleString()}
                        </span>
                        {m.stats?.avgMintsPerBuyer ? (
                          <span
                            title={`Buyers mint an average of ${m.stats.avgMintsPerBuyer.toFixed(2)} ${m.name} Objekts per paid round`}
                            className="hidden sm:inline-block w-24 text-right text-xs text-zinc-400"
                          >
                            {m.stats.avgMintsPerBuyer.toFixed(1)} / buyer
                          </span>
                        ) : (
                          <span className="hidden sm:inline-block w-24 text-right text-xs text-zinc-600">
                            —
                          </span>
                        )}
                        <span className="w-14 text-right text-sm font-semibold text-white">
                          {rel.toFixed(2)}×
                        </span>
                      </div>
                    </div>
                    <div className="relative mt-2 ml-8 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: m.hexColor,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute inset-y-0 w-px bg-zinc-300/50"
                        style={{ left: `${avgTickPct}%` }}
                        title="1.00× round average"
                      />
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-zinc-800/80 px-4 py-3 text-xs text-zinc-500 sm:px-5">
              {boardMetric === "buyers"
                ? "Round Buyers sums distinct purchasing wallets across major paid digital drops (a wallet buying in multiple drops counts once per drop)."
                : "Paid Mints sums on-chain mints across major paid digital drops (excludes physical QR scans, Welcome 100Z, and SCO grid rewards; includes cards later spun)."}
            </div>
          </div>

          {/* Narrow Paid Sale Rounds Rail */}
          <aside className="rounded-lg border border-zinc-800/90 bg-[#121215]">
            <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800/90 px-4 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Paid Sale Rounds
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Most recent primary drops
                </p>
              </div>
              <Link
                to="/rounds"
                search={searchParam}
                className="text-xs text-zinc-400 hover:text-white shrink-0 transition-colors"
              >
                All →
              </Link>
            </div>

            <div className="divide-y divide-zinc-800/60">
              {displayRounds.map((r) => {
                const topBuyerMember = r.topSellerByBuyers
                  ? memberById.get(r.topSellerByBuyers.memberId)
                  : null;
                const topMintMember = r.topSeller
                  ? memberById.get(r.topSeller.memberId)
                  : null;
                const leader =
                  boardMetric === "buyers"
                    ? topBuyerMember ?? topMintMember
                    : topMintMember;
                return (
                  <Link
                    key={r.slug}
                    to="/rounds/$slug"
                    params={{ slug: r.slug }}
                    className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[13px] font-medium text-zinc-100 group-hover:text-white truncate">
                        {r.title}
                      </p>
                      <span
                        className="font-mono text-xs font-semibold text-zinc-100 tabular-nums shrink-0"
                        title={`${r.uniqueBuyers.toLocaleString()} unique buyers across all ${r.participatingMembers} members`}
                      >
                        {r.uniqueBuyers.toLocaleString()}
                        <span className="ml-1 font-normal text-zinc-500">
                          buyers
                        </span>
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                      <span className="font-mono tabular-nums truncate">
                        {r.startAt.slice(0, 10)} · {r.totalMints.toLocaleString()}{" "}
                        mints
                      </span>
                      {leader && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-400 shrink-0">
                          <span
                            className="h-2 w-2 rounded-[2px]"
                            style={{ backgroundColor: leader.hexColor }}
                          />
                          <span>{leader.name}</span>
                          {boardMetric === "buyers" && r.topSellerByBuyers ? (
                            <span className="font-mono tabular-nums text-zinc-500">
                              ({r.topSellerByBuyers.uniqueBuyers.toLocaleString()})
                            </span>
                          ) : r.topSeller ? (
                            <span className="font-mono tabular-nums text-zinc-500">
                              ({r.topSeller.mintCount.toLocaleString()})
                            </span>
                          ) : null}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </aside>
        </section>
      ) : (
        <section className="rounded-lg border border-zinc-800 bg-[#121215] p-5">
          <h2 className="text-sm font-semibold text-zinc-200">
            Waiting for On-Chain Data
          </h2>
          <p className="mt-1 text-xs text-zinc-400">
            No indexed sale rounds found for this artist yet. Live sync updates
            automatically every minute.
          </p>
        </section>
      )}

      {/* Rank Movers & Notable Shifts */}
      {(data.anomalies.length > 0 ||
        data.movers.risers.length > 0 ||
        data.movers.fallers.length > 0) && (
        <section className="grid gap-6 lg:grid-cols-2">
          {(data.movers.risers.length > 0 || data.movers.fallers.length > 0) && (
            <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
                <h2 className="text-sm font-semibold text-white">
                  Latest Round Movers
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Rank shifts in{" "}
                  {data.movers.roundSlug ? (
                    <Link
                      to="/rounds/$slug"
                      params={{ slug: data.movers.roundSlug }}
                      className="text-zinc-200 underline decoration-zinc-700 underline-offset-2 hover:text-white"
                    >
                      {data.movers.roundTitle}
                    </Link>
                  ) : (
                    "latest round"
                  )}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 sm:divide-x divide-zinc-800/70">
                <div className="divide-y divide-zinc-800/60">
                  <div className="bg-[#0f0f12] px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-emerald-400/90">
                    Risers
                  </div>
                  {data.movers.risers.map((r) => (
                    <Link
                      key={r.memberId}
                      to="/members/$memberId"
                      params={{ memberId: r.memberId }}
                      className="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-zinc-900/70"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-[2px]"
                          style={{ backgroundColor: r.hexColor }}
                        />
                        <span className="font-medium text-zinc-200">
                          {r.memberName}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-emerald-400">
                        #{r.rank} (+{r.rankDeltaPrev})
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/70 sm:border-t-0">
                  <div className="bg-[#0f0f12] px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-rose-400/90">
                    Fallers
                  </div>
                  {data.movers.fallers.map((r) => (
                    <Link
                      key={r.memberId}
                      to="/members/$memberId"
                      params={{ memberId: r.memberId }}
                      className="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-zinc-900/70"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-[2px]"
                          style={{ backgroundColor: r.hexColor }}
                        />
                        <span className="font-medium text-zinc-200">
                          {r.memberName}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-rose-400">
                        #{r.rank} ({r.rankDeltaPrev})
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {data.anomalies.length > 0 && (
            <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
                <h2 className="text-sm font-semibold text-white">
                  Notable Demand Shifts
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Outliers vs. trailing 5-round baseline with nearby events
                </p>
              </div>
              <div className="divide-y divide-zinc-800/60">
                {data.anomalies.slice(0, 4).map((a) => (
                  <div
                    key={`${a.roundSlug}-${a.memberId}`}
                    className="px-4 py-3 space-y-1 text-xs sm:px-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: a.memberId }}
                        className="inline-flex items-center gap-2 font-medium text-zinc-100 hover:text-white"
                      >
                        <span
                          className="h-2 w-2 rounded-[2px]"
                          style={{ backgroundColor: a.hexColor }}
                        />
                        {a.memberName}
                        <span className="font-mono text-zinc-500">
                          #{a.rank} · {a.uniqueBuyers.toLocaleString()} buyers
                        </span>
                      </Link>
                      <span
                        className={`font-mono text-[11px] uppercase ${
                          a.anomalyDirection === "surge"
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {a.anomalyDirection}
                      </span>
                    </div>
                    <p className="text-zinc-400">
                      <Link
                        to="/rounds/$slug"
                        params={{ slug: a.roundSlug }}
                        className="text-zinc-200 hover:underline"
                      >
                        {a.roundTitle}
                      </Link>{" "}
                      — {a.anomalyReason}
                    </p>
                    {a.nearestEvent && (
                      <p className="font-mono text-[11px] text-zinc-500">
                        {a.nearestEvent.eventDate}: {a.nearestEvent.title}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Member Roster */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-white">
            {isArtms ? "ARTMS Roster" : "tripleS S1–S24"}
          </h2>
          <Link
            to="/members"
            search={searchParam}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Full matrix →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.members.map((m) => (
            <Link
              key={m.id}
              to="/members/$memberId"
              params={{ memberId: m.id }}
              className="group relative overflow-hidden rounded-md border border-zinc-800/90 bg-[#121215] px-3 py-2.5 pl-3.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
            >
              <span
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ backgroundColor: m.hexColor }}
              />
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-sm text-zinc-100 group-hover:text-white truncate">
                  {m.name}
                </span>
                <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                  {m.code}
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 font-mono text-[11px] text-zinc-500">
                <span className="truncate font-sans text-zinc-500">
                  {m.fullName}
                </span>
                {m.stats?.avgBuyersRank !== null &&
                  m.stats?.avgBuyersRank !== undefined && (
                    <span className="text-zinc-300 tabular-nums shrink-0">
                      #{m.stats.avgBuyersRank.toFixed(1)}
                    </span>
                  )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Milestone Timeline */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">
              Milestone Timeline
            </h2>
            <p className="text-xs text-zinc-400">
              Key dates cross-referenced against sales shifts (−14d / +7d).
            </p>
          </div>
          <Link
            to="/events"
            search={searchParam}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            All {data.events.length} events →
          </Link>
        </div>

        <div className="grid gap-px overflow-hidden rounded-lg border border-zinc-800/90 bg-zinc-800/70 md:grid-cols-2">
          {data.events.slice(0, 6).map((ev) => (
            <article
              key={ev.id}
              className="bg-[#121215] p-4 space-y-2"
            >
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span className="text-zinc-400">
                  {ev.eventDate}
                  {ev.endDate ? ` → ${ev.endDate}` : ""}
                </span>
                <span className="uppercase tracking-wider text-zinc-500">
                  {ev.category}
                </span>
              </div>
              <h3 className="text-sm font-medium text-zinc-100">{ev.title}</h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                {ev.summary}
              </p>
              {ev.memberIds.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5 text-[11px] text-zinc-400">
                  {ev.memberIds.map((mId) => {
                    const member = memberById.get(mId);
                    if (!member) return null;
                    return (
                      <span
                        key={mId}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-[1px]"
                          style={{ backgroundColor: member.hexColor }}
                        />
                        {member.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
