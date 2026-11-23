import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  Clock,
  Layers,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
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
        { title: `${name} Most Traded Objekts & Asymmetric Swaps — Objekt Stats` },
        {
          name: "description",
          content: `Detect real user-to-user COSMO Objekt trades and asymmetric 2:1 / 3:1+ premium swaps for ${name}, strictly separated from newly minted primary sales.`,
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

function formatRatioLabel(a: number, b: number): string {
  if (a === b) return `${a}:${b}`;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return `${hi}:${lo}`;
}

function TradesPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const isArtms = artist === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");

  const [metricMode, setMetricMode] = useState<
    "trades" | "asymmetric" | "transfers"
  >("trades");
  const [sameClassOnly, setSameClassOnly] = useState(false);
  const [asymSort, setAsymSort] = useState<"2x" | "3x" | "rate">("2x");
  const [recentFilter, setRecentFilter] = useState<
    "all" | "asymmetric" | "2x" | "3x" | "sameClassAsym"
  >("all");
  const [query, setQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [classFilter, setClassFilter] = useState<
    "all" | "First" | "Double" | "Special" | "Premier" | "Unit" | "physical"
  >("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [sortBy, setSortBy] = useState<
    "traded" | "premium2x" | "rate" | "sessions" | "transfers" | "turnover"
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
    if (metricMode === "asymmetric") {
      return list.sort((a, b) => {
        if (asymSort === "rate") {
          const ra = sameClassOnly ? a.sameClassAvgRate : a.avgExchangeRate;
          const rb = sameClassOnly ? b.sameClassAvgRate : b.avgExchangeRate;
          return rb - ra || b.premium2xCount - a.premium2xCount;
        }
        if (asymSort === "3x") {
          const va = sameClassOnly ? a.sameClass3xCount : a.premium3xCount;
          const vb = sameClassOnly ? b.sameClass3xCount : b.premium3xCount;
          return vb - va || b.avgExchangeRate - a.avgExchangeRate;
        }
        const va = sameClassOnly ? a.sameClass2xCount : a.premium2xCount;
        const vb = sameClassOnly ? b.sameClass2xCount : b.premium2xCount;
        return vb - va || b.avgExchangeRate - a.avgExchangeRate;
      });
    }
    return list.sort(
      (a, b) => a.tradeRank - b.tradeRank || b.tradedCount - a.tradedCount,
    );
  }, [data.memberLeaderboard, metricMode, sameClassOnly, asymSort]);

  const maxMemberVal = useMemo(() => {
    if (rankedMembers.length === 0) return 1;
    if (metricMode === "asymmetric") {
      if (asymSort === "rate") {
        return Math.max(
          1.15,
          ...rankedMembers.map((m) =>
            sameClassOnly ? m.sameClassAvgRate : m.avgExchangeRate,
          ),
        );
      }
      if (asymSort === "3x") {
        return Math.max(
          1,
          ...rankedMembers.map((m) =>
            sameClassOnly ? m.sameClass3xCount : m.premium3xCount,
          ),
        );
      }
      return Math.max(
        1,
        ...rankedMembers.map((m) =>
          sameClassOnly ? m.sameClass2xCount : m.premium2xCount,
        ),
      );
    }
    return Math.max(
      1,
      ...rankedMembers.map((m) =>
        metricMode === "transfers" ? m.directTransferCount : m.tradedCount,
      ),
    );
  }, [rankedMembers, metricMode, sameClassOnly, asymSort]);

  const filteredCollections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.collections
      .filter((c) => {
        if (metricMode === "trades" && c.tradedCount <= 0) return false;
        if (metricMode === "asymmetric") {
          const pCount = sameClassOnly ? c.sameClassPremiumCount : c.premiumCount;
          if (pCount <= 0) return false;
        }
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
        if (sortBy === "premium2x") {
          const va = sameClassOnly ? a.sameClass2xCount : a.premium2xCount;
          const vb = sameClassOnly ? b.sameClass2xCount : b.premium2xCount;
          return vb - va || b.avgExchangeRate - a.avgExchangeRate;
        }
        if (sortBy === "rate") {
          // Prioritize collections with >= 5 trades so 1-off anomalies don't drown out real demand
          const aQual = a.tradedCount >= 5 ? 1 : 0;
          const bQual = b.tradedCount >= 5 ? 1 : 0;
          if (aQual !== bQual) return bQual - aQual;
          const ra = sameClassOnly ? a.sameClassAvgRate : a.avgExchangeRate;
          const rb = sameClassOnly ? b.sameClassAvgRate : b.avgExchangeRate;
          return rb - ra || b.premium2xCount - a.premium2xCount;
        }
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
    sameClassOnly,
    query,
    seasonFilter,
    classFilter,
    memberFilter,
    sortBy,
  ]);

  const filteredRecentTrades = useMemo(() => {
    return data.recentTrades.filter((rt) => {
      if (recentFilter === "asymmetric") return rt.isAsymmetric;
      if (recentFilter === "2x") return rt.isAsymmetric && rt.ratioMultiple >= 2;
      if (recentFilter === "3x") return rt.isAsymmetric && rt.ratioMultiple >= 3;
      if (recentFilter === "sameClassAsym") return rt.isAsymmetric && rt.isSameClass;
      return true;
    });
  }, [data.recentTrades, recentFilter]);

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
              Detecting reciprocal user-to-user Objekt swaps (1↔1, 2↔2, and{" "}
              <strong className="text-zinc-200">asymmetric 2:1 / 3:1+ premium swaps</strong>
              ) within 30 minutes on-chain. Primary Modhaus mints (
              <code className="text-zinc-300">0x0</code>), COSMO Spins, burns,
              and single-token bounce-backs are strictly excluded.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Ranking Basis
            </span>
            <div className="inline-flex flex-wrap rounded-xl border border-zinc-800 bg-zinc-950 p-1 text-xs gap-0.5">
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
                  setMetricMode("asymmetric");
                  setSortBy("premium2x");
                  setRecentFilter("2x");
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
                  metricMode === "asymmetric"
                    ? "bg-amber-400 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Scale className="h-3.5 w-3.5" />
                Asymmetric (2:1 / 3:1+)
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
                Direct Transfers
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
          icon={<Scale className="h-4 w-4 text-amber-400" />}
          label="Asymmetric Swaps"
          value={`${data.totals.asymmetricSessions.toLocaleString()} (${data.totals.asymmetricSharePct.toFixed(1)}%)`}
          subtext={`${data.totals.ratio2xSessions.toLocaleString()} at ≥2:1 • ${data.totals.ratio3xSessions.toLocaleString()} at ≥3:1`}
        />
        <KpiCard
          icon={<Sparkles className="h-4 w-4 text-zinc-400" />}
          label="Objekts Exchanged"
          value={data.totals.tradedObjekts.toLocaleString()}
          subtext={`${data.totals.trackedCollections.toLocaleString()} distinct collections active`}
        />
        <KpiCard
          icon={<Activity className="h-4 w-4 text-zinc-400" />}
          label="All Direct P2P Transfers"
          value={data.totals.directTransfers.toLocaleString()}
          subtext={
            data.totals.windowStart && data.totals.windowEnd
              ? `${data.totals.confirmedSwapSharePct.toFixed(1)}% swaps • ${data.totals.windowStart.slice(5, 10)} → ${data.totals.windowEnd.slice(5, 10)}`
              : "Excludes mints, burns & spins"
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
          {/* Member Leaderboard + Asymmetric Breakdown / Daily Activity */}
          <section className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    {metricMode === "asymmetric"
                      ? `Asymmetric Swap Premium (${sameClassOnly ? "Same-Class Only" : "All Classes"})`
                      : metricMode === "transfers"
                        ? "Most Transferred Members (All P2P)"
                        : "Most Traded Members (Confirmed Swaps)"}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {metricMode === "asymmetric"
                      ? "Times a member's Objekt sat on the scarcer side of 2:1 / 3:1+ swaps. Exchange rate 1.00× = exact market parity."
                      : "Compare secondary trading activity, average exchange rate (1.00× = parity), and primary mint rank."}
                  </p>
                </div>

                {metricMode === "asymmetric" ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSameClassOnly((v) => !v)}
                      title="Restrict to swaps where both sides are the exact same Objekt class (e.g. First ↔ First), removing cross-class rarity upgrades like 4 FCO → 1 SCO"
                      className={`rounded-lg border px-2.5 py-1 font-medium transition ${
                        sameClassOnly
                          ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {sameClassOnly ? "✓ Same-Class Only" : "Same-Class Filter"}
                    </button>
                    <select
                      value={asymSort}
                      onChange={(e) =>
                        setAsymSort(e.target.value as "2x" | "3x" | "rate")
                      }
                      aria-label="Sort asymmetric leaderboard"
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-zinc-600 focus:outline-none"
                    >
                      <option value="2x">Sort: ≥2:1 Swaps</option>
                      <option value="3x">Sort: ≥3:1 Swaps</option>
                      <option value="rate">Sort: Avg Rate</option>
                    </select>
                  </div>
                ) : (
                  <span className="font-mono text-[11px] text-zinc-500">
                    1.00× = parity
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {rankedMembers.map((m, idx) => {
                  const rateVal = sameClassOnly
                    ? m.sameClassAvgRate
                    : m.avgExchangeRate;
                  const count2x = sameClassOnly
                    ? m.sameClass2xCount
                    : m.premium2xCount;
                  const count3x = sameClassOnly
                    ? m.sameClass3xCount
                    : m.premium3xCount;
                  const premCnt = sameClassOnly
                    ? m.sameClassPremiumCount
                    : m.premiumCount;
                  const bulkCnt = sameClassOnly
                    ? m.sameClassBulkCount
                    : m.bulkCount;

                  const barVal =
                    metricMode === "transfers"
                      ? m.directTransferCount
                      : metricMode === "asymmetric"
                        ? asymSort === "rate"
                          ? rateVal
                          : asymSort === "3x"
                            ? count3x
                            : count2x
                        : m.tradedCount;

                  const widthPct = Math.max(
                    3,
                    Math.min(100, (barVal / maxMemberVal) * 100),
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

                          {metricMode === "asymmetric" && count3x > 0 && (
                            <span
                              title={`Commanded ${count3x} swaps at ≥3:1 (peak ${m.maxExchangeRate.toFixed(1)}:1)`}
                              className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                            >
                              {count3x} at ≥3:1
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          {metricMode === "asymmetric" ? (
                            <>
                              <span
                                className="text-[11px] text-zinc-500 hidden sm:inline"
                                title="Scarce-side legs vs Bulk-offering legs in asymmetric swaps"
                              >
                                {premCnt}↑ / {bulkCnt}↓
                              </span>
                              <span className="text-zinc-200 font-semibold">
                                {count2x.toLocaleString()}{" "}
                                <span className="text-[10px] font-normal text-zinc-500">
                                  2:1+
                                </span>
                              </span>
                              <span
                                title="Average counterparty Objekts received per 1 Objekt of this member (1.00× = exact market parity)"
                                className={`w-12 text-right font-semibold ${
                                  rateVal >= 1.03
                                    ? "text-emerald-300"
                                    : rateVal <= 0.97
                                      ? "text-rose-300"
                                      : "text-zinc-300"
                                }`}
                              >
                                {rateVal.toFixed(2)}×
                              </span>
                            </>
                          ) : metricMode === "trades" ? (
                            <>
                              <span
                                title={`Avg exchange rate ${m.avgExchangeRate.toFixed(2)}× (${m.premium2xCount} swaps at ≥2:1)`}
                                className={`hidden sm:inline text-[11px] ${
                                  m.avgExchangeRate >= 1.03
                                    ? "text-amber-300"
                                    : "text-zinc-500"
                                }`}
                              >
                                {m.avgExchangeRate.toFixed(2)}:1
                              </span>
                              <span className="text-zinc-200 font-semibold">
                                {m.tradedCount.toLocaleString()}
                              </span>
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
                          ) : (
                            <span className="text-zinc-200 font-semibold">
                              {m.directTransferCount.toLocaleString()}
                            </span>
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
              {/* Asymmetric Swap Breakdown Card */}
              <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.06] via-zinc-900/50 to-zinc-900/40 p-5 space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <Scale className="h-4 w-4 text-amber-400" />
                      Asymmetric Swap Breakdown
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Multi-for-one swaps reveal real secondary-market premiums
                      (e.g. 2:1 or 3:1 trades).
                    </p>
                  </div>
                </div>

                {/* Symmetry split bar */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-400">
                      Equal (1:1 / N:N):{" "}
                      <strong className="text-zinc-200">
                        {(100 - data.totals.asymmetricSharePct).toFixed(1)}%
                      </strong>
                    </span>
                    <span className="text-amber-300">
                      Asymmetric:{" "}
                      <strong>{data.totals.asymmetricSharePct.toFixed(1)}%</strong>
                    </span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-950">
                    <div
                      className="h-full bg-zinc-700"
                      style={{
                        width: `${Math.max(0, 100 - data.totals.asymmetricSharePct)}%`,
                      }}
                    />
                    <div
                      className="h-full bg-amber-400"
                      style={{
                        width: `${Math.min(100, data.totals.asymmetricSharePct)}%`,
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                    <div className="font-mono text-sm font-bold text-amber-300 tabular-nums">
                      {data.totals.ratio2xSessions.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">≥ 2:1 Swaps</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                    <div className="font-mono text-sm font-bold text-amber-200 tabular-nums">
                      {data.totals.ratio3xSessions.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">≥ 3:1 Swaps</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800/90 bg-zinc-950/70 p-2.5">
                    <div className="font-mono text-sm font-bold text-sky-300 tabular-nums">
                      {data.totals.sameClassAsymmetricSessions.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">Same-Class</div>
                  </div>
                </div>

                {metricMode !== "asymmetric" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMetricMode("asymmetric");
                      setSortBy("premium2x");
                      setRecentFilter("2x");
                    }}
                    className="w-full rounded-lg border border-amber-400/30 bg-amber-400/10 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/20"
                  >
                    Switch to Asymmetric 2:1 / 3:1+ View →
                  </button>
                )}
              </div>

              {/* Daily Activity */}
              <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Daily Secondary Activity (UTC)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {metricMode === "asymmetric"
                      ? "Asymmetric swap sessions per day (≥2:1 highlighted)."
                      : "Confirmed swapped Objekts vs total P2P transfers per day."}
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
                              : metricMode === "asymmetric"
                                ? x.asymmetricSessions
                                : x.tradedObjekts,
                          ),
                      );
                      const val =
                        metricMode === "transfers"
                          ? d.directTransfers
                          : metricMode === "asymmetric"
                            ? d.asymmetricSessions
                            : d.tradedObjekts;
                      return (
                        <div key={d.tradeDate} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between font-mono">
                            <span className="text-zinc-400">{d.tradeDate}</span>
                            <span className="text-zinc-200 tabular-nums">
                              {val.toLocaleString()}{" "}
                              <span className="text-zinc-500">
                                {metricMode === "asymmetric"
                                  ? `(${d.ratio2xSessions.toLocaleString()} at 2:1+)`
                                  : `(${d.tradeSessions.toLocaleString()} swaps)`}
                              </span>
                            </span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-zinc-950">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.max(4, (val / maxDay) * 100)}%`,
                                backgroundColor:
                                  metricMode === "asymmetric"
                                    ? "#fbbf24"
                                    : accent,
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
                  How Exchange Rate Works
                </h3>
                <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">1.00× Market Parity:</strong>{" "}
                    In a 3↔1 swap, the 1 scarce card logs{" "}
                    <span className="font-mono text-amber-300">3.00×</span> and
                    each of the 3 offered cards logs{" "}
                    <span className="font-mono text-zinc-300">0.33×</span> — the
                    market-wide mean is always exactly 1.00×.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Same-Class Filter:</strong>{" "}
                    Removes cross-class upgrades (e.g. 4 First → 1 Special) to
                    isolate pure member &amp; edition demand premiums.
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
                    Filter by member, season, or class — or sort by ≥2:1
                    asymmetric swaps &amp; average exchange rate to spot
                    high-premium cards.
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
                        | "premium2x"
                        | "rate"
                        | "sessions"
                        | "transfers"
                        | "turnover",
                    )
                  }
                  aria-label="Sort traded collections"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="traded">Sort: Most Traded</option>
                  <option value="premium2x">Sort: Most ≥2:1 Swaps</option>
                  <option value="rate">Sort: Highest Avg Rate</option>
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
                      <th className="px-4 py-3 text-right">Traded</th>
                      <th className="px-4 py-3 text-right">≥2:1 (≥3:1)</th>
                      <th className="px-4 py-3 text-right">Avg Rate</th>
                      <th className="px-4 py-3 text-right">Direct</th>
                      <th className="px-4 py-3 text-right">Turnover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredCollections.slice(0, 80).map((c, idx) => {
                      const col2x = sameClassOnly
                        ? c.sameClass2xCount
                        : c.premium2xCount;
                      const col3x = sameClassOnly
                        ? c.sameClass3xCount
                        : c.premium3xCount;
                      const colRate = sameClassOnly
                        ? c.sameClassAvgRate
                        : c.avgExchangeRate;
                      return (
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
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {col2x > 0 ? (
                              <span className="text-amber-300 font-semibold">
                                {col2x}
                                {col3x > 0 && (
                                  <span className="text-amber-200/70 font-normal">
                                    {" "}
                                    ({col3x})
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="text-zinc-600">0</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold tabular-nums">
                            <span
                              title={`Peak ratio ${c.maxExchangeRate.toFixed(1)}:1 (${c.premiumCount} scarce-side vs ${c.bulkCount} bulk-side)`}
                              className={
                                colRate >= 1.15
                                  ? "text-emerald-300"
                                  : colRate <= 0.85
                                    ? "text-rose-300"
                                    : "text-zinc-300"
                              }
                            >
                              {colRate.toFixed(2)}:1
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400 tabular-nums">
                            {c.directTransferCount.toLocaleString()}
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
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Recent Confirmed Swaps Feed */}
          {data.recentTrades.length > 0 && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Clock className="h-4 w-4 text-zinc-400" />
                    Recent Detected Swaps ({filteredRecentTrades.length})
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Live examples of reciprocal swaps detected on-chain — filter
                    for 2:1+ and 3:1+ asymmetric trades below.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      ["all", "All Swaps"],
                      ["asymmetric", "Asymmetric"],
                      ["2x", "2:1+ Swaps"],
                      ["3x", "3:1+ Swaps"],
                      ["sameClassAsym", "Same-Class Asym"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRecentFilter(key)}
                      className={`rounded-lg px-2.5 py-1 font-medium transition ${
                        recentFilter === key
                          ? "bg-amber-400 text-zinc-950"
                          : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredRecentTrades.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6 text-center text-xs text-zinc-400">
                  No recent swaps match this filter yet.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {filteredRecentTrades.slice(0, 16).map((rt) => {
                    const premiumSide: "A" | "B" | null =
                      rt.sideACount < rt.sideBCount
                        ? "A"
                        : rt.sideBCount < rt.sideACount
                          ? "B"
                          : null;
                    const ratioLabel = formatRatioLabel(
                      rt.sideACount,
                      rt.sideBCount,
                    );
                    return (
                      <article
                        key={rt.tradeId}
                        className={`rounded-xl border p-4 space-y-3 ${
                          rt.isAsymmetric && rt.ratioMultiple >= 2
                            ? "border-amber-500/30 bg-zinc-900/50"
                            : "border-zinc-800/80 bg-zinc-900/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400">
                          <span className="inline-flex flex-wrap items-center gap-1.5 text-zinc-200 font-semibold">
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                rt.isAsymmetric
                                  ? "bg-amber-500/15 text-amber-300"
                                  : "bg-emerald-500/15 text-emerald-300"
                              }`}
                            >
                              {rt.isAsymmetric
                                ? `${ratioLabel} asymmetric`
                                : `${rt.sideACount} ↔ ${rt.sideBCount} swap`}
                            </span>
                            {rt.isAsymmetric && rt.isSameClass && (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                                Same Class
                              </span>
                            )}
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
                            count={rt.sideACount}
                            isPremium={premiumSide === "A"}
                            items={rt.sideASummary}
                          />
                          <div className="pt-5 text-zinc-500">
                            <ArrowLeftRight className="h-4 w-4" />
                          </div>
                          <TradeSideBox
                            label={rt.walletBShort}
                            count={rt.sideBCount}
                            isPremium={premiumSide === "B"}
                            items={rt.sideBSummary}
                          />
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TradeSideBox({
  label,
  count,
  isPremium,
  items,
}: {
  label: string;
  count: number;
  isPremium: boolean;
  items: TradeLegSummary[];
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1.5 min-w-0 ${
        isPremium
          ? "border-amber-400/40 bg-amber-500/[0.06]"
          : "border-zinc-800/80 bg-zinc-950/70"
      }`}
    >
      <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
        <span className="text-zinc-500 truncate">{label}</span>
        {isPremium ? (
          <span className="rounded bg-amber-400/20 px-1 py-0.2 text-amber-300 shrink-0">
            {count} • premium
          </span>
        ) : (
          <span className="text-zinc-500 shrink-0">{count} sent</span>
        )}
      </div>
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
