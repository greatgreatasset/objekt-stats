export interface MemberMintInput {
  memberId: string;
  mintCount: number;
  uniqueBuyers?: number;
  topBuyerMints?: number;
}

export interface SaleRoundInput {
  slug: string;
  artistId: string;
  startAt: string; // ISO date or timestamp
  includeInPopularity: boolean;
  memberMints: MemberMintInput[];
}

export interface ComputedRoundMemberStat {
  roundSlug: string;
  memberId: string;
  mintCount: number;
  uniqueBuyers: number;
  mintsPerBuyer: number;
  topBuyerSharePct: number | null;
  rank: number;
  uniqueBuyersRank: number;
  sharePct: number;
  uniqueBuyersSharePct: number;
  relativeIndex: number;
  uniqueBuyersRelativeIndex: number;
  zScore: number;
  rankDeltaPrev: number | null;
  rolling5Rank: number | null;
  rolling10Rank: number | null;
  rolling5RelativeIndex: number | null;
  rolling10RelativeIndex: number | null;
  isAnomaly: boolean;
  anomalyDirection: "surge" | "drop" | null;
  anomalyReason: string | null;
}

export interface TimelineEventInput {
  id: string;
  artistId: string;
  eventDate: string; // YYYY-MM-DD
  endDate?: string | null;
  category: string;
  title: string;
  summary: string;
  members: string[]; // empty array = group-wide event
}

export interface CorrelatedEvent {
  event: TimelineEventInput;
  scope: "member" | "group";
  dayOffset: number; // eventDate - roundDate in days (negative = before round)
}

export interface AnomalyThresholds {
  minRankDelta: number;
  minRelativeIndexPctChange: number;
  minZScoreShift: number;
  /** Minimum roster-normalized percentile shift (0..1) for rank-percentile alerts. */
  minPercentileShift: number;
  /** Minimum participating members in a round before updating baselines or flagging anomalies (excludes 2–5 member subunit drops). */
  minParticipatingMembers: number;
  /** Minimum total unique buyers across a round before anomalies are flagged (filters tiny promo/noise drops). */
  minRoundUniqueBuyers: number;
}

export const DEFAULT_THRESHOLDS_BY_ARTIST: Record<string, AnomalyThresholds> = {
  triples: {
    minRankDelta: 5,
    minRelativeIndexPctChange: 0.25,
    minZScoreShift: 1.5,
    minPercentileShift: 0.35,
    minParticipatingMembers: 6,
    minRoundUniqueBuyers: 150,
  },
  artms: {
    minRankDelta: 2,
    minRelativeIndexPctChange: 0.22,
    minZScoreShift: 1.4,
    minPercentileShift: 0.45,
    minParticipatingMembers: 4,
    minRoundUniqueBuyers: 50,
  },
};

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Computes single-round normalized metrics for each participating member across BOTH
 * Total Mints and Unique Buyers (separating broad fanbase popularity from whale spend):
 * - Standard competition ranking (1, 2, 2, 4 on ties) for both mints and unique buyers
 * - sharePct & uniqueBuyersSharePct (0..100)
 * - relativeIndex & uniqueBuyersRelativeIndex (1.0 = exact round average)
 * - mintsPerBuyer & topBuyerSharePct (whale concentration indicator)
 * - zScore (standard deviations from round mean)
 */
