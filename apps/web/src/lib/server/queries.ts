import { createServerFn } from "@tanstack/react-start";
import { asc, desc, eq, sql } from "drizzle-orm";
import { env } from "cloudflare:workers";
import {
  artists,
  collectionDailyMints,
  collections,
  createDb,
  eventMembers,
  events,
  members,
  roundDailyMints,
  saleRoundCollections,
  saleRoundMemberStats,
  saleRounds,
  syncState,
} from "@objekt-stats/db";
import {
  classifyFcoGridEdition,
  classifyGridRewardSco,
  computeEditionGridSupply,
  correlateEventsForMemberRound,
  type GridEditionId,
} from "@objekt-stats/stats";

export type ArtistSlug = "triples" | "artms";

function normalizeArtist(input?: string): ArtistSlug {
  return input === "artms" ? "artms" : "triples";
}

async function loadArtistEventsWithMembers(
  db: ReturnType<typeof createDb>,
  artistId: ArtistSlug,
) {
  const eventList = await db
    .select()
    .from(events)
    .where(eq(events.artistId, artistId))
    .orderBy(desc(events.eventDate));

  const links = await db.select().from(eventMembers);
  const byEvent = new Map<string, string[]>();
  for (const l of links) {
    const arr = byEvent.get(l.eventId) ?? [];
    arr.push(l.memberId);
    byEvent.set(l.eventId, arr);
  }

  return eventList.map((ev) => ({
    ...ev,
    memberIds: byEvent.get(ev.id) ?? [],
  }));
}

