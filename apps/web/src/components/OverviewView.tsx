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
    apolloEventSlug?: string | null;
    apolloEventName?: string | null;
    isBuyersLowerBound?: boolean;
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
    uniqueBuyersRank?: number;
    rankDeltaPrev: number | null;
    relativeIndex: number;
    uniqueBuyersRelativeIndex?: number;
    rolling5RelativeIndex?: number | null;
    rolling5Rank?: number | null;
    zScore?: number;
    mintCount: number;
    uniqueBuyers: number;
    roundUniqueBuyers?: number;
    participatingMembers?: number;
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
    roundStartAt?: string | null;
    participatingMembers?: number;
    roundUniqueBuyers?: number;
    risers: Array<{
      roundSlug: string;
      memberId: string;
      memberName: string;
      memberCode: string;
      hexColor: string;
      rank: number;
      uniqueBuyersRank?: number;
      prevBuyersRank?: number;
      rankDeltaPrev: number | null;
      relativeIndex: number;
      uniqueBuyersRelativeIndex?: number;
      uniqueBuyers?: number;
      mintCount?: number;
    }>;
    fallers: Array<{
      roundSlug: string;
      memberId: string;
      memberName: string;
      memberCode: string;
      hexColor: string;
      rank: number;
      uniqueBuyersRank?: number;
      prevBuyersRank?: number;
      rankDeltaPrev: number | null;
      relativeIndex: number;
      uniqueBuyersRelativeIndex?: number;
      uniqueBuyers?: number;
      mintCount?: number;
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
  calcMeta?: {
    minLeaderboardBuyers: number;
    qualifyingPopularityRoundCount: number;
    excludedRoundCount: number;
  };
  totals: {
    roundCount: number;
    popularityRoundCount: number;
    collectionCount: number;
    totalMints: number;
    totalSpins?: number;
    estGrossUsd: number;
  };
}

type RoundItem = OverviewData["rounds"][number];

interface GroupedOverviewRound {
  key: string;
  lead: RoundItem;
  cards: RoundItem[];
  displayTitle: string;
  cardTag: string | null;
  totalMints: number;
  displayBuyers: number;
  buyersHasPlus: boolean;
  startAt: string;
}

function extractColNo(title: string, slug: string): string | null {
  const m = /\b(\d{3}[ZA])\b/i.exec(title) ?? /-(\d{3}[za])$/i.exec(slug);
  return m ? m[1]!.toUpperCase() : null;
}

function formatCardRangeTag(cards: RoundItem[]): string | null {
  if (cards.length <= 1) return null;
  const nums = cards
    .map((c) => extractColNo(c.title, c.slug))
    .filter((v): v is string => Boolean(v))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (nums.length >= 2) {
    const first = nums[0]!;
    const last = nums[nums.length - 1]!;
    const suffix = last.slice(-1);
    const firstNum = first.replace(/[A-Z]$/i, "");
    const lastNum = last.replace(/[A-Z]$/i, "");
    if (firstNum !== lastNum) {
      return `${firstNum}–${lastNum}${suffix}`;
    }
  }
  return `${cards.length} cards`;
}

/**
 * Collapses same-event multi-card sets (e.g. Autumn Breeze 368Z/369Z/370Z) into
 * single clean Overview rail entries while preserving exact component breakdowns
 * in the calculation proof tooltip.
 */