export function computeSingleRoundMetrics(
  round: SaleRoundInput,
): ComputedRoundMemberStat[] {
  const entries = round.memberMints.map((e) => ({
    memberId: e.memberId,
    mintCount: e.mintCount,
    uniqueBuyers: e.uniqueBuyers ?? e.mintCount,
    topBuyerMints: e.topBuyerMints,
  }));
  const n = entries.length;
  if (n === 0) return [];

  const totalMints = entries.reduce((sum, e) => sum + e.mintCount, 0);
  const mean = totalMints / n;
  const variance =
    entries.reduce((sum, e) => sum + (e.mintCount - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  const totalUniqueSum = entries.reduce((sum, e) => sum + e.uniqueBuyers, 0);
  const meanUnique = totalUniqueSum / n;
  const varianceUnique =
    entries.reduce((sum, e) => sum + (e.uniqueBuyers - meanUnique) ** 2, 0) / n;
  const stdDevUnique = Math.sqrt(varianceUnique);

  // Competition rank for unique buyers
  const byUnique = [...entries].sort((a, b) =>
    b.uniqueBuyers !== a.uniqueBuyers
      ? b.uniqueBuyers - a.uniqueBuyers
      : b.mintCount !== a.mintCount
        ? b.mintCount - a.mintCount
        : a.memberId.localeCompare(b.memberId),
  );
  const uniqueRankByMember = new Map<string, number>();
  let uRank = 1;
  byUnique.forEach((entry, idx) => {
    if (idx > 0 && entry.uniqueBuyers < byUnique[idx - 1]!.uniqueBuyers) {
      uRank = idx + 1;
    }
    uniqueRankByMember.set(entry.memberId, uRank);
  });

  // Sort descending by mintCount, tie-break by uniqueBuyers DESC, then memberId
  entries.sort((a, b) =>
    b.mintCount !== a.mintCount
      ? b.mintCount - a.mintCount
      : b.uniqueBuyers !== a.uniqueBuyers
        ? b.uniqueBuyers - a.uniqueBuyers
        : a.memberId.localeCompare(b.memberId),
  );

  let currentRank = 1;
  return entries.map((entry, idx) => {
    if (idx > 0 && entry.mintCount < entries[idx - 1]!.mintCount) {
      currentRank = idx + 1;
    }

    const sharePct = totalMints > 0 ? (entry.mintCount / totalMints) * 100 : 0;
    const relativeIndex = mean > 0 ? entry.mintCount / mean : 1;
    const zScore =
      stdDevUnique > 0
        ? (entry.uniqueBuyers - meanUnique) / stdDevUnique
        : stdDev > 0
          ? (entry.mintCount - mean) / stdDev
          : 0;

    const uniqueBuyersSharePct =
      totalUniqueSum > 0 ? (entry.uniqueBuyers / totalUniqueSum) * 100 : 0;
    const uniqueBuyersRelativeIndex =
      meanUnique > 0 ? entry.uniqueBuyers / meanUnique : 1;
    const mintsPerBuyer =
      entry.uniqueBuyers > 0 ? entry.mintCount / entry.uniqueBuyers : 1;
    const topBuyerSharePct =
      entry.topBuyerMints !== undefined && entry.mintCount > 0
        ? roundTo((entry.topBuyerMints / entry.mintCount) * 100, 2)
        : null;

    return {
      roundSlug: round.slug,
      memberId: entry.memberId,
      mintCount: entry.mintCount,
      uniqueBuyers: entry.uniqueBuyers,
      mintsPerBuyer: roundTo(mintsPerBuyer, 2),
      topBuyerSharePct,
      rank: currentRank,
      uniqueBuyersRank: uniqueRankByMember.get(entry.memberId) ?? currentRank,
      sharePct: roundTo(sharePct, 4),
      uniqueBuyersSharePct: roundTo(uniqueBuyersSharePct, 4),
      relativeIndex: roundTo(relativeIndex, 4),
      uniqueBuyersRelativeIndex: roundTo(uniqueBuyersRelativeIndex, 4),
      zScore: roundTo(zScore, 4),
      rankDeltaPrev: null,
      rolling5Rank: null,
      rolling10Rank: null,
      rolling5RelativeIndex: null,
      rolling10RelativeIndex: null,
      isAnomaly: false,
      anomalyDirection: null,
      anomalyReason: null,
    };
  });
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Computes chronological per-round stats, rolling 5/10 averages, previous-round
 * rank deltas, and automated surge/drop anomaly detection across an artist's rounds.
 *
 * Only rounds with `includeInPopularity === true` feed into rolling baselines and
 * previous-round deltas (so random packs & rewards don't distort member baselines).
 */
export function computeArtistSeriesStats(
  rounds: SaleRoundInput[],
  customThresholds?: Partial<AnomalyThresholds>,
): Map<string, ComputedRoundMemberStat[]> {
  const sorted = [...rounds].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const results = new Map<string, ComputedRoundMemberStat[]>();

  interface HistoryPoint {
    rank: number;
    percentile: number;
    relativeIndex: number;
    zScore: number;
  }

  const memberHistory = new Map<string, HistoryPoint[]>();

  for (const round of sorted) {
    const baseStats = computeSingleRoundMetrics(round);
    const defaults =
      DEFAULT_THRESHOLDS_BY_ARTIST[round.artistId] ??
      DEFAULT_THRESHOLDS_BY_ARTIST.triples!;
    const thresholds: AnomalyThresholds = {
      ...defaults,
      ...customThresholds,
    };

    // Gate anomaly detection & baselines on meaningful round volume and comparable roster size
    // (filters tiny promo/stray mints AND 2–5 member subunit drops whose raw ranks cannot be compared to 24-member rounds)
    const roundBuyerVolume = baseStats.reduce((sum, s) => sum + s.uniqueBuyers, 0);
    const participatingCount = baseStats.length;
    const meetsVolumeThreshold =
      roundBuyerVolume >= thresholds.minRoundUniqueBuyers &&
      participatingCount >= thresholds.minParticipatingMembers;

    for (const stat of baseStats) {
      const history = memberHistory.get(stat.memberId) ?? [];
      const percentile =
        participatingCount > 1
          ? (participatingCount - stat.uniqueBuyersRank) / (participatingCount - 1)
          : 0.5;

      if (round.includeInPopularity && meetsVolumeThreshold) {
        const prev = history[history.length - 1];
        if (prev) {
          stat.rankDeltaPrev = prev.rank - stat.uniqueBuyersRank;
        }

        if (history.length >= 2) {
          const prior5 = history.slice(-5);
          const baselineRank = meanOf(prior5.map((h) => h.rank));
          const baselinePct = meanOf(prior5.map((h) => h.percentile));
          const baselineRelIdx = meanOf(prior5.map((h) => h.relativeIndex));
          const baselineZ = meanOf(prior5.map((h) => h.zScore));

          const rankShift = baselineRank - stat.uniqueBuyersRank;
          const pctShift = percentile - baselinePct;
          const relIdxPctShift =
            baselineRelIdx > 0
              ? (stat.uniqueBuyersRelativeIndex - baselineRelIdx) / baselineRelIdx
              : 0;
          const zShift = stat.zScore - baselineZ;

          // Require directional agreement across standardized buyer share + Z-score + roster-normalized percentile
          const isSurge =
            (relIdxPctShift >= thresholds.minRelativeIndexPctChange &&
              zShift >= thresholds.minZScoreShift) ||
            (zShift >= thresholds.minZScoreShift + 0.65 && relIdxPctShift >= 0.12) ||
            (pctShift >= thresholds.minPercentileShift &&
              relIdxPctShift >= 0.18 &&
              zShift >= 1.1);

          const isDrop =
            (relIdxPctShift <= -thresholds.minRelativeIndexPctChange &&
              zShift <= -thresholds.minZScoreShift) ||
            (zShift <= -(thresholds.minZScoreShift + 0.65) && relIdxPctShift <= -0.12) ||
            (pctShift <= -thresholds.minPercentileShift &&
              relIdxPctShift <= -0.18 &&
              zShift <= -1.1);

          if (isSurge || isDrop) {
            const direction: "surge" | "drop" = isSurge ? "surge" : "drop";
            const sign = direction === "surge" ? 1 : -1;
            const reasons: string[] = [];

            if (sign * relIdxPctShift >= 0.12) {
              reasons.push(
                `Buyer share ${direction === "surge" ? "surged" : "fell"} ${Math.round(Math.abs(relIdxPctShift) * 100)}% vs 5-round baseline`,
              );
            }
            if (sign * zShift >= 1.1) {
              reasons.push(
                `Z-score shifted ${zShift > 0 ? "+" : ""}${zShift.toFixed(2)}σ`,
              );
            }
            if (
              sign * pctShift >= thresholds.minPercentileShift &&
              sign * rankShift >= thresholds.minRankDelta
            ) {
              reasons.push(
                `Buyers rank ${direction === "surge" ? "jumped" : "dropped"} ${Math.abs(rankShift).toFixed(1)} spots`,
              );
            }

            if (reasons.length > 0) {
              stat.isAnomaly = true;
              stat.anomalyDirection = direction;
              stat.anomalyReason = reasons.join("; ");
            }
          }
        }

        const updatedHistory = [
          ...history,
          {
            rank: stat.uniqueBuyersRank,
            percentile,
            relativeIndex: stat.uniqueBuyersRelativeIndex,
            zScore: stat.zScore,
          },
        ];
        memberHistory.set(stat.memberId, updatedHistory);

        const last5 = updatedHistory.slice(-5);
        const last10 = updatedHistory.slice(-10);
        stat.rolling5Rank = roundTo(meanOf(last5.map((h) => h.rank)), 2);
        stat.rolling10Rank = roundTo(meanOf(last10.map((h) => h.rank)), 2);
        stat.rolling5RelativeIndex = roundTo(
          meanOf(last5.map((h) => h.relativeIndex)),
          4,
        );
        stat.rolling10RelativeIndex = roundTo(
          meanOf(last10.map((h) => h.relativeIndex)),
          4,
        );
      }
    }

    results.set(round.slug, baseStats);
  }

  return results;
}

const MS_PER_DAY = 86_400_000;

export function correlateEventsForMemberRound(
  roundStartAt: string,
  artistId: string,
  memberId: string | null,
  events: TimelineEventInput[],
  daysBefore = 14,
  daysAfter = 7,
): CorrelatedEvent[] {
  const roundMs = Date.parse(roundStartAt.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(roundMs)) return [];

  const matches: CorrelatedEvent[] = [];

  for (const ev of events) {
    if (ev.artistId !== artistId) continue;

    const isGroupEvent = ev.members.length === 0;
    const isMemberEvent = memberId !== null && ev.members.includes(memberId);
    if (!isGroupEvent && !isMemberEvent) continue;

    const evStartMs = Date.parse(ev.eventDate + "T00:00:00Z");
    const evEndMs = ev.endDate
      ? Date.parse(ev.endDate + "T00:00:00Z")
      : evStartMs;
    if (Number.isNaN(evStartMs)) continue;

    let effectiveMs = evStartMs;
    if (roundMs >= evStartMs && roundMs <= evEndMs) {
      effectiveMs = roundMs;
    } else if (roundMs > evEndMs) {
      effectiveMs = evEndMs;
    }

    const dayOffset = Math.round((effectiveMs - roundMs) / MS_PER_DAY);
    if (dayOffset >= -daysBefore && dayOffset <= daysAfter) {
      matches.push({
        event: ev,
        scope: isMemberEvent ? "member" : "group",
        dayOffset,
      });
    }
  }

  matches.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "member" ? -1 : 1;
    return Math.abs(a.dayOffset) - Math.abs(b.dayOffset);
  });

  return matches;
}

export interface MemberCareerSummary {
  memberId: string;
  roundsCount: number;
  totalMints: number;
  latestRank: number | null;
  latestRankDelta: number | null;
  currentRolling5Rank: number | null;
  allTimeAvgRank: number | null;
  bestRank: number | null;
  worstRank: number | null;
  avgRelativeIndex: number | null;
  rankVolatility: number | null;
  anomalyCount: number;
}

export function computeMemberCareerSummary(
  memberId: string,
  popularityStatsInChronologicalOrder: ComputedRoundMemberStat[],
): MemberCareerSummary {
  const mine = popularityStatsInChronologicalOrder.filter(
    (s) => s.memberId === memberId,
  );
  if (mine.length === 0) {
    return {
      memberId,
      roundsCount: 0,
      totalMints: 0,
      latestRank: null,
      latestRankDelta: null,
      currentRolling5Rank: null,
      allTimeAvgRank: null,
      bestRank: null,
      worstRank: null,
      avgRelativeIndex: null,
      rankVolatility: null,
      anomalyCount: 0,
    };
  }

  const ranks = mine.map((s) => s.rank);
  const avgRank = meanOf(ranks);
  const variance =
    ranks.reduce((sum, r) => sum + (r - avgRank) ** 2, 0) / ranks.length;
  const latest = mine[mine.length - 1]!;

  return {
    memberId,
    roundsCount: mine.length,
    totalMints: mine.reduce((sum, s) => sum + s.mintCount, 0),
    latestRank: latest.rank,
    latestRankDelta: latest.rankDeltaPrev,
    currentRolling5Rank: latest.rolling5Rank,
    allTimeAvgRank: roundTo(avgRank, 2),
    bestRank: Math.min(...ranks),
    worstRank: Math.max(...ranks),
    avgRelativeIndex: roundTo(meanOf(mine.map((s) => s.relativeIndex)), 4),
    rankVolatility: roundTo(Math.sqrt(variance), 2),
    anomalyCount: mine.filter((s) => s.isAnomaly).length,
  };
}