export const getArtistOverview = createServerFn({ method: "GET" })
  .validator((artistId?: string) => normalizeArtist(artistId))
  .handler(async ({ data: artistId }) => {
    const db = createDb(env.DB);

    const [artist] = await db
      .select()
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);

    const memberList = await db
      .select()
      .from(members)
      .where(eq(members.artistId, artistId))
      .orderBy(asc(members.memberOrder));
    const memberById = new Map(memberList.map((m) => [m.id, m]));

    const roundList = await db
      .select()
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId))
      .orderBy(desc(saleRounds.startAt), desc(saleRounds.totalMints))
      .limit(1200);

    const roundTopByMints = new Map<
      string,
      { memberId: string; mintCount: number; sharePct: number }
    >();
    const roundTopByBuyers = new Map<
      string,
      { memberId: string; uniqueBuyers: number; sharePct: number }
    >();

    if (roundList.length > 0) {
      const rank1Rows = await db
        .select({
          roundSlug: saleRoundMemberStats.roundSlug,
          memberId: saleRoundMemberStats.memberId,
          mintCount: saleRoundMemberStats.mintCount,
          sharePct: saleRoundMemberStats.sharePct,
          rank: saleRoundMemberStats.rank,
          uniqueBuyers: saleRoundMemberStats.uniqueBuyers,
          uniqueBuyersSharePct: saleRoundMemberStats.uniqueBuyersSharePct,
          uniqueBuyersRank: saleRoundMemberStats.uniqueBuyersRank,
        })
        .from(saleRoundMemberStats)
        .innerJoin(
          saleRounds,
          eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
        )
        .where(
          sql`${saleRounds.artistId} = ${artistId} AND (${saleRoundMemberStats.rank} = 1 OR ${saleRoundMemberStats.uniqueBuyersRank} = 1)`,
        );

      for (const row of rank1Rows) {
        if (row.rank === 1) {
          const prev = roundTopByMints.get(row.roundSlug);
          if (!prev || row.mintCount > prev.mintCount) {
            roundTopByMints.set(row.roundSlug, {
              memberId: row.memberId,
              mintCount: row.mintCount,
              sharePct: row.sharePct,
            });
          }
        }
        if (row.uniqueBuyersRank === 1) {
          const prev = roundTopByBuyers.get(row.roundSlug);
          if (!prev || row.uniqueBuyers > prev.uniqueBuyers) {
            roundTopByBuyers.set(row.roundSlug, {
              memberId: row.memberId,
              uniqueBuyers: row.uniqueBuyers,
              sharePct: row.uniqueBuyersSharePct,
            });
          }
        }
      }
    }

    const memberTotalsRows = await db
      .select({
        memberId: saleRoundMemberStats.memberId,
        totalMints: sql<number>`coalesce(sum(${saleRoundMemberStats.mintCount}), 0)`,
        totalUniqueBuyers: sql<number>`coalesce(sum(${saleRoundMemberStats.uniqueBuyers}), 0)`,
        roundsCount: sql<number>`count(*)`,
        avgRank: sql<number>`avg(${saleRoundMemberStats.rank})`,
        avgBuyersRank: sql<number>`avg(${saleRoundMemberStats.uniqueBuyersRank})`,
        avgRelativeIndex: sql<number>`avg(${saleRoundMemberStats.relativeIndex})`,
        avgBuyersRelativeIndex: sql<number>`avg(${saleRoundMemberStats.uniqueBuyersRelativeIndex})`,
        avgMintsPerBuyer: sql<number>`avg(${saleRoundMemberStats.mintsPerBuyer})`,
        bestRank: sql<number>`min(${saleRoundMemberStats.rank})`,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
      )
      .groupBy(saleRoundMemberStats.memberId);

    const memberStatsMap = new Map(
      memberTotalsRows.map((r) => [
        r.memberId,
        {
          totalMints: Number(r.totalMints),
          totalUniqueBuyers: Number(r.totalUniqueBuyers),
          roundsCount: Number(r.roundsCount),
          avgRank: r.avgRank !== null ? Number(r.avgRank.toFixed(2)) : null,
          avgBuyersRank:
            r.avgBuyersRank !== null ? Number(r.avgBuyersRank.toFixed(2)) : null,
          avgRelativeIndex:
            r.avgRelativeIndex !== null
              ? Number(r.avgRelativeIndex.toFixed(3))
              : null,
          avgBuyersRelativeIndex:
            r.avgBuyersRelativeIndex !== null
              ? Number(r.avgBuyersRelativeIndex.toFixed(3))
              : null,
          avgMintsPerBuyer:
            r.avgMintsPerBuyer !== null
              ? Number(r.avgMintsPerBuyer.toFixed(2))
              : null,
          bestRank: r.bestRank !== null ? Number(r.bestRank) : null,
        },
      ]),
    );

    const eventsWithMembers = await loadArtistEventsWithMembers(db, artistId);
    const timelineEvents = eventsWithMembers.map((e) => ({
      ...e,
      members: e.memberIds,
    }));

    const anomalyRows = await db
      .select({
        roundSlug: saleRoundMemberStats.roundSlug,
        roundTitle: saleRounds.title,
        startAt: saleRounds.startAt,
        memberId: saleRoundMemberStats.memberId,
        rank: saleRoundMemberStats.rank,
        rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
        relativeIndex: saleRoundMemberStats.relativeIndex,
        mintCount: saleRoundMemberStats.mintCount,
        uniqueBuyers: saleRoundMemberStats.uniqueBuyers,
        anomalyDirection: saleRoundMemberStats.anomalyDirection,
        anomalyReason: saleRoundMemberStats.anomalyReason,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRoundMemberStats.isAnomaly} = 1`,
      )
      .orderBy(desc(saleRounds.startAt), desc(saleRoundMemberStats.mintCount))
      .limit(8);

    const anomalies = anomalyRows.map((a) => {
      const m = memberById.get(a.memberId);
      const correlated = correlateEventsForMemberRound(
        a.startAt,
        artistId,
        a.memberId,
        timelineEvents,
        14,
        7,
      );
      return {
        ...a,
        memberName: m?.name ?? a.memberId,
        memberCode: m?.code ?? "",
        hexColor: m?.hexColor ?? "#22AEFF",
        nearestEvent: correlated[0]
          ? {
              id: correlated[0].event.id,
              title: correlated[0].event.title,
              eventDate: correlated[0].event.eventDate,
              dayOffset: correlated[0].dayOffset,
              scope: correlated[0].scope,
            }
          : null,
      };
    });

    const recentMoversRows = await db
      .select({
        roundSlug: saleRoundMemberStats.roundSlug,
        roundTitle: saleRounds.title,
        startAt: saleRounds.startAt,
        memberId: saleRoundMemberStats.memberId,
        rank: saleRoundMemberStats.rank,
        rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
        relativeIndex: saleRoundMemberStats.relativeIndex,
        mintCount: saleRoundMemberStats.mintCount,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1 AND ${saleRoundMemberStats.rankDeltaPrev} IS NOT NULL AND ${saleRoundMemberStats.rankDeltaPrev} != 0`,
      )
      .orderBy(desc(saleRounds.startAt))
      .limit(48);

    const latestMoverRoundSlug = recentMoversRows[0]?.roundSlug ?? null;
    const latestMoverRows = latestMoverRoundSlug
      ? recentMoversRows.filter((r) => r.roundSlug === latestMoverRoundSlug)
      : [];

    const biggestRisers = [...latestMoverRows]
      .filter((r) => (r.rankDeltaPrev ?? 0) > 0)
      .sort((a, b) => (b.rankDeltaPrev ?? 0) - (a.rankDeltaPrev ?? 0))
      .slice(0, 4)
      .map((r) => {
        const m = memberById.get(r.memberId);
        return {
          ...r,
          memberName: m?.name ?? r.memberId,
          memberCode: m?.code ?? "",
          hexColor: m?.hexColor ?? "#22AEFF",
        };
      });

    const biggestFallers = [...latestMoverRows]
      .filter((r) => (r.rankDeltaPrev ?? 0) < 0)
      .sort((a, b) => (a.rankDeltaPrev ?? 0) - (b.rankDeltaPrev ?? 0))
      .slice(0, 4)
      .map((r) => {
        const m = memberById.get(r.memberId);
        return {
          ...r,
          memberName: m?.name ?? r.memberId,
          memberCode: m?.code ?? "",
          hexColor: m?.hexColor ?? "#22AEFF",
        };
      });

    const syncRows = await db.select().from(syncState);

    const [roundTotals] = await db
      .select({
        roundCount: sql<number>`count(*)`,
        popularityRoundCount: sql<number>`sum(case when ${saleRounds.includeInPopularity} = 1 then 1 else 0 end)`,
        estGrossUsd: sql<number>`coalesce(sum(case when ${saleRounds.unitPriceUsd} > 0 then ${saleRounds.totalMints} * ${saleRounds.unitPriceUsd} else 0 end), 0)`,
      })
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId));

    const [collectionTotals] = await db
      .select({
        collectionCount: sql<number>`count(*)`,
        totalMints: sql<number>`coalesce(sum(${collections.totalMints}), 0)`,
      })
      .from(collections)
      .where(eq(collections.artistId, artistId));

    return {
      artist: artist ?? null,
      members: memberList.map((m) => ({
        ...m,
        stats: memberStatsMap.get(m.id) ?? null,
      })),
      rounds: roundList.map((r) => ({
        ...r,
        topSeller: roundTopByMints.get(r.slug) ?? null,
        topSellerByBuyers: roundTopByBuyers.get(r.slug) ?? null,
      })),
      anomalies,
      movers: {
        roundSlug: latestMoverRoundSlug,
        roundTitle: recentMoversRows[0]?.roundTitle ?? null,
        risers: biggestRisers,
        fallers: biggestFallers,
      },
      events: eventsWithMembers,
      syncState: syncRows,
      totals: {
        roundCount: Number(roundTotals?.roundCount ?? 0),
        popularityRoundCount: Number(roundTotals?.popularityRoundCount ?? 0),
        collectionCount: Number(collectionTotals?.collectionCount ?? 0),
        totalMints: Number(collectionTotals?.totalMints ?? 0),
        estGrossUsd: Number(roundTotals?.estGrossUsd ?? 0),
      },
    };
  });

