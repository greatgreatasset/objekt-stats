import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
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

const TIER_TEXT_CLASS: Record<SpinRarityTierId, string> = {
  ultra_rare: "text-rose-400",
  very_rare: "text-amber-400",
  rare: "text-purple-400",
  uncommon: "text-sky-400",
  common: "text-zinc-400",
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
      {/* Compact Editorial Header + Inline Stats */}
      <header className="border-b border-zinc-800/90 pb-6 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 max-w-2xl">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName}{" "}
              <span className="font-normal text-zinc-400">Spin Stats</span>
            </h1>
            <p className="text-sm text-zinc-400">
              Objekts burned into COSMO Spin across Polygon &amp; Abstract —
              member spin rates, blank vs. rare pull results, and low-supply
              cards sacrificed.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-[#121215] px-2.5 py-1.5 text-xs text-zinc-400">
              <span>Season</span>
              <select
                value={seasonFilter}
                onChange={(e) => handleSeasonChange(e.target.value)}
                aria-label="Filter spin stats by season"
                className="bg-transparent font-mono text-xs font-medium text-white focus:outline-none"
              >
                <option value="all" className="bg-[#0c0c0e]">
                  All ({availableSeasons.length})
                </option>
                {availableSeasons.map((s) => (
                  <option key={s} value={s} className="bg-[#0c0c0e]">
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Inline Metric Strip */}
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 pt-1">
          <div>
            <div className="text-xs text-zinc-500">Sent to Spin</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-white tabular-nums">
                {totals.totalSpins.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {totals.overallSpinRatePct.toFixed(1)}% of{" "}
                {totals.totalMints.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">
              {pairedSummary ? "Observed Blank Rate" : "Est. Blank Spins"}
            </div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-rose-400 tabular-nums">
                {pairedSummary && pairedBlankPct !== null
                  ? `${pairedBlankPct.toFixed(2)}%`
                  : totals.estBlanks.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {pairedSummary
                  ? `${pairedSummary.blankCount.toLocaleString()} / ${pairedSummary.totalPairedSpins.toLocaleString()} paired`
                  : `~${totals.estBlankRatePct.toFixed(2)}% nothing`}
              </span>
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">Rare Jackpots</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-amber-300 tabular-nums">
                {pairedSummary
                  ? `${pairedSummary.premierCount.toLocaleString()} PCO${
                      pairedSummary.scoCount > 0
                        ? ` + ${pairedSummary.scoCount} SCO`
                        : ""
                    }`
                  : `~${totals.estPremierPulls.toLocaleString()} PCO`}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {pairedSummary && pairedRarePct !== null
                  ? `${pairedRarePct.toFixed(2)}% in sample`
                  : "0.06% odds"}
              </span>
            </div>
          </div>

          <div className="hidden sm:block h-7 w-px bg-zinc-800 self-center" />

          <div>
            <div className="text-xs text-zinc-500">Rare Burned (&lt;1k)</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="font-mono text-xl font-semibold text-white tabular-nums">
                {totals.rareUnder1000Spun.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500 tabular-nums">
                {totals.premierSpun} PCO · {totals.motionSpun} MCO ·{" "}
                {totals.specialSpun.toLocaleString()} SCO
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Spin Results: Nothing vs Normal vs Rare */}
      <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Spin Outcomes: Blank vs. Normal vs. Rare
            </h2>
            <p className="text-xs text-zinc-400">
              {pairedSummary
                ? `Verified across ${pairedSummary.totalPairedSpins.toLocaleString()} paired Abstract spins (${pairedSummary.uniqueSpinners.toLocaleString()} wallets) alongside all-time season drop tables.`
                : `Season-weighted breakdown across all ${totals.totalSpins.toLocaleString()} on-chain ${artistName} spins using COSMO drop tables.`}
            </p>
          </div>
          <span className="font-mono text-[11px] text-zinc-500">
            Modern pool: 90.63% FCO · 9.31% Blank · 0.06% Premier
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Stacked Outcome Bar */}
          <div className="space-y-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-[2px] bg-zinc-800/90">
              <div
                className="h-full bg-sky-500 transition-all"
                style={{
                  width: `${pairedFcoPct ?? totals.estFcoRatePct}%`,
                }}
                title={`First Class (FCO): ${(pairedFcoPct ?? totals.estFcoRatePct).toFixed(2)}%`}
              />
              {(pairedSummary ? pairedSummary.scoCount : totals.estScoPulls) >
                0 && (
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
                    0.5,
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

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[1px] bg-sky-500" />
                FCO ({(pairedFcoPct ?? totals.estFcoRatePct).toFixed(2)}%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[1px] bg-rose-500" />
                Blank / Nothing (
                {(pairedBlankPct ?? totals.estBlankRatePct).toFixed(2)}%)
              </span>
              {totals.estScoPulls > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[1px] bg-violet-500" />
                  SCO (Legacy:{" "}
                  {COSMO_SPIN_PUBLISHED_ODDS.legacy_with_sco.scoRate * 100}%)
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[1px] bg-amber-400" />
                Premier 4xxZ (0.06%)
              </span>
            </div>
          </div>

          {/* 4-column hairline outcome grid */}
          <div className="grid gap-px overflow-hidden rounded-md border border-zinc-800/80 bg-zinc-800/70 sm:grid-cols-2 lg:grid-cols-4">
            <OutcomeCell
              title="Normal Replacement (FCO)"
              accentClass="text-sky-400"
              primaryValue={`~${totals.estFcoPulls.toLocaleString()}`}
              rateLabel={`${totals.estFcoRatePct.toFixed(2)}% avg`}
              detail={
                pairedSummary && pairedFcoPct !== null
                  ? `Observed: ${pairedSummary.fcoCount.toLocaleString()} (${pairedFcoPct.toFixed(2)}%)`
                  : "Random same-season FCO (90.63% Binary02+ / 87.50% earlier)"
              }
            />
            <OutcomeCell
              title="Nothing / Blank"
              accentClass="text-rose-400"
              primaryValue={`~${totals.estBlanks.toLocaleString()}`}
              rateLabel={`${totals.estBlankRatePct.toFixed(2)}% fail`}
              detail={
                pairedSummary && pairedBlankPct !== null
                  ? `Observed: ${pairedSummary.blankCount.toLocaleString()} (${pairedBlankPct.toFixed(2)}%)`
                  : "~1 in 11 spins destroys the card with no mint returned"
              }
            />
            <OutcomeCell
              title="Special Pull (SCO)"
              accentClass="text-violet-400"
              primaryValue={`~${totals.estScoPulls.toLocaleString()}`}
              rateLabel={`${totals.estScoRatePct.toFixed(2)}% weighted`}
              detail={
                pairedSummary
                  ? `Observed: ${pairedSummary.scoCount.toLocaleString()} · Legacy seasons only`
                  : "3.13% in legacy seasons; removed in Binary02+ / ARTMS Ever01+"
              }
            />
            <OutcomeCell
              title="Premier Jackpot (4xxZ)"
              accentClass="text-amber-300"
              primaryValue={`~${totals.estPremierPulls.toLocaleString()}`}
              rateLabel="0.06% (~1/1,667)"
              detail={
                pairedSummary
                  ? `Observed: ${pairedSummary.premierCount.toLocaleString()} · ${totals.premierTotalMinted.toLocaleString()} total PCO supply`
                  : `${totals.premierTotalMinted.toLocaleString()} total PCO supply`
              }
            />
          </div>

          {pairedSummary && (
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-500">
              <span>
                Paired sample: {pairedSummary.totalPairedSpins.toLocaleString()}{" "}
                spins across {pairedSummary.uniqueSpinners.toLocaleString()}{" "}
                wallets ({pairedSummary.sampleStartAt?.slice(0, 10) ?? "recent"}{" "}
                → {pairedSummary.sampleEndAt?.slice(0, 10) ?? "latest"})
              </span>
              <span>Matched via wallet → SPIN + single-per-wallet mint ≤ 240s</span>
            </div>
          )}
        </div>
      </section>

      {/* Member Spin Leaderboard */}
      <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Members Sent Into Spin
            </h2>
            <p className="text-xs text-zinc-400">
              Spin Rate % is the share of a member&apos;s indexed supply sent
              into Spin. Lower rate = more protected by collectors.
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs">
            {(
              [
                ["rate_desc", "Highest %"],
                ["rate_asc", "Most Protected"],
                ["total_desc", "Most Spun"],
                ["rare_desc", "Most Rare"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMemberSort(key)}
                className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  memberSort === key
                    ? "bg-zinc-200 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[660px]">
            <div className="flex items-center justify-between border-b border-zinc-800/70 bg-[#0f0f12] px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500 sm:px-5">
              <span>Member</span>
              <div className="flex items-center gap-4">
                <span className="w-24 text-right">Sent to Spin</span>
                <span className="w-24 text-right">Total Minted</span>
                <span className="hidden md:inline-block w-20 text-right">
                  Rare (&lt;1k)
                </span>
                {hasPairedMemberData && (
                  <span className="hidden lg:inline-block w-24 text-right">
                    Sample Pulled
                  </span>
                )}
                <span className="w-20 text-right">Spin Rate</span>
                <span
                  className="w-14 text-right"
                  title="Spin rate relative to the group average (1.00× = average)"
                >
                  vs Avg
                </span>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/60">
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
                    className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70 sm:px-5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-6 font-mono text-xs text-zinc-500 tabular-nums">
                          {idx + 1}
                        </span>
                        <span
                          className="h-2.5 w-2.5 rounded-[2px] shrink-0"
                          style={{ backgroundColor: row.member.hexColor }}
                        />
                        <span className="text-sm font-medium text-zinc-100 group-hover:text-white truncate">
                          {row.member.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                          {row.member.code}
                        </span>
                        <span className="hidden xl:inline font-mono text-[11px] text-zinc-500">
                          FCO {row.fcoSpun.toLocaleString()} · DCO{" "}
                          {row.dcoSpun.toLocaleString()} · Phys{" "}
                          {row.physicalSpun.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 font-mono tabular-nums shrink-0">
                        <span className="w-24 text-right text-xs sm:text-sm font-semibold text-zinc-100">
                          {row.spunCount.toLocaleString()}
                        </span>
                        <span className="w-24 text-right text-xs text-zinc-400">
                          {row.totalMints.toLocaleString()}
                        </span>
                        <span className="hidden md:inline-block w-20 text-right text-xs text-zinc-300">
                          {row.rareSupplySpun.toLocaleString()}
                        </span>
                        {hasPairedMemberData && (
                          <span className="hidden lg:inline-block w-24 text-right text-xs text-zinc-400">
                            {row.pairedPulledCount.toLocaleString()}
                          </span>
                        )}
                        <span
                          className={`w-20 text-right text-sm font-semibold ${
                            row.spinRateRelativeIndex >= 1.12
                              ? "text-rose-400"
                              : row.spinRateRelativeIndex <= 0.88
                                ? "text-emerald-400"
                                : "text-zinc-100"
                          }`}
                        >
                          {row.spinRatePct.toFixed(1)}%
                        </span>
                        <span className="w-14 text-right text-xs text-zinc-500">
                          {row.spinRateRelativeIndex.toFixed(2)}×
                        </span>
                      </div>
                    </div>

                    <div className="relative mt-2 ml-8 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: row.member.hexColor,
                        }}
                      />
                      {avgTickPct !== null && (
                        <div
                          className="pointer-events-none absolute inset-y-0 w-px bg-zinc-300/50"
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
        </div>
      </section>

      {/* Rarity Tier Breakdown + Class Breakdown */}
      <section className="grid gap-6 lg:grid-cols-2 items-start">
        <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5 space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Rarity of Cards Sent Into Spin
            </h2>
            <p className="text-xs text-zinc-400">
              Grouped by total collection supply (Apollo copies or on-chain mints).
            </p>
          </div>

          <div className="divide-y divide-zinc-800/60">
            {analytics.rarityTiers.map((row) => {
              const barPct = Math.max(
                row.spunCount > 0 ? 3 : 0,
                Math.min(100, row.shareOfSpinsPct),
              );
              return (
                <div key={row.tier.id} className="px-4 py-3.5 sm:px-5 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-xs font-semibold ${TIER_TEXT_CLASS[row.tier.id]}`}
                      >
                        {row.tier.label}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {row.tier.rangeLabel}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
                      <span className="font-semibold text-white">
                        {row.spunCount.toLocaleString()} spun
                      </span>
                      <span className="text-zinc-500">
                        {row.shareOfSpinsPct.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-zinc-800/90">
                    <div
                      className="h-full"
                      style={{
                        width: `${barPct}%`,
                        backgroundColor: row.tier.accentHex,
                      }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-500 tabular-nums">
                    <span>
                      {row.collectionsCount.toLocaleString()} collections ·{" "}
                      <span className="text-zinc-300">
                        {row.tierSpinRatePct.toFixed(1)}%
                      </span>{" "}
                      burn rate
                    </span>
                    {row.estMarketValueBurnedUsd > 0 && (
                      <span className="text-amber-300/90">
                        ~${Math.round(row.estMarketValueBurnedUsd).toLocaleString()}{" "}
                        mkt value
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5 space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Spins by Class &amp; Format
            </h2>
            <p className="text-xs text-zinc-400">
              Digital FCOs make up most spin fuel, followed by Digital &amp;
              Physical DCOs.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-800/70 bg-[#0f0f12] font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Class &amp; Format</th>
                  <th className="px-4 py-2.5 text-right">Spun</th>
                  <th className="px-4 py-2.5 text-right">Share</th>
                  <th className="px-4 py-2.5 text-right">Burn %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
                {analytics.classBreakdown.map((c) => (
                  <tr key={c.key} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-2.5 font-sans">
                      <span className="font-medium text-zinc-100">
                        {c.objektClass}
                      </span>{" "}
                      <span className="ml-1 font-mono text-[11px] text-zinc-500">
                        {c.onOffline === "offline" ? "Physical" : "Digital"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-white">
                      {c.spunCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {c.shareOfSpinsPct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-200">
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
      <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-800/90 px-4 py-4 sm:px-5">
          <div className="space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Rarest &amp; Highest-Value Cards Sacrificed
            </h2>
            <p className="text-xs text-zinc-400">
              Low-supply, Premier, Motion, and high-market-value Objekts sent
              into COSMO Spin. Click any card for Apollo.
            </p>
          </div>

          <div className="inline-flex flex-wrap rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs">
            {(
              [
                ["rarest", `Rarest (${analytics.rarestSpunCards.length})`],
                [
                  "premier_motion",
                  `Premier & Motion (${analytics.premierMotionSpunCards.length})`,
                ],
                [
                  "highest_value",
                  `Highest $ (${analytics.highestValueSpunCards.length})`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setGalleryTab(key)}
                className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors ${
                  galleryTab === key
                    ? "bg-zinc-200 text-zinc-950"
                    : "text-zinc-400 hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {galleryCards.length === 0 ? (
            <p className="text-xs text-zinc-500">
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
                  className="group overflow-hidden rounded-md border border-zinc-800/90 bg-[#0f0f12] transition-colors hover:border-zinc-500"
                >
                  {c.frontImageUrl ? (
                    <img
                      src={c.frontImageUrl}
                      alt={c.collectionId}
                      loading="lazy"
                      className="aspect-[2/3] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] w-full items-center justify-center bg-zinc-900 text-xs text-zinc-600">
                      No Preview
                    </div>
                  )}
                  <div className="p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                      <span className={TIER_TEXT_CLASS[c.rarityTier]}>
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
                      <span className="text-zinc-500">
                        {c.onOffline === "offline" ? "Phys" : "Dig"}
                      </span>
                    </div>
                    <p className="truncate text-xs font-medium text-zinc-100 group-hover:text-white">
                      {c.collectionId}
                    </p>
                    <p className="font-mono text-[11px] text-rose-400 tabular-nums">
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
        </div>
      </section>

      {/* Recent Notable Paired On-Chain Spins */}
      {notableSpins.length > 0 && (
        <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5 space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Recent Notable On-Chain Spin Results
            </h2>
            <p className="text-xs text-zinc-400">
              Abstract spin transactions paired with their exact on-chain
              outcome — Premier jackpots, Special pulls, and Blank whiffs.
            </p>
          </div>

          <div className="grid gap-px bg-zinc-800/60 md:grid-cols-2">
            {notableSpins.slice(0, 16).map((sp) => (
              <div
                key={sp.spinKey}
                className="flex items-center justify-between gap-3 bg-[#121215] px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {sp.inputImageUrl && (
                    <img
                      src={sp.inputImageUrl}
                      alt={sp.inputCollectionId}
                      loading="lazy"
                      className="h-11 w-7 rounded-[2px] border border-zinc-800 object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100 truncate">
                      {sp.inputCollectionId}
                    </p>
                    <p className="font-mono text-[11px] text-zinc-500">
                      {sp.walletShort} ·{" "}
                      {sp.spunAt.slice(0, 16).replace("T", " ")} UTC
                    </p>
                  </div>
                </div>

                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />

                <div className="flex items-center gap-2.5 shrink-0 text-right">
                  {sp.outcomeKind === "blank" ? (
                    <span className="font-mono text-xs font-semibold text-rose-400">
                      BLANK
                    </span>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <span
                          className={`font-mono text-[10px] font-semibold uppercase ${
                            sp.outcomeKind === "premier"
                              ? "text-amber-300"
                              : sp.outcomeKind === "sco"
                                ? "text-violet-400"
                                : "text-sky-400"
                          }`}
                        >
                          {sp.outcomeKind === "premier"
                            ? "Premier"
                            : sp.outcomeKind === "sco"
                              ? "Special"
                              : sp.outcomeKind.toUpperCase()}
                        </span>
                        <p className="font-medium text-zinc-200 truncate max-w-[140px]">
                          {sp.outputCollectionId ?? "Minted"}
                        </p>
                      </div>
                      {sp.outputImageUrl && (
                        <img
                          src={sp.outputImageUrl}
                          alt={sp.outputCollectionId ?? "Spin reward"}
                          loading="lazy"
                          className="h-11 w-7 rounded-[2px] border border-zinc-800 object-cover shrink-0"
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
        <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5 space-y-0.5">
            <h2 className="text-base font-semibold text-white">
              Spin Volume by Season
            </h2>
            <p className="text-xs text-zinc-400">
              Burn rate and spin pool rules per season.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-zinc-800/70 bg-[#0f0f12] font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Season</th>
                  <th className="px-4 py-2.5">Spin Pool</th>
                  <th className="px-4 py-2.5 text-right">Spun</th>
                  <th className="px-4 py-2.5 text-right">Minted</th>
                  <th className="px-4 py-2.5 text-right">Burn %</th>
                  <th className="px-4 py-2.5 text-right">Est. Blanks</th>
                  <th className="px-4 py-2.5 text-right">Premier Supply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono tabular-nums">
                {analytics.seasons.map((s) => (
                  <tr key={s.season} className="hover:bg-zinc-900/60">
                    <td className="px-4 py-2.5 font-sans font-medium text-white">
                      {s.season}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                      {s.era === "modern_no_sco"
                        ? "Modern (90.6% FCO / 0.06% PCO)"
                        : "Legacy (87.5% FCO / 3.1% SCO / 0.06% PCO)"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-white">
                      {s.spunCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {s.totalMints.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-200">
                      {s.spinRatePct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-rose-400">
                      ~{s.estBlanks.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right text-amber-300">
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

function OutcomeCell({
  title,
  accentClass,
  primaryValue,
  rateLabel,
  detail,
}: {
  title: string;
  accentClass: string;
  primaryValue: string;
  rateLabel: string;
  detail: string;
}) {
  return (
    <div className="bg-[#121215] p-4 space-y-1">
      <p className="text-xs text-zinc-400">{title}</p>
      <div className="flex items-baseline justify-between gap-2">
        <p className={`font-mono text-lg font-semibold tabular-nums ${accentClass}`}>
          {primaryValue}
        </p>
        <span className="font-mono text-[11px] text-zinc-500">{rateLabel}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">{detail}</p>
    </div>
  );
}
