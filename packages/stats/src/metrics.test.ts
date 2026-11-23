import { describe, expect, it } from "vitest";
import {
  computeArtistSeriesStats,
  computeMemberCareerSummary,
  computeSingleRoundMetrics,
  correlateEventsForMemberRound,
  type SaleRoundInput,
  type TimelineEventInput,
} from "./metrics.js";

describe("computeSingleRoundMetrics", () => {
  it("computes standard competition ranks, shares, relativeIndex, and zScore", () => {
    const stats = computeSingleRoundMetrics({
      slug: "test-round-1",
      artistId: "triples",
      startAt: "2024-05-01T00:00:00Z",
      includeInPopularity: true,
      memberMints: [
        { memberId: "triples-yooyeon", mintCount: 400 },
        { memberId: "triples-sohyun", mintCount: 200 },
        { memberId: "triples-kotone", mintCount: 200 },
        { memberId: "triples-seoyeon", mintCount: 200 },
      ],
    });

    expect(stats[0]).toMatchObject({
      memberId: "triples-yooyeon",
      rank: 1,
      sharePct: 40,
      relativeIndex: 1.6,
    });
    // Ties share rank 2
    expect(stats[1]?.rank).toBe(2);
    expect(stats[2]?.rank).toBe(2);
    expect(stats[3]?.rank).toBe(2);
    expect(stats[0]!.zScore).toBeGreaterThan(1.5);
  });

  it("normalizes relativeIndex identically across 4-member and 24-member rosters", () => {
    const smallRound = computeSingleRoundMetrics({
      slug: "early-ot4",
      artistId: "triples",
      startAt: "2022-07-01T00:00:00Z",
      includeInPopularity: true,
      memberMints: [
        { memberId: "m1", mintCount: 150 },
        { memberId: "m2", mintCount: 100 },
        { memberId: "m3", mintCount: 100 },
        { memberId: "m4", mintCount: 50 },
      ],
    });

    const fullRosterMints = [
      { memberId: "m1", mintCount: 1500 },
      ...Array.from({ length: 22 }, (_, i) => ({
        memberId: `m${i + 2}`,
        mintCount: 1000,
      })),
      { memberId: "m24", mintCount: 500 },
    ];
    const largeRound = computeSingleRoundMetrics({
      slug: "full-ot24",
      artistId: "triples",
      startAt: "2024-06-01T00:00:00Z",
      includeInPopularity: true,
      memberMints: fullRosterMints,
    });

    // Both m1 entries are 1.5x the average member of their respective round
    expect(smallRound.find((s) => s.memberId === "m1")?.relativeIndex).toBe(1.5);
    expect(largeRound.find((s) => s.memberId === "m1")?.relativeIndex).toBe(1.5);
  });

  it("separates unique buyer rankings and flags whale concentration accurately", () => {
    const stats = computeSingleRoundMetrics({
      slug: "sco-whale-check",
      artistId: "triples",
      startAt: "2026-11-21T00:00:00Z",
      includeInPopularity: false,
      memberMints: [
        { memberId: "triples-joobin", mintCount: 48, uniqueBuyers: 3, topBuyerMints: 42 },
        { memberId: "triples-sohyun", mintCount: 48, uniqueBuyers: 9, topBuyerMints: 15 },
        { memberId: "triples-shion", mintCount: 37, uniqueBuyers: 17, topBuyerMints: 5 },
      ],
    });

    const joobin = stats.find((s) => s.memberId === "triples-joobin")!;
    const sohyun = stats.find((s) => s.memberId === "triples-sohyun")!;
    const shion = stats.find((s) => s.memberId === "triples-shion")!;

    // Tied #1 on mints, but SoHyun sorts ahead of JooBin because 9 > 3 unique buyers
    expect(sohyun.rank).toBe(1);
    expect(joobin.rank).toBe(1);
    expect(stats[0]?.memberId).toBe("triples-sohyun");

    // On unique buyers: ShiOn is #1, SoHyun #2, JooBin #3
    expect(shion.uniqueBuyersRank).toBe(1);
    expect(sohyun.uniqueBuyersRank).toBe(2);
    expect(joobin.uniqueBuyersRank).toBe(3);

    // Whale metrics
    expect(joobin.mintsPerBuyer).toBe(16);
    expect(joobin.topBuyerSharePct).toBe(87.5);
    expect(shion.topBuyerSharePct).toBeCloseTo(13.51, 1);
  });
});