export const getRoundDetail = createServerFn({ method: "GET" })
  .validator((slug: string) => slug.trim())
  .handler(async ({ data: slug }) => {
    const db = createDb(env.DB);

    const [round] = await db
      .select()
      .from(saleRounds)
      .where(eq(saleRounds.slug, slug))
      .limit(1);

    if (!round) return null;

    const memberRows = await db
      .select()
      .from(members)
      .where(eq(members.artistId, round.artistId))
      .orderBy(asc(members.memberOrder));
    const memberById = new Map(memberRows.map((m) => [m.id, m]));

    const statRows = await db
      .select()
      .from(saleRoundMemberStats)
      .where(eq(saleRoundMemberStats.roundSlug, slug))
      .orderBy(
        asc(saleRoundMemberStats.rank),
        desc(saleRoundMemberStats.uniqueBuyers),
      );

    const linkedCols = await db
      .select({
        slug: collections.slug,
        collectionId: collections.collectionId,
        memberId: collections.memberId,
        collectionNo: collections.collectionNo,
        totalMints: collections.totalMints,
        uniqueMinters: collections.uniqueMinters,
        spunCount: collections.spunCount,
        frontImageUrl: collections.frontImageUrl,
        backgroundColor: collections.backgroundColor,
      })
      .from(saleRoundCollections)
      .innerJoin(
        collections,
        eq(collections.slug, saleRoundCollections.collectionSlug),
      )
      .where(eq(saleRoundCollections.roundSlug, slug))
      .orderBy(desc(collections.totalMints));

    const roundDailyRows = await db
      .select({
        mintDate: roundDailyMints.mintDate,
        mintCount: roundDailyMints.mintCount,
        uniqueBuyers: roundDailyMints.uniqueBuyers,
      })
      .from(roundDailyMints)
      .where(eq(roundDailyMints.roundSlug, slug))
      .orderBy(asc(roundDailyMints.mintDate))
      .catch(() => []);

    const dailyCurve =
      roundDailyRows.length > 0
        ? roundDailyRows.map((d) => ({
            mintDate: d.mintDate,
            mintCount: Number(d.mintCount),
            uniqueBuyers: Number(d.uniqueBuyers),
          }))
        : (
            await db
              .select({
                mintDate: collectionDailyMints.mintDate,
                mintCount: sql<number>`sum(${collectionDailyMints.mintCount})`,
              })
              .from(collectionDailyMints)
              .innerJoin(
                saleRoundCollections,
                eq(
                  saleRoundCollections.collectionSlug,
                  collectionDailyMints.collectionSlug,
                ),
              )
              .where(eq(saleRoundCollections.roundSlug, slug))
              .groupBy(collectionDailyMints.mintDate)
              .orderBy(asc(collectionDailyMints.mintDate))
          ).map((d) => ({
            mintDate: d.mintDate,
            mintCount: Number(d.mintCount),
            uniqueBuyers: 0,
          }));

    const eventsWithMembers = await loadArtistEventsWithMembers(
      db,
      normalizeArtist(round.artistId),
    );
    const correlated = correlateEventsForMemberRound(
      round.startAt,
      round.artistId,
      null,
      eventsWithMembers.map((e) => ({ ...e, members: e.memberIds })),
      14,
      7,
    );

    const previewByMember = new Map<string, string>();
    for (const c of linkedCols) {
      if (c.memberId && c.frontImageUrl && !previewByMember.has(c.memberId)) {
        previewByMember.set(c.memberId, c.frontImageUrl);
      }
    }

    return {
      round,
      leaderboard: statRows.map((s) => {
        const m = memberById.get(s.memberId);
        return {
          ...s,
          memberCode: m?.code ?? "",
          memberName: m?.name ?? s.memberId,
          memberFullName: m?.fullName ?? "",
          hexColor: m?.hexColor ?? "#22AEFF",
          previewImageUrl: previewByMember.get(s.memberId) ?? null,
        };
      }),
      collections: linkedCols.slice(0, 48),
      dailyCurve,
      correlatedEvents: correlated,
    };
  });

