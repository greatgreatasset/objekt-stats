import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  ArrowLeftRight,
  Clock,
  Layers,
  LayoutGrid,
  Lock,
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
  const [asymScope, setAsymScope] = useState<
    "clean_solo" | "same_edition" | "all_classes"
  >("clean_solo");
  const [asymSort, setAsymSort] = useState<
    "overpayers" | "2x" | "3x" | "fav" | "rate"
  >("overpayers");
  const [recentFilter, setRecentFilter] = useState<
    "all" | "sameEdition" | "cleanSolo" | "asymmetric" | "2x" | "3x"
  >("all");
  const [gridMonitorSeason, setGridMonitorSeason] = useState("latest");
  const [query, setQuery] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [classFilter, setClassFilter] = useState<
    "all" | "First" | "Double" | "Special" | "Premier" | "Unit" | "physical"
  >("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [sortBy, setSortBy] = useState<
    | "traded"
    | "cleanSolo"
    | "sameEdition"
    | "premium2x"
    | "rate"
    | "gridLock"
    | "tightFloat"
    | "sessions"
    | "transfers"
    | "turnover"
  >("traded");

  const isGridTierMode = asymScope === "clean_solo";
  const isSameEdMode = asymScope === "same_edition";
  const isCleanMode = isGridTierMode || isSameEdMode;

  const gridMonitorSeasons = useMemo(
    () =>
      Array.from(new Set(data.editionGridSummary.map((e) => e.season))),
    [data.editionGridSummary],
  );

  const visibleGridEditions = useMemo(() => {
    if (gridMonitorSeason === "latest") {
      return data.editionGridSummary.slice(0, 6);
    }
    return data.editionGridSummary.filter((e) => e.season === gridMonitorSeason);
  }, [data.editionGridSummary, gridMonitorSeason]);

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
        const aOver = isSameEdMode ? a.sameEditionOverpayers : a.uniqueOverpayers;
        const bOver = isSameEdMode ? b.sameEditionOverpayers : b.uniqueOverpayers;
        const a2x = isSameEdMode
          ? a.sameEdition2xCount
          : isGridTierMode
            ? a.cleanSolo2xCount
            : a.premium2xCount;
        const b2x = isSameEdMode
          ? b.sameEdition2xCount
          : isGridTierMode
            ? b.cleanSolo2xCount
            : b.premium2xCount;
        const a3x = isSameEdMode
          ? a.sameEdition3xCount
          : isGridTierMode
            ? a.cleanSolo3xCount
            : a.premium3xCount;
        const b3x = isSameEdMode
          ? b.sameEdition3xCount
          : isGridTierMode
            ? b.cleanSolo3xCount
            : b.premium3xCount;
        const aFav = isSameEdMode
          ? (a.sameEditionFavorablePct ?? 0)
          : isGridTierMode
            ? (a.cleanFavorablePct ?? 0)
            : (a.premiumCount / Math.max(1, a.premiumCount + a.bulkCount)) * 100;
        const bFav = isSameEdMode
          ? (b.sameEditionFavorablePct ?? 0)
          : isGridTierMode
            ? (b.cleanFavorablePct ?? 0)
            : (b.premiumCount / Math.max(1, b.premiumCount + b.bulkCount)) * 100;

        if (isCleanMode && asymSort === "overpayers") {
          return bOver - aOver || bFav - aFav || b2x - a2x;
        }
        if (asymSort === "fav") {
          return bFav - aFav || bOver - aOver;
        }
        if (asymSort === "rate") {
          const ra = isCleanMode ? a.sameClassAvgRate : a.avgExchangeRate;
          const rb = isCleanMode ? b.sameClassAvgRate : b.avgExchangeRate;
          return rb - ra || bOver - aOver;
        }
        if (asymSort === "3x") {
          return b3x - a3x || bOver - aOver;
        }
        return b2x - a2x || bOver - aOver;
      });
    }
    return list.sort(
      (a, b) => a.tradeRank - b.tradeRank || b.tradedCount - a.tradedCount,
    );
  }, [data.memberLeaderboard, metricMode, isGridTierMode, isSameEdMode, isCleanMode, asymSort]);

  const maxMemberVal = useMemo(() => {
    if (rankedMembers.length === 0) return 1;
    if (metricMode === "asymmetric") {
      if (isCleanMode && asymSort === "overpayers") {
        return Math.max(
          1,
          ...rankedMembers.map((m) =>
            isSameEdMode ? m.sameEditionOverpayers : m.uniqueOverpayers,
          ),
        );
      }
      if (asymSort === "fav") {
        return Math.max(
          50,
          ...rankedMembers.map((m) =>
            isSameEdMode
              ? (m.sameEditionFavorablePct ?? 0)
              : isGridTierMode
                ? (m.cleanFavorablePct ?? 0)
                : (m.premiumCount / Math.max(1, m.premiumCount + m.bulkCount)) * 100,
          ),
        );
      }
      if (asymSort === "rate") {
        return Math.max(
          1.15,
          ...rankedMembers.map((m) =>
            isCleanMode ? m.sameClassAvgRate : m.avgExchangeRate,
          ),
        );
      }
      if (asymSort === "3x") {
        return Math.max(
          1,
          ...rankedMembers.map((m) =>
            isSameEdMode
              ? m.sameEdition3xCount
              : isGridTierMode
                ? m.cleanSolo3xCount
                : m.premium3xCount,
          ),
        );
      }
      return Math.max(
        1,
        ...rankedMembers.map((m) =>
          isSameEdMode
            ? m.sameEdition2xCount
            : isGridTierMode
              ? m.cleanSolo2xCount
              : m.premium2xCount,
        ),
      );
    }
    return Math.max(
      1,
      ...rankedMembers.map((m) =>
        metricMode === "transfers" ? m.directTransferCount : m.tradedCount,
      ),
    );
  }, [rankedMembers, metricMode, isGridTierMode, isSameEdMode, isCleanMode, asymSort]);

  const filteredCollections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.collections
      .filter((c) => {
        if (metricMode === "trades" && c.tradedCount <= 0) return false;
        if (metricMode === "asymmetric") {
          const pCount = isSameEdMode
            ? c.sameEdition2xCount
            : isGridTierMode
              ? c.cleanSolo2xCount
              : c.premiumCount;
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
        if (sortBy === "sameEdition") {
          return (
            b.sameEditionOverpayers - a.sameEditionOverpayers ||
            b.sameEdition2xCount - a.sameEdition2xCount ||
            b.sameClassAvgRate - a.sameClassAvgRate
          );
        }
        if (sortBy === "cleanSolo") {
          return (
            b.uniqueOverpayers - a.uniqueOverpayers ||
            b.cleanSolo2xCount - a.cleanSolo2xCount ||
            b.sameClassAvgRate - a.sameClassAvgRate
          );
        }
        if (sortBy === "premium2x") {
          const va = isSameEdMode
            ? a.sameEdition2xCount
            : isGridTierMode
              ? a.cleanSolo2xCount
              : a.premium2xCount;
          const vb = isSameEdMode
            ? b.sameEdition2xCount
            : isGridTierMode
              ? b.cleanSolo2xCount
              : b.premium2xCount;
          return vb - va || b.avgExchangeRate - a.avgExchangeRate;
        }
        if (sortBy === "rate") {
          const aQual = a.tradedCount >= 5 ? 1 : 0;
          const bQual = b.tradedCount >= 5 ? 1 : 0;
          if (aQual !== bQual) return bQual - aQual;
          const ra = isCleanMode ? a.sameClassAvgRate : a.avgExchangeRate;
          const rb = isCleanMode ? b.sameClassAvgRate : b.avgExchangeRate;
          return rb - ra || b.premium2xCount - a.premium2xCount;
        }
        if (sortBy === "gridLock") {
          return (
            (b.gridLockPct ?? -1) - (a.gridLockPct ?? -1) ||
            b.tradedCount - a.tradedCount
          );
        }
        if (sortBy === "tightFloat") {
          const aHas = a.estTradableFloat !== null ? 1 : 0;
          const bHas = b.estTradableFloat !== null ? 1 : 0;
          if (aHas !== bHas) return bHas - aHas;
          return (
            (a.estTradableFloat ?? Number.MAX_SAFE_INTEGER) -
              (b.estTradableFloat ?? Number.MAX_SAFE_INTEGER) ||
            b.tradedCount - a.tradedCount
          );
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
          const ta = a.floatTurnoverPct ?? a.turnoverPct ?? -1;
          const tb = b.floatTurnoverPct ?? b.turnoverPct ?? -1;
          return tb - ta || b.tradedCount - a.tradedCount;
        }
        return b.tradedCount - a.tradedCount || b.directTransferCount - a.directTransferCount;
      });
  }, [
    data.collections,
    metricMode,
    isGridTierMode,
    isSameEdMode,
    isCleanMode,
    query,
    seasonFilter,
    classFilter,
    memberFilter,
    sortBy,
  ]);

  const filteredRecentTrades = useMemo(() => {
    return data.recentTrades.filter((rt) => {
      if (recentFilter === "sameEdition") return rt.isSameEdition;
      if (recentFilter === "cleanSolo") return rt.isCleanSolo;
      if (recentFilter === "asymmetric") return rt.isAsymmetric;
      if (recentFilter === "2x") return rt.isAsymmetric && rt.ratioMultiple >= 2;
      if (recentFilter === "3x") return rt.isAsymmetric && rt.ratioMultiple >= 3;
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
                  setAsymScope("clean_solo");
                  setAsymSort("overpayers");
                  setSortBy("cleanSolo");
                  setRecentFilter("cleanSolo");
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
                      ? isSameEdMode
                        ? "Asymmetric Swap Premium — Exact Same-Edition N:1"
                        : isGridTierMode
                          ? "Asymmetric Swap Premium — Grid-Tier Clean N:1"
                          : "Asymmetric Swap Premium — All Classes (≤6:1)"
                      : metricMode === "transfers"
                        ? "Most Transferred Members (All P2P)"
                        : "Most Traded Members (Confirmed Swaps)"}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {metricMode === "asymmetric"
                      ? isSameEdMode
                        ? "Strictest apples-to-apples 2:1–6:1 swaps within the exact same season & edition/DCO (e.g. Cream02 3rd Ed ↔ 3rd Ed, 353Z ↔ 353Z)."
                        : isGridTierMode
                          ? "Pure 2:1–6:1 swaps separating 8-card grid FCOs (101–116Z) from 4-card grid FCOs (117–120Z) so grid-utility arbitrage isn't miscounted as member demand."
                          : "Includes cross-class upgrades (e.g. 3 First → 1 Special) and M:N bundles up to 6:1; extreme >6:1 / >10-card alt-wallet dumps excluded."
                      : "Compare secondary trading activity, average exchange rate (1.00× = parity), and primary mint rank."}
                  </p>
                </div>

                {metricMode === "asymmetric" ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAsymScope("clean_solo");
                          setSortBy("cleanSolo");
                          setRecentFilter("cleanSolo");
                        }}
                        title="Pure N:1 (2:1–6:1) swaps matching class, format, and COSMO grid tier (8-card vs 4-card)"
                        className={`rounded-md px-2 py-1 font-medium transition ${
                          isGridTierMode
                            ? "bg-amber-400/20 text-amber-300"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Grid-Tier N:1
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAsymScope("same_edition");
                          setSortBy("sameEdition");
                          setRecentFilter("sameEdition");
                        }}
                        title="Strictest: exact same season + edition bucket or exact DCO collection number"
                        className={`rounded-md px-2 py-1 font-medium transition ${
                          isSameEdMode
                            ? "bg-emerald-400/20 text-emerald-300"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Same Edition
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAsymScope("all_classes");
                          if (asymSort === "overpayers") setAsymSort("2x");
                          setSortBy("premium2x");
                        }}
                        title="Includes cross-class rarity upgrades (e.g. First → Special) & M:N bundles up to 6:1"
                        className={`rounded-md px-2 py-1 font-medium transition ${
                          !isCleanMode
                            ? "bg-zinc-800 text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        All Classes
                      </button>
                    </div>
                    <select
                      value={asymSort}
                      onChange={(e) =>
                        setAsymSort(
                          e.target.value as
                            | "overpayers"
                            | "2x"
                            | "3x"
                            | "fav"
                            | "rate",
                        )
                      }
                      aria-label="Sort asymmetric leaderboard"
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-200 focus:border-zinc-600 focus:outline-none"
                    >
                      {isCleanMode && (
                        <option value="overpayers">Sort: Unique Overpayers</option>
                      )}
                      <option value="2x">Sort: ≥2:1 Swaps</option>
                      <option value="3x">Sort: ≥3:1 Swaps</option>
                      <option value="fav">Sort: Favorable %</option>
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
                  const rateVal = isCleanMode
                    ? m.sameClassAvgRate
                    : m.avgExchangeRate;
                  const count2x = isSameEdMode
                    ? m.sameEdition2xCount
                    : isGridTierMode
                      ? m.cleanSolo2xCount
                      : m.premium2xCount;
                  const count3x = isSameEdMode
                    ? m.sameEdition3xCount
                    : isGridTierMode
                      ? m.cleanSolo3xCount
                      : m.premium3xCount;
                  const overpayerCount = isSameEdMode
                    ? m.sameEditionOverpayers
                    : m.uniqueOverpayers;
                  const bulkCount = isSameEdMode
                    ? m.sameEditionBulkCount
                    : m.cleanSoloBulkCount;
                  const topSharePct = isSameEdMode
                    ? m.sameEditionTopSharePct
                    : m.topOverpayerSharePct;
                  const favPct = isSameEdMode
                    ? m.sameEditionFavorablePct
                    : isGridTierMode
                      ? m.cleanFavorablePct
                      : m.premiumCount + m.bulkCount > 0
                        ? Number(
                            (
                              (m.premiumCount / (m.premiumCount + m.bulkCount)) *
                              100
                            ).toFixed(1),
                          )
                        : null;
                  const hasWhaleFlag =
                    isCleanMode &&
                    count2x >= 5 &&
                    topSharePct !== null &&
                    topSharePct >= 25;

                  const barVal =
                    metricMode === "transfers"
                      ? m.directTransferCount
                      : metricMode === "asymmetric"
                        ? isCleanMode && asymSort === "overpayers"
                          ? overpayerCount
                          : asymSort === "fav"
                            ? (favPct ?? 0)
                            : asymSort === "rate"
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
                        <div className="flex flex-wrap items-center gap-2">
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
                              title={`Commanded ${count3x} swaps at ≥3:1`}
                              className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                            >
                              {count3x} at ≥3:1
                            </span>
                          )}

                          {metricMode === "asymmetric" && hasWhaleFlag && (
                            <span
                              title={`Whale concentration: 1 single wallet accounts for ${topSharePct?.toFixed(0)}% of ${m.memberName}'s ${isSameEdMode ? "same-edition" : "grid-tier"} 2:1+ swaps (${overpayerCount} unique wallets across ${count2x} swaps).`}
                              className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300"
                            >
                              Top wallet {Math.round(topSharePct!)}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          {metricMode === "asymmetric" ? (
                            isCleanMode ? (
                              <>
                                <span
                                  className="text-zinc-200 font-semibold"
                                  title={`${overpayerCount} distinct wallets paid 2:1–6:1 across ${count2x} ${isSameEdMode ? "same-edition" : "grid-tier"} swaps`}
                                >
                                  {overpayerCount.toLocaleString()}{" "}
                                  <span className="text-[10px] font-normal text-zinc-500">
                                    wallets
                                  </span>
                                </span>
                                <span className="text-[11px] text-zinc-400 hidden sm:inline">
                                  {count2x} swaps
                                </span>
                                <span
                                  title={`Favorable share: ${count2x} times on scarce side vs ${bulkCount} times on bulk offering side`}
                                  className={`w-14 text-right text-[11px] font-semibold ${
                                    (favPct ?? 0) >= 35
                                      ? "text-emerald-300"
                                      : (favPct ?? 0) <= 25
                                        ? "text-rose-300"
                                        : "text-zinc-300"
                                  }`}
                                >
                                  {favPct !== null ? `${favPct.toFixed(1)}% fav` : "—"}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-zinc-200 font-semibold">
                                  {count2x.toLocaleString()}{" "}
                                  <span className="text-[10px] font-normal text-zinc-500">
                                    2:1+
                                  </span>
                                </span>
                                <span
                                  title="Average counterparty Objekts received per 1 Objekt (≤6:1 cap; 1.00× = parity)"
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
                            )
                          ) : metricMode === "trades" ? (
                            <>
                              <span
                                title={`Avg exchange rate ${m.avgExchangeRate.toFixed(2)}× (${m.uniqueOverpayers} unique overpaying wallets in clean N:1 swaps)`}
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
                      setAsymScope("clean_solo");
                      setAsymSort("overpayers");
                      setSortBy("cleanSolo");
                      setRecentFilter("cleanSolo");
                    }}
                    className="w-full rounded-lg border border-amber-400/30 bg-amber-400/10 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-400/20"
                  >
                    Switch to Clean N:1 Asymmetric View →
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
                    <strong className="text-zinc-200">COSMO Grid-Tier Filter:</strong>{" "}
                    Separates 8-card grid FCOs (<code className="text-zinc-300">101–116Z</code>)
                    from 4-card grid FCOs (<code className="text-zinc-300">117–120Z</code>) so
                    fair 2× 1st/2nd-Ed → 1× 3rd-Ed grid utility swaps aren&apos;t misread as
                    member premiums.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Grid Lock &amp; Float:</strong>{" "}
                    Every minted grid SCO (<code className="text-zinc-300">201Z–206Z</code>)
                    permanently locks 1 copy of every FCO slot in that edition, revealing true
                    circulating tradable float.
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

          {/* COSMO Grid Supply & Lock Monitor */}
          {data.editionGridSummary.length > 0 && (
            <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-white flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4 text-emerald-400" />
                    COSMO Grid Lock &amp; Tradable Float Monitor
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Completing a Digital First Class grid locks 8 FCOs (1st/2nd Ed →{" "}
                    <code className="text-zinc-300">201Z–204Z</code>) or 4 FCOs (3rd Ed →{" "}
                    <code className="text-zinc-300">205Z–206Z</code>) permanently unsendable.{" "}
                    <span className="text-zinc-300 font-medium">
                      {data.totals.totalGridsCompleted.toLocaleString()} total {artistName} grids completed
                    </span>{" "}
                    across indexed seasons.
                  </p>
                </div>

                <select
                  value={gridMonitorSeason}
                  onChange={(e) => setGridMonitorSeason(e.target.value)}
                  aria-label="Filter grid monitor season"
                  className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="latest">Latest Editions (Top 6)</option>
                  {gridMonitorSeasons.map((s) => (
                    <option key={s} value={s}>
                      {s} Season
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleGridEditions.map((ed) => (
                  <div
                    key={ed.key}
                    className="rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {ed.season} · {ed.editionLabel}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-500">
                          {ed.gridSize}-card grid · {ed.gridsCompleted.toLocaleString()} grids completed
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold shrink-0 ${
                          ed.gridLockPct >= 50
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : ed.gridLockPct >= 25
                              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                              : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        <Lock className="h-3 w-3" />
                        {ed.gridLockPct.toFixed(1)}%
                      </span>
                    </div>

                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                      <div
                        className={`h-full rounded-full ${
                          ed.gridLockPct >= 50
                            ? "bg-amber-400"
                            : ed.gridLockPct >= 25
                              ? "bg-emerald-400"
                              : "bg-sky-400"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(3, ed.gridLockPct))}%`,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-0.5 font-mono text-[11px] tabular-nums">
                      <div>
                        <p className="text-[10px] text-zinc-500">Minted</p>
                        <p className="text-zinc-300">{ed.fcoMints.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Locked FCOs</p>
                        <p className="text-amber-200/90">{ed.lockedFcos.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500">Tradable Float</p>
                        <p className="font-semibold text-emerald-300">
                          {ed.estTradableFloat.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

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
                          | "cleanSolo"
                          | "sameEdition"
                          | "premium2x"
                          | "rate"
                          | "gridLock"
                          | "tightFloat"
                          | "sessions"
                          | "transfers"
                          | "turnover",
                      )
                    }
                    aria-label="Sort traded collections"
                    className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                  >
                    <option value="traded">Sort: Most Traded</option>
                    <option value="cleanSolo">Sort: Grid-Tier N:1 Overpayers</option>
                    <option value="sameEdition">Sort: Same-Edition Overpayers</option>
                    <option value="premium2x">Sort: Most ≥2:1 Swaps</option>
                    <option value="rate">Sort: Highest Avg Rate</option>
                    <option value="gridLock">Sort: Highest Grid Lock %</option>
                    <option value="tightFloat">Sort: Tightest Tradable Float</option>
                    <option value="sessions">Sort: Most Trade Swaps</option>
                    <option value="transfers">Sort: Most Direct Transfers</option>
                    <option value="turnover">Sort: Highest Float Turnover %</option>
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
                      <th className="px-4 py-3">Class / Grid</th>
                      <th className="px-4 py-3 text-right">Traded</th>
                      <th className="px-4 py-3 text-right">≥2:1 (≥3:1)</th>
                      <th className="px-4 py-3 text-right">Avg Rate</th>
                      <th className="px-4 py-3 text-right">Grid Lock / Float</th>
                      <th className="px-4 py-3 text-right">Float Turnover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {filteredCollections.slice(0, 80).map((c, idx) => {
                      const col2x = isSameEdMode
                        ? c.sameEdition2xCount
                        : isGridTierMode
                          ? c.cleanSolo2xCount
                          : c.premium2xCount;
                      const col3x = isSameEdMode
                        ? c.sameEdition3xCount
                        : isGridTierMode
                          ? c.cleanSolo3xCount
                          : c.premium3xCount;
                      const colRate = isCleanMode
                        ? c.sameClassAvgRate
                        : c.avgExchangeRate;
                      const effTurnover = c.floatTurnoverPct ?? c.turnoverPct;
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
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{c.objektClass}</span>
                              {c.gridSize && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                                    c.gridSize === 4
                                      ? "bg-amber-500/15 text-amber-300"
                                      : "bg-zinc-800 text-zinc-400"
                                  }`}
                                >
                                  {c.gridSize}-card
                                </span>
                              )}
                            </div>
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
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {c.gridLockPct !== null && c.estTradableFloat !== null ? (
                              <div
                                title={`${c.gridsCompleted?.toLocaleString()} completed grids locked + ${c.spunCount.toLocaleString()} spun out of ${c.primaryMints?.toLocaleString()} minted`}
                              >
                                <span
                                  className={`font-semibold ${
                                    c.gridLockPct >= 50
                                      ? "text-amber-300"
                                      : c.gridLockPct >= 25
                                        ? "text-emerald-300"
                                        : "text-zinc-300"
                                  }`}
                                >
                                  {c.gridLockPct.toFixed(1)}%
                                </span>
                                <span className="block text-[10px] text-zinc-500">
                                  {c.estTradableFloat.toLocaleString()} float
                                </span>
                              </div>
                            ) : c.primaryMints ? (
                              <span className="text-[11px] text-zinc-500">
                                {c.primaryMints.toLocaleString()} minted
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {effTurnover !== null ? (
                              <span
                                title={
                                  c.floatTurnoverPct !== null
                                    ? `${c.tradedCount.toLocaleString()} traded / ${c.estTradableFloat?.toLocaleString()} unlocked float (${c.turnoverPct?.toFixed(1)}% of total mints)`
                                    : `${c.tradedCount.toLocaleString()} traded / ${c.primaryMints?.toLocaleString()} indexed primary mints`
                                }
                                className="text-sky-300"
                              >
                                {effTurnover.toFixed(1)}%
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
                      ["sameEdition", "Same Edition"],
                      ["cleanSolo", "Grid-Tier N:1"],
                      ["asymmetric", "Asymmetric (≤6:1)"],
                      ["2x", "2:1+ Swaps"],
                      ["3x", "3:1+ Swaps"],
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
                            {rt.isSameEdition ? (
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                Same Edition
                              </span>
                            ) : rt.isCleanSolo ? (
                              <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                                Grid-Tier N:1
                              </span>
                            ) : (
                              rt.isAsymmetric &&
                              rt.isSameClass && (
                                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                                  Same Class
                                </span>
                              )
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
