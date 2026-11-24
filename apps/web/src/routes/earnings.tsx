import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Copy,
  Download,
  Info,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_EARNINGS_CONFIG,
  DEFAULT_EARNINGS_RATES,
  EARNINGS_SPLIT_PRESETS,
  MODHAUS_PUBLIC_BENCHMARKS,
  computeMemberEarnings,
  getSeasonCoverageInfo,
  type EarningsModelConfig,
  type EarningsSplitPresetId,
} from "@objekt-stats/stats";
import { getEarningsDataset, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/earnings")({
  validateSearch: (search: Record<string, unknown>): { artist?: ArtistSlug } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
  }),
  loaderDeps: ({ search }) => ({ artist: search.artist ?? "triples" }),
  loader: ({ deps }) => getEarningsDataset({ data: deps.artist }),
  head: ({ loaderData }) => {
    const name = loaderData?.artist?.name ?? "tripleS";
    const title = `${name} Member Objekt Earnings Estimator — Objekt Stats`;
    const desc = `Estimate individual ${name} member revenue and take-home payouts from on-chain COSMO Objekt sales with spin-replacement deduction, Web Shop vs. App Store fee modeling, and customizable Modhaus split ratios.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  component: EarningsPage,
});

function formatMoney(
  usd: number,
  currency: "usd" | "krw",
  krwPerUsd: number,
  compact = false,
): string {
  if (currency === "krw") {
    const krw = Math.round(usd * krwPerUsd);
    if (compact) {
      if (Math.abs(krw) >= 100_000_000) {
        return `₩${(krw / 100_000_000).toFixed(2)}억`;
      }
      if (Math.abs(krw) >= 10_000) {
        return `₩${Math.round(krw / 10_000).toLocaleString()}만`;
      }
    }
    return `₩${krw.toLocaleString("en-US")}`;
  }
  if (compact && Math.abs(usd) >= 1_000_000) {
    return `$${(usd / 1_000_000).toFixed(2)}M`;
  }
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

function EarningsPage() {
  const data = Route.useLoaderData();
  const { artist } = Route.useSearch();
  const artistSlug: ArtistSlug = artist === "artms" ? "artms" : "triples";
  const isArtms = artistSlug === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");

  // Default to 100%-indexed seasons for this artist
  const fullCoverageSeasonNames = useMemo(
    () =>
      data.seasons
        .filter(
          (s) =>
            getSeasonCoverageInfo(
              artistSlug,
              s.season,
              s.firstMintAt,
              s.lastMintAt,
            ).coverage === "full",
        )
        .map((s) => s.season),
    [artistSlug, data.seasons],
  );

  const allSeasonNames = useMemo(
    () => data.seasons.map((s) => s.season),
    [data.seasons],
  );

  const [selectedSeasons, setSelectedSeasons] = useState<string[]>(() =>
    fullCoverageSeasonNames.length > 0
      ? fullCoverageSeasonNames
      : allSeasonNames,
  );

  // Reset season selection cleanly whenever switching tripleS <-> ARTMS
  useEffect(() => {
    setSelectedSeasons(
      fullCoverageSeasonNames.length > 0
        ? fullCoverageSeasonNames
        : allSeasonNames,
    );
  }, [artistSlug, fullCoverageSeasonNames, allSeasonNames]);

  const [config, setConfig] = useState<EarningsModelConfig>(() => ({
    ...DEFAULT_EARNINGS_CONFIG,
    rates: { ...DEFAULT_EARNINGS_RATES },
  }));
  const [currency, setCurrency] = useState<"usd" | "krw">("usd");
  const [chartMode, setChartMode] = useState<"member" | "gross" | "annualized">(
    "member",
  );
  const [sortBy, setSortBy] = useState<
    "earnings" | "gross" | "fco" | "dco" | "mco" | "pass" | "order"
  >("earnings");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [copied, setCopied] = useState(false);

  const analysis = useMemo(
    () =>
      computeMemberEarnings({
        artistId: artistSlug,
        members: data.members,
        seasons: data.seasons,
        rows: data.rows,
        selectedSeasons,
        config,
      }),
    [artistSlug, data.members, data.seasons, data.rows, selectedSeasons, config],
  );

  const canAnnualize = analysis.members.some(
    (m) => m.annualizedMemberEarningsUsd !== null,
  );

  // If user switches to a partial season where annualization is disabled, fall back to member mode
  const effectiveChartMode =
    chartMode === "annualized" && !canAnnualize ? "member" : chartMode;

  const sortedMembers = useMemo(() => {
    const list = [...analysis.members];
    switch (sortBy) {
      case "order":
        return list.sort((a, b) => a.member.memberOrder - b.member.memberOrder);
      case "gross":
        return list.sort(
          (a, b) =>
            b.totalGrossUsd - a.totalGrossUsd ||
            a.member.memberOrder - b.member.memberOrder,
        );
      case "fco":
        return list.sort(
          (a, b) =>
            b.paidFcoMints - a.paidFcoMints ||
            a.member.memberOrder - b.member.memberOrder,
        );
      case "dco":
        return list.sort(
          (a, b) =>
            b.paidDcoMints - a.paidDcoMints ||
            a.member.memberOrder - b.member.memberOrder,
        );
      case "mco":
        return list.sort(
          (a, b) =>
            b.paidMcoMints - a.paidMcoMints ||
            a.member.memberOrder - b.member.memberOrder,
        );
      case "pass":
        return list.sort(
          (a, b) =>
            b.passPlusMints - a.passPlusMints ||
            a.member.memberOrder - b.member.memberOrder,
        );
      default:
        return list.sort(
          (a, b) =>
            b.memberEarningsUsd - a.memberEarningsUsd ||
            a.member.memberOrder - b.member.memberOrder,
        );
    }
  }, [analysis.members, sortBy]);

  const maxBarValue = useMemo(() => {
    const vals = analysis.members.map((m) =>
      effectiveChartMode === "gross"
        ? m.totalGrossUsd
        : effectiveChartMode === "annualized"
          ? (m.annualizedMemberEarningsUsd ?? m.memberEarningsUsd)
          : m.memberEarningsUsd,
    );
    return Math.max(1, ...vals);
  }, [analysis.members, effectiveChartMode]);

  const topEarner = analysis.members[0] ?? null;

  // Revenue waterfall percentages of $1.00 gross fan spend
  const feeShareOfGrossPct = analysis.totals.effectiveFeePct;
  const netShareOfGrossPct = Math.max(0, 100 - feeShareOfGrossPct);
  const memberShareOfGrossPct =
    Math.round(netShareOfGrossPct * (config.memberSplitPct / 100) * 10) / 10;
  const modhausShareOfGrossPct =
    Math.round((netShareOfGrossPct - memberShareOfGrossPct) * 10) / 10;

  const isFullCoveragePresetSelected =
    fullCoverageSeasonNames.length > 0 &&
    selectedSeasons.length === fullCoverageSeasonNames.length &&
    fullCoverageSeasonNames.every((s) => selectedSeasons.includes(s));

  const isAllSeasonsSelected =
    allSeasonNames.length > 0 &&
    selectedSeasons.length === allSeasonNames.length;

  const toggleSeason = (season: string) => {
    setSelectedSeasons((prev) => {
      if (prev.includes(season)) {
        if (prev.length === 1) return prev; // Keep at least 1 season active
        return prev.filter((s) => s !== season);
      }
      return [...prev, season];
    });
  };

  const applySplitPreset = (
    presetId: Exclude<EarningsSplitPresetId, "custom">,
    pct: number,
  ) => {
    setConfig((prev) => ({
      ...prev,
      preset: presetId,
      memberSplitPct: pct,
    }));
  };

  const resetDefaults = () => {
    setConfig({
      ...DEFAULT_EARNINGS_CONFIG,
      rates: { ...DEFAULT_EARNINGS_RATES },
    });
    setSelectedSeasons(
      fullCoverageSeasonNames.length > 0
        ? fullCoverageSeasonNames
        : allSeasonNames,
    );
  };

  const fmt = (usd: number, compact = false) =>
    formatMoney(usd, currency, config.krwPerUsd, compact);

  const copySummary = async () => {
    const scopeLabel = selectedSeasons.join(" + ");
    const spanText = analysis.spanDays ? ` (${analysis.spanDays}d window)` : "";
    const topLines = analysis.members.slice(0, 10).map((m) => {
      const val = fmt(m.memberEarningsUsd);
      const gross = fmt(m.totalGrossUsd);
      return `#${m.rank} ${m.member.code} ${m.member.name} — ${val} est. (${gross} gross | ${m.shareOfGroupPct.toFixed(1)}%)`;
    });
    const text = [
      `${artistName} Estimated Objekt Member Earnings (${scopeLabel}${spanText})`,
      `Assumptions: ${config.memberSplitPct}% member / ${100 - config.memberSplitPct}% Modhaus of net · ${config.webShopSharePct}% Web Shop (${feeShareOfGrossPct.toFixed(1)}% eff. fees)${config.deductSpinMints ? " · Spin FCOs deducted" : ""}`,
      `Group Gross: ${fmt(analysis.totals.totalGrossUsd)} · Total Member Est.: ${fmt(analysis.totals.totalMemberEarningsUsd)} (Median: ${fmt(analysis.totals.medianMemberEarningsUsd)})`,
      "",
      ...topLines,
      "",
      `Interactive calculator: https://objektstats.com/earnings${isArtms ? "?artist=artms" : ""}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  const exportCsv = () => {
    const header = [
      "rank",
      "code",
      "member",
      "full_name",
      "raw_fco_mints",
      "est_spin_fco_deducted",
      "paid_fco_mints",
      "paid_dco_mints",
      "paid_mco_mints",
      "pass_plus_mints",
      "physical_mints",
      "free_excluded_mints",
      "est_gross_usd",
      "platform_fees_usd",
      "net_revenue_usd",
      "member_earnings_usd",
      "member_earnings_low_usd",
      "member_earnings_high_usd",
      "modhaus_earnings_usd",
      "member_earnings_krw",
      "share_of_group_pct",
      "relative_to_avg",
    ];
    const csvRows = [
      header.join(","),
      ...sortedMembers.map((m) =>
        [
          m.rank,
          m.member.code,
          `"${m.member.name.replace(/"/g, '""')}"`,
          `"${m.member.fullName.replace(/"/g, '""')}"`,
          m.rawFcoMints,
          m.estSpinFcoMints,
          m.paidFcoMints,
          m.paidDcoMints,
          m.paidMcoMints,
          m.passPlusMints,
          m.physicalMints,
          m.freeExcludedMints,
          m.totalGrossUsd.toFixed(2),
          m.platformFeesUsd.toFixed(2),
          m.netRevenueUsd.toFixed(2),
          m.memberEarningsUsd.toFixed(2),
          m.memberEarningsLowUsd.toFixed(2),
          m.memberEarningsHighUsd.toFixed(2),
          m.modhausEarningsUsd.toFixed(2),
          Math.round(m.memberEarningsUsd * config.krwPerUsd),
          m.shareOfGroupPct.toFixed(2),
          m.relativeToAvg.toFixed(2),
        ].join(","),
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artistSlug}-member-objekt-earnings-${config.memberSplitPct}pct.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-2.5">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 text-xs font-mono text-zinc-300">
              <CircleDollarSign className="h-3.5 w-3.5 text-emerald-400" />
              <span>{artistName} Revenue &amp; Settlement Model</span>
              <span className="text-zinc-600">•</span>
              <span className="text-emerald-400">
                {selectedSeasons.join(" + ")}
              </span>
              {analysis.spanDays && (
                <>
                  <span className="text-zinc-600">•</span>
                  <span className="text-zinc-400">
                    {analysis.spanDays}d window
                  </span>
                </>
              )}
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName} Member Objekt Earnings Estimator
            </h1>

            <p className="text-sm leading-relaxed text-zinc-400">
              Estimates individual member revenue and take-home payouts from
              on-chain COSMO sales — automatically excluding free rewards
              (Welcome, Grid SCO, Spin PCO, promotional gifts) and deducting
              free <strong className="text-zinc-200">COSMO Spin</strong>{" "}
              replacement FCOs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setCurrency("usd")}
                className={`rounded-md px-2.5 py-1.5 font-mono font-semibold transition ${
                  currency === "usd"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                USD ($)
              </button>
              <button
                type="button"
                onClick={() => setCurrency("krw")}
                className={`rounded-md px-2.5 py-1.5 font-mono font-semibold transition ${
                  currency === "krw"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                KRW (₩)
              </button>
            </div>

            <button
              type="button"
              onClick={copySummary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy Recap
                </>
              )}
            </button>

            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
        </div>
      </section>

      {/* Transparent Disclosure Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3.5 text-xs leading-relaxed text-amber-200/90">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-200">
            Contractual Modhaus vs. Member Split Is Not Publicly Disclosed
          </p>
          <p className="text-amber-200/80">
            Modhaus has confirmed that Objekt revenue is settled directly to
            members without waiting to clear traditional trainee/debut debt, but
            has never published the exact percentage split. All numbers below
            are <strong className="text-white">transparent estimates</strong> —
            drag the Member Cut slider or enter a sourced rate to recalculate
            every girl&apos;s payout instantly.
          </p>
        </div>
      </div>

      {/* Interactive Split, Channel Mix & Season Scope Panel */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Settlement Split &amp; Revenue Assumptions
            </h2>
            <p className="text-xs text-zinc-400">
              Platform fees are deducted from gross fan spend first; remaining
              net revenue is split between Modhaus and the pictured member.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-white"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Unit Prices &amp; Fees
              {showAdvanced ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={resetDefaults}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-white"
              title="Reset assumptions to defaults"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
        </div>

        {/* Sliders Row */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Member Split Control */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="member-split-slider"
                className="text-xs font-semibold text-zinc-200"
              >
                Member Cut of Net Revenue
              </label>
              <span className="font-mono text-sm font-bold text-emerald-300 tabular-nums">
                {config.memberSplitPct}% Member / {100 - config.memberSplitPct}%
                Modhaus
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {EARNINGS_SPLIT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applySplitPreset(p.id, p.memberSplitPct)}
                  title={p.description}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    config.memberSplitPct === p.memberSplitPct
                      ? "bg-emerald-400 text-zinc-950 font-semibold"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>

            <div className="space-y-1">
              <input
                id="member-split-slider"
                type="range"
                min={5}
                max={80}
                step={1}
                value={config.memberSplitPct}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    preset: "custom",
                    memberSplitPct: Number(e.target.value),
                  }))
                }
                className="w-full accent-emerald-400 cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10px] text-zinc-500">
                <span>5%</span>
                <span>20%</span>
                <span>30%</span>
                <span>50%</span>
                <span>80%</span>
              </div>
            </div>
          </div>

          {/* Web Shop vs App Store Mix Control */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="web-shop-slider"
                className="text-xs font-semibold text-zinc-200"
              >
                Web Shop vs. Mobile App Store Mix
              </label>
              <span className="font-mono text-sm font-bold text-sky-300 tabular-nums">
                {config.webShopSharePct}% Web / {100 - config.webShopSharePct}%
                App
              </span>
            </div>

            <p className="text-[11px] text-zinc-400">
              <code className="text-zinc-300">shop.cosmo.fans</code> (~
              {config.webPaymentFeePct}% PG fee) avoids the{" "}
              {config.appStoreFeePct}% Apple/Google IAP cut. Pre-Sep 2024
              seasons automatically apply {config.appStoreFeePct}% App Store
              fees.
            </p>

            <div className="space-y-1">
              <input
                id="web-shop-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={config.webShopSharePct}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    webShopSharePct: Number(e.target.value),
                  }))
                }
                className="w-full accent-sky-400 cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10px] text-zinc-500">
                <span>0% Web (30% fee)</span>
                <span>50/50 (~17% fee)</span>
                <span>100% Web ({config.webPaymentFeePct}% fee)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live $1.00 Fan Spend Waterfall Bar */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-zinc-200">
              Effective Revenue Waterfall per $1.00 of Fan Spend
            </span>
            <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] tabular-nums">
              <span className="inline-flex items-center gap-1.5 text-rose-300">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                Store/PG Fees: {feeShareOfGrossPct.toFixed(1)}%
              </span>
              <span className="inline-flex items-center gap-1.5 text-zinc-300">
                <span className="h-2 w-2 rounded-full bg-zinc-500" />
                Modhaus: {modhausShareOfGrossPct.toFixed(1)}%
              </span>
              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Member: {memberShareOfGrossPct.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-900">
            <div
              className="h-full bg-rose-500/80 transition-all"
              style={{ width: `${Math.max(0, feeShareOfGrossPct)}%` }}
              title={`Store & Payment Fees: ${feeShareOfGrossPct.toFixed(1)}% of gross`}
            />
            <div
              className="h-full bg-zinc-600 transition-all"
              style={{ width: `${Math.max(0, modhausShareOfGrossPct)}%` }}
              title={`Modhaus Share: ${modhausShareOfGrossPct.toFixed(1)}% of gross`}
            />
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${Math.max(0, memberShareOfGrossPct)}%` }}
              title={`Member Share: ${memberShareOfGrossPct.toFixed(1)}% of gross`}
            />
          </div>
        </div>

        {/* Season Scope & Inclusion Toggles */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-200">
              Seasons Included ({selectedSeasons.length}/{data.seasons.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {fullCoverageSeasonNames.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedSeasons(fullCoverageSeasonNames)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                    isFullCoveragePresetSelected
                      ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                      : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  100% Indexed Seasons ({fullCoverageSeasonNames.join(" + ")})
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedSeasons(allSeasonNames)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  isAllSeasonsSelected
                    ? "bg-white text-zinc-950 font-semibold"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All Indexed Seasons
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {analysis.seasons.map((s) => {
              const active = selectedSeasons.includes(s.season);
              const isFull = s.coverage === "full";
              return (
                <button
                  key={s.season}
                  type="button"
                  onClick={() => toggleSeason(s.season)}
                  title={`${s.season} (${s.dateLabel}) · ${s.coverageLabel} · Est. gross ${fmt(s.totalGrossUsd)}`}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono transition ${
                    active
                      ? isFull
                        ? "border-emerald-500/50 bg-emerald-500/15 text-white"
                        : "border-amber-500/50 bg-amber-500/15 text-amber-100"
                      : "border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  <span className="font-semibold">{s.season}</span>
                  <span
                    className={`rounded px-1 py-0.2 text-[9px] uppercase ${
                      isFull
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-amber-500/20 text-amber-300"
                    }`}
                  >
                    {isFull ? "100%" : "Partial"}
                  </span>
                </button>
              );
            })}
          </div>

          {analysis.hasPartialCoverageSeason && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-[11px] text-amber-200/85">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>
                Your selection includes pre-Nov 2025 Polygon or partial-Abstract
                seasons where our on-chain index holds only a partial subset of
                mints. Use{" "}
                <strong className="text-white">100% Indexed Seasons</strong> for
                complete trailing-year revenue figures.
              </span>
            </div>
          )}

          {/* Feature Toggles */}
          <div className="flex flex-wrap gap-2 pt-1">
            <TogglePill
              checked={config.deductSpinMints}
              onChange={(v) =>
                setConfig((prev) => ({ ...prev, deductSpinMints: v }))
              }
              label="Deduct Free COSMO Spin FCOs"
              sublabel={
                config.deductSpinMints
                  ? `−${analysis.totals.estSpinFcoMints.toLocaleString()} spin FCOs`
                  : "Off (raw FCOs)"
              }
            />
            <TogglePill
              checked={config.includePassPlus}
              onChange={(v) =>
                setConfig((prev) => ({ ...prev, includePassPlus: v }))
              }
              label="Include COSMO Talk Pass+"
              sublabel={
                analysis.totals.passPlusMints > 0
                  ? `${analysis.totals.passPlusMints.toLocaleString()} member-mo`
                  : "None in scope"
              }
            />
            <TogglePill
              checked={config.includePhysicalScans}
              onChange={(v) =>
                setConfig((prev) => ({ ...prev, includePhysicalScans: v }))
              }
              label="Include Physical QR Scans (A)"
              sublabel={
                analysis.totals.physicalMints > 0
                  ? `${analysis.totals.physicalMints.toLocaleString()} scans @ $${config.rates.physicalNetUsd.toFixed(2)}`
                  : "None in scope"
              }
            />
          </div>
        </div>

        {/* Collapsible Advanced Unit Prices & Fees Editor */}
        {showAdvanced && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-3">
            <p className="text-xs font-semibold text-zinc-200">
              Custom Unit Pricing &amp; Processing Fees
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <NumberField
                label="Blended FCO ($)"
                value={config.rates.fcoUsd}
                step={0.05}
                onChange={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    rates: { ...prev.rates, fcoUsd: v },
                  }))
                }
              />
              <NumberField
                label="Paid DCO ($)"
                value={config.rates.dcoUsd}
                step={0.05}
                onChange={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    rates: { ...prev.rates, dcoUsd: v },
                  }))
                }
              />
              <NumberField
                label="Motion MCO ($)"
                value={config.rates.mcoUsd}
                step={0.05}
                onChange={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    rates: { ...prev.rates, mcoUsd: v },
                  }))
                }
              />
              <NumberField
                label="Pass+ / mo ($)"
                value={config.rates.passPlusUsd}
                step={0.05}
                onChange={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    rates: { ...prev.rates, passPlusUsd: v },
                  }))
                }
              />
              <NumberField
                label="Physical Net ($)"
                value={config.rates.physicalNetUsd}
                step={0.1}
                onChange={(v) =>
                  setConfig((prev) => ({
                    ...prev,
                    rates: { ...prev.rates, physicalNetUsd: v },
                  }))
                }
              />
              <NumberField
                label="App Store Fee (%)"
                value={config.appStoreFeePct}
                step={1}
                onChange={(v) =>
                  setConfig((prev) => ({ ...prev, appStoreFeePct: v }))
                }
              />
              <NumberField
                label="Web PG Fee (%)"
                value={config.webPaymentFeePct}
                step={0.5}
                onChange={(v) =>
                  setConfig((prev) => ({ ...prev, webPaymentFeePct: v }))
                }
              />
              <NumberField
                label="KRW per $1 USD"
                value={config.krwPerUsd}
                step={10}
                onChange={(v) =>
                  setConfig((prev) => ({ ...prev, krwPerUsd: Math.max(100, v) }))
                }
              />
            </div>
          </div>
        )}
      </section>

      {/* 4 KPI Summary Cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Est. Fan Gross Spend"
          value={fmt(analysis.totals.totalGrossUsd, true)}
          subtext={`Band: ${fmt(analysis.totals.lowGrossUsd, true)} – ${fmt(analysis.totals.highGrossUsd, true)}`}
          detail={`${analysis.totals.totalPaidObjekts.toLocaleString()} est. paid mints`}
        />
        <KpiCard
          label="Store & Payment Fees"
          value={fmt(analysis.totals.platformFeesUsd, true)}
          subtext={`${analysis.totals.effectiveFeePct.toFixed(1)}% effective cut of gross`}
          detail={`Net pool: ${fmt(analysis.totals.netRevenueUsd, true)}`}
          tone="rose"
        />
        <KpiCard
          label={`Est. Modhaus Share (${100 - config.memberSplitPct}%)`}
          value={fmt(analysis.totals.totalModhausEarningsUsd, true)}
          subtext={`${modhausShareOfGrossPct.toFixed(1)}% of gross fan spend`}
          detail="Funds ops, COSMO dev & comebacks"
        />
        <KpiCard
          label={`Est. Paid to Members (${config.memberSplitPct}%)`}
          value={fmt(analysis.totals.totalMemberEarningsUsd, true)}
          subtext={`Median: ${fmt(analysis.totals.medianMemberEarningsUsd)} / girl`}
          detail={
            topEarner
              ? `#1 ${topEarner.member.name}: ${fmt(topEarner.memberEarningsUsd)}`
              : ""
          }
          tone="emerald"
        />
      </section>

      {/* Visual Member Earnings Leaderboard Bar Chart */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              {artistName} Member Earnings Leaderboard
            </h2>
            <p className="text-xs text-zinc-400">
              {effectiveChartMode === "member"
                ? `Estimated individual payout at ${config.memberSplitPct}% of post-fee net revenue (${selectedSeasons.join(" + ")}).`
                : effectiveChartMode === "annualized"
                  ? `12-month annualized member payout rate projected from the ${analysis.spanDays}-day 100%-indexed window.`
                  : `Estimated gross primary fan spend per member before App Store/PG fees and Modhaus split.`}
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setChartMode("member")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                effectiveChartMode === "member"
                  ? "bg-white text-zinc-950"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Member Payout
            </button>
            <button
              type="button"
              onClick={() => setChartMode("gross")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                effectiveChartMode === "gross"
                  ? "bg-white text-zinc-950"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Gross Sales
            </button>
            {canAnnualize && (
              <button
                type="button"
                onClick={() => setChartMode("annualized")}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  effectiveChartMode === "annualized"
                    ? "bg-white text-zinc-950"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Annualized / Yr
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {analysis.members.map((row) => {
            const activeUsd =
              effectiveChartMode === "gross"
                ? row.totalGrossUsd
                : effectiveChartMode === "annualized"
                  ? (row.annualizedMemberEarningsUsd ?? row.memberEarningsUsd)
                  : row.memberEarningsUsd;
            const widthPct = Math.max(3, (activeUsd / maxBarValue) * 100);
            const lowVal =
              effectiveChartMode === "gross"
                ? row.lowGrossUsd
                : effectiveChartMode === "annualized" && analysis.spanDays
                  ? (row.memberEarningsLowUsd / analysis.spanDays) * 365
                  : row.memberEarningsLowUsd;
            const highVal =
              effectiveChartMode === "gross"
                ? row.highGrossUsd
                : effectiveChartMode === "annualized" && analysis.spanDays
                  ? (row.memberEarningsHighUsd / analysis.spanDays) * 365
                  : row.memberEarningsHighUsd;

            return (
              <Link
                key={row.member.id}
                to="/members/$memberId"
                params={{ memberId: row.member.id }}
                className="group block rounded-xl border border-transparent p-2 transition hover:border-zinc-800 hover:bg-zinc-950/70"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 font-mono font-bold text-zinc-400">
                      #{row.rank}
                    </span>
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: row.member.hexColor }}
                    />
                    <span className="font-semibold text-white group-hover:text-sky-300">
                      {row.member.name}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-500">
                      {row.member.code}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    <span className="hidden md:inline text-[11px] text-zinc-500">
                      {fmt(lowVal)} – {fmt(highVal)}
                    </span>
                    <span className="font-bold text-emerald-300 text-sm">
                      {fmt(activeUsd)}
                    </span>
                    <span className="w-11 text-right text-zinc-400">
                      {row.shareOfGroupPct.toFixed(1)}%
                    </span>
                    <span
                      className={`w-11 text-right font-semibold ${
                        row.relativeToAvg >= 1.15
                          ? "text-emerald-300"
                          : row.relativeToAvg <= 0.85
                            ? "text-rose-300"
                            : "text-zinc-300"
                      }`}
                    >
                      {row.relativeToAvg.toFixed(2)}×
                    </span>
                  </div>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-950">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: row.member.hexColor,
                    }}
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Detailed Sortable Member Breakdown Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-400" />
              Per-Member Revenue Breakdown
            </h2>
            <p className="text-xs text-zinc-400">
              Shows paid primary mints by class alongside estimated gross spend,
              member take-home range, and revenue mix (
              <span className="text-sky-300">FCO</span> /{" "}
              <span className="text-violet-300">DCO</span> /{" "}
              <span className="text-amber-300">MCO</span> /{" "}
              <span className="text-emerald-300">Pass+</span>).
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["earnings", "Sort: Earnings"],
                ["gross", "Sort: Gross"],
                ["fco", "Sort: Paid FCO"],
                ["dco", "Sort: Paid DCO"],
                ["mco", "Sort: Motion"],
                ["pass", "Sort: Pass+"],
                ["order", "Sort: Debut Order"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  sortBy === key
                    ? "bg-white text-zinc-950"
                    : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3 text-right">Est. Member Payout</th>
                <th className="px-4 py-3 text-right">Est. Gross</th>
                <th className="px-4 py-3 text-right">
                  {config.deductSpinMints ? "Paid FCO" : "Raw FCO"}
                </th>
                <th className="px-4 py-3 text-right">Paid DCO</th>
                <th className="px-4 py-3 text-right">MCO</th>
                {config.includePassPlus && (
                  <th className="px-4 py-3 text-right">Pass+</th>
                )}
                <th className="px-4 py-3">Revenue Mix</th>
                <th className="px-4 py-3 text-right">Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {sortedMembers.map((m) => {
                const denom = Math.max(1, m.totalGrossUsd);
                const fcoPct = (m.fcoGrossUsd / denom) * 100;
                const dcoPct = ((m.dcoGrossUsd + m.unitGrossUsd) / denom) * 100;
                const mcoPct = (m.mcoGrossUsd / denom) * 100;
                const passPct = (m.passPlusGrossUsd / denom) * 100;
                const physPct = (m.physicalGrossUsd / denom) * 100;

                return (
                  <tr key={m.member.id} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-zinc-400">
                      #{m.rank}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: m.member.id }}
                        className="flex items-center gap-2 font-semibold text-white hover:text-sky-300"
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: m.member.hexColor }}
                        />
                        <span>{m.member.name}</span>
                        <span className="font-mono text-[10px] font-normal text-zinc-500">
                          {m.member.code}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      <div className="font-bold text-emerald-300">
                        {fmt(m.memberEarningsUsd)}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {fmt(m.memberEarningsLowUsd)} –{" "}
                        {fmt(m.memberEarningsHighUsd)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-200 tabular-nums">
                      {fmt(m.totalGrossUsd)}
                    </td>
                    <td
                      className="px-4 py-3 text-right font-mono text-xs text-zinc-200 tabular-nums"
                      title={
                        config.deductSpinMints
                          ? `${m.rawFcoMints.toLocaleString()} raw FCO − ${m.estSpinFcoMints.toLocaleString()} est. free spin FCOs`
                          : undefined
                      }
                    >
                      <div>{m.paidFcoMints.toLocaleString()}</div>
                      {config.deductSpinMints && m.estSpinFcoMints > 0 && (
                        <div className="text-[10px] text-zinc-500">
                          −{Math.round(m.estSpinFcoMints / 1000)}k spin
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                      {m.paidDcoMints.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                      {m.paidMcoMints.toLocaleString()}
                    </td>
                    {config.includePassPlus && (
                      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-300 tabular-nums">
                        {m.passPlusMints.toLocaleString()}
                      </td>
                    )}
                    <td className="px-4 py-3 min-w-[110px]">
                      <div
                        className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-950"
                        title={`FCO ${fcoPct.toFixed(0)}% · DCO ${dcoPct.toFixed(0)}% · MCO ${mcoPct.toFixed(0)}%${passPct > 0 ? ` · Pass+ ${passPct.toFixed(0)}%` : ""}${physPct > 0 ? ` · Physical ${physPct.toFixed(0)}%` : ""}`}
                      >
                        <div
                          className="h-full bg-sky-400"
                          style={{ width: `${fcoPct}%` }}
                        />
                        <div
                          className="h-full bg-violet-400"
                          style={{ width: `${dcoPct}%` }}
                        />
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${mcoPct}%` }}
                        />
                        <div
                          className="h-full bg-emerald-400"
                          style={{ width: `${passPct}%` }}
                        />
                        <div
                          className="h-full bg-zinc-400"
                          style={{ width: `${physPct}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      <span className="text-zinc-200">
                        {m.shareOfGroupPct.toFixed(1)}%
                      </span>
                      <span className="ml-1.5 text-[10px] text-zinc-500">
                        {m.relativeToAvg.toFixed(2)}×
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Public Benchmarks & Forensic Exclusions Context */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3.5">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-sky-400" />
            Publicly Sourced Financial Context
          </h2>
          <div className="space-y-3 text-xs leading-relaxed text-zinc-400">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-1">
              <p className="font-semibold text-zinc-200">
                Kim YooYeon&apos;s Early Settlement Benchmark (
                {MODHAUS_PUBLIC_BENCHMARKS.yooyeonDisclosure.date})
              </p>
              <p>{MODHAUS_PUBLIC_BENCHMARKS.yooyeonDisclosure.summary}</p>
              <p className="font-mono text-[10px] text-zinc-500">
                Source: {MODHAUS_PUBLIC_BENCHMARKS.yooyeonDisclosure.source}
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
              <p className="font-semibold text-zinc-200">
                Modhaus Audited Total Company Revenue (DART Filings)
              </p>
              <div className="grid grid-cols-4 gap-2 font-mono text-[11px]">
                {MODHAUS_PUBLIC_BENCHMARKS.auditedRevenueKrw.map((yr) => (
                  <div
                    key={yr.year}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2 text-center"
                  >
                    <div className="text-zinc-500">{yr.year}</div>
                    <div className="font-bold text-white">
                      ₩{yr.krwBillions}B
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      ~${yr.approxUsdMillions}M
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">
                Covers all Modhaus operations (tripleS, ARTMS, idntt — digital
                Objekts, physical albums, world tours, merch, and brand deals).
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 space-y-3.5">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Why Raw Mints Overstate Revenue (Exclusions Applied)
          </h2>
          <ul className="space-y-2.5 text-xs leading-relaxed text-zinc-400">
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between font-mono text-zinc-200 mb-0.5">
                <span className="font-sans font-semibold">
                  COSMO Spin Replacement FCOs
                </span>
                <span className="text-amber-300">
                  −{analysis.totals.estSpinFcoMints.toLocaleString()} cards
                </span>
              </div>
              Every Objekt sent to the COSMO Spin contract mints a free
              same-season FCO replacement at published odds (90.63% in
              Binary02+/Ever01+; 87.50% in earlier seasons). Subtracting these
              uniform draws prevents ~45–55% double-counting.
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between font-mono text-zinc-200 mb-0.5">
                <span className="font-sans font-semibold">
                  Free Native &amp; Promotional Rewards
                </span>
                <span className="text-sky-300">
                  −{analysis.totals.freeExcludedMints.toLocaleString()} cards
                </span>
              </div>
              Excludes Welcome (<code className="text-zinc-300">100Z</code>),
              online Grid SCOs (<code className="text-zinc-300">2xxZ</code>),
              Spin-jackpot PCOs (<code className="text-zinc-300">4xxZ</code>),
              Zero class, and Apollo-verified voting/event/completion bonus
              drops at $0.00.
            </li>
            <li className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-center justify-between font-mono text-zinc-200 mb-0.5">
                <span className="font-sans font-semibold">
                  What This Does Not Include
                </span>
                <Link
                  to="/methodology"
                  className="text-sky-400 hover:underline font-sans"
                >
                  Full Methodology →
                </Link>
              </div>
              Excludes physical album royalties (unless toggled), concerts/world
              tours, streaming, brand deals/CFs, Fromm/chat-only Pass tiers, and
              any internal random-pack pooling rules Modhaus uses privately.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtext,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  subtext: string;
  detail: string;
  tone?: "default" | "emerald" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/35 bg-emerald-500/10"
      : tone === "rose"
        ? "border-rose-500/25 bg-rose-500/5"
        : "border-zinc-800/80 bg-zinc-900/40";
  const valueClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "rose"
        ? "text-rose-300"
        : "text-white";
  return (
    <div className={`rounded-xl border p-4 space-y-1.5 ${toneClass}`}>
      <div className="text-xs font-medium text-zinc-400">{label}</div>
      <div
        className={`font-mono text-2xl font-bold tracking-tight tabular-nums ${valueClass}`}
      >
        {value}
      </div>
      <div className="font-mono text-[11px] text-zinc-300 tabular-nums">
        {subtext}
      </div>
      {detail && (
        <div className="font-mono text-[10px] text-zinc-500 truncate">
          {detail}
        </div>
      )}
    </div>
  );
}

function TogglePill({
  checked,
  onChange,
  label,
  sublabel,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
        checked
          ? "border-sky-500/40 bg-sky-500/10 text-white"
          : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          checked ? "bg-sky-400" : "bg-zinc-600"
        }`}
      />
      <span className="font-medium">{label}</span>
      <span className="font-mono text-[10px] text-zinc-400">{sublabel}</span>
    </button>
  );
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (val: number) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] text-zinc-400">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed) && parsed >= 0) onChange(parsed);
        }}
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-zinc-600 focus:outline-none"
      />
    </label>
  );
}