describe("computeArtistSeriesStats", () => {
  it("tracks rolling averages, excludes random packs from baselines, and flags surges/drops", () => {
    const makeRound = (
      slug: string,
      startAt: string,
      yooyeonMints: number,
      includeInPopularity = true,
    ): SaleRoundInput => ({
      slug,
      artistId: "triples",
      startAt,
      includeInPopularity,
      memberMints: [
        { memberId: "triples-yooyeon", mintCount: yooyeonMints },
        { memberId: "triples-sohyun", mintCount: 1000 },
        { memberId: "triples-kotone", mintCount: 950 },
        { memberId: "triples-xinyu", mintCount: 900 },
        { memberId: "triples-seoyeon", mintCount: 850 },
        { memberId: "triples-nakyoung", mintCount: 800 },
      ],
    });

    const rounds: SaleRoundInput[] = [
      makeRound("r1", "2024-01-01T00:00:00Z", 1200, true), // #1
      makeRound("r2", "2024-02-01T00:00:00Z", 1150, true), // #1
      makeRound("r-random", "2024-02-15T00:00:00Z", 900, false), // random pack, must not affect rolling baseline
      makeRound("r3", "2024-03-01T00:00:00Z", 600, true), // sharp drop to #6 -> anomaly!
    ];

    const series = computeArtistSeriesStats(rounds);

    const rRandomYooyeon = series
      .get("r-random")
      ?.find((s) => s.memberId === "triples-yooyeon");
    expect(rRandomYooyeon?.rolling5Rank).toBeNull();
    expect(rRandomYooyeon?.isAnomaly).toBe(false);

    const r3Yooyeon = series
      .get("r3")
      ?.find((s) => s.memberId === "triples-yooyeon");
    expect(r3Yooyeon?.rank).toBe(6);
    expect(r3Yooyeon?.rankDeltaPrev).toBe(-5); // #1 -> #6 = -5
    expect(r3Yooyeon?.isAnomaly).toBe(true);
    expect(r3Yooyeon?.anomalyDirection).toBe("drop");

    const allPopularityStats = [
      ...(series.get("r1") ?? []),
      ...(series.get("r2") ?? []),
      ...(series.get("r3") ?? []),
    ];
    const summary = computeMemberCareerSummary(
      "triples-yooyeon",
      allPopularityStats,
    );
    expect(summary.roundsCount).toBe(3);
    expect(summary.bestRank).toBe(1);
    expect(summary.worstRank).toBe(6);
    expect(summary.anomalyCount).toBe(1);
  });

  it("ignores tiny low-volume rounds and single-whale mint spikes for anomaly detection", () => {
    const makeBigRound = (slug: string, startAt: string, joobinMints = 200, joobinBuyers = 100): SaleRoundInput => ({
      slug,
      artistId: "triples",
      startAt,
      includeInPopularity: true,
      memberMints: [
        { memberId: "triples-yooyeon", mintCount: 600, uniqueBuyers: 300 },
        { memberId: "triples-sohyun", mintCount: 500, uniqueBuyers: 250 },
        { memberId: "triples-seoyeon", mintCount: 400, uniqueBuyers: 200 },
        { memberId: "triples-nakyoung", mintCount: 300, uniqueBuyers: 150 },
        { memberId: "triples-kotone", mintCount: 250, uniqueBuyers: 125 },
        { memberId: "triples-joobin", mintCount: joobinMints, uniqueBuyers: joobinBuyers },
      ],
    });

    const tinyPromoRound: SaleRoundInput = {
      slug: "tiny-promo",
      artistId: "triples",
      startAt: "2024-03-01T00:00:00Z",
      includeInPopularity: true,
      memberMints: [
        { memberId: "triples-joobin", mintCount: 20, uniqueBuyers: 10 },
        { memberId: "triples-yooyeon", mintCount: 5, uniqueBuyers: 4 },
        { memberId: "triples-sohyun", mintCount: 5, uniqueBuyers: 4 },
        { memberId: "triples-seoyeon", mintCount: 4, uniqueBuyers: 3 },
        { memberId: "triples-nakyoung", mintCount: 3, uniqueBuyers: 2 },
        { memberId: "triples-kotone", mintCount: 2, uniqueBuyers: 2 },
      ],
    };

    const series = computeArtistSeriesStats([
      makeBigRound("r1", "2024-01-01T00:00:00Z"),
      makeBigRound("r2", "2024-02-01T00:00:00Z"),
      tinyPromoRound,
      // Single whale buys 2,000 copies of JooBin, but unique buyers stays flat at 100!
      makeBigRound("r3-whale", "2024-04-01T00:00:00Z", 2200, 100),
    ]);

    // Tiny promo round (< 150 buyers) must NOT flag anomaly
    expect(series.get("tiny-promo")?.every((s) => !s.isAnomaly)).toBe(true);
    // Whale spike with flat unique buyers must NOT flag anomaly
    expect(
      series.get("r3-whale")?.find((s) => s.memberId === "triples-joobin")?.isAnomaly,
    ).toBe(false);
  });
});

describe("correlateEventsForMemberRound", () => {
  const events: TimelineEventInput[] = [
    {
      id: "group-comeback",
      artistId: "triples",
      eventDate: "2024-05-08",
      category: "comeback",
      title: "ASSEMBLE24 Comeback",
      summary: "OT24 comeback",
      members: [],
    },
    {
      id: "member-viral",
      artistId: "triples",
      eventDate: "2024-05-05",
      category: "viral",
      title: "YooYeon Viral Variety Clip",
      summary: "Major viral moment",
      members: ["triples-yooyeon"],
    },
    {
      id: "old-event",
      artistId: "triples",
      eventDate: "2024-01-01",
      category: "tour",
      title: "Old Tour",
      summary: "Outside correlation window",
      members: [],
    },
  ];

  it("prioritizes member-specific events over group-wide events within window", () => {
    const matched = correlateEventsForMemberRound(
      "2024-05-10T00:00:00Z",
      "triples",
      "triples-yooyeon",
      events,
    );

    expect(matched).toHaveLength(2);
    expect(matched[0]?.event.id).toBe("member-viral");
    expect(matched[0]?.scope).toBe("member");
    expect(matched[0]?.dayOffset).toBe(-5);
    expect(matched[1]?.event.id).toBe("group-comeback");
    expect(matched[1]?.scope).toBe("group");
  });
});
