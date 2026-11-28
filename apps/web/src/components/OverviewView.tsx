import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
    allTime?: {
      uniquePaidBuyers: number | null;
      uniqueAllMinters: number | null;
      paidMints: number;
      allTimeMints: number;
      spunCount: number;
      paidSpunCount: number;
      spinRatePct: number;
      paidSpinRatePct: number;
    };
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
    randomPackRoundCount?: number;
    collectionCount: number;
    totalMints: number;
    paidDigitalMints?: number;
    totalSpins?: number;
    estGrossUsd: number;
    uniquePaidBuyers?: number | null;
    uniqueAllMinters?: number | null;
    buyersSnapshotBlock?: number | null;
    buyersSnapshotAt?: string | null;
  };
}

type RoundItem = OverviewData["rounds"][number];
type MemberSortKey = "index" | "buyers" | "purchased" | "spun" | "order";

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

function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

/**
 * Collapses same-event multi-card sets (e.g. Autumn Breeze 368Z/369Z/370Z) into
 * single clean Overview entries while preserving exact component breakdowns
 * in the hover proof tooltip.
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
  const [sortKey, setSortKey] = useState<MemberSortKey>("index");
  const [showHeroMath, setShowHeroMath] = useState(false);
  const [showDemandMath, setShowDemandMath] = useState(false);
  const [showRoundsMath, setShowRoundsMath] = useState(false);
  const [showMoversMath, setShowMoversMath] = useState(false);
  const [showShiftsMath, setShowShiftsMath] = useState(false);

  const isArtms = artistSlug === "artms";
  const artistName = data.artist?.name ?? (isArtms ? "ARTMS" : "tripleS");
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  const searchParam = isArtms ? { artist: "artms" as const } : {};
  const minBuyers = data.calcMeta?.minLeaderboardBuyers ?? (isArtms ? 50 : 150);
  const qualifyingRounds = data.calcMeta?.qualifyingPopularityRoundCount ?? 0;
  const randomPackRounds = data.totals.randomPackRoundCount ?? 0;
  const otherNonRankedRounds = Math.max(
    0,
    data.totals.roundCount - data.totals.popularityRoundCount - randomPackRounds,
  );

  // Compute canonical Demand Index rank (1..N) once so it stays visible even when sorted by S1–S24
  const demandRankById = useMemo(() => {
    const byIdx = [...data.members]
      .filter((m) => (m.allTime?.allTimeMints ?? m.stats?.totalMints ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.stats?.avgBuyersRelativeIndex ?? 0) -
            (a.stats?.avgBuyersRelativeIndex ?? 0) ||
          (b.allTime?.uniquePaidBuyers ?? 0) - (a.allTime?.uniquePaidBuyers ?? 0),
      );
    const map = new Map<string, number>();
    byIdx.forEach((m, idx) => map.set(m.id, idx + 1));
    return map;
  }, [data.members]);

  const sortedMembers = useMemo(() => {
    const active = data.members.filter(
      (m) => (m.allTime?.allTimeMints ?? m.stats?.totalMints ?? 0) > 0,
    );
    return [...active].sort((a, b) => {
      if (sortKey === "order") {
        return a.memberOrder - b.memberOrder;
      }
      if (sortKey === "buyers") {
        return (
          (b.allTime?.uniquePaidBuyers ?? 0) - (a.allTime?.uniquePaidBuyers ?? 0) ||
          (b.allTime?.paidMints ?? 0) - (a.allTime?.paidMints ?? 0)
        );
      }
      if (sortKey === "purchased") {
        return (
          (b.allTime?.paidMints ?? 0) - (a.allTime?.paidMints ?? 0) ||
          (b.allTime?.uniquePaidBuyers ?? 0) - (a.allTime?.uniquePaidBuyers ?? 0)
        );
      }
      if (sortKey === "spun") {
        return (
          (b.allTime?.spunCount ?? 0) - (a.allTime?.spunCount ?? 0) ||
          (b.allTime?.spinRatePct ?? 0) - (a.allTime?.spinRatePct ?? 0)
        );
      }
      return (
        (b.stats?.avgBuyersRelativeIndex ?? 0) -
          (a.stats?.avgBuyersRelativeIndex ?? 0) ||
        (b.allTime?.uniquePaidBuyers ?? 0) - (a.allTime?.uniquePaidBuyers ?? 0)
      );
    });
  }, [data.members, sortKey]);

  const maxRelIdx = Math.max(
    1.35,
    ...sortedMembers.map((m) => m.stats?.avgBuyersRelativeIndex ?? 1),
  );
  const topByDemand =
    sortedMembers.find((m) => demandRankById.get(m.id) === 1) ??
    sortedMembers[0] ??
    null;

  const displayRounds = groupOverviewRounds(data.rounds, isArtms ? 6 : 8);

  const totalSpins = data.totals.totalSpins ?? 0;
  const spinRatePct =
    data.totals.totalMints > 0
      ? (totalSpins / data.totals.totalMints) * 100
      : 0;
  const paidDigitalMints = data.totals.paidDigitalMints ?? 0;
  const abstractChain = data.syncState.find((s) => s.chain === "abstract");
  const isCatchingUp =
    data.abstractLagMinutes !== null &&
    data.abstractLagMinutes !== undefined &&
    data.abstractLagMinutes >= 30;

  const memberOrderLabel = isArtms ? "A1–A5" : "S1–S24";

  return (
    <div className="space-y-8">
      {/* Compact Editorial Header + Fan-Readable Hero Stats */}
      <header className="border-b border-zinc-800/90 pb-6 space-y-5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-baseline sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {artistName}{" "}
              <span className="font-normal text-zinc-400">Objekt Stats</span>
            </h1>
            <p className="text-sm text-zinc-400">
              All-time unique COSMO buyers, paid primary mints, Spin burns, and
              member demand across Polygon and Abstract.
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
            {data.totals.uniquePaidBuyers !== null &&
              data.totals.uniquePaidBuyers !== undefined && (
                <>
                  <div
                    title={`Exact distinct COSMO wallets with ≥1 paid digital ${artistName} mint (${(data.totals.uniqueAllMinters ?? 0).toLocaleString()} total wallets incl. free/physical · through Abstract block #${(data.totals.buyersSnapshotBlock ?? 0).toLocaleString()})`}
                  >
                    <div className="text-xs text-zinc-500">Unique Buyers</div>
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-white tabular-nums">
                        {data.totals.uniquePaidBuyers.toLocaleString()}
                      </span>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        paid wallets
                      </span>
                    </div>
                  </div>
                  <div className="hidden sm:block h-8 w-px bg-zinc-800/90 self-center" />
                </>
              )}

            <div
              title={`SUM(collections.total_mints) across ${data.totals.collectionCount.toLocaleString()} collections on Polygon + Abstract (${paidDigitalMints.toLocaleString()} paid digital)`}
            >
              <div className="text-xs text-zinc-500">On-Chain Mints</div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold text-white tabular-nums">
                  {data.totals.totalMints.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {paidDigitalMints > 0
                    ? `${formatCompactCount(paidDigitalMints)} paid`
                    : `${data.totals.collectionCount.toLocaleString()} sets`}
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

            <div className="hidden sm:block h-8 w-px bg-zinc-800/90 self-center" />

            <Link
              to="/rounds"
              search={searchParam}
              className="group block"
              title={`${data.totals.roundCount.toLocaleString()} total indexed releases: ${data.totals.popularityRoundCount.toLocaleString()} member-select paid drops + ${randomPackRounds.toLocaleString()} paid random/unit packs + ${otherNonRankedRounds.toLocaleString()} free rewards, Pass+ & physical QR scans`}
            >
              <div className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                Indexed Releases{" "}
                <span className="text-zinc-600 group-hover:text-zinc-400">
                  →
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-2">
                <span className="font-mono text-xl font-semibold text-white tabular-nums">
                  {data.totals.roundCount.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  {data.totals.popularityRoundCount.toLocaleString()} ranked
                </span>
              </div>
            </Link>
          </div>

          <MathToggle
            open={showHeroMath}
            onToggle={() => setShowHeroMath((v) => !v)}
            label="Verify math"
          />
        </div>

        {showHeroMath && (
          <div className="rounded-md border border-zinc-800/80 bg-[#0f0f12] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1">
            {data.totals.uniquePaidBuyers !== null &&
              data.totals.uniquePaidBuyers !== undefined && (
                <div>
                  <span className="text-zinc-200">Unique Buyers:</span>{" "}
                  <span className="text-zinc-300">
                    {data.totals.uniquePaidBuyers.toLocaleString()}
                  </span>{" "}
                  distinct COSMO wallets with ≥1 paid digital mint (
                  <span className="text-zinc-300">
                    {(data.totals.uniqueAllMinters ?? 0).toLocaleString()}
                  </span>{" "}
                  distinct wallets incl. free Welcome, SCO, promos &amp; physical
                  scans), deduplicated across Polygon + Abstract through block{" "}
                  <span className="text-zinc-300">
                    #{(data.totals.buyersSnapshotBlock ?? 0).toLocaleString()}
                  </span>
                  {data.totals.buyersSnapshotAt
                    ? ` (${data.totals.buyersSnapshotAt.slice(0, 10)})`
                    : ""}
                  .
                </div>
              )}
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
              total ({paidDigitalMints.toLocaleString()} paid digital primary
              mints).
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
            <div>
              <span className="text-zinc-200">Indexed Releases:</span>{" "}
              <span className="text-zinc-300">
                {data.totals.popularityRoundCount.toLocaleString()}
              </span>{" "}
              member-select paid drops (feed Demand Index) +{" "}
              <span className="text-zinc-300">
                {randomPackRounds.toLocaleString()}
              </span>{" "}
              paid random/unit packs +{" "}
              <span className="text-zinc-300">
                {otherNonRankedRounds.toLocaleString()}
              </span>{" "}
              free rewards, Pass+, fanclub/airdrops &amp; physical scans ={" "}
              <span className="text-zinc-200">
                {data.totals.roundCount.toLocaleString()}
              </span>{" "}
              total (100% indexed).
            </div>
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

      {/* Full-Width All-Members Overview (Every Member Visible at a Glance) */}
      {sortedMembers.length > 0 ? (
        <section className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="flex flex-col gap-3 border-b border-zinc-800/90 px-4 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-5">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold text-white">
                  {isArtms ? "ARTMS Member Overview" : "Member Overview (All 24)"}
                </h2>
                <MathToggle
                  open={showDemandMath}
                  onToggle={() => setShowDemandMath((v) => !v)}
                />
                <Link
                  to="/members"
                  search={searchParam}
                  className="text-xs text-zinc-400 hover:text-white transition-colors"
                >
                  Full matrix →
                </Link>
              </div>
              <p className="text-xs text-zinc-400">
                All-time unique COSMO buyers, paid Objekts purchased, Spin burns,
                and equal-footing Demand Index across member-select drops.
              </p>
            </div>

            <div className="inline-flex flex-wrap self-start lg:self-auto rounded-md border border-zinc-800 bg-[#0c0c0e] p-0.5 text-xs shrink-0">
              {(
                [
                  ["index", "Demand Index"],
                  ["buyers", "Unique Buyers"],
                  ["purchased", "Purchased"],
                  ["spun", "Spun"],
                  ["order", memberOrderLabel],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`rounded-[4px] px-2.5 py-1 font-medium transition-colors whitespace-nowrap ${
                    sortKey === key
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {showDemandMath && (
            <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
              <div>
                <span className="text-zinc-200">Unique Buyers:</span> Exact
                all-time COUNT(DISTINCT minter) across all paid digital FCO,
                Motion, selectable DCO &amp; paid random/unit packs on Polygon +
                Abstract (deduplicated through block #
                {(data.totals.buyersSnapshotBlock ?? 0).toLocaleString()}).
                Excludes Welcome, SCO, promos, Pass+, free airdrops &amp;
                physical scans.
              </div>
              <div>
                <span className="text-zinc-200">Purchased:</span> Live
                SUM(collections.total_mints) across paid digital collections for
                each member.
              </div>
              <div>
                <span className="text-zinc-200">Spun:</span> Live
                SUM(collections.spun_count) transferred to COSMO Spin ·{" "}
                <span className="text-zinc-300">%</span> = Spun ÷ All-Time Member
                Mints (hover any row for paid-only spin rate).
              </div>
              <div>
                <span className="text-zinc-200">Demand Index:</span> Equal-footing
                AVG(member_buyers ÷ round_mean_buyers) across{" "}
                <span className="text-zinc-300">
                  {qualifyingRounds.toLocaleString()}
                </span>{" "}
                member-select paid drops (≥{minBuyers} buyers · 1.00× = exact
                round average; excludes random &amp; unit-random packs so every
                member is judged fairly regardless of reveal date).
              </div>
              {topByDemand && topByDemand.allTime && topByDemand.stats && (
                <div>
                  <span className="text-zinc-200">
                    Worked check (#1 {topByDemand.name}):
                  </span>{" "}
                  <span className="text-zinc-300">
                    {(topByDemand.allTime.uniquePaidBuyers ?? 0).toLocaleString()}
                  </span>{" "}
                  unique buyers ·{" "}
                  <span className="text-zinc-300">
                    {topByDemand.allTime.paidMints.toLocaleString()}
                  </span>{" "}
                  purchased ·{" "}
                  <span className="text-zinc-300">
                    {topByDemand.allTime.spunCount.toLocaleString()} ÷{" "}
                    {topByDemand.allTime.allTimeMints.toLocaleString()}
                  </span>{" "}
                  ={" "}
                  <span className="text-zinc-200">
                    {topByDemand.allTime.spinRatePct.toFixed(1)}%
                  </span>{" "}
                  spun · index{" "}
                  <span className="text-zinc-200">
                    {(topByDemand.stats.avgBuyersRelativeIndex ?? 1).toFixed(3)}×
                  </span>{" "}
                  across {topByDemand.stats.roundsCount} ranked drops.
                </div>
              )}
            </div>
          )}

          {/* Desktop Column Headers */}
          <div className="hidden md:grid md:grid-cols-[2.25rem_minmax(150px,1.25fr)_minmax(105px,0.85fr)_minmax(105px,0.85fr)_minmax(135px,1fr)_minmax(190px,1.5fr)] items-center gap-3 border-b border-zinc-800/70 bg-[#0f0f12] px-5 py-2 font-mono text-[11px] uppercase tracking-wide text-zinc-500">
            <span>#</span>
            <button
              type="button"
              onClick={() => setSortKey("order")}
              className={`text-left transition-colors hover:text-zinc-200 ${
                sortKey === "order" ? "text-zinc-200" : ""
              }`}
            >
              Member {sortKey === "order" ? "↑" : ""}
            </button>
            <button
              type="button"
              onClick={() => setSortKey("buyers")}
              className={`text-right transition-colors hover:text-zinc-200 ${
                sortKey === "buyers" ? "text-zinc-200" : ""
              }`}
              title="All-time distinct COSMO wallets that purchased this member"
            >
              Unique Buyers {sortKey === "buyers" ? "↓" : ""}
            </button>
            <button
              type="button"
              onClick={() => setSortKey("purchased")}
              className={`text-right transition-colors hover:text-zinc-200 ${
                sortKey === "purchased" ? "text-zinc-200" : ""
              }`}
              title="All-time paid digital Objekts minted for this member"
            >
              Purchased {sortKey === "purchased" ? "↓" : ""}
            </button>
            <button
              type="button"
              onClick={() => setSortKey("spun")}
              className={`text-right transition-colors hover:text-zinc-200 ${
                sortKey === "spun" ? "text-zinc-200" : ""
              }`}
              title="Total Objekts sent to COSMO Spin (% of all member mints)"
            >
              Spun {sortKey === "spun" ? "↓" : ""}
            </button>
            <button
              type="button"
              onClick={() => setSortKey("index")}
              className={`text-right transition-colors hover:text-zinc-200 ${
                sortKey === "index" ? "text-zinc-200" : ""
              }`}
              title="Equal-footing demand vs. round average across member-select drops (1.00× = avg)"
            >
              Demand Index {sortKey === "index" ? "↓" : ""}
            </button>
          </div>

          <div className="divide-y divide-zinc-800/60">
            {sortedMembers.map((m, i) => {
              const rel = m.stats?.avgBuyersRelativeIndex ?? 1;
              const widthPct = Math.max(
                6,
                Math.min(100, (rel / maxRelIdx) * 100),
              );
              const avgTickPct = Math.min(100, (1 / maxRelIdx) * 100);
              const at = m.allTime;
              const displayRank =
                sortKey === "order"
                  ? (demandRankById.get(m.id) ?? i + 1)
                  : i + 1;

              const rowProof = [
                `${m.name} (${m.code}) · Demand #${demandRankById.get(m.id) ?? i + 1}`,
                at?.uniquePaidBuyers != null
                  ? `Unique Buyers: ${at.uniquePaidBuyers.toLocaleString()} paid (${(at.uniqueAllMinters ?? 0).toLocaleString()} incl. free/phys)`
                  : null,
                at
                  ? `Purchased: ${at.paidMints.toLocaleString()} paid digital (${at.allTimeMints.toLocaleString()} total mints)`
                  : null,
                at
                  ? `Spun: ${at.spunCount.toLocaleString()} (${at.spinRatePct.toFixed(1)}% of all · ${at.paidSpinRatePct.toFixed(1)}% of paid)`
                  : null,
                m.stats
                  ? `Demand Index: ${rel.toFixed(3)}× across ${m.stats.roundsCount} member-select drops (avg rank #${m.stats.avgBuyersRank?.toFixed(1) ?? "—"})`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <Link
                  key={m.id}
                  to="/members/$memberId"
                  params={{ memberId: m.id }}
                  title={rowProof}
                  className="group block px-4 py-2.5 transition-colors hover:bg-zinc-900/70 sm:px-5"
                >
                  {/* Desktop Row */}
                  <div className="hidden md:grid md:grid-cols-[2.25rem_minmax(150px,1.25fr)_minmax(105px,0.85fr)_minmax(105px,0.85fr)_minmax(135px,1fr)_minmax(190px,1.5fr)] items-center gap-3">
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        displayRank === 1
                          ? "font-semibold text-white"
                          : "text-zinc-500"
                      }`}
                    >
                      {sortKey === "order" ? `#${displayRank}` : displayRank}
                    </span>

                    <div className="flex items-center gap-2.5 min-w-0">
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

                    <div
                      className={`text-right font-mono text-sm tabular-nums ${
                        sortKey === "buyers"
                          ? "font-semibold text-white"
                          : "text-zinc-100"
                      }`}
                    >
                      {at?.uniquePaidBuyers != null
                        ? at.uniquePaidBuyers.toLocaleString()
                        : "—"}
                    </div>

                    <div
                      className={`text-right font-mono text-sm tabular-nums ${
                        sortKey === "purchased"
                          ? "font-semibold text-white"
                          : "text-zinc-300"
                      }`}
                    >
                      {at ? at.paidMints.toLocaleString() : "—"}
                    </div>

                    <div className="text-right font-mono text-sm tabular-nums whitespace-nowrap">
                      <span
                        className={
                          sortKey === "spun"
                            ? "font-semibold text-white"
                            : "text-zinc-300"
                        }
                      >
                        {at ? at.spunCount.toLocaleString() : "—"}
                      </span>
                      {at && at.allTimeMints > 0 && (
                        <span className="ml-1.5 text-xs text-zinc-500">
                          {at.spinRatePct.toFixed(0)}%
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-[2px] bg-zinc-800/90">
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
                      <span
                        className={`w-12 text-right font-mono text-sm tabular-nums shrink-0 ${
                          sortKey === "index"
                            ? "font-semibold text-white"
                            : "text-zinc-200"
                        }`}
                      >
                        {rel.toFixed(2)}×
                      </span>
                    </div>
                  </div>

                  {/* Mobile Card Row */}
                  <div className="md:hidden space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 font-mono text-xs tabular-nums shrink-0 ${
                            displayRank === 1
                              ? "font-semibold text-white"
                              : "text-zinc-500"
                          }`}
                        >
                          {sortKey === "order" ? `#${displayRank}` : displayRank}
                        </span>
                        <span
                          className="h-2.5 w-2.5 rounded-[2px] shrink-0 ring-1 ring-inset ring-white/15"
                          style={{ backgroundColor: m.hexColor }}
                        />
                        <span className="text-sm font-medium text-zinc-100 truncate">
                          {m.name}
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500 shrink-0">
                          {m.code}
                        </span>
                      </div>
                      <span className="font-mono text-sm font-semibold text-white tabular-nums shrink-0">
                        {rel.toFixed(2)}×
                      </span>
                    </div>

                    <div className="relative ml-8 h-1.5 overflow-hidden rounded-[2px] bg-zinc-800/90">
                      <div
                        className="h-full"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: m.hexColor,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute inset-y-0 w-[1.5px] bg-zinc-200/75"
                        style={{ left: `${avgTickPct}%` }}
                      />
                    </div>

                    <div className="ml-8 grid grid-cols-3 gap-2 font-mono tabular-nums text-xs">
                      <div>
                        <div className="text-[10px] text-zinc-500">Buyers</div>
                        <div className="text-zinc-100 font-medium">
                          {at?.uniquePaidBuyers != null
                            ? at.uniquePaidBuyers.toLocaleString()
                            : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Purchased</div>
                        <div className="text-zinc-200">
                          {at ? at.paidMints.toLocaleString() : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-zinc-500">Spun</div>
                        <div className="text-zinc-200">
                          {at ? at.spunCount.toLocaleString() : "—"}
                          {at && at.allTimeMints > 0 ? (
                            <span className="ml-1 text-zinc-500">
                              {at.spinRatePct.toFixed(0)}%
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
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

      {/* Editorial 2-Column Split: Recent Paid Drops + Movers & Notable Shifts */}
      <section className="grid gap-6 lg:grid-cols-2 items-start">
        {/* Recent Member-Select Paid Drops */}
        <div className="rounded-lg border border-zinc-800/90 bg-[#121215]">
          <div className="flex items-baseline justify-between gap-2 border-b border-zinc-800/90 px-4 py-3.5 sm:px-5">
            <div>
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold text-white">
                  Recent Paid Drops
                </h2>
                <MathToggle
                  open={showRoundsMath}
                  onToggle={() => setShowRoundsMath((v) => !v)}
                />
              </div>
              <p className="mt-0.5 text-xs text-zinc-400">
                Latest member-select COSMO shop releases
              </p>
            </div>
            <Link
              to="/rounds"
              search={searchParam}
              className="text-xs text-zinc-400 hover:text-white shrink-0 transition-colors"
            >
              All {data.totals.roundCount} →
            </Link>
          </div>

          {showRoundsMath && (
            <div className="border-b border-zinc-800/70 bg-[#0d0d10] px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-400 space-y-1 sm:px-5">
              <div>
                <span className="text-zinc-200">Filter:</span> Member-select paid
                digital drops only (excludes random/unit packs, Welcome, Special
                grid rewards, Premier 401Z/402Z, promos, Pass+, offline scans).
              </div>
              <div>
                <span className="text-zinc-200">Grouping:</span> Multi-card sets
                (e.g. 368–370Z) sum mints across cards and show peak lead-card
                buyers.
              </div>
              <div>
                <span className="text-zinc-200">+ suffix:</span> Multi-card peak
                buyers or a single-member live lower bound before full wallet
                deduplication.
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
              const leader = topBuyerMember ?? topMintMember;

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
                  className="group block px-4 py-3 transition-colors hover:bg-zinc-900/70 sm:px-5"
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
                        {r.topSellerByBuyers ? (
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
        </div>

        {/* Right Stack: Latest Round Movers + Notable Demand Shifts */}
        <div className="space-y-6">
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
                    roster-size member-select drop (positive = climbed).
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
                    member-select drops AND |ΔZ| ≥ {isArtms ? "1.4σ" : "1.5σ"} (or
                    strong rank-percentile + Z agreement).
                  </div>
                  <div>
                    <span className="text-zinc-200">Metric:</span> Ranked by
                    unique buyers per member (not raw mints) so single-wallet
                    whales cannot trigger false surges. Random packs and drops
                    still in staggered rollout (&lt;72h seasonal / &lt;24h shop)
                    are excluded.
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
        </div>
      </section>
    </div>
  );
}