export const getMembersMatrix = createServerFn({ method: "GET" })
  .validator((artistId?: string) => normalizeArtist(artistId))
  .handler(async ({ data: artistId }) => {
    const db = createDb(env.DB);

    const [artist] = await db
      .select()
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);

    const memberList = await db
      .select()
      .from(members)
      .where(eq(members.artistId, artistId))
      .orderBy(asc(members.memberOrder));

    const popRounds = await db
      .select()
      .from(saleRounds)
      .where(
        sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
      )
      .orderBy(asc(saleRounds.startAt));

    const statRows =
      popRounds.length > 0
        ? await db
            .select({
              roundSlug: saleRoundMemberStats.roundSlug,
              memberId: saleRoundMemberStats.memberId,
              mintCount: saleRoundMemberStats.mintCount,
              uniqueBuyers: saleRoundMemberStats.uniqueBuyers,
              mintsPerBuyer: saleRoundMemberStats.mintsPerBuyer,
              topBuyerSharePct: saleRoundMemberStats.topBuyerSharePct,
              rank: saleRoundMemberStats.rank,
              uniqueBuyersRank: saleRoundMemberStats.uniqueBuyersRank,
              sharePct: saleRoundMemberStats.sharePct,
              uniqueBuyersSharePct: saleRoundMemberStats.uniqueBuyersSharePct,
              relativeIndex: saleRoundMemberStats.relativeIndex,
              uniqueBuyersRelativeIndex:
                saleRoundMemberStats.uniqueBuyersRelativeIndex,
              zScore: saleRoundMemberStats.zScore,
              rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
              rolling5Rank: saleRoundMemberStats.rolling5Rank,
              rolling10Rank: saleRoundMemberStats.rolling10Rank,
              rolling5RelativeIndex: saleRoundMemberStats.rolling5RelativeIndex,
              rolling10RelativeIndex:
                saleRoundMemberStats.rolling10RelativeIndex,
              isAnomaly: saleRoundMemberStats.isAnomaly,
              anomalyDirection: saleRoundMemberStats.anomalyDirection,
              anomalyReason: saleRoundMemberStats.anomalyReason,
            })
            .from(saleRoundMemberStats)
            .innerJoin(
              saleRounds,
              eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
            )
            .where(
              sql`${saleRounds.artistId} = ${artistId} AND ${saleRounds.includeInPopularity} = 1`,
            )
        : [];

    const statsByMember = new Map<string, typeof statRows>();
    for (const s of statRows) {
      const arr = statsByMember.get(s.memberId) ?? [];
      arr.push(s);
      statsByMember.set(s.memberId, arr);
    }

    const roundOrderMap = new Map(popRounds.map((r, i) => [r.slug, i]));
    const eventsWithMembers = await loadArtistEventsWithMembers(db, artistId);

    const matrix = memberList.map((m) => {
      const rows = (statsByMember.get(m.id) ?? []).sort(
        (a, b) =>
          (roundOrderMap.get(a.roundSlug) ?? 0) -
          (roundOrderMap.get(b.roundSlug) ?? 0),
      );
      const latest = rows[rows.length - 1];
      const totalMints = rows.reduce((acc, r) => acc + r.mintCount, 0);
      const totalUniqueBuyers = rows.reduce((acc, r) => acc + r.uniqueBuyers, 0);
      const avgRankVal =
        rows.length > 0
          ? rows.reduce((acc, r) => acc + r.rank, 0) / rows.length
          : null;
      const avgBuyersRankVal =
        rows.length > 0
          ? rows.reduce((acc, r) => acc + r.uniqueBuyersRank, 0) / rows.length
          : null;
      const rankVolatility =
        rows.length >= 2 && avgRankVal !== null
          ? Number(
              Math.sqrt(
                rows.reduce((acc, r) => acc + (r.rank - avgRankVal) ** 2, 0) /
                  rows.length,
              ).toFixed(2),
            )
          : null;
      const avgRelativeIndex =
        rows.length > 0
          ? Number(
              (
                rows.reduce((acc, r) => acc + r.relativeIndex, 0) / rows.length
              ).toFixed(3),
            )
          : null;
      const avgBuyersRelativeIndex =
        rows.length > 0
          ? Number(
              (
                rows.reduce((acc, r) => acc + r.uniqueBuyersRelativeIndex, 0) /
                rows.length
              ).toFixed(3),
            )
          : null;
      const avgMintsPerBuyer =
        totalUniqueBuyers > 0
          ? Number((totalMints / totalUniqueBuyers).toFixed(2))
          : null;
      const bestRank =
        rows.length > 0 ? Math.min(...rows.map((r) => r.rank)) : null;

      return {
        ...m,
        roundsCount: rows.length,
        totalMints,
        totalUniqueBuyers,
        avgMintsPerBuyer,
        latestRank: latest?.rank ?? null,
        latestBuyersRank: latest?.uniqueBuyersRank ?? null,
        latestRankDelta: latest?.rankDeltaPrev ?? null,
        rolling5Rank:
          latest?.rolling5Rank ??
          (avgRankVal !== null ? Number(avgRankVal.toFixed(2)) : null),
        avgRank: avgRankVal !== null ? Number(avgRankVal.toFixed(2)) : null,
        avgBuyersRank:
          avgBuyersRankVal !== null ? Number(avgBuyersRankVal.toFixed(2)) : null,
        avgRelativeIndex,
        avgBuyersRelativeIndex,
        bestRank,
        rankVolatility,
        anomaliesCount: rows.filter((r) => r.isAnomaly).length,
        history: rows.map((r) => ({
          roundSlug: r.roundSlug,
          rank: r.rank,
          uniqueBuyersRank: r.uniqueBuyersRank,
          relativeIndex: r.relativeIndex,
          uniqueBuyersRelativeIndex: r.uniqueBuyersRelativeIndex,
          mintCount: r.mintCount,
          uniqueBuyers: r.uniqueBuyers,
          sharePct: r.sharePct,
          isAnomaly: r.isAnomaly,
          anomalyDirection: r.anomalyDirection,
        })),
      };
    });

    return {
      artist: artist ?? null,
      rounds: popRounds.map((r) => ({
        slug: r.slug,
        title: r.title,
        season: r.season,
        startAt: r.startAt,
        totalMints: r.totalMints,
        uniqueBuyers: r.uniqueBuyers,
        participatingMembers: r.participatingMembers,
      })),
      events: eventsWithMembers.map((e) => ({
        id: e.id,
        eventDate: e.eventDate,
        category: e.category,
        title: e.title,
      })),
      members: matrix,
    };
  });

