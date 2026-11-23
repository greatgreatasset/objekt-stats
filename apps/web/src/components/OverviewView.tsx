import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  Database,
  Layers,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";

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
  syncState: Array<{
    chain: string;
    lastIndexedBlock: number;
    lastIndexedTimestamp: string | null;
    totalTokensIndexed: number;
  }>;
  totals: {
    roundCount: number;
    popularityRoundCount: number;
    collectionCount: number;
    totalMints: number;
    estGrossUsd: number;
  };
}

const CATEGORY_BADGE: Record<string, string> = {
  comeback: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  subunit: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  reveal: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  gravity: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  viral: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  tour: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};

export function OverviewView({
  data,
  artistSlug,
}: {
  data: OverviewData;
  artistSlug: "triples" | "artms";
}) {
  const [boardMetric, setBoardMetric] = useState<"buyers" | "mints">("buyers");
  const isArtms = artistSlug === "artms";
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");
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
    .slice(0, 6);
  const displayRounds =
    featuredRounds.length > 0 ? featuredRounds : data.rounds.slice(0, 6);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-10">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-mono text-zinc-300">
              <span
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ backgroundColor: accent }}
              />
              <span>
                {isArtms ? "ARTMS Secondary Tracker" : "tripleS Primary Tracker"}
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-emerald-400">Live Cron Sync Active</span>
              {data.syncState.length > 0 && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-400">
                    {data.syncState
                      .map(
                        (s) =>
                          `${s.chain} #${s.lastIndexedBlock.toLocaleString()}`,
                      )
                      .join(" + ")}
                  </span>
                </>
              )}
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS")} Objekt Sale
              Rounds &amp; Popularity Analytics
            </h1>

            <p className="text-sm leading-relaxed text-zinc-400 sm:text-base">
              Tracking Modhaus COSMO Objekt releases across Polygon (2022–2025)
              and Abstract (2025–present). Separate{" "}
              <strong className="text-zinc-200">unique purchasers</strong> from
              whale spend, compare member rank trajectories, and correlate
              demand shifts with real-world events.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              to="/rounds"
              search={searchParam}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200"
            >
              <Layers className="h-4 w-4" />
              Browse Sale Rounds
            </Link>
            <Link
              to="/members"
              search={searchParam}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-900/70 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
            >
              Rank Bump Chart
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-4 w-4 text-zinc-400" />}
          label="Tracked Members"
          value={String(data.members.length)}
          subtext={isArtms ? "A1 HeeJin – A5 Choerry" : "S1 SeoYeon – S24 JiYeon"}
        />
        <KpiCard
          icon={<Layers className="h-4 w-4 text-zinc-400" />}
          label="Paid Sale Rounds"
          value={data.totals.popularityRoundCount.toLocaleString()}
          subtext={`${data.totals.roundCount.toLocaleString()} total incl. physical & SCO`}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-zinc-400" />}
          label="On-Chain Mints Indexed"
          value={data.totals.totalMints.toLocaleString()}
          subtext={`${data.totals.collectionCount.toLocaleString()} unique collections`}
        />
        <KpiCard
          icon={<Calendar className="h-4 w-4 text-zinc-400" />}
          label="Est. Digital Volume"
          value={
            data.totals.estGrossUsd > 0
              ? `$${Math.round(data.totals.estGrossUsd).toLocaleString()}`
              : `${data.events.length} events`
          }
          subtext={`${data.events.length} curated timeline events`}
        />
      </section>

      {/* Live Popularity Leaderboard Preview + Recent Sale Rounds */}
      {rankedMembers.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  Demand Index Leaderboard
                </h2>
                <p className="text-xs text-zinc-400">
                  {boardMetric === "buyers"
                    ? `Ranked by Unique Purchasers Relative Index across major paid rounds (≥${isArtms ? 50 : 150} unique buyers; 1.00× = average).`
                    : `Ranked by Total Mints Relative Index across major paid rounds (≥${isArtms ? 50 : 150} unique buyers; 1.00× = average).`}
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setBoardMetric("buyers")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    boardMetric === "buyers"
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Unique Buyers
                </button>
                <button
                  type="button"
                  onClick={() => setBoardMetric("mints")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    boardMetric === "mints"
                      ? "bg-white text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Total Mints
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {rankedMembers.slice(0, 10).map((m, i) => {
                const rel =
                  boardMetric === "buyers"
                    ? (m.stats?.avgBuyersRelativeIndex ?? 1)
                    : (m.stats?.avgRelativeIndex ?? 1);
                const widthPct = Math.max(8, Math.min(100, (rel / maxRelIdx) * 100));
                return (
                  <Link
                    key={m.id}
                    to="/members/$memberId"
                    params={{ memberId: m.id }}
                    className="group block space-y-1 rounded-lg p-1.5 transition hover:bg-zinc-900/80"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-5 font-mono text-zinc-500">
                          #{i + 1}
                        </span>
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: m.hexColor }}
                        />
                        <span className="font-semibold text-zinc-100 group-hover:text-white">
                          {m.name}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {m.code}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 font-mono tabular-nums">
                        <span className="text-zinc-400">
                          {boardMetric === "buyers"
                            ? `${(m.stats?.totalUniqueBuyers ?? 0).toLocaleString()} buyers`
                            : `${(m.stats?.totalMints ?? 0).toLocaleString()} mints`}
                        </span>
                        {m.stats?.avgMintsPerBuyer && (
                          <span className="hidden sm:inline text-[11px] text-zinc-500">
                            {m.stats.avgMintsPerBuyer.toFixed(1)}/w
                          </span>
                        )}
                        <span className="w-12 text-right font-semibold text-white">
                          {rel.toFixed(2)}×
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-950">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: m.hexColor,
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Paid Sale Rounds
                </h2>
                <p className="text-xs text-zinc-400">
                  Click any round to compare Unique Buyers vs. Total Mints.
                </p>
              </div>
              <Link
                to="/rounds"
                search={searchParam}
                className="text-xs font-medium text-zinc-400 hover:text-white"
              >
                All rounds →
              </Link>
            </div>

            <div className="space-y-2.5">
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
                    className="block rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 transition hover:border-zinc-600 hover:bg-zinc-900/70"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {r.title}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-500">
                          {r.startAt.slice(0, 10)} •{" "}
                          {r.uniqueBuyers.toLocaleString()} buyers •{" "}
                          {r.totalMints.toLocaleString()} mints
                        </p>
                      </div>
                    </div>
                    {leader && (
                      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-amber-400 font-mono">
                            #1 {boardMetric === "buyers" ? "Buyers" : "Mints"}
                          </span>
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: leader.hexColor }}
                          />
                          <span className="text-zinc-200 font-medium">
                            {leader.name}
                          </span>
                        </span>
                        <span className="font-mono tabular-nums">
                          {boardMetric === "buyers" && r.topSellerByBuyers
                            ? `${r.topSellerByBuyers.uniqueBuyers.toLocaleString()} wallets`
                            : r.topSeller
                              ? `${r.topSeller.mintCount.toLocaleString()} (${r.topSeller.sharePct.toFixed(1)}%)`
                              : ""}
                        </span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <Database className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-amber-200">
                Waiting for On-Chain Backfill Data
              </h2>
              <p className="text-xs leading-relaxed text-zinc-400">
                No indexed sale rounds found for this artist yet. Live sync
                updates automatically every 5 minutes.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Biggest Movers & Detected Anomalies */}
      {(data.anomalies.length > 0 ||
        data.movers.risers.length > 0 ||
        data.movers.fallers.length > 0) && (
        <section className="grid gap-6 lg:grid-cols-2">
          {(data.movers.risers.length > 0 || data.movers.fallers.length > 0) && (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Biggest Rank Movers
                </h2>
                <p className="text-xs text-zinc-400">
                  Rank jumps &amp; drops in{" "}
                  {data.movers.roundSlug ? (
                    <Link
                      to="/rounds/$slug"
                      params={{ slug: data.movers.roundSlug }}
                      className="text-zinc-200 underline decoration-zinc-600 hover:text-white"
                    >
                      {data.movers.roundTitle}
                    </Link>
                  ) : (
                    "latest round"
                  )}
                  .
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase text-emerald-400 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> Risers
                  </p>
                  {data.movers.risers.map((r) => (
                    <Link
                      key={r.memberId}
                      to="/members/$memberId"
                      params={{ memberId: r.memberId }}
                      className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-xs hover:border-zinc-700"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: r.hexColor }}
                        />
                        <span className="font-medium text-zinc-100">
                          {r.memberName}
                        </span>
                      </span>
                      <span className="font-mono text-emerald-300">
                        #{r.rank} (+{r.rankDeltaPrev})
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-[11px] font-mono uppercase text-rose-400 flex items-center gap-1">
                    <TrendingDown className="h-3.5 w-3.5" /> Fallers
                  </p>
                  {data.movers.fallers.map((r) => (
                    <Link
                      key={r.memberId}
                      to="/members/$memberId"
                      params={{ memberId: r.memberId }}
                      className="flex items-center justify-between rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2 text-xs hover:border-zinc-700"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: r.hexColor }}
                        />
                        <span className="font-medium text-zinc-100">
                          {r.memberName}
                        </span>
                      </span>
                      <span className="font-mono text-rose-300">
                        #{r.rank} ({r.rankDeltaPrev})
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {data.anomalies.length > 0 && (
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-white flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  Statistical Surges &amp; Drops
                </h2>
                <p className="text-xs text-zinc-400">
                  Auto-flagged shifts vs. trailing 5-round baseline with nearby
                  event context.
                </p>
              </div>
              <div className="space-y-2.5">
                {data.anomalies.slice(0, 4).map((a) => (
                  <div
                    key={`${a.roundSlug}-${a.memberId}`}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: a.memberId }}
                        className="inline-flex items-center gap-2 font-semibold text-white hover:text-sky-300"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: a.hexColor }}
                        />
                        {a.memberName}
                        <span className="font-mono text-zinc-500">
                          #{a.rank} ({a.uniqueBuyers} buyers)
                        </span>
                      </Link>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase font-semibold ${
                          a.anomalyDirection === "surge"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {a.anomalyDirection}
                      </span>
                    </div>
                    <p className="text-zinc-400">
                      In{" "}
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
                      <p className="font-mono text-[11px] text-amber-300/90">
                        Nearby event ({a.nearestEvent.eventDate}):{" "}
                        {a.nearestEvent.title}
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
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isArtms ? "ARTMS Members" : "tripleS S1–S24 Roster"}
            </h2>
            <p className="text-xs text-zinc-400">
              Click any member to inspect their round history, unique buyer
              breadth, and indexed Objekts.
            </p>
          </div>
          <Link
            to="/members"
            search={searchParam}
            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            Full matrix →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {data.members.map((m) => (
            <Link
              key={m.id}
              to="/members/$memberId"
              params={{ memberId: m.id }}
              className="group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 transition hover:border-zinc-600 hover:bg-zinc-900"
            >
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ backgroundColor: m.hexColor }}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-zinc-400">
                  {m.code}
                </span>
                <span
                  className="h-3 w-3 rounded-full ring-2 ring-zinc-950"
                  style={{ backgroundColor: m.hexColor }}
                  title={m.hexColor}
                />
              </div>
              <div className="mt-2">
                <p className="font-semibold text-white text-sm group-hover:text-sky-200 transition-colors">
                  {m.name}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">{m.fullName}</p>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-zinc-500">
                <span>{m.revealDate}</span>
                {m.stats?.avgBuyersRank !== null &&
                  m.stats?.avgBuyersRank !== undefined && (
                    <span className="text-zinc-300">
                      avg #{m.stats.avgBuyersRank.toFixed(1)}
                    </span>
                  )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Events Timeline Preview */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-zinc-400" />
              Curated Milestone Timeline
            </h2>
            <p className="text-xs text-zinc-400">
              Events automatically cross-referenced against sales anomalies
              within a −14d / +7d window.
            </p>
          </div>
          <Link
            to="/events"
            search={searchParam}
            className="text-xs font-medium text-zinc-400 hover:text-white transition-colors"
          >
            View all {data.events.length} events →
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {data.events.slice(0, 6).map((ev) => (
            <article
              key={ev.id}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-zinc-400">
                  {ev.eventDate}
                  {ev.endDate ? ` → ${ev.endDate}` : ""}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                    CATEGORY_BADGE[ev.category] ??
                    "bg-zinc-800 text-zinc-300 border-zinc-700"
                  }`}
                >
                  {ev.category}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">{ev.title}</h3>
              <p className="text-xs leading-relaxed text-zinc-400">
                {ev.summary}
              </p>
              {ev.memberIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ev.memberIds.map((mId) => {
                    const member = memberById.get(mId);
                    if (!member) return null;
                    return (
                      <span
                        key={mId}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[11px] text-zinc-300"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: member.hexColor }}
                        />
                        {member.code} {member.name}
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

function KpiCard({
  icon,
  label,
  value,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
        {icon}
      </div>
      <p className="font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </p>
      <p className="text-[11px] text-zinc-500">{subtext}</p>
    </div>
  );
}
