import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Flame,
  Gem,
  Info,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  apolloCollectionUrl,
  COSMO_SPIN_PUBLISHED_ODDS,
  type SpinRarityTierId,
} from "@objekt-stats/stats";
import { getSpinAnalytics, type ArtistSlug } from "../lib/server/queries";

export const Route = createFileRoute("/spins")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { artist?: ArtistSlug; season?: string } => ({
    artist: search.artist === "artms" ? "artms" : undefined,
    season:
      typeof search.season === "string" && search.season.trim()
        ? search.season.trim()
        : undefined,
  }),
  loaderDeps: ({ search }) => ({
    artist: search.artist ?? "triples",
    season: search.season ?? "all",
  }),
  loader: ({ deps }) => getSpinAnalytics({ data: deps }),
  head: ({ loaderData }) => {
    const artistName = loaderData?.artist?.name ?? "tripleS";
    const totalSpins = loaderData?.analytics.totals.totalSpins ?? 0;
    const title = `${artistName} COSMO Spin Stats — Objekt Stats`;
    const desc = `Explore ${totalSpins.toLocaleString()} ${artistName} Objekts sent to COSMO Spin: member burn rates, blank vs. rare pull outcomes, supply rarity tiers, and the rarest cards ever sacrificed.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  component: SpinsPage,
});

const TIER_BADGE_CLASS: Record<SpinRarityTierId, string> = {
  ultra_rare: "border-rose-500/40 bg-rose-500/15 text-rose-300",
  very_rare: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  rare: "border-purple-500/40 bg-purple-500/15 text-purple-300",
  uncommon: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  common: "border-zinc-700 bg-zinc-900 text-zinc-300",
};

function SpinsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const [memberSort, setMemberSort] = useState<
    "rate_desc" | "rate_asc" | "total_desc" | "rare_desc"
  >("rate_desc");
  const [galleryTab, setGalleryTab] = useState<
    "rarest" | "premier_motion" | "highest_value"
  >("rarest");

  const isArtms = search.artist === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const accent = data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF");
  const { analytics, availableSeasons, seasonFilter, notableSpins } = data;
  const { totals, pairedSummary } = analytics;

  const sortedMembers = useMemo(() => {
    const copy = [...analytics.members];
    if (memberSort === "rate_asc") {
      return copy.sort(
        (a, b) => a.spinRatePct - b.spinRatePct || a.spunCount - b.spunCount,
      );
    }
    if (memberSort === "total_desc") {
      return copy.sort(
        (a, b) => b.spunCount - a.spunCount || b.spinRatePct - a.spinRatePct,
      );
    }
    if (memberSort === "rare_desc") {
      return copy.sort(
        (a, b) =>
          b.rareSupplySpun - a.rareSupplySpun ||
          b.premierMotionScoSpun - a.premierMotionScoSpun ||
          b.spunCount - a.spunCount,
      );
    }
    return copy.sort(
      (a, b) => b.spinRatePct - a.spinRatePct || b.spunCount - a.spunCount,
    );
  }, [analytics.members, memberSort]);

  const maxMemberBarVal = useMemo(() => {
    if (sortedMembers.length === 0) return 1;
    if (memberSort === "total_desc") {
      return Math.max(1, ...sortedMembers.map((m) => m.spunCount));
    }
    if (memberSort === "rare_desc") {
      return Math.max(1, ...sortedMembers.map((m) => m.rareSupplySpun));
    }
    return Math.max(50, ...sortedMembers.map((m) => m.spinRatePct));
  }, [sortedMembers, memberSort]);

  const avgMemberRate = useMemo(() => {
    if (analytics.members.length === 0) return 0;
    return (
      analytics.members.reduce((s, m) => s + m.spinRatePct, 0) /
      analytics.members.length
    );
  }, [analytics.members]);

  const hasPairedMemberData = analytics.members.some(
    (m) => m.pairedSentCount > 0 || m.pairedPulledCount > 0,
  );

  const galleryCards =
    galleryTab === "premier_motion"
      ? analytics.premierMotionSpunCards
      : galleryTab === "highest_value"
        ? analytics.highestValueSpunCards
        : analytics.rarestSpunCards;

  const handleSeasonChange = (nextSeason: string) => {
    void navigate({
      to: "/spins",
      search: {
        artist: isArtms ? "artms" : undefined,
        season: nextSeason === "all" ? undefined : nextSeason,
      },
    });
  };

  const pairedBlankPct =
    pairedSummary && pairedSummary.totalPairedSpins > 0
      ? (pairedSummary.blankCount / pairedSummary.totalPairedSpins) * 100
      : null;
  const pairedFcoPct =
    pairedSummary && pairedSummary.totalPairedSpins > 0
      ? (pairedSummary.fcoCount / pairedSummary.totalPairedSpins) * 100
      : null;
  const pairedRareCount = pairedSummary
    ? pairedSummary.scoCount + pairedSummary.premierCount
    : 0;
  const pairedRarePct =
    pairedSummary && pairedSummary.totalPairedSpins > 0
      ? (pairedRareCount / pairedSummary.totalPairedSpins) * 100
      : null;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900/90 via-zinc-950 to-zinc-950 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-15 blur-3xl"
          style={{ backgroundColor: accent }}
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-2.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1 font-mono text-xs text-zinc-300">
              <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
              <span>COSMO Spin On-Chain Analytics</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400">Polygon + Abstract</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName} Spin Analytics &amp; Burn Rates
            </h1>
            <p className="text-sm leading-relaxed text-zinc-300">
              Every Objekt sent to the{" "}
              <span className="font-mono text-zinc-200">COSMO Spin</span>{" "}
              contract is permanently burned in exchange for a random same-season
              roll — or <strong className="text-rose-300">nothing (Blank)</strong>
              . Compare which members get spun most vs. protected, track rare
              cards sacrificed, and inspect spin outcomes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300">
              <span className="font-medium text-zinc-400">Season:</span>
              <select
                value={seasonFilter}
                onChange={(e) => handleSeasonChange(e.target.value)}
                aria-label="Filter spin stats by season"
                className="bg-transparent font-mono text-sm font-semibold text-white focus:outline-none"
              >
                <option value="all" className="bg-zinc-950">
                  All Seasons ({availableSeasons.length})
                </option>
                {availableSeasons.map((s) => (
                  <option key={s} value={s} className="bg-zinc-950">
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* KPI Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Flame className="h-4 w-4 text-orange-400" />}
          label="Total Sent to Spin"
          value={totals.totalSpins.toLocaleString()}
          subtext={`${totals.overallSpinRatePct.toFixed(1)}% of ${totals.totalMints.toLocaleString()} indexed Objekts`}
        />
        <KpiCard
          icon={<XCircle className="h-4 w-4 text-rose-400" />}
          label={
            pairedSummary ? "Observed Blank Rate" : "Est. Blank (Nothing) Spins"
          }
          value={
            pairedSummary && pairedBlankPct !== null
              ? `${pairedBlankPct.toFixed(2)}%`
              : totals.estBlanks.toLocaleString()
          }
          subtext={
            pairedSummary
              ? `${pairedSummary.blankCount.toLocaleString()} blanks in ${pairedSummary.totalPairedSpins.toLocaleString()} paired spins · ~${totals.estBlanks.toLocaleString()} est. all-time`
              : `~${totals.estBlankRatePct.toFixed(2)}% fail rate (card burned, nothing minted)`
          }
          tone="rose"
        />
        <KpiCard
          icon={<Sparkles className="h-4 w-4 text-amber-400" />}
          label="Rare Jackpots (Premier 4xxZ)"
          value={
            pairedSummary
              ? `${pairedSummary.premierCount.toLocaleString()} PCO${
                  pairedSummary.scoCount > 0
                    ? ` + ${pairedSummary.scoCount} SCO`
                    : ""
                }`
              : `~${totals.estPremierPulls.toLocaleString()} est.`
          }
          subtext={
            pairedSummary
              ? `${pairedRarePct?.toFixed(2)}% rare pulls in paired sample · ${totals.premierTotalMinted.toLocaleString()} total PCO supply`
              : `0.06% PCO odds (~1 in 1,667) · ${totals.premierTotalMinted.toLocaleString()} total PCO minted`
          }
          tone="amber"
        />
        <KpiCard
          icon={<Gem className="h-4 w-4 text-purple-400" />}
          label="Rare Cards Sacrificed (<1k)"
          value={totals.rareUnder1000Spun.toLocaleString()}
          subtext={`${totals.premierSpun.toLocaleString()} Premier · ${totals.motionSpun.toLocaleString()} Motion · ${totals.specialSpun.toLocaleString()} SCO spun`}
          tone="purple"
        />
      </section>

      {/* Spin Results: Nothing vs Normal vs Rare */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Spin Results: Nothing (Blank) vs. Normal vs. Rare Pulls
            </h2>
            <p className="text-sm text-zinc-300">
              {pairedSummary
                ? `Comparing ${pairedSummary.totalPairedSpins.toLocaleString()} directly paired on-chain Abstract spins against COSMO's published season drop tables across all ${totals.totalSpins.toLocaleString()} historical spins.`
                : `Season-weighted outcome breakdown across all ${totals.totalSpins.toLocaleString()} on-chain ${artistName} spins using COSMO's published drop-rate tables.`}
            </p>
          </div>
          <span className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-xs text-zinc-300">
            Modern Pool: 90.63% FCO · 9.31% Blank · 0.06% Premier
          </span>
        </div>

        {/* Stacked Outcome Bar */}
        <div className="space-y-2">
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-950 ring-1 ring-zinc-800">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{
                width: `${pairedFcoPct ?? totals.estFcoRatePct}%`,
              }}
              title={`First Class (FCO): ${(pairedFcoPct ?? totals.estFcoRatePct).toFixed(2)}%`}
            />
            {((pairedSummary ? pairedSummary.scoCount : totals.estScoPulls) >
              0) && (
              <div
                className="h-full bg-violet-500 transition-all"
                style={{
                  width: `${
                    pairedSummary && pairedSummary.totalPairedSpins > 0
                      ? (pairedSummary.scoCount /
                          pairedSummary.totalPairedSpins) *
                        100
                      : totals.estScoRatePct
                  }%`,
                }}
                title="Special Class (SCO)"
              />
            )}
            <div
              className="h-full bg-amber-400 transition-all"
              style={{
                width: `${Math.max(
                  0.6,
                  pairedSummary && pairedSummary.totalPairedSpins > 0
                    ? (pairedSummary.premierCount /
                        pairedSummary.totalPairedSpins) *
                        100
                    : totals.estPremierRatePct,
                )}%`,
              }}
              title="Premier Class Jackpot (4xxZ)"
            />
            <div
              className="h-full bg-rose-500 transition-all"
              style={{
                width: `${pairedBlankPct ?? totals.estBlankRatePct}%`,
              }}
              title={`Blank / Nothing: ${(pairedBlankPct ?? totals.estBlankRatePct).toFixed(2)}%`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-zinc-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
              First Class FCO (
              {(pairedFcoPct ?? totals.estFcoRatePct).toFixed(2)}%)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
              Blank / Nothing (
              {(pairedBlankPct ?? totals.estBlankRatePct).toFixed(2)}%)
            </span>
            {totals.estScoPulls > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-500" />
                Special Class SCO (Legacy:{" "}
                {COSMO_SPIN_PUBLISHED_ODDS.legacy_with_sco.scoRate * 100}%)
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              Premier 4xxZ Jackpot (0.06%)
            </span>
          </div>
        </div>

        {/* 4 Outcome Breakdown Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <OutcomeCard
            title="Normal Replacement (FCO)"
            colorClass="border-sky-500/30 bg-sky-500/10"
            valueColor="text-sky-300"
            primaryValue={`~${totals.estFcoPulls.toLocaleString()}`}
            rateLabel={`${totals.estFcoRatePct.toFixed(2)}% all-time avg`}
            detail={
              pairedSummary && pairedFcoPct !== null
                ? `Observed on-chain: ${pairedSummary.fcoCount.toLocaleString()} (${pairedFcoPct.toFixed(2)}%)`
                : "Random same-season First Class Objekt (90.63% Binary02+ / 87.50% earlier)"
            }
          />
          <OutcomeCard
            title="Nothing / Blank (Whiff)"
            colorClass="border-rose-500/30 bg-rose-500/10"
            valueColor="text-rose-300"
            primaryValue={`~${totals.estBlanks.toLocaleString()}`}
            rateLabel={`${totals.estBlankRatePct.toFixed(2)}% fail rate`}
            detail={
              pairedSummary && pairedBlankPct !== null
                ? `Observed on-chain: ${pairedSummary.blankCount.toLocaleString()} (${pairedBlankPct.toFixed(2)}%)`
                : "~1 in 11 spins destroys your card with zero replacement minted"
            }
          />
          <OutcomeCard
            title="Rare Special Pull (SCO)"
            colorClass="border-violet-500/30 bg-violet-500/10"
            valueColor="text-violet-300"
            primaryValue={`~${totals.estScoPulls.toLocaleString()}`}
            rateLabel={`${totals.estScoRatePct.toFixed(2)}% weighted`}
            detail={
              pairedSummary
                ? `Observed on-chain: ${pairedSummary.scoCount.toLocaleString()} · Only in legacy seasons (3.13% odds)`
                : "3.13% (~1 in 32) in legacy seasons; removed from Spin in Binary02+ / ARTMS Ever01+"
            }
          />
          <OutcomeCard
            title="Jackpot Premier (4xxZ)"
            colorClass="border-amber-500/30 bg-amber-500/10"
            valueColor="text-amber-300"
            primaryValue={`~${totals.estPremierPulls.toLocaleString()}`}
            rateLabel="0.06% jackpot (~1 in 1,667)"
            detail={
              pairedSummary
                ? `Observed on-chain: ${pairedSummary.premierCount.toLocaleString()} · Total PCO supply: ${totals.premierTotalMinted.toLocaleString()}`
                : `${totals.premierTotalMinted.toLocaleString()} total Premier Objekts exist (Spin + FCO packs + leaderboard gifts)`
            }
          />
        </div>

        {pairedSummary ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
            <span className="inline-flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              Verified on-chain paired sample:{" "}
              <strong className="font-mono text-white">
                {pairedSummary.totalPairedSpins.toLocaleString()}
              </strong>{" "}
              spins across{" "}
              <strong className="font-mono text-white">
                {pairedSummary.uniqueSpinners.toLocaleString()}
              </strong>{" "}
              wallets ({pairedSummary.sampleStartAt?.slice(0, 10) ?? "recent"} →{" "}
              {pairedSummary.sampleEndAt?.slice(0, 10) ?? "latest"})
            </span>
            <span className="font-mono text-[11px] text-emerald-300/80">
              Matched via wallet → SPIN + single-per-wallet mint ≤ 240s
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            <p className="leading-relaxed">
              All-time outcome totals above combine exact per-season on-chain
              spin counts with COSMO&apos;s published probability tables (Legacy
              87.50% FCO / 3.125% SCO / 0.06% PCO / 9.315% Blank vs. Modern
              90.63% FCO / 0.06% PCO / 9.31% Blank). Run{" "}
              <code className="text-zinc-200">
                npm run sync:spins --workspace=@objekt-stats/indexer
              </code>{" "}
              and apply migration 0010 to layer live wallet-paired on-chain
              outcomes &amp; recent jackpot/blank feeds directly on top.
            </p>
          </div>
        )}
      </section>

      {/* Member Spin Leaderboard */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Each Member Sent Into Spin ({sortedMembers.length} members)
            </h2>
            <p className="text-sm text-zinc-300">
              Compare total Objekts burned per member and{" "}
              <strong className="text-white">Spin Rate %</strong> (what % of a
              member&apos;s supply fans throw into Spin). Lower rate = more
              protected by collectors.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["rate_desc", "Highest Spin %"],
                ["rate_asc", "Most Protected"],
                ["total_desc", "Most Spun"],
                ["rare_desc", "Most Rare Spun"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMemberSort(key)}
                className={`rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition ${
                  memberSort === key
                    ? "bg-white text-zinc-950"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[660px] space-y-2">
            <div className="flex items-center justify-between border-b border-zinc-800/80 px-3.5 pb-2 text-xs font-medium text-zinc-400">
              <span>Member</span>
              <div className="flex items-center gap-4 font-mono">
                <span className="w-24 text-right">Sent to Spin</span>
                <span className="w-24 text-right">Total Minted</span>
                <span className="hidden md:inline-block w-20 text-right">
                  Rare (&lt;1k)
                </span>
                {hasPairedMemberData && (
                  <span className="hidden lg:inline-block w-24 text-right">
                    Paired Pulled
                  </span>
                )}
                <span className="w-20 text-right">Spin Rate</span>
                <span
                  className="w-16 text-right"
                  title="Spin rate relative to the group average (1.00× = average)"
                >
                  vs Avg
                </span>
              </div>
            </div>

            {sortedMembers.map((row, idx) => {
              const barVal =
                memberSort === "total_desc"
                  ? row.spunCount
                  : memberSort === "rare_desc"
                    ? row.rareSupplySpun
                    : row.spinRatePct;
              const widthPct = Math.max(
                4,
                Math.min(100, (barVal / maxMemberBarVal) * 100),
              );
              const avgTickPct =
                memberSort === "rate_desc" || memberSort === "rate_asc"
                  ? Math.min(100, (avgMemberRate / maxMemberBarVal) * 100)
                  : null;
              return (
                <Link
                  key={row.member.id}
                  to="/members/$memberId"
                  params={{ memberId: row.member.id }}
                  className="group block space-y-2 rounded-xl border border-zinc-800/60 bg-zinc-950/50 px-3.5 py-2.5 transition hover:border-zinc-700 hover:bg-zinc-900/80"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 font-mono text-sm font-semibold text-zinc-400">
                        #{idx + 1}
                      </span>
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: row.member.hexColor }}
                      />
                      <span className="text-sm sm:text-base font-semibold text-white group-hover:text-sky-200 truncate">
                        {row.member.name}
                      </span>
                      <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-xs text-zinc-300 shrink-0">
                        {row.member.code}
                      </span>
                      <span className="hidden xl:inline font-mono text-[11px] text-zinc-500">
                        FCO {row.fcoSpun.toLocaleString()} · DCO{" "}
                        {row.dcoSpun.toLocaleString()} · Phys{" "}
                        {row.physicalSpun.toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                      <span className="w-24 text-right text-sm font-semibold text-white">
                        {row.spunCount.toLocaleString()}
                      </span>
                      <span className="w-24 text-right text-xs sm:text-sm text-zinc-400">
                        {row.totalMints.toLocaleString()}
                      </span>
                      <span className="hidden md:inline-block w-20 text-right text-xs text-purple-300">
                        {row.rareSupplySpun.toLocaleString()}
                      </span>
                      {hasPairedMemberData && (
                        <span className="hidden lg:inline-block w-24 text-right text-xs text-sky-300">
                          {row.pairedPulledCount.toLocaleString()}
                        </span>
                      )}
                      <span
                        className={`w-20 text-right text-sm font-bold ${
                          row.spinRateRelativeIndex >= 1.12
                            ? "text-rose-300"
                            : row.spinRateRelativeIndex <= 0.88
                              ? "text-emerald-300"
                              : "text-zinc-100"
                        }`}
                      >
                        {row.spinRatePct.toFixed(1)}%
                      </span>
                      <span className="w-16 text-right text-xs text-zinc-400">
                        {row.spinRateRelativeIndex.toFixed(2)}×
                      </span>
                    </div>
                  </div>

                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${widthPct}%`,
                        backgroundColor: row.member.hexColor,
                      }}
                    />
                    {avgTickPct !== null && (
                      <div
                        className="pointer-events-none absolute inset-y-0 w-px bg-zinc-400/50"
                        style={{ left: `${avgTickPct}%` }}
                        title={`Group avg spin rate: ${avgMemberRate.toFixed(1)}%`}
                      />
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* Rarity Tier Breakdown + Class Breakdown */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Rarity Tiers */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Rarity of Cards Sent Into Spin
            </h2>
            <p className="text-sm text-zinc-300">
              Grouped by total collection supply (Apollo all-time copies or
              on-chain mints). Most spins are common FCOs — but thousands of
              scarce cards get burned too.
            </p>
          </div>

          <div className="space-y-3">
            {analytics.rarityTiers.map((row) => {
              const barPct = Math.max(
                row.spunCount > 0 ? 3 : 0,
                Math.min(100, row.shareOfSpinsPct),
              );
              return (
                <div
                  key={row.tier.id}
                  className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${TIER_BADGE_CLASS[row.tier.id]}`}
                      >
                        {row.tier.label}
                      </span>
                      <span className="font-mono text-xs text-zinc-400">
                        {row.tier.rangeLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-xs sm:text-sm tabular-nums">
                      <span className="font-bold text-white">
                        {row.spunCount.toLocaleString()} spun
                      </span>
                      <span className="text-zinc-400">
                        {row.shareOfSpinsPct.toFixed(2)}% of spins
                      </span>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-900">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${barPct}%`,
                        backgroundColor: row.tier.accentHex,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-400 tabular-nums">
                    <span>
                      {row.collectionsCount.toLocaleString()} collections
                      touched ·{" "}
                      <strong className="text-zinc-200">
                        {row.tierSpinRatePct.toFixed(1)}%
                      </strong>{" "}
                      tier burn rate
                    </span>
                    {row.estMarketValueBurnedUsd > 0 && (
                      <span className="text-amber-300/90">
                        ~${Math.round(row.estMarketValueBurnedUsd).toLocaleString()}{" "}
                        priced mkt value
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Class & Format Breakdown */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Cards Sent Into Spin by Class &amp; Format
            </h2>
            <p className="text-sm text-zinc-300">
              Digital First Class Objekts account for the vast majority of spin
              fuel, followed by Digital &amp; Physical Double Class cards.
            </p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950/60">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-3.5 py-2.5">Class &amp; Format</th>
                  <th className="px-3.5 py-2.5 text-right">Spun</th>
                  <th className="px-3.5 py-2.5 text-right">Share</th>
                  <th className="px-3.5 py-2.5 text-right">Burn %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 font-mono tabular-nums">
                {analytics.classBreakdown.map((c) => (
                  <tr key={c.key} className="hover:bg-zinc-900/60">
                    <td className="px-3.5 py-2.5 font-sans">
                      <span className="font-medium text-white">
                        {c.objektClass}
                      </span>{" "}
                      <span
                        className={`ml-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          c.onOffline === "offline"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {c.onOffline === "offline" ? "Physical" : "Digital"}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-semibold text-white">
                      {c.spunCount.toLocaleString()}
                    </td>
                    <td className="px-3.5 py-2.5 text-right text-zinc-400">
                      {c.shareOfSpinsPct.toFixed(2)}%
                    </td>
                    <td className="px-3.5 py-2.5 text-right text-zinc-200">
                      {c.spinRatePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Rarest & Most Valuable Cards Ever Sent Into Spin */}
      <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Gem className="h-5 w-5 text-rose-400" />
              Rarest &amp; Highest-Value Cards Sacrificed to Spin
            </h2>
            <p className="text-sm text-zinc-300">
              Low-supply, Premier, Motion, and high-market-value Objekts that
              collectors actually sent into COSMO Spin. Click any card to view
              it on Apollo.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["rarest", `Rarest Supply (${analytics.rarestSpunCards.length})`],
                [
                  "premier_motion",
                  `Premier & Motion (${analytics.premierMotionSpunCards.length})`,
                ],
                [
                  "highest_value",
                  `Highest Market $ (${analytics.highestValueSpunCards.length})`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGalleryTab(key)}
                className={`rounded-lg px-3 py-1.5 text-xs sm:text-sm font-medium transition ${
                  galleryTab === key
                    ? "bg-white text-zinc-950"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-300 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {galleryCards.length === 0 ? (
          <p className="text-sm text-zinc-400">
            No matching spun cards for this filter in the selected season.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {galleryCards.map((c) => (
              <a
                key={c.slug}
                href={apolloCollectionUrl(
                  c.season,
                  c.rawMemberName,
                  c.collectionNo,
                )}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70 transition hover:border-sky-500/50"
              >
                {c.frontImageUrl ? (
                  <img
                    src={c.frontImageUrl}
                    alt={c.collectionId}
                    loading="lazy"
                    className="aspect-[2/3] w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center bg-zinc-900 text-xs text-zinc-500">
                    No Preview
                  </div>
                )}
                <div className="p-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${TIER_BADGE_CLASS[c.rarityTier]}`}
                    >
                      {c.objektClass === "Premier"
                        ? "Premier"
                        : c.objektClass === "Motion"
                          ? "Motion"
                          : c.effectiveSupply < 100
                            ? "Ultra Rare"
                            : c.effectiveSupply < 500
                              ? "Very Rare"
                              : "Rare"}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-400">
                      {c.onOffline === "offline" ? "Phys" : "Dig"}
                    </span>
                  </div>
                  <p className="truncate text-xs font-semibold text-zinc-100 group-hover:text-sky-300">
                    {c.collectionId}
                  </p>
                  <p className="font-mono text-[11px] text-rose-300 tabular-nums">
                    {c.spunCount.toLocaleString()} /{" "}
                    {c.effectiveSupply.toLocaleString()} spun (
                    {c.spinRatePct.toFixed(1)}%)
                  </p>
                  {c.apolloMedianPriceUsd !== null &&
                    c.apolloMedianPriceUsd > 0 && (
                      <p className="font-mono text-[11px] text-amber-300 tabular-nums">
                        Med ${c.apolloMedianPriceUsd.toFixed(2)}
                        {c.apolloListingCount
                          ? ` (${c.apolloListingCount})`
                          : ""}
                      </p>
                    )}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      {/* Recent Notable Paired On-Chain Spins (when populated) */}
      {notableSpins.length > 0 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Recent Notable On-Chain Spin Results
            </h2>
            <p className="text-sm text-zinc-300">
              Real Abstract spin transactions paired with their exact on-chain
              outcome — highlighting Premier jackpots, Special pulls, and Blank
              whiffs.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {notableSpins.slice(0, 16).map((sp) => (
              <div
                key={sp.spinKey}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {sp.inputImageUrl && (
                    <img
                      src={sp.inputImageUrl}
                      alt={sp.inputCollectionId}
                      loading="lazy"
                      className="h-12 w-8 rounded border border-zinc-800 object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-zinc-100 truncate">
                      {sp.inputCollectionId}
                    </p>
                    <p className="font-mono text-[11px] text-zinc-400">
                      {sp.walletShort} · {sp.spunAt.slice(0, 16).replace("T", " ")} UTC
                    </p>
                  </div>
                </div>

                <ArrowRight className="h-4 w-4 shrink-0 text-zinc-500" />

                <div className="flex items-center gap-2.5 shrink-0 text-right">
                  {sp.outcomeKind === "blank" ? (
                    <div className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-rose-300 font-mono font-semibold">
                      BLANK (Nothing)
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                            sp.outcomeKind === "premier"
                              ? "bg-amber-500/20 text-amber-300"
                              : sp.outcomeKind === "sco"
                                ? "bg-violet-500/20 text-violet-300"
                                : "bg-sky-500/15 text-sky-300"
                          }`}
                        >
                          {sp.outcomeKind === "premier"
                            ? "Premier Jackpot"
                            : sp.outcomeKind === "sco"
                              ? "Special Pull"
                              : sp.outcomeKind.toUpperCase()}
                        </span>
                        <p className="mt-0.5 font-medium text-zinc-100 truncate max-w-[140px]">
                          {sp.outputCollectionId ?? "Minted"}
                        </p>
                      </div>
                      {sp.outputImageUrl && (
                        <img
                          src={sp.outputImageUrl}
                          alt={sp.outputCollectionId ?? "Spin reward"}
                          loading="lazy"
                          className="h-12 w-8 rounded border border-zinc-800 object-cover shrink-0"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Season-by-Season Spin Breakdown */}
      {analytics.seasons.length > 0 && (
        <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-5 sm:p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white">
              Spin Volume by Season
            </h2>
            <p className="text-sm text-zinc-300">
              Tracks burn rate and spin pool rules per season.
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-800/80 bg-zinc-950/60">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase text-zinc-400">
                <tr>
                  <th className="px-4 py-3">Season</th>
                  <th className="px-4 py-3">Spin Pool Era</th>
                  <th className="px-4 py-3 text-right">Spun</th>
                  <th className="px-4 py-3 text-right">Minted</th>
                  <th className="px-4 py-3 text-right">Burn %</th>
                  <th className="px-4 py-3 text-right">Est. Blanks</th>
                  <th className="px-4 py-3 text-right">Premier Supply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70 font-mono tabular-nums">
                {analytics.seasons.map((s) => (
                  <tr key={s.season} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-3 font-sans font-semibold text-white">
                      {s.season}
                    </td>
                    <td className="px-4 py-3 font-sans text-xs">
                      <span
                        className={`rounded-md border px-2 py-0.5 ${
                          s.era === "modern_no_sco"
                            ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                            : "border-violet-500/30 bg-violet-500/10 text-violet-300"
                        }`}
                      >
                        {s.era === "modern_no_sco"
                          ? "Modern (90.6% FCO / 0.06% PCO)"
                          : "Legacy (87.5% FCO / 3.1% SCO / 0.06% PCO)"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-white">
                      {s.spunCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-400">
                      {s.totalMints.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-200">
                      {s.spinRatePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right text-rose-300">
                      ~{s.estBlanks.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-300">
                      {s.premierMints.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subtext,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtext: string;
  tone?: "default" | "rose" | "amber" | "purple";
}) {
  const borderClass =
    tone === "rose"
      ? "border-rose-500/30 bg-rose-500/[0.06]"
      : tone === "amber"
        ? "border-amber-500/30 bg-amber-500/[0.06]"
        : tone === "purple"
          ? "border-purple-500/30 bg-purple-500/[0.06]"
          : "border-zinc-800/80 bg-zinc-900/40";
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${borderClass}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {icon}
      </div>
      <p className="font-mono text-2xl font-bold tracking-tight text-white tabular-nums">
        {value}
      </p>
      <p className="text-xs text-zinc-400 leading-snug">{subtext}</p>
    </div>
  );
}

function OutcomeCard({
  title,
  colorClass,
  valueColor,
  primaryValue,
  rateLabel,
  detail,
}: {
  title: string;
  colorClass: string;
  valueColor: string;
  primaryValue: string;
  rateLabel: string;
  detail: string;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-1.5 ${colorClass}`}>
      <p className="text-xs font-semibold text-zinc-200">{title}</p>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`font-mono text-xl font-bold tabular-nums ${valueColor}`}>
          {primaryValue}
        </p>
        <span className="font-mono text-xs text-zinc-300">{rateLabel}</span>
      </div>
      <p className="text-xs leading-relaxed text-zinc-300/85">{detail}</p>
    </div>
  );
}
