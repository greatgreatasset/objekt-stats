import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  Clock,
  Layers,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ArtistSlug } from "../lib/server/queries";
import {
  getTradesDashboard,
  type TradeLegSummary,
} from "../lib/server/trade-queries";

export const Route = createFileRoute("/trades")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getTradesDashboard({ data: deps.artist }),
  head: ({ loaderData }) => {
    const name = loaderData?.artist?.name ?? "tripleS";
    return {
      meta: [
        { title: `${name} Most Traded Objekts — Objekt Stats` },
        {
          name: "description",
          content: `Detect real user-to-user COSMO Objekt trades for ${name} via reciprocal P2P transfers within 30 minutes, strictly separated from newly minted primary sales.`,
        },
      ],
    };
  },
  component: TradesPage,
});

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

function TradesPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const isArtms = artist === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");

  const [metricMode, setMetricMode] = useState<"trades" | "transfers">("trades");
  const [query, setQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [classFilter, setClassFilter] = useState<
    "all" | "First" | "Double" | "Special" | "Premier" | "Unit" | "physical"
  >("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [sortBy, setSortBy] = useState<
    "traded" | "sessions" | "transfers" | "turnover"
  >("traded");

  const seasons = useMemo(
    () =>
      Array.from(new Set(data.collections.map((c) => c.season)))
        .sort()
        .reverse(),
    [data.collections],
  );

  const rankedMembers = useMemo(() => {
    const list = [...data.memberLeaderboard];
    if (metricMode === "transfers") {
      return list.sort(
        (a, b) =>
          b.directTransferCount - a.directTransferCount ||
          b.tradedCount - a.tradedCount,
      );
    }
    return list.sort(
      (a, b) => a.tradeRank - b.tradeRank || b.tradedCount - a.tradedCount,
    );
  }, [data.memberLeaderboard, metricMode]);

  const maxMemberVal = useMemo(() => {
    if (rankedMembers.length === 0) return 1;
    return Math.max(
      1,
      ...rankedMembers.map((m) =>
        metricMode === "transfers" ? m.directTransferCount : m.tradedCount,
      ),
    );
  }, [rankedMembers, metricMode]);

  const filteredCollections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.collections
      .filter((c) => {
        if (metricMode === "trades" && c.tradedCount <= 0) return false;
        if (seasonFilter !== "all" && c.season !== seasonFilter) return false;
        if (memberFilter !== "all" && c.memberId !== memberFilter) return false;
        if (classFilter === "physical" && c.onOffline !== "offline") return false;
        if (
          classFilter !== "all" &&
          classFilter !== "physical" &&
          c.objektClass !== classFilter
        ) {
          return false;
        }
        if (
          q &&
          !c.collectionId.toLowerCase().includes(q) &&
          !c.memberName.toLowerCase().includes(q) &&
          !c.season.toLowerCase().includes(q) &&
          !c.collectionNo.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "sessions") {
          return b.tradeSessions - a.tradeSessions || b.tradedCount - a.tradedCount;
        }
        if (sortBy === "transfers") {
          return (
            b.directTransferCount - a.directTransferCount ||
            b.tradedCount - a.tradedCount
          );
        }
        if (sortBy === "turnover") {
          return (b.turnoverPct ?? -1) - (a.turnoverPct ?? -1) || b.tradedCount - a.tradedCount;
        }
        return b.tradedCount - a.tradedCount || b.directTransferCount - a.directTransferCount;
      });
  }, [
    data.collections,
    metricMode,
    query,
    seasonFilter,
    classFilter,
    memberFilter,
    sortBy,
  ]);

  const hasData =
    data.totals.tradedObjekts > 0 || data.totals.directTransfers > 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-2.5">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-[11px] font-mono text-zinc-300">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span>Isolated from Newly Minted Sales</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">
                Reciprocal P2P Swaps (≥2 Objekts ≤30m)
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName} Most Traded Objekts
            </h1>
            <p className="text-sm leading-relaxed text-zinc-400">
              On-chain, COSMO only records direct ERC-721 transfers. When two
              user wallets send Objekts back and forth within 30 minutes (such as
              1↔1, 2↔2, or 3↔1 swaps), we classify the exchange as a{" "}
              <strong className="text-zinc-200">Confirmed Trade</strong>. Primary
              Modhaus mints (<code className="text-zinc-300">0x0</code>), COSMO
              Spins, burns, and single-token bounce-backs are strictly excluded.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Ranking Basis
            </span>
            <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-950 p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setMetricMode("trades");
                  setSortBy("traded");
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
                  metricMode === "trades"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Confirmed Trades
              </button>
              <button
                type="button"
                onClick={() => {
                  setMetricMode("transfers");
                  setSortBy("transfers");
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
                  metricMode === "transfers"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                All Direct Transfers
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<ArrowLeftRight className="h-4 w-4 text-zinc-400" />}
          label="Confirmed Trade Swaps"
          value={data.totals.confirmedTradeSessions.toLocaleString()}
          subtext={
            data.totals.avgObjektsPerTrade > 0
              ? `Avg ${data.totals.avgObjektsPerTrade.toFixed(2)} Objekts / swap`
              : "Reciprocal A ↔ B sessions"
          }
        />
        <KpiCard
          icon={<Sparkles className="h-4 w-4 text-zinc-400" />}
          label="Objekts Exchanged in Trades"
          value={data.totals.tradedObjekts.toLocaleString()}
          subtext={`${data.totals.trackedCollections.toLocaleString()} distinct collections active`}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-zinc-400" />}
          label="All Direct P2P Transfers"
          value={data.totals.directTransfers.toLocaleString()}
          subtext={
            data.totals.confirmedSwapSharePct > 0
              ? `${data.totals.confirmedSwapSharePct.toFixed(1)}% matched as confirmed swaps`
              : "Excludes mints, burns & spins"
          }
        />
        <KpiCard
          icon={<Users className="h-4 w-4 text-zinc-400" />}
          label="Indexed Trade Window"
          value={
            data.totals.windowEnd
              ? data.totals.windowEnd.slice(0, 10)
              : "Pending"
          }
          subtext={
            data.totals.windowStart && data.totals.windowEnd
              ? `${data.totals.windowStart.slice(0, 10)} → ${data.totals.windowEnd.slice(0, 10)} UTC`
              : "Run sync-transfers to populate"
          }
        />
      </section>

      {!hasData ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center space-y-3">
          <ArrowLeftRight className="mx-auto h-8 w-8 text-zinc-500" />
          <h2 className="text-base font-semibold text-zinc-200">
            No secondary P2P trades indexed for {artistName} yet
          </h2>
          <p className="mx-auto max-w-lg text-xs leading-relaxed text-zinc-400">
            Once P2P transfer logs are synced (via the 5-minute live cron or{" "}
            <code className="text-zinc-200">npm run indexer -- sync-transfers</code>
            ), confirmed user-to-user swaps will appear here automatically.
          </p>
        </section>
      ) : (
        <>
          {/* Member Trade Leaderboard + Daily Trade Activity */}
          <section className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Most Traded Members (
                    {metricMode === "trades"
                      ? "Confirmed Swaps"
                      : "All Direct Transfers"}
                    )
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Compare secondary trading activity against each member&apos;s
                    primary mint demand rank.
                  </p>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">
                  1.00× = roster avg
                </span>
              </div>

              <div className="space-y-2">
                {rankedMembers.map((m, idx) => {
                  const val =
                    metricMode === "transfers"
                      ? m.directTransferCount
                      : m.tradedCount;
                  const widthPct = Math.max(
                    3,
                    Math.min(100, (val / maxMemberVal) * 100),
                  );
                  return (
                    <Link
                      key={m.memberId}
                      to="/members/$memberId"
                      params={{ memberId: m.memberId }}
                      className="group block space-y-1 rounded-lg p-1.5 transition hover:bg-zinc-900/80"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-6 font-mono text-zinc-500">
                            #{metricMode === "trades" ? m.tradeRank : idx + 1}
                          </span>
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: m.hexColor }}
                          />
                          <span className="font-semibold text-zinc-100 group-hover:text-white">
                            {m.memberName}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            {m.memberCode}
                          </span>
                          {metricMode === "trades" &&
                            m.rankVsPrimary !== null &&
                            m.rankVsPrimary !== 0 && (
                              <span
                                title={`Trade rank #${m.tradeRank} vs Primary Sales rank #${m.primarySalesRank}`}
                                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                                  m.rankVsPrimary > 0
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-zinc-800 text-zinc-400"
                                }`}
                              >
                                {m.rankVsPrimary > 0
                                  ? `+${m.rankVsPrimary} vs sales`
                                  : `${m.rankVsPrimary} vs sales`}
                              </span>
                            )}
                        </div>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-zinc-300 font-semibold">
                            {val.toLocaleString()}
                          </span>
                          {metricMode === "trades" && (
                            <>
                              <span className="w-11 text-right text-zinc-500">
                                {m.tradeSharePct.toFixed(1)}%
                              </span>
                              <span
                                className={`w-11 text-right font-semibold ${
                                  m.tradeRelativeIndex >= 1.15
                                    ? "text-emerald-300"
                                    : m.tradeRelativeIndex <= 0.85
                                      ? "text-rose-300"
                                      : "text-zinc-300"
                                }`}
                              >
                                {m.tradeRelativeIndex.toFixed(2)}×
                              </span>
                            </>
                          )}
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

            <div className="lg:col-span-2 space-y-6">
              {/* Daily Activity */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Daily Secondary Activity (UTC)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Confirmed swapped Objekts vs total P2P transfers per day.
                  </p>
                </div>

                {data.dailyActivity.length === 0 ? (
                  <p className="text-xs text-zinc-500">No daily records yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {data.dailyActivity.slice(-14).map((d) => {
                      const maxDay = Math.max(
                        1,
                        ...data.dailyActivity
                          .slice(-14)
                          .map((x) =>
                            metricMode === "transfers"
                              ? x.directTransfers
                              : x.tradedObjekts,
                          ),
                      );
                      const val =
                        metricMode === "transfers"
                          ? d.directTransfers
                          : d.tradedObjekts;
                      return (
                        <div key={d.tradeDate} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between font-mono">
                            <span className="text-zinc-400">{d.tradeDate}</span>
                            <span className="text-zinc-200 tabular-nums">
                              {val.toLocaleString()}{" "}
                              <span className="text-zinc-500">
                                ({d.tradeSessions.toLocaleString()} swaps)
                              </span>
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-950">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(4, (val / maxDay) * 100)}%`,
                                backgroundColor: accent,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* How Trade Detection Works card */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-2.5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Layers className="h-4 w-4 text-sky-400" />
                  Trade Detection Heuristic
                </h3>
                <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">Confirmed Trade:</strong>{" "}
                    Wallet A sends ≥1 Objekt to Wallet B <em>and</em> Wallet B
                    sends ≥1 different Objekt back to Wallet A within 30 minutes.
                  </li>
                  <li>
                    <strong className="text-zinc-200">
                      Multi-Card Swaps Supported:
                    </strong>{" "}
                    1↔1, 2↔2, 3↔2, and 12↔1 rare swaps are clustered into one
                    session.
                  </li>
                  <li>
                    <strong className="text-zinc-200">
                      Zero Primary Contamination:
                    </strong>{" "}
                    Newly minted sales strictly read{" "}
                    <code className="text-zinc-300">from = 0x0</code>; P2P
                    transfers never touch mint totals or sale round rankings.
                  </li>
                </ul>
                <div className="pt-1">
                  <Link
                    to="/methodology"
                    className="text-xs font-medium text-sky-400 hover:text-sky-300"
                  >
                    Read full methodology →
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* Most Traded Collections Table */}
          <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Most Traded Objekt Collections ({filteredCollections.length})
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Filter by member, season, or class to see which specific
                    Objekts change hands most actively.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search member, season, or collection number..."
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                </div>

                <select
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  aria-label="Filter by member"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="all">All Members</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} {m.name}
                    </option>
                  ))}
                </select>

                <select
                  value={seasonFilter}
                  onChange={(e) => setSeasonFilter(e.target.value)}
                  aria-label="Filter by season"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="all">All Seasons ({seasons.length})</option>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(
                      e.target.value as
                        | "traded"
                        | "sessions"
                        | "transfers"
                        | "turnover",
                    )
                  }
                  aria-label="Sort traded collections"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="traded">Sort: Most Traded</option>
                  <option value="sessions">Sort: Most Trade Swaps</option>
                  <option value="transfers">Sort: Most Direct Transfers</option>
                  <option value="turnover">Sort: Highest Turnover %</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["all", "All Classes"],
                    ["First", "First (FCO)"],
                    ["Double", "Double (DCO)"],
                    ["Special", "Special (SCO)"],
                    ["Premier", "Premier (PCO)"],
                    ["Unit", "Unit"],
                    ["physical", "Physical (A)"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setClassFilter(key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      classFilter === key
                        ? "bg-white text-zinc-950"
                        : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredCollections.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-xs text-zinc-400">
                No traded collections match your current filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Objekt Collection</th>
                      <th className="px-4 py-3">Member</th>
                      <th className="px-4 py-3">Class</th>
                      <th className="px-4 py-3 text-right">Confirmed Trades</th>
                      <th className="px-4 py-3 text-right">Swaps</th>
                      <th className="px-4 py-3 text-right">Direct Transfers</th>
                      <th className="px-4 py-3 text-right">Traders</th>
                      <th className="px-4 py-3 text-right">Turnover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredCollections.slice(0, 80).map((c, idx) => (
                      <tr
                        key={c.collectionSlug}
                        className="transition hover:bg-zinc-900/70"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">
                          {idx + 1}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            {c.frontImageUrl ? (
                              <img
                                src={c.frontImageUrl}
                                alt={c.collectionId}
                                loading="lazy"
                                className="h-11 w-7 rounded object-cover border border-zinc-800 shrink-0"
                              />
                            ) : (
                              <span
                                className="h-11 w-7 rounded border border-zinc-800 shrink-0"
                                style={{
                                  backgroundColor:
                                    c.backgroundColor ?? "#18181b",
                                }}
                              />
                            )}
                            <div>
                              <p className="font-semibold text-white text-xs sm:text-sm">
                                {c.collectionId}
                              </p>
                              <p className="font-mono text-[11px] text-zinc-500">
                                {c.season} • {c.collectionNo} (
                                {c.onOffline === "offline"
                                  ? "Physical"
                                  : "Digital"}
                                )
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {c.memberId ? (
                            <Link
                              to="/members/$memberId"
                              params={{ memberId: c.memberId }}
                              className="inline-flex items-center gap-1.5 font-medium text-zinc-200 hover:text-sky-300"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: c.hexColor }}
                              />
                              <span>{c.memberName}</span>
                            </Link>
                          ) : (
                            <span className="text-zinc-400">
                              {c.rawMemberName}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                          {c.objektClass}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-white tabular-nums">
                          {c.tradedCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400 tabular-nums">
                          {c.tradeSessions.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-300 tabular-nums">
                          {c.directTransferCount.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400 tabular-nums">
                          {c.uniqueTraders.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                          {c.turnoverPct !== null ? (
                            <span
                              title={`${c.tradedCount} traded / ${c.primaryMints?.toLocaleString()} indexed primary mints`}
                              className="text-sky-300"
                            >
                              {c.turnoverPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Confirmed Swaps Feed */}
          {data.recentTrades.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-400" />
                  Recent Detected Swaps ({data.recentTrades.length})
                </h2>
                <p className="text-xs text-zinc-400">
                  Live examples of reciprocal user-to-user swaps detected on-chain
                  within the 30-minute matching window.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {data.recentTrades.slice(0, 16).map((rt) => (
                  <article
                    key={rt.tradeId}
                    className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
                      <span className="inline-flex items-center gap-1.5 text-zinc-200 font-semibold">
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">
                          {rt.sideACount} ↔ {rt.sideBCount} swap
                        </span>
                        <span className="text-zinc-500">
                          {formatDuration(rt.durationSeconds)}
                        </span>
                      </span>
                      <span>
                        {rt.tradedAt.slice(0, 16).replace("T", " ")} UTC
                      </span>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2.5 text-xs">
                      <TradeSideBox
                        label={rt.walletAShort}
                        items={rt.sideASummary}
                      />
                      <div className="pt-5 text-zinc-500">
                        <ArrowLeftRight className="h-4 w-4" />
                      </div>
                      <TradeSideBox
                        label={rt.walletBShort}
                        items={rt.sideBSummary}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TradeSideBox({
  label,
  items,
}: {
  label: string;
  items: TradeLegSummary[];
}) {
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-2.5 space-y-1.5 min-w-0">
      <p className="font-mono text-[10px] text-zinc-500 truncate">{label}</p>
      <div className="space-y-1">
        {items.slice(0, 4).map((item) => (
          <div
            key={item.slug}
            className="flex items-center justify-between gap-1.5 text-[11px]"
          >
            <span className="inline-flex items-center gap-1.5 truncate text-zinc-200">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: item.hexColor }}
              />
              <span className="truncate">{item.collectionId}</span>
            </span>
            {item.count > 1 && (
              <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                ×{item.count}
              </span>
            )}
          </div>
        ))}
        {items.length > 4 && (
          <p className="font-mono text-[10px] text-zinc-500">
            +{items.length - 4} more collection(s)
          </p>
        )}
      </div>
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
