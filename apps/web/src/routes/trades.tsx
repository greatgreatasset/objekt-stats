import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeftRight, Search } from "lucide-react";
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
      {/* Compact Editorial Header + Inline Stats */}
      <header className="border-b border-zinc-800/90 pb-6 space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName}{" "}
              <span className="font-normal text-zinc-400">Most Traded</span>
            </h1>
            <p className="text-sm text-zinc-400">
              Reciprocal user-to-user Objekt swaps (1↔1, 2↔2, and asymmetric
              2:1 / 3:1+ trades within 30 minutes). Primary mints, Spins, and
              burns are excluded.
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-md border border-zinc-800 bg-[#121215] p-0.5 text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                setMetricMode("trades");
                setSortBy("traded");
              }}
              className={`rounded-[4px] px-2.5 py-1.5 font-medium transition-colors ${
                metricMode === "trades"
                  ? "bg-zinc-200 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
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
              className={`rounded-[4px] px-2.5 py-1.5 font-medium transition-colors ${
                metricMode === "asymmetric"
                  ? "bg-amber-400 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Asymmetric (2:1 / 3:1+)
            </button>
            <button
              type="button"
              onClick={() => {
                setMetricMode("transfers");
                setSortBy("transfers");
              }}
              className={`rounded-[4px] px-2.5 py-1.5 font-medium transition-colors ${
                metricMode === "transfers"
                  ? "bg-zinc-200 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              Direct Transfers
            </button>
          </div>
        </div>

        {/* Inline Metric Strip */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 pt-1">
          <div>
            <div className="text-xs text-zinc-500">Confirmed Swaps</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-white tabular-nums">
                {data.totals.confirmedTradeSessions.toLocaleString()}
              </span>
              {data.totals.avgObjektsPerTrade > 0 && (
                <span className="font-mono text-xs text-zinc-500 tabular-nums">
                  {data.totals.avgObjektsPerTrade.toFixed(2)} cards/swap
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">Asymmetric Swaps</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-amber-300 tabular-nums">
                {data.totals.asymmetricSessions.toLocaleString()}
              </span>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">
                {data.totals.asymmetricSharePct.toFixed(1)}% ({data.totals.ratio2xSessions.toLocaleString()} at 2:1+)
              </span>
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">Objekts Exchanged</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-white tabular-nums">
                {data.totals.tradedObjekts.toLocaleString()}
              </span>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">
                {data.totals.trackedCollections.toLocaleString()} collections
              </span>
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">Direct P2P Transfers</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-white tabular-nums">
                {data.totals.directTransfers.toLocaleString()}
              </span>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">
                {data.totals.confirmedSwapSharePct.toFixed(1)}% matched swaps
              </span>
            </div>
          </div>
        </div>
      </header>

      {!hasData ? (
        <section className="rounded-lg border border-zinc-800/90 bg-[#121215] p-8 text-center space-y-2">
          <h2 className="text-sm font-semibold text-zinc-200">
            No secondary P2P trades indexed for {artistName} yet
          </h2>
          <p className="mx-auto max-w-lg text-xs text-zinc-400">
            Confirmed user-to-user swaps will appear here automatically as P2P
            transfers settle.
          </p>
        </section>
      ) : (
        <>
          {/* Member Leaderboard + Asymmetric Breakdown / Daily Activity Rail */}
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
            <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-white">
                    {metricMode === "asymmetric"
                      ? isSameEdMode
                        ? "Asymmetric Premium — Exact Same-Edition N:1"
                        : isGridTierMode
                          ? "Asymmetric Premium — Grid-Tier Clean N:1"
                          : "Asymmetric Premium — All Classes (≤6:1)"
                      : metricMode === "transfers"
                        ? "Most Transferred Members"
                        : "Most Traded Members"}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {metricMode === "asymmetric"
                      ? isSameEdMode
                        ? "Strict apples-to-apples 2:1–6:1 swaps within the exact same season & edition/DCO."
                        : isGridTierMode
                          ? "Pure 2:1–6:1 swaps separating 8-card grid FCOs (101–116Z) from 4-card grid FCOs (117–120Z)."
                          : "Includes cross-class upgrades and M:N bundles up to 6:1."
                      : "Secondary swap volume, average exchange rate (1.00× = parity), and primary sales delta."}
                  </p>
                </div>

                {metricMode === "asymmetric" ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <div className="inline-flex rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setAsymScope("clean_solo");
                          setSortBy("cleanSolo");
                          setRecentFilter("cleanSolo");
                        }}
                        title="Pure N:1 (2:1–6:1) swaps matching class, format, and COSMO grid tier (8-card vs 4-card)"
                        className={`rounded-[4px] px-2 py-1 font-medium transition-colors ${
                          isGridTierMode
                            ? "bg-zinc-200 text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-100"
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
                        className={`rounded-[4px] px-2 py-1 font-medium transition-colors ${
                          isSameEdMode
                            ? "bg-zinc-200 text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-100"
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
                        title="Includes cross-class rarity upgrades & M:N bundles up to 6:1"
                        className={`rounded-[4px] px-2 py-1 font-medium transition-colors ${
                          !isCleanMode
                            ? "bg-zinc-200 text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-100"
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
                      className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2 py-1 text-zinc-200 focus:border-zinc-600 focus:outline-none"
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

              <div className="divide-y divide-zinc-800/60">
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
                      className="group block px-4 py-2.5 transition-colors hover:bg-zinc-900/70 sm:px-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="w-6 font-mono text-zinc-500 tabular-nums">
                            {metricMode === "trades" ? m.tradeRank : idx + 1}
                          </span>
                          <span
                            className="h-2.5 w-2.5 rounded-[2px]"
                            style={{ backgroundColor: m.hexColor }}
                          />
                          <span className="text-sm font-medium text-zinc-100 group-hover:text-white">
                            {m.memberName}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500">
                            {m.memberCode}
                          </span>

                          {metricMode === "trades" &&
                            m.rankVsPrimary !== null &&
                            m.rankVsPrimary !== 0 && (
                              <span
                                title={`Trade rank #${m.tradeRank} vs Primary Sales rank #${m.primarySalesRank}`}
                                className={`font-mono text-[10px] ${
                                  m.rankVsPrimary > 0
                                    ? "text-emerald-400"
                                    : "text-zinc-500"
                                }`}
                              >
                                ({m.rankVsPrimary > 0
                                  ? `+${m.rankVsPrimary}`
                                  : m.rankVsPrimary}{" "}
                                vs sales)
                              </span>
                            )}

                          {metricMode === "asymmetric" && count3x > 0 && (
                            <span
                              title={`Commanded ${count3x} swaps at ≥3:1`}
                              className="font-mono text-[10px] text-amber-300"
                            >
                              {count3x} at ≥3:1
                            </span>
                          )}

                          {metricMode === "asymmetric" && hasWhaleFlag && (
                            <span
                              title={`1 wallet accounts for ${topSharePct?.toFixed(0)}% of ${m.memberName}'s ${isSameEdMode ? "same-edition" : "grid-tier"} 2:1+ swaps (${overpayerCount} unique wallets)`}
                              className="font-mono text-[10px] text-amber-400/90"
                            >
                              top wallet {Math.round(topSharePct!)}%
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          {metricMode === "asymmetric" ? (
                            isCleanMode ? (
                              <>
                                <span
                                  className="text-zinc-100 font-semibold"
                                  title={`${overpayerCount} distinct wallets paid 2:1–6:1 across ${count2x} swaps`}
                                >
                                  {overpayerCount.toLocaleString()}{" "}
                                  <span className="text-[10px] font-normal text-zinc-500">
                                    wallets
                                  </span>
                                </span>
                                <span className="text-[11px] text-zinc-500 hidden sm:inline">
                                  {count2x} swaps
                                </span>
                                <span
                                  title={`Favorable share: ${count2x} scarce vs ${bulkCount} bulk`}
                                  className={`w-14 text-right text-[11px] font-semibold ${
                                    (favPct ?? 0) >= 35
                                      ? "text-emerald-400"
                                      : (favPct ?? 0) <= 25
                                        ? "text-rose-400"
                                        : "text-zinc-300"
                                  }`}
                                >
                                  {favPct !== null ? `${favPct.toFixed(1)}% fav` : "—"}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-zinc-100 font-semibold">
                                  {count2x.toLocaleString()}{" "}
                                  <span className="text-[10px] font-normal text-zinc-500">
                                    2:1+
                                  </span>
                                </span>
                                <span
                                  title="Average counterparty Objekts received per 1 Objekt (≤6:1 cap; 1.00× = parity)"
                                  className={`w-12 text-right font-semibold ${
                                    rateVal >= 1.03
                                      ? "text-emerald-400"
                                      : rateVal <= 0.97
                                        ? "text-rose-400"
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
                                title={`Avg exchange rate ${m.avgExchangeRate.toFixed(2)}× (${m.uniqueOverpayers} unique overpaying wallets)`}
                                className={`hidden sm:inline text-[11px] ${
                                  m.avgExchangeRate >= 1.03
                                    ? "text-amber-300"
                                    : "text-zinc-500"
                                }`}
                              >
                                {m.avgExchangeRate.toFixed(2)}:1
                              </span>
                              <span className="text-zinc-100 font-semibold">
                                {m.tradedCount.toLocaleString()}
                              </span>
                              <span className="w-11 text-right text-zinc-500">
                                {m.tradeSharePct.toFixed(1)}%
                              </span>
                              <span
                                className={`w-11 text-right font-semibold ${
                                  m.tradeRelativeIndex >= 1.15
                                    ? "text-emerald-400"
                                    : m.tradeRelativeIndex <= 0.85
                                      ? "text-rose-400"
                                      : "text-zinc-300"
                                }`}
                              >
                                {m.tradeRelativeIndex.toFixed(2)}×
                              </span>
                            </>
                          ) : (
                            <span className="text-zinc-100 font-semibold">
                              {m.directTransferCount.toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-1.5 ml-8 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                        <div
                          className="h-full transition-all"
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

            <aside className="space-y-6">
              {/* Asymmetric Swap Breakdown */}
              <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
                <div className="border-b border-zinc-800/90 px-4 py-3.5 space-y-0.5">
                  <h2 className="text-sm font-semibold text-white">
                    Asymmetric Swap Breakdown
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Multi-for-one swaps show real secondary premiums.
                  </p>
                </div>

                <div className="p-4 space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="text-zinc-400">
                        Equal (1:1 / N:N):{" "}
                        <strong className="text-zinc-200">
                          {(100 - data.totals.asymmetricSharePct).toFixed(1)}%
                        </strong>
                      </span>
                      <span className="text-amber-300">
                        Asym: {data.totals.asymmetricSharePct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className="h-full bg-zinc-600"
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

                  <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-800/70 text-center">
                    <div className="bg-[#0f0f12] p-2.5">
                      <div className="font-mono text-sm font-semibold text-amber-300 tabular-nums">
                        {data.totals.ratio2xSessions.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-zinc-500">≥ 2:1</div>
                    </div>
                    <div className="bg-[#0f0f12] p-2.5">
                      <div className="font-mono text-sm font-semibold text-amber-200 tabular-nums">
                        {data.totals.ratio3xSessions.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-zinc-500">≥ 3:1</div>
                    </div>
                    <div className="bg-[#0f0f12] p-2.5">
                      <div className="font-mono text-sm font-semibold text-zinc-200 tabular-nums">
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
                      className="w-full rounded-md border border-zinc-700 bg-[#0c0c0e] py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
                    >
                      Switch to Clean N:1 View →
                    </button>
                  )}
                </div>
              </div>

              {/* Daily Activity */}
              <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
                <div className="border-b border-zinc-800/90 px-4 py-3.5 space-y-0.5">
                  <h2 className="text-sm font-semibold text-white">
                    Daily Activity (UTC)
                  </h2>
                  <p className="text-xs text-zinc-400">
                    {metricMode === "asymmetric"
                      ? "Asymmetric swap sessions per day."
                      : "Confirmed swapped Objekts per day."}
                  </p>
                </div>

                <div className="p-4">
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
                            <div className="flex items-center justify-between font-mono tabular-nums">
                              <span className="text-zinc-500">{d.tradeDate}</span>
                              <span className="text-zinc-200">
                                {val.toLocaleString()}{" "}
                                <span className="text-zinc-500">
                                  (
                                  {metricMode === "asymmetric"
                                    ? `${d.ratio2xSessions.toLocaleString()} 2:1+`
                                    : `${d.tradeSessions.toLocaleString()} swaps`}
                                  )
                                </span>
                              </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                              <div
                                className="h-full"
                                style={{
                                  width: `${Math.max(3, (val / maxDay) * 100)}%`,
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
              </div>

              {/* How Trade Detection Works */}
              <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-4 space-y-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 font-mono">
                  How Exchange Rate Works
                </h3>
                <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
                  <li>
                    <strong className="text-zinc-200">1.00× Parity:</strong> In
                    a 3↔1 swap, the scarce card logs{" "}
                    <span className="font-mono text-amber-300">3.00×</span> and
                    each offered card logs{" "}
                    <span className="font-mono text-zinc-300">0.33×</span>.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Grid-Tier Filter:</strong>{" "}
                    Separates 8-card FCOs (101–116Z) from 4-card FCOs (117–120Z)
                    so grid-utility swaps aren&apos;t miscounted as member
                    premiums.
                  </li>
                  <li>
                    <strong className="text-zinc-200">Grid Lock:</strong>{" "}
                    Completed grid SCOs (201Z–206Z) lock 1 copy of every FCO
                    slot, revealing true tradable float.
                  </li>
                </ul>
                <Link
                  to="/methodology"
                  className="inline-block text-xs text-zinc-300 hover:text-white underline decoration-zinc-700 underline-offset-2"
                >
                  Full methodology →
                </Link>
              </div>
            </aside>
          </section>

          {/* COSMO Grid Supply & Lock Monitor */}
          {data.editionGridSummary.length > 0 && (
            <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-white">
                    COSMO Grid Lock &amp; Tradable Float
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Completing a Digital FCO grid locks 8 FCOs (1st/2nd Ed →
                    201Z–204Z) or 4 FCOs (3rd Ed → 205Z–206Z) unsendable.{" "}
                    <span className="text-zinc-200">
                      {data.totals.totalGridsCompleted.toLocaleString()} grids
                      completed
                    </span>
                    .
                  </p>
                </div>

                <select
                  value={gridMonitorSeason}
                  onChange={(e) => setGridMonitorSeason(e.target.value)}
                  aria-label="Filter grid monitor season"
                  className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
                >
                  <option value="latest">Latest Editions (Top 6)</option>
                  {gridMonitorSeasons.map((s) => (
                    <option key={s} value={s}>
                      {s} Season
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-px bg-zinc-800/70 sm:grid-cols-2 lg:grid-cols-3">
                {visibleGridEditions.map((ed) => (
                  <div
                    key={ed.key}
                    className="bg-[#121215] p-4 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {ed.season} · {ed.editionLabel}
                        </p>
                        <p className="font-mono text-[11px] text-zinc-500">
                          {ed.gridSize}-card grid ·{" "}
                          {ed.gridsCompleted.toLocaleString()} completed
                        </p>
                      </div>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                          ed.gridLockPct >= 50
                            ? "text-amber-300"
                            : ed.gridLockPct >= 25
                              ? "text-emerald-400"
                              : "text-zinc-300"
                        }`}
                      >
                        {ed.gridLockPct.toFixed(1)}% locked
                      </span>
                    </div>

                    <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className={`h-full ${
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
                        <p className="text-zinc-300">
                          {ed.fcoMints.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-500">Locked</p>
                        <p className="text-amber-300/90">
                          {ed.lockedFcos.toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-zinc-500">Float</p>
                        <p className="font-semibold text-emerald-400">
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
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-800/90 bg-[#121215] p-3.5 sm:p-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  Most Traded Collections ({filteredCollections.length})
                </h2>
                <p className="text-xs text-zinc-400">
                  Filter by member, season, or class — or sort by ≥2:1 swaps and
                  exchange rate.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search member, season, or collection number..."
                    className="w-full rounded-md border border-zinc-800 bg-[#0c0c0e] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                  />
                </div>

                <select
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                  aria-label="Filter by member"
                  className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
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
                  className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
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
                  className="rounded-md border border-zinc-800 bg-[#0c0c0e] px-2.5 py-1.5 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
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
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      classFilter === key
                        ? "bg-zinc-200 text-zinc-950"
                        : "border border-zinc-800 bg-[#0c0c0e] text-zinc-400 hover:text-zinc-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredCollections.length === 0 ? (
              <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-8 text-center text-xs text-zinc-400">
                No traded collections match your current filters.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800/90 bg-[#121215]">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-800/80 bg-[#0f0f12] font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th className="px-4 py-2.5">#</th>
                      <th className="px-4 py-2.5">Collection</th>
                      <th className="px-4 py-2.5">Member</th>
                      <th className="px-4 py-2.5">Class / Grid</th>
                      <th className="px-4 py-2.5 text-right">Traded</th>
                      <th className="px-4 py-2.5 text-right">≥2:1 (≥3:1)</th>
                      <th className="px-4 py-2.5 text-right">Avg Rate</th>
                      <th className="px-4 py-2.5 text-right">Lock / Float</th>
                      <th className="px-4 py-2.5 text-right">Turnover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
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
                          className="transition-colors hover:bg-zinc-900/60"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 tabular-nums">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-3">
                              {c.frontImageUrl ? (
                                <img
                                  src={c.frontImageUrl}
                                  alt={c.collectionId}
                                  loading="lazy"
                                  className="h-10 w-7 rounded-[2px] object-cover border border-zinc-800 shrink-0"
                                />
                              ) : (
                                <span
                                  className="h-10 w-7 rounded-[2px] border border-zinc-800 shrink-0"
                                  style={{
                                    backgroundColor:
                                      c.backgroundColor ?? "#18181b",
                                  }}
                                />
                              )}
                              <div>
                                <p className="font-medium text-zinc-100 text-xs sm:text-sm">
                                  {c.collectionId}
                                </p>
                                <p className="font-mono text-[11px] text-zinc-500">
                                  {c.season} · {c.collectionNo} (
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
                                className="inline-flex items-center gap-1.5 font-medium text-zinc-200 hover:text-white"
                              >
                                <span
                                  className="h-2 w-2 rounded-[2px]"
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
                            <span>{c.objektClass}</span>
                            {c.gridSize && (
                              <span
                                className={`ml-1.5 text-[10px] ${
                                  c.gridSize === 4
                                    ? "text-amber-300"
                                    : "text-zinc-500"
                                }`}
                              >
                                {c.gridSize}c
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-white tabular-nums">
                            {c.tradedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {col2x > 0 ? (
                              <span className="text-amber-300 font-semibold">
                                {col2x}
                                {col3x > 0 && (
                                  <span className="text-zinc-400 font-normal">
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
                              title={`Peak ratio ${c.maxExchangeRate.toFixed(1)}:1`}
                              className={
                                colRate >= 1.15
                                  ? "text-emerald-400"
                                  : colRate <= 0.85
                                    ? "text-rose-400"
                                    : "text-zinc-300"
                              }
                            >
                              {colRate.toFixed(2)}:1
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                            {c.gridLockPct !== null &&
                            c.estTradableFloat !== null ? (
                              <div
                                title={`${c.gridsCompleted?.toLocaleString()} completed grids + ${c.spunCount.toLocaleString()} spun`}
                              >
                                <span
                                  className={`font-semibold ${
                                    c.gridLockPct >= 50
                                      ? "text-amber-300"
                                      : c.gridLockPct >= 25
                                        ? "text-emerald-400"
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
                                    ? `${c.tradedCount.toLocaleString()} traded / ${c.estTradableFloat?.toLocaleString()} unlocked float`
                                    : `${c.tradedCount.toLocaleString()} traded / ${c.primaryMints?.toLocaleString()} indexed mints`
                                }
                                className="text-zinc-200"
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
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">
                    Recent Detected Swaps ({filteredRecentTrades.length})
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Reciprocal swaps detected on-chain.
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      ["all", "All"],
                      ["sameEdition", "Same Edition"],
                      ["cleanSolo", "Grid-Tier N:1"],
                      ["asymmetric", "Asymmetric"],
                      ["2x", "2:1+"],
                      ["3x", "3:1+"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setRecentFilter(key)}
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        recentFilter === key
                          ? "bg-zinc-200 text-zinc-950"
                          : "border border-zinc-800 bg-[#121215] text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {filteredRecentTrades.length === 0 ? (
                <div className="rounded-lg border border-zinc-800/90 bg-[#121215] p-6 text-center text-xs text-zinc-500">
                  No recent swaps match this filter yet.
                </div>
              ) : (
                <div className="grid gap-px overflow-hidden rounded-lg border border-zinc-800/90 bg-zinc-800/70 md:grid-cols-2">
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
                        className="bg-[#121215] p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <span
                              className={
                                rt.isAsymmetric
                                  ? "font-semibold text-amber-300"
                                  : "font-semibold text-zinc-200"
                              }
                            >
                              {rt.isAsymmetric
                                ? `${ratioLabel} asym`
                                : `${rt.sideACount}↔${rt.sideBCount}`}
                            </span>
                            {rt.isSameEdition ? (
                              <span className="text-emerald-400">
                                Same Ed
                              </span>
                            ) : rt.isCleanSolo ? (
                              <span className="text-zinc-400">Grid N:1</span>
                            ) : (
                              rt.isAsymmetric &&
                              rt.isSameClass && (
                                <span className="text-zinc-400">Same Class</span>
                              )
                            )}
                            <span>{formatDuration(rt.durationSeconds)}</span>
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
                          <div className="pt-4 text-zinc-600">
                            <ArrowLeftRight className="h-3.5 w-3.5" />
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
      className={`rounded-md border p-2.5 space-y-1.5 min-w-0 ${
        isPremium
          ? "border-amber-500/40 bg-[#0f0f12]"
          : "border-zinc-800/80 bg-[#0c0c0e]"
      }`}
    >
      <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
        <span className="text-zinc-500 truncate">{label}</span>
        {isPremium ? (
          <span className="text-amber-300 shrink-0">{count} · premium</span>
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
                className="h-2 w-2 rounded-[1px] shrink-0"
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
            +{items.length - 4} more
          </p>
        )}
      </div>
    </div>
  );
}