function groupOverviewRounds(
  rounds: RoundItem[],
  maxGroups: number,
): GroupedOverviewRound[] {
  const paid = rounds.filter((r) => r.includeInPopularity);
  const source = paid.length > 0 ? paid : rounds;

  const groups: Array<{
    key: string;
    anchorMs: number;
    cards: RoundItem[];
  }> = [];

  for (const r of source) {
    const rMs = Date.parse(r.startAt) || 0;
    const canGroup =
      Boolean(r.apolloEventSlug) &&
      (r.objektClass === "Double" || r.objektClass === "Motion");

    const existing = canGroup
      ? groups.find(
          (g) =>
            g.key === `${r.apolloEventSlug}|${r.objektClass}` &&
            Math.abs(g.anchorMs - rMs) <= 72 * 3_600_000,
        )
      : undefined;

    if (existing) {
      existing.cards.push(r);
    } else {
      if (groups.length >= maxGroups) break;
      groups.push({
        key: canGroup ? `${r.apolloEventSlug}|${r.objektClass}` : r.slug,
        anchorMs: rMs,
        cards: [r],
      });
    }
  }

  return groups.map((g) => {
    const sorted = [...g.cards].sort(
      (a, b) => b.uniqueBuyers - a.uniqueBuyers || b.totalMints - a.totalMints,
    );
    const lead = sorted[0]!;
    const totalMints = g.cards.reduce((sum, c) => sum + c.totalMints, 0);
    const cardTag = formatCardRangeTag(g.cards);
    const displayTitle =
      g.cards.length > 1
        ? (lead.apolloEventName?.trim() ||
            lead.title.replace(/\s*\([^)]*\)\s*$/, "").trim())
        : lead.title;
    const buyersHasPlus =
      Boolean(lead.isBuyersLowerBound) || g.cards.length > 1;

    return {
      key: g.key,
      lead,
      cards: g.cards,
      displayTitle,
      cardTag,
      totalMints,
      displayBuyers: lead.uniqueBuyers,
      buyersHasPlus,
      startAt: lead.startAt,
    };
  });
}

function formatSyncAge(lagMinutes: number | null | undefined): string {
  if (lagMinutes === null || lagMinutes === undefined) return "Live sync";
  if (lagMinutes <= 1) return "Synced just now";
  if (lagMinutes < 60) return `Synced ${lagMinutes}m ago`;
  return `Syncing · ${(lagMinutes / 60).toFixed(1)}h behind`;
}

function MathToggle({
  open,
  onToggle,
  label = "Math",
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="font-mono text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors"
    >
      {open ? "Hide math" : label}
    </button>
  );
}