export const getMemberDetail = createServerFn({ method: "GET" })
  .validator((memberId: string) => memberId.trim())
  .handler(async ({ data: memberId }) => {
    const db = createDb(env.DB);

    const [member] = await db
      .select()
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1);

    if (!member) return null;

    const roundHistory = await db
      .select({
        roundSlug: saleRounds.slug,
        title: saleRounds.title,
        season: saleRounds.season,
        objektClass: saleRounds.objektClass,
        saleMechanic: saleRounds.saleMechanic,
        startAt: saleRounds.startAt,
        includeInPopularity: saleRounds.includeInPopularity,
        participatingMembers: saleRounds.participatingMembers,
        roundTotalMints: saleRounds.totalMints,
        mintCount: saleRoundMemberStats.mintCount,
        uniqueBuyers: saleRoundMemberStats.uniqueBuyers,
        mintsPerBuyer: saleRoundMemberStats.mintsPerBuyer,
        topBuyerSharePct: saleRoundMemberStats.topBuyerSharePct,
        rank: saleRoundMemberStats.rank,
        uniqueBuyersRank: saleRoundMemberStats.uniqueBuyersRank,
        sharePct: saleRoundMemberStats.sharePct,
        uniqueBuyersSharePct: saleRoundMemberStats.uniqueBuyersSharePct,
        relativeIndex: saleRoundMemberStats.relativeIndex,
        uniqueBuyersRelativeIndex:
          saleRoundMemberStats.uniqueBuyersRelativeIndex,
        zScore: saleRoundMemberStats.zScore,
        rankDeltaPrev: saleRoundMemberStats.rankDeltaPrev,
        rolling5Rank: saleRoundMemberStats.rolling5Rank,
        isAnomaly: saleRoundMemberStats.isAnomaly,
        anomalyDirection: saleRoundMemberStats.anomalyDirection,
        anomalyReason: saleRoundMemberStats.anomalyReason,
      })
      .from(saleRoundMemberStats)
      .innerJoin(
        saleRounds,
        eq(saleRounds.slug, saleRoundMemberStats.roundSlug),
      )
      .where(eq(saleRoundMemberStats.memberId, memberId))
      .orderBy(desc(saleRounds.startAt));

    const classMap = new Map<
      string,
      {
        objektClass: string;
        rounds: number;
        totalMints: number;
        uniqueBuyersSum: number;
        rankSum: number;
        buyersRankSum: number;
        relSum: number;
      }
    >();
    for (const r of roundHistory) {
      if (!r.includeInPopularity) continue;
      const prev = classMap.get(r.objektClass) ?? {
        objektClass: r.objektClass,
        rounds: 0,
        totalMints: 0,
        uniqueBuyersSum: 0,
        rankSum: 0,
        buyersRankSum: 0,
        relSum: 0,
      };
      prev.rounds++;
      prev.totalMints += r.mintCount;
      prev.uniqueBuyersSum += r.uniqueBuyers;
      prev.rankSum += r.rank;
      prev.buyersRankSum += r.uniqueBuyersRank;
      prev.relSum += r.relativeIndex;
      classMap.set(r.objektClass, prev);
    }

    const classBreakdown = Array.from(classMap.values()).map((c) => ({
      objektClass: c.objektClass,
      rounds: c.rounds,
      totalMints: c.totalMints,
      avgRank: Number((c.rankSum / c.rounds).toFixed(2)),
      avgBuyersRank: Number((c.buyersRankSum / c.rounds).toFixed(2)),
      avgRelativeIndex: Number((c.relSum / c.rounds).toFixed(2)),
      avgMintsPerBuyer:
        c.uniqueBuyersSum > 0
          ? Number((c.totalMints / c.uniqueBuyersSum).toFixed(2))
          : 1,
    }));

    const memberCollections = await db
      .select()
      .from(collections)
      .where(eq(collections.memberId, memberId))
      .orderBy(desc(collections.totalMints))
      .limit(24);

    // Compute per-edition COSMO Grid completion & supply lock stats for this member
    const memberGridRows = await db
      .select({
        season: collections.season,
        objektClass: collections.objektClass,
        collectionNo: collections.collectionNo,
        onOffline: collections.onOffline,
        totalMints: collections.totalMints,
        spunCount: collections.spunCount,
        lastMintAt: collections.lastMintAt,
      })
      .from(collections)
      .where(
        sql`${collections.memberId} = ${memberId} AND ${collections.onOffline} = 'online' AND ${collections.objektClass} IN ('First', 'Special')`,
      )
      .catch(() => []);

    const memberEdMap = new Map<
      string,
      {
        season: string;
        editionId: GridEditionId;
        editionLabel: string;
        shortLabel: string;
        gridSize: 4 | 8;
        fcoMints: number;
        scoMints: number;
        spunCount: number;
        latestMintAt: string;
      }
    >();

    for (const row of memberGridRows) {
      if (row.totalMints <= 0) continue;
      if (row.objektClass === "Special") {
        const sco = classifyGridRewardSco(
          member.artistId,
          row.season,
          row.objektClass,
          row.collectionNo,
          row.onOffline,
        );
        if (!sco) continue;
        const key = `${row.season}|${sco.editionId}`;
        let acc = memberEdMap.get(key);
        if (!acc) {
          acc = {
            season: row.season,
            editionId: sco.editionId,
            editionLabel: sco.editionLabel,
            shortLabel: sco.shortLabel,
            gridSize: sco.gridSize,
            fcoMints: 0,
            scoMints: 0,
            spunCount: 0,
            latestMintAt: row.lastMintAt ?? "",
          };
          memberEdMap.set(key, acc);
        }
        acc.scoMints += row.totalMints;
        if (row.lastMintAt && row.lastMintAt > acc.latestMintAt) {
          acc.latestMintAt = row.lastMintAt;
        }
      } else if (row.objektClass === "First") {
        const fco = classifyFcoGridEdition(
          member.artistId,
          row.season,
          row.objektClass,
          row.collectionNo,
          row.onOffline,
        );
        if (!fco) continue;
        const key = `${row.season}|${fco.editionId}`;
        let acc = memberEdMap.get(key);
        if (!acc) {
          acc = {
            season: row.season,
            editionId: fco.editionId,
            editionLabel: fco.editionLabel,
            shortLabel: fco.shortLabel,
            gridSize: fco.gridSize,
            fcoMints: 0,
            scoMints: 0,
            spunCount: 0,
            latestMintAt: row.lastMintAt ?? "",
          };
          memberEdMap.set(key, acc);
        }
        acc.fcoMints += row.totalMints;
        acc.spunCount += row.spunCount ?? 0;
        if (row.lastMintAt && row.lastMintAt > acc.latestMintAt) {
          acc.latestMintAt = row.lastMintAt;
        }
      }
    }

    const gridEditions = Array.from(memberEdMap.entries())
      .filter(([, a]) => a.fcoMints > 0)
      .map(([key, a]) => {
        const m = computeEditionGridSupply({
          fcoMints: a.fcoMints,
          scoMints: a.scoMints,
          spunCount: a.spunCount,
          gridSize: a.gridSize,
          slotCount: a.gridSize,
        });
        return {
          key,
          season: a.season,
          editionId: a.editionId,
          editionLabel: a.editionLabel,
          shortLabel: a.shortLabel,
          gridSize: a.gridSize,
          fcoMints: a.fcoMints,
          gridsCompleted: m.gridsCompleted,
          lockedFcos: m.lockedFcos,
          gridLockPct: m.gridLockPct,
          estTradableFloat: m.estTradableFloat,
          estTradableFloatPerSlot: m.estTradableFloatPerSlot,
          latestMintAt: a.latestMintAt,
        };
      })
      .sort(
        (a, b) =>
          b.latestMintAt.localeCompare(a.latestMintAt) ||
          b.fcoMints - a.fcoMints,
      );

    const gridSummary = {
      totalGridsCompleted: gridEditions.reduce((s, g) => s + g.gridsCompleted, 0),
      totalLockedFcos: gridEditions.reduce((s, g) => s + g.lockedFcos, 0),
      totalFcoMints: gridEditions.reduce((s, g) => s + g.fcoMints, 0),
      editions: gridEditions,
    };

    const artistEvents = await loadArtistEventsWithMembers(
      db,
      normalizeArtist(member.artistId),
    );
    const relatedEvents = artistEvents.filter((e) =>
      e.memberIds.includes(memberId),
    );

    const timelineForCorrelation = artistEvents.map((e) => ({
      ...e,
      members: e.memberIds,
    }));

    const anomalies = roundHistory
      .filter((r) => r.isAnomaly)
      .map((r) => {
        const matched = correlateEventsForMemberRound(
          r.startAt,
          member.artistId,
          memberId,
          timelineForCorrelation,
          14,
          7,
        );
        return {
          ...r,
          nearestEvent: matched[0]
            ? {
                title: matched[0].event.title,
                eventDate: matched[0].event.eventDate,
                dayOffset: matched[0].dayOffset,
              }
            : null,
        };
      });

    return {
      member,
      roundHistory,
      classBreakdown,
      anomalies,
      collections: memberCollections,
      events: relatedEvents,
      gridSummary,
    };
  });

export const getEventsWithImpact = createServerFn({ method: "GET" })
  .validator((artistId?: string) => normalizeArtist(artistId))
  .handler(async ({ data: artistId }) => {
    const db = createDb(env.DB);
    const [artist] = await db
      .select()
      .from(artists)
      .where(eq(artists.id, artistId))
      .limit(1);

    const memberList = await db
      .select()
      .from(members)
      .where(eq(members.artistId, artistId))
      .orderBy(asc(members.memberOrder));

    const eventList = await loadArtistEventsWithMembers(db, artistId);
    const allRounds = await db
      .select({
        slug: saleRounds.slug,
        title: saleRounds.title,
        season: saleRounds.season,
        startAt: saleRounds.startAt,
        totalMints: saleRounds.totalMints,
        uniqueBuyers: saleRounds.uniqueBuyers,
        includeInPopularity: saleRounds.includeInPopularity,
      })
      .from(saleRounds)
      .where(eq(saleRounds.artistId, artistId))
      .orderBy(desc(saleRounds.startAt));

    const MS_PER_DAY = 86_400_000;
    const eventsWithRounds = eventList.map((ev) => {
      const evMs = Date.parse(ev.eventDate + "T00:00:00Z");
      const nearbyRounds = allRounds
        .filter((r) => {
          const rMs = Date.parse(r.startAt.slice(0, 10) + "T00:00:00Z");
          const diffDays = (rMs - evMs) / MS_PER_DAY;
          return diffDays >= -10 && diffDays <= 18;
        })
        .slice(0, 4);
      return {
        ...ev,
        nearbyRounds,
      };
    });

    return {
      artist: artist ?? null,
      members: memberList,
      events: eventsWithRounds,
    };
  });