export function OverviewView({
  data,
  artistSlug,
}: {
  data: OverviewData;
  artistSlug: "triples" | "artms";
}) {
  const [boardMetric, setBoardMetric] = useState<"buyers" | "mints">("buyers");
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [showHeroMath, setShowHeroMath] = useState(false);
  const [showDemandMath, setShowDemandMath] = useState(false);
  const [showRoundsMath, setShowRoundsMath] = useState(false);
  const [showMoversMath, setShowMoversMath] = useState(false);
  const [showShiftsMath, setShowShiftsMath] = useState(false);
  const [showRosterMath, setShowRosterMath] = useState(false);

  const isArtms = artistSlug === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const searchParam = isArtms ? { artist: "artms" as const } : {};
  const minBuyers = data.calcMeta?.minLeaderboardBuyers ?? (isArtms ? 50 : 150);
  const qualifyingRounds = data.calcMeta?.qualifyingPopularityRoundCount ?? 0;
  const excludedRounds =
    data.calcMeta?.excludedRoundCount ??
    Math.max(0, data.totals.roundCount - data.totals.popularityRoundCount);

  const rankedMembers = [...data.members]
    .filter((m) => m.stats && m.stats.totalMints > 0)
    .sort((a, b) =>
      boardMetric === "buyers"
        ? (b.stats?.avgBuyersRelativeIndex ?? 0) -
          (a.stats?.avgBuyersRelativeIndex ?? 0)
        : (b.stats?.avgRelativeIndex ?? 0) - (a.stats?.avgRelativeIndex ?? 0),
    );
  const visibleRankedMembers = showAllMembers
    ? rankedMembers
    : rankedMembers.slice(0, 10);
  const maxRelIdx = Math.max(
    1.35,
    ...rankedMembers.map((m) =>
      boardMetric === "buyers"
        ? (m.stats?.avgBuyersRelativeIndex ?? 1)
        : (m.stats?.avgRelativeIndex ?? 1),
    ),
  );
  const topMember = rankedMembers[0] ?? null;

  // Match ARTMS's 5-row Demand Index height (5 distinct drops); tripleS gets 10 to align with top-10 Demand Index
  const displayRounds = groupOverviewRounds(data.rounds, isArtms ? 5 : 10);

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
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-baseline sm:justify-between">
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

          <div
            className="inline-flex items-center gap-2 font-mono text-xs text-zinc-400 shrink-0"
            title={
              abstractChain
                ? `Abstract block #${abstractChain.lastIndexedBlock.toLocaleString()} (${abstractChain.lastIndexedTimestamp ?? ""})`
                : "Live Abstract chain indexer"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isCatchingUp ? "bg-amber-400" : "bg-emerald-500/80"
              }`}
            />
            <span className={isCatchingUp ? "text-amber-400/90" : "text-zinc-400"}>
              {formatSyncAge(data.abstractLagMinutes)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <Link
              to="/rounds"
              search={searchParam}
              className="group block"
              title={`${data.totals.popularityRoundCount.toLocaleString()} paid digital rounds + ${excludedRounds.toLocaleString()} excluded (Welcome, Special, Premier rewards, offline QR) = ${data.totals.roundCount.toLocaleString()} total`}
            >
              <div className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                Paid Sale Rounds{" "}
                <span className="text-zinc-600 group-hover:text-zinc-400">
                  →
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold text-white tabular-nums">
                  {data.totals.popularityRoundCount.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  of {data.totals.roundCount.toLocaleString()} total
                </span>
              </div>
            </Link>

            <div className="hidden sm:block h-8 w-px bg-zinc-800/90 self-center" />

            <div
              title={`Sum of collections.total_mints across ${data.totals.collectionCount.toLocaleString()} indexed collections on Polygon + Abstract`}
            >
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
                  title={`${totalSpins.toLocaleString()} ÷ ${data.totals.totalMints.toLocaleString()} = ${spinRatePct.toFixed(2)}% sent to COSMO Spin`}
                >
                  <div className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                    Sent to Spin{" "}
                    <span className="text-zinc-600 group-hover:text-zinc-400">
                      →
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="font-mono text-xl font-semibold text-white tabular-nums">
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

          <MathToggle
            open={showHeroMath}
            onToggle={() => setShowHeroMath((v) => !v)}
            label="Verify math"
          />
        </div>

        {showHeroMath && (
          <div className="rounded-md border border-zinc-800/80 bg-[#0f0f12] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1">
            <div>
              <span className="text-zinc-200">Paid Sale Rounds:</span>{" "}
              <span className="text-zinc-300">
                {data.totals.popularityRoundCount.toLocaleString()}
              </span>{" "}
              paid digital +{" "}
              <span className="text-zinc-300">
                {excludedRounds.toLocaleString()}
              </span>{" "}
              excluded (Welcome 100Z, Special grid rewards, Premier 401Z/402Z,
              leaderboard rewards, Pass+, offline scans) ={" "}
              <span className="text-zinc-200">
                {data.totals.roundCount.toLocaleString()}
              </span>{" "}
              total rounds.
            </div>
            <div>
              <span className="text-zinc-200">On-Chain Mints:</span>{" "}
              SUM(collections.total_mints) across{" "}
              <span className="text-zinc-300">
                {data.totals.collectionCount.toLocaleString()}
              </span>{" "}
              collections ={" "}
              <span className="text-zinc-200">
                {data.totals.totalMints.toLocaleString()}
              </span>{" "}
              primary Transfer(0x0 → wallet) mints on Polygon + Abstract.
            </div>
            {totalSpins > 0 && (
              <div>
                <span className="text-zinc-200">Spin Burn Rate:</span>{" "}
                <span className="text-zinc-300">
                  {totalSpins.toLocaleString()} ÷{" "}
                  {data.totals.totalMints.toLocaleString()}
                </span>{" "}
                ={" "}
                <span className="text-zinc-200">{spinRatePct.toFixed(2)}%</span>{" "}
                transferred to COSMO Spin contract (0xd3d5…345f).
              </div>
            )}
            {abstractChain && (
              <div>
                <span className="text-zinc-200">Indexer Cursor:</span> Abstract
                block{" "}
                <span className="text-zinc-300">
                  #{abstractChain.lastIndexedBlock.toLocaleString()}
                </span>
                {abstractChain.lastIndexedTimestamp
                  ? ` (${abstractChain.lastIndexedTimestamp.slice(0, 19).replace("T", " ")} UTC)`
                  : ""}
                .
              </div>
            )}
          </div>
        )}
      </header>

      {/* Live Drop Schedule (Current Drop / Active Season + Countdown, Upcoming, Recent Past) */}
      {data.dropSchedule && (
        <DropSchedulePanel
          schedule={data.dropSchedule}
          accentColor={
            data.artist?.accentColor ?? (isArtms ? "#ED0090" : "#22AEFF")
          }
        />
      )}

      {/* Main Split: Demand Index Leaderboard (wide) + Paid Sale Rounds (360px rail) */}
      {rankedMembers.length > 0 ? (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          {/* Demand Index Leaderboard */}
          <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
            <div className="flex flex-col gap-3 border-b border-zinc-800/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-base font-semibold text-white">
                    Demand Index
                  </h2>
                  <MathToggle
                    open={showDemandMath}
                    onToggle={() => setShowDemandMath((v) => !v)}
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  {boardMetric === "buyers"
                    ? `Unique buyers vs. mean across paid drops (≥${minBuyers} buyers · 1.00× = avg).`
                    : `Paid mints vs. mean across paid drops (≥${minBuyers} buyers · 1.00× = avg).`}
                </p>
              </div>
              <div className="inline-flex self-start sm:self-auto rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => setBoardMetric("buyers")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    boardMetric === "buyers"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  Unique Buyers
                </button>
                <button
                  type="button"
                  onClick={() => setBoardMetric("mints")}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    boardMetric === "mints"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  Total Mints
                </button>
              </div>
            </div>

            {showDemandMath && (
              <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
                <div>
                  <span className="text-zinc-200">Qualifying pool:</span>{" "}
                  <span className="text-zinc-300">
                    {qualifyingRounds.toLocaleString()}
                  </span>{" "}
                  paid digital rounds with ≥{minBuyers} unique buyers (excludes
                  Welcome, Special, Premier rewards, Pass+, and offline scans).
                </div>
                <div>
                  <span className="text-zinc-200">Formula:</span>{" "}
                  {boardMetric === "buyers"
                    ? "Index = AVG(member_buyers ÷ round_mean_buyers) · Round Buyers = SUM(distinct buyers per round) · Avg/Buyer = SUM(mints) ÷ SUM(buyers)."
                    : "Index = AVG(member_mints ÷ round_mean_mints) · Paid Mints = SUM(primary mints per round) · Avg/Buyer = SUM(mints) ÷ SUM(buyers)."}
                </div>
                {topMember?.stats && (
                  <div>
                    <span className="text-zinc-200">
                      Worked check (#1 {topMember.name}):
                    </span>{" "}
                    <span className="text-zinc-300">
                      {topMember.stats.totalMints.toLocaleString()} ÷{" "}
                      {topMember.stats.totalUniqueBuyers.toLocaleString()}
                    </span>{" "}
                    ={" "}
                    <span className="text-zinc-200">
                      {topMember.stats.avgMintsPerBuyer?.toFixed(2) ?? "—"}
                    </span>{" "}
                    mints/buyer across{" "}
                    <span className="text-zinc-300">
                      {topMember.stats.roundsCount}
                    </span>{" "}
                    rounds · index{" "}
                    <span className="text-zinc-200">
                      {(boardMetric === "buyers"
                        ? (topMember.stats.avgBuyersRelativeIndex ?? 1)
                        : (topMember.stats.avgRelativeIndex ?? 1)
                      ).toFixed(3)}
                      ×
                    </span>
                    .
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between border-b border-zinc-800/70 bg-[#0f0f12] px-4 py-2 text-[11px] font-mono uppercase tracking-wide text-zinc-500 sm:px-5">
              <span>Member</span>
              <div className="flex items-center gap-4 sm:gap-6">
                <span className="w-24 text-right">
                  {boardMetric === "buyers" ? "Round Buyers" : "Paid Mints"}
                </span>
                <span
                  className="hidden sm:inline-block w-20 text-right"
                  title="Average Objekts minted per unique buyer in a qualifying paid round"
                >
                  Avg / Buyer
                </span>
                <span
                  className="w-14 text-right"
                  title="Relative demand vs. round average (1.00× = exact average)"
                >
                  Index
                </span>
              </div>
            </div>

            <div className="divide-y divide-zinc-800/60">
              {visibleRankedMembers.map((m, i) => {
                const rel =
                  boardMetric === "buyers"
                    ? (m.stats?.avgBuyersRelativeIndex ?? 1)
                    : (m.stats?.avgRelativeIndex ?? 1);
                const widthPct = Math.max(
                  6,
                  Math.min(100, (rel / maxRelIdx) * 100),
                );
                const avgTickPct = Math.min(100, (1 / maxRelIdx) * 100);
                const rowProof = m.stats
                  ? `${m.name}: ${m.stats.totalUniqueBuyers.toLocaleString()} round-buyers & ${m.stats.totalMints.toLocaleString()} paid mints across ${m.stats.roundsCount} rounds · avg ${m.stats.avgMintsPerBuyer?.toFixed(2) ?? "—"} mints/buyer · index ${rel.toFixed(3)}× (avg rank #${m.stats.avgBuyersRank?.toFixed(1) ?? "—"})`
                  : m.name;

                return (
                  <Link
                    key={m.id}
                    to="/members/$memberId"
                    params={{ memberId: m.id }}
                    title={rowProof}
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
                          className="h-2.5 w-2.5 rounded-[2px] shrink-0 ring-1 ring-inset ring-white/15"
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
                        <span className="hidden sm:inline-block w-20 text-right text-xs text-zinc-400">
                          {m.stats?.avgMintsPerBuyer
                            ? m.stats.avgMintsPerBuyer.toFixed(1)
                            : "—"}
                        </span>
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
                          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.14)",
                        }}
                      />
                      <div
                        className="pointer-events-none absolute inset-y-0 w-[1.5px] bg-zinc-200/75"
                        style={{ left: `${avgTickPct}%` }}
                      />
                    </div>
                  </Link>
                );
              })}
            </div>

            {rankedMembers.length > 10 && (
              <div className="flex items-center justify-between border-t border-zinc-800/80 px-4 py-2.5 sm:px-5">
                <span className="font-mono text-[11px] text-zinc-500">
                  Showing {visibleRankedMembers.length} of {rankedMembers.length}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllMembers((v) => !v)}
                  className="text-xs font-medium text-zinc-300 hover:text-white transition-colors"
                >
                  {showAllMembers
                    ? "Show top 10"
                    : `Show all ${rankedMembers.length} →`}
                </button>
              </div>
            )}
          </div>

          {/* Narrow Paid Sale Rounds Rail (grouped by event) */}
          <aside className="rounded-lg border border-zinc-800/90 bg-[#121215]">
            <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800/90 px-4 py-4">
              <div>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-base font-semibold text-white">
                    Paid Sale Rounds
                  </h2>
                  <MathToggle
                    open={showRoundsMath}
                    onToggle={() => setShowRoundsMath((v) => !v)}
                  />
                </div>
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

            {showRoundsMath && (
              <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1">
                <div>
                  <span className="text-zinc-200">Filter:</span> Paid digital
                  drops only (excludes Welcome, Special grid rewards, Premier
                  401Z/402Z, leaderboard rewards, Pass+, offline scans).
                </div>
                <div>
                  <span className="text-zinc-200">Grouping:</span> Multi-card
                  sets (e.g. 368–370Z) sum mints across cards and show peak
                  lead-card buyers.
                </div>
                <div>
                  <span className="text-zinc-200">+ suffix:</span> Indicates
                  either multi-card peak buyers or a single-member live lower
                  bound before full wallet deduplication.
                </div>
              </div>
            )}

            <div className="divide-y divide-zinc-800/60">
              {displayRounds.map((g) => {
                const r = g.lead;
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

                const groupProof =
                  g.cards.length > 1
                    ? `${g.cards.length} cards grouped: ${g.cards
                        .map(
                          (c) =>
                            `${extractColNo(c.title, c.slug) ?? c.slug} (${c.totalMints.toLocaleString()})`,
                        )
                        .join(" + ")} = ${g.totalMints.toLocaleString()} mints · lead card peak ${g.displayBuyers.toLocaleString()} buyers`
                    : `${r.slug}: ${r.totalMints.toLocaleString()} mints across ${r.participatingMembers} members · ${g.displayBuyers.toLocaleString()}${g.buyersHasPlus ? "+ (single-member lower bound)" : " distinct"} buyers`;

                return (
                  <Link
                    key={g.key}
                    to="/rounds/$slug"
                    params={{ slug: r.slug }}
                    title={groupProof}
                    className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[13px] font-medium text-zinc-100 group-hover:text-white truncate">
                        {g.displayTitle}
                        {g.cardTag && (
                          <span className="ml-1.5 font-mono text-[11px] font-normal text-zinc-500">
                            {g.cardTag}
                          </span>
                        )}
                      </p>
                      <span className="font-mono text-xs font-semibold text-zinc-100 tabular-nums shrink-0">
                        {g.displayBuyers.toLocaleString()}
                        {g.buyersHasPlus ? "+" : ""}
                        <span className="ml-1 font-normal text-zinc-500">
                          buyers
                        </span>
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                      <span className="font-mono tabular-nums truncate">
                        {g.startAt.slice(0, 10)} · {g.totalMints.toLocaleString()}{" "}
                        mints
                      </span>
                      {leader && (
                        <span className="inline-flex items-center gap-1.5 text-zinc-400 shrink-0">
                          <span
                            className="h-2 w-2 rounded-[2px] ring-1 ring-inset ring-white/15"
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

      {/* Rank Movers & Notable Shifts — items-start eliminates empty stretched voids */}
      {(data.anomalies.length > 0 ||
        data.movers.risers.length > 0 ||
        data.movers.fallers.length > 0) && (
        <section className="grid gap-6 lg:grid-cols-2 items-start">
          {(data.movers.risers.length > 0 || data.movers.fallers.length > 0) && (
            <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    Latest Round Movers
                  </h2>
                  <MathToggle
                    open={showMoversMath}
                    onToggle={() => setShowMoversMath((v) => !v)}
                  />
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Buyers-rank shifts in{" "}
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

              {showMoversMath && (
                <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
                  <div>
                    <span className="text-zinc-200">Formula:</span> Δ =
                    prev_buyers_rank − curr_buyers_rank vs. prior comparable
                    roster-size paid round (positive = climbed).
                  </div>
                  <div>
                    <span className="text-zinc-200">Round:</span>{" "}
                    <span className="text-zinc-300">
                      {data.movers.roundSlug}
                    </span>
                    {data.movers.roundStartAt
                      ? ` · ${data.movers.roundStartAt.slice(0, 10)}`
                      : ""}
                    {data.movers.participatingMembers
                      ? ` · ${data.movers.participatingMembers} members`
                      : ""}
                    {data.movers.roundUniqueBuyers
                      ? ` · ${data.movers.roundUniqueBuyers.toLocaleString()} buyers`
                      : ""}
                    .
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 sm:divide-x divide-zinc-800/70">
                <div className="divide-y divide-zinc-800/60">
                  <div className="bg-[#0f0f12] px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-emerald-400/90">
                    Risers
                  </div>
                  {data.movers.risers.length > 0 ? (
                    data.movers.risers.map((r) => {
                      const currRank = r.uniqueBuyersRank ?? r.rank;
                      const prevRank =
                        r.prevBuyersRank ?? currRank + (r.rankDeltaPrev ?? 0);
                      return (
                        <Link
                          key={r.memberId}
                          to="/members/$memberId"
                          params={{ memberId: r.memberId }}
                          title={`${r.memberName}: buyers rank #${prevRank} → #${currRank} (+${r.rankDeltaPrev})${r.uniqueBuyers ? ` · ${r.uniqueBuyers.toLocaleString()} buyers` : ""}${r.uniqueBuyersRelativeIndex ? ` (${r.uniqueBuyersRelativeIndex.toFixed(2)}× round mean)` : ""}`}
                          className="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-zinc-900/70"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2 w-2 rounded-[2px] shrink-0 ring-1 ring-inset ring-white/15"
                              style={{ backgroundColor: r.hexColor }}
                            />
                            <span className="font-medium text-zinc-200 truncate">
                              {r.memberName}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-emerald-400 shrink-0">
                            <span className="text-zinc-500">#{prevRank}→</span>#
                            {currRank} (+{r.rankDeltaPrev})
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="px-4 py-2.5 text-xs text-zinc-500">
                      None in this round
                    </div>
                  )}
                </div>

                <div className="divide-y divide-zinc-800/60 border-t border-zinc-800/70 sm:border-t-0">
                  <div className="bg-[#0f0f12] px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-rose-400/90">
                    Fallers
                  </div>
                  {data.movers.fallers.length > 0 ? (
                    data.movers.fallers.map((r) => {
                      const currRank = r.uniqueBuyersRank ?? r.rank;
                      const prevRank =
                        r.prevBuyersRank ?? currRank + (r.rankDeltaPrev ?? 0);
                      return (
                        <Link
                          key={r.memberId}
                          to="/members/$memberId"
                          params={{ memberId: r.memberId }}
                          title={`${r.memberName}: buyers rank #${prevRank} → #${currRank} (${r.rankDeltaPrev})${r.uniqueBuyers ? ` · ${r.uniqueBuyers.toLocaleString()} buyers` : ""}${r.uniqueBuyersRelativeIndex ? ` (${r.uniqueBuyersRelativeIndex.toFixed(2)}× round mean)` : ""}`}
                          className="flex items-center justify-between px-4 py-2.5 text-xs transition-colors hover:bg-zinc-900/70"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2 w-2 rounded-[2px] shrink-0 ring-1 ring-inset ring-white/15"
                              style={{ backgroundColor: r.hexColor }}
                            />
                            <span className="font-medium text-zinc-200 truncate">
                              {r.memberName}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-rose-400 shrink-0">
                            <span className="text-zinc-500">#{prevRank}→</span>#
                            {currRank} ({r.rankDeltaPrev})
                          </span>
                        </Link>
                      );
                    })
                  ) : (
                    <div className="px-4 py-2.5 text-xs text-zinc-500">
                      None in this round
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {data.anomalies.length > 0 && (
            <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
              <div className="border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    Notable Demand Shifts
                  </h2>
                  <MathToggle
                    open={showShiftsMath}
                    onToggle={() => setShowShiftsMath((v) => !v)}
                  />
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Outliers vs. trailing 5-round buyer-share baseline
                </p>
              </div>

              {showShiftsMath && (
                <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
                  <div>
                    <span className="text-zinc-200">Trigger rule:</span> Flags
                    outliers where buyer-share index shifts ≥
                    {isArtms ? "22%" : "25%"} vs. trailing 5 comparable-roster
                    paid rounds AND |ΔZ| ≥ {isArtms ? "1.4σ" : "1.5σ"} (or
                    strong rank-percentile + Z agreement).
                  </div>
                  <div>
                    <span className="text-zinc-200">Metric:</span> Ranked by
                    unique buyers per member (not raw mints) so single-wallet
                    whales cannot trigger false surges. Active drops still in
                    staggered rollout (&lt;72h seasonal / &lt;24h shop) wait
                    until rollout finishes.
                  </div>
                </div>
              )}

              <div className="divide-y divide-zinc-800/60">
                {data.anomalies.slice(0, 4).map((a) => {
                  const buyersRank = a.uniqueBuyersRank ?? a.rank;
                  const relIdx = a.uniqueBuyersRelativeIndex ?? a.relativeIndex;
                  return (
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
                            className="h-2 w-2 rounded-[2px] ring-1 ring-inset ring-white/15"
                            style={{ backgroundColor: a.hexColor }}
                          />
                          {a.memberName}
                          <span className="font-mono text-zinc-500">
                            #{buyersRank} · {a.uniqueBuyers.toLocaleString()}{" "}
                            buyers
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
                      <p className="font-mono text-[11px] text-zinc-500">
                        {a.startAt.slice(0, 10)} · index {relIdx.toFixed(2)}×
                        {a.rolling5RelativeIndex
                          ? ` · 5-rd avg ${a.rolling5RelativeIndex.toFixed(2)}×`
                          : ""}
                        {a.zScore !== undefined
                          ? ` · Z ${a.zScore > 0 ? "+" : ""}${a.zScore.toFixed(2)}σ`
                          : ""}
                        {a.nearestEvent
                          ? ` · ${a.nearestEvent.eventDate}: ${a.nearestEvent.title}`
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Member Roster */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold text-white">
              {isArtms ? "ARTMS Roster" : "tripleS S1–S24"}
            </h2>
            <MathToggle
              open={showRosterMath}
              onToggle={() => setShowRosterMath((v) => !v)}
            />
          </div>
          <Link
            to="/members"
            search={searchParam}
            className="text-xs text-zinc-400 hover:text-white transition-colors"
          >
            Full matrix →
          </Link>
        </div>

        {showRosterMath && (
          <div className="rounded-md border border-zinc-800/80 bg-[#0f0f12] px-4 py-2.5 font-mono text-[11px] text-zinc-400">
            <span className="text-zinc-200">avg #X.X:</span> Mean unique-buyers
            rank across each member&apos;s qualifying paid digital rounds (≥
            {minBuyers} buyers · {qualifyingRounds.toLocaleString()} rounds
            total).
          </div>
        )}

        <div
          className={
            isArtms
              ? "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5"
              : "grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
          }
        >
          {data.members.map((m) => {
            const hasDistinctFullName =
              m.fullName.trim().toLowerCase() !== m.name.trim().toLowerCase();
            return (
              <Link
                key={m.id}
                to="/members/$memberId"
                params={{ memberId: m.id }}
                title={
                  m.stats?.avgBuyersRank != null
                    ? `${m.name} (${m.code}): mean unique-buyers rank #${m.stats.avgBuyersRank.toFixed(2)} across ${m.stats.roundsCount} qualifying paid rounds`
                    : `${m.name} (${m.code})`
                }
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
                    {hasDistinctFullName ? m.fullName : ""}
                  </span>
                  {m.stats?.avgBuyersRank !== null &&
                    m.stats?.avgBuyersRank !== undefined && (
                      <span className="text-zinc-300 tabular-nums shrink-0">
                        <span className="text-zinc-500">avg </span>#
                        {m.stats.avgBuyersRank.toFixed(1)}
                      </span>
                    )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
